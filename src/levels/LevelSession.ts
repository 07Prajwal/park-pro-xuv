/**
 * One attempt at a level: timer, penalties (direction changes, collisions,
 * cones, kerb touches, rolling back on a slope, speed bumps taken too fast),
 * progress through gates, intermediate parking stops and the final target,
 * the checkpoint (last place the car stood still) and the progress hint along
 * the ideal manoeuvre. Renderer-agnostic; the game feeds it the car state
 * every frame and reacts to the returned events.
 */

import type { CarDimensions } from '../config';
import { angleDiff, pointInRect, rectSeparation, tyreRects, type Vec2 } from './geometry';
import { samplePath, type SampledPath } from './idealPath';
import { alignmentOf, evaluateParking, scoreRun, type ParkingVerdict, type Score } from './scoring';
import type { Difficulty, LevelDef, LevelLayout, OrientedRect, ParkingTarget, Pose } from './types';
import { kerbRects } from './validate';

export interface CarState {
  pose: Pose;
  /** Height of the car's floor (physics origin), metres. */
  y: number;
  speedMs: number;
  selector: string;
  parkingBrake: boolean;
}

export interface SessionResult {
  score: Score;
  timeS: number;
  verdict: ParkingVerdict | null;
  usedCheckpoint: boolean;
  /** Set when the attempt ended without finishing. */
  failed?: string;
}

/** What happened this frame, for sounds and messages. */
export interface SessionEvents {
  kerb: boolean;
  /** Strength (0..1) of an axle going over a speed bump, 0 if none. */
  bump: number;
  bumpTooFast: boolean;
  rollback: boolean;
  /** An intermediate parking stop was completed. */
  stopDone: ParkingTarget | null;
}

const MOVING_MS = 0.25;
const STOPPED_MS = 0.05;
const CHECKPOINT_STILL_S = 0.6;
const CONTACT_COOLDOWN_S = 1.0;
const KERB_COOLDOWN_S = 1.0;
const PARKED_STILL_S = 0.4;
const ROLLING_MS = 0.05;
const LEVEL_TOLERANCE = 0.6;

export class LevelSession {
  readonly layout: LevelLayout;
  readonly path: SampledPath | null;
  readonly idealDirectionChanges: number;

  timeS = 0;
  started = false;
  finished = false;
  collisions = 0;
  conesHit = 0;
  kerbTouches = 0;
  rollbacks = 0;
  fastBumps = 0;
  directionChanges = 0;
  gateIndex = 0;
  stopIndex = 0;
  usedCheckpoint = false;
  checkpoint: Pose;
  checkpointY = 0;
  verdict: ParkingVerdict | null = null;
  result: SessionResult | null = null;
  /** Index into `path` nearest to the car (monotonic search window). */
  pathIndex = 0;

  private lastDir = 0;
  private stillTime = 0;
  private parkedTime = 0;
  private readonly contactCooldown = new Map<number, number>();
  private kerbCooldown = 0;
  private wasOnKerb = false;
  private readonly hitCones = new Set<number>();
  private readonly tyres: OrientedRect[] = [];
  private readonly kerbs: { rect: OrientedRect; y: number }[];
  /** Per bump: [front axle inside, rear axle inside]. */
  private readonly onBump: [boolean, boolean][];
  private rolled = 0;
  private rollCounted = false;
  private readonly events: SessionEvents = { kerb: false, bump: 0, bumpTooFast: false, rollback: false, stopDone: null };
  private readonly axle: Vec2 = { x: 0, z: 0 };

  constructor(
    readonly def: LevelDef,
    readonly difficulty: Difficulty,
    private readonly dim: CarDimensions,
  ) {
    this.layout = def.build(difficulty);
    this.checkpoint = { ...this.layout.spawn };
    this.path = this.layout.ideal ? samplePath(this.layout.spawn, this.layout.ideal, dim, 0.1) : null;
    const segs = this.layout.ideal ?? [];
    let changes = 0;
    for (let i = 1; i < segs.length; i++) if (segs[i].dir !== segs[i - 1].dir) changes++;
    this.idealDirectionChanges = changes;
    this.kerbs = kerbRects(this.layout);
    this.onBump = this.layout.bumps.map(() => [false, false]);
  }

  get isParkingLevel(): boolean {
    return !!this.layout.target;
  }

  get isCourse(): boolean {
    return !!this.layout.gates?.length;
  }

  get gatesDone(): boolean {
    return this.gateIndex >= (this.layout.gates?.length ?? 0);
  }

  /** The parking space the driver is working towards now (an intermediate stop or the final target). */
  get currentTarget(): ParkingTarget | null {
    if (!this.gatesDone) return null;
    return this.layout.stops?.[this.stopIndex] ?? this.layout.target ?? null;
  }

  /** Current hint: the next gate's instruction, then the ideal manoeuvre's. */
  get hint(): string {
    if (this.finished) return '';
    if (!this.gatesDone) return this.layout.gates![this.gateIndex].label;
    const t = this.currentTarget;
    if (t && this.verdict?.ok) return this.secureHint(t);
    const segs = this.layout.ideal;
    if (!segs || !this.path) return '';
    if (this.pathIndex >= this.path.poses.length - 3) return t ? this.secureHint(t) : '';
    return segs[this.path.segment[this.pathIndex]].hint;
  }

  /** Rectangle to highlight on the ground: the next gate, else the current parking space. */
  get highlight(): OrientedRect | null {
    if (this.finished) return null;
    if (!this.gatesDone) return this.layout.gates![this.gateIndex].rect;
    return this.currentTarget?.zone ?? null;
  }

  /** Contact with an obstacle collider (parked car, wall, pillar, lamp post). */
  onCollision(handle: number): boolean {
    if (this.finished) return false;
    const until = this.contactCooldown.get(handle) ?? -Infinity;
    const fresh = this.timeS >= until;
    this.contactCooldown.set(handle, this.timeS + CONTACT_COOLDOWN_S);
    if (fresh) this.collisions++;
    return fresh;
  }

  onConeHit(coneIndex: number): boolean {
    if (this.finished || this.hitCones.has(coneIndex)) return false;
    this.hitCones.add(coneIndex);
    this.conesHit++;
    return true;
  }

  update(car: CarState, dt: number): SessionEvents {
    const ev = this.events;
    ev.kerb = false;
    ev.bump = 0;
    ev.bumpTooFast = false;
    ev.rollback = false;
    ev.stopDone = null;
    if (this.finished) return ev;
    const moving = Math.abs(car.speedMs) > MOVING_MS;
    if (!this.started && moving) this.started = true;
    if (this.started) this.timeS += dt;

    // Direction changes (forward <-> reverse) count as corrections beyond the ideal number.
    if (moving) {
      const dir = Math.sign(car.speedMs);
      if (this.lastDir !== 0 && dir !== this.lastDir) this.directionChanges++;
      this.lastDir = dir;
    }

    // Checkpoint: wherever the car has been standing still for a moment.
    if (Math.abs(car.speedMs) < STOPPED_MS) {
      this.stillTime += dt;
      if (this.stillTime > CHECKPOINT_STILL_S) {
        this.checkpoint = { ...car.pose };
        this.checkpointY = car.y;
      }
    } else {
      this.stillTime = 0;
    }

    ev.kerb = this.updateKerb(car, dt);
    this.updateBumps(car);
    this.updateRollback(car, dt);
    this.updatePathIndex(car.pose);

    const limit = this.layout.rules?.kerbTouchLimit;
    if (limit !== undefined && this.kerbTouches > limit) {
      this.fail(`The wheels touched the kerb ${this.kerbTouches} times (${limit} allowed).`);
      return ev;
    }

    if (!this.gatesDone) {
      const g = this.layout.gates![this.gateIndex];
      if (pointInRect(car.pose, g.rect) && Math.abs((g.rect.level ?? 0) - car.y) < 1.5) {
        this.gateIndex++;
        if (this.gatesDone && !this.layout.target) this.finish(null);
      }
      return ev;
    }
    const t = this.currentTarget;
    if (!t) return ev;
    this.verdict = evaluateParking(car.pose, t, this.dim);
    const onFloor = Math.abs((t.zone.level ?? 0) - car.y) < 1;
    const secured = !t.needsParkingBrake || car.parkingBrake;
    if (onFloor && this.verdict.ok && Math.abs(car.speedMs) < STOPPED_MS && secured) {
      this.parkedTime += dt;
      if (this.parkedTime > PARKED_STILL_S) {
        this.parkedTime = 0;
        if (t === this.layout.target) this.finish(this.verdict);
        else {
          this.stopIndex++;
          this.verdict = null;
          ev.stopDone = t;
        }
      }
    } else {
      this.parkedTime = 0;
    }
    return ev;
  }

  restoreCheckpoint(): { pose: Pose; y: number } {
    this.usedCheckpoint = true;
    this.lastDir = 0;
    return { pose: { ...this.checkpoint }, y: this.checkpointY };
  }

  private secureHint(t: ParkingTarget): string {
    return t.needsParkingBrake ? 'Stop inside the space and apply the parking brake (Space).' : 'Stop inside the space.';
  }

  private updateKerb(car: CarState, dt: number): boolean {
    this.kerbCooldown -= dt;
    if (!this.kerbs.length) return false;
    tyreRects(car.pose, this.dim, this.tyres);
    let on = false;
    for (const k of this.kerbs) {
      if (Math.abs(k.y - car.y) > LEVEL_TOLERANCE) continue;
      for (const t of this.tyres) {
        if (rectSeparation(t, k.rect) < 0) {
          on = true;
          break;
        }
      }
      if (on) break;
    }
    const fresh = on && !this.wasOnKerb && this.kerbCooldown <= 0;
    this.wasOnKerb = on;
    if (fresh) {
      this.kerbTouches++;
      this.kerbCooldown = KERB_COOLDOWN_S;
    }
    return fresh;
  }

  /** Each axle entering a bump gives a thud; the front axle entering too fast is penalised. */
  private updateBumps(car: CarState): void {
    const bumps = this.layout.bumps;
    if (!bumps.length) return;
    const fx = Math.sin(car.pose.yaw);
    const fz = Math.cos(car.pose.yaw);
    const half = this.dim.wheelbaseM / 2;
    const speed = Math.abs(car.speedMs);
    const maxKmh = this.layout.rules?.bumpMaxKmh;
    bumps.forEach((b, i) => {
      if (Math.abs((b.level ?? 0) - car.y) > LEVEL_TOLERANCE) return;
      for (let a = 0; a < 2; a++) {
        const s = a === 0 ? half : -half;
        this.axle.x = car.pose.x + fx * s;
        this.axle.z = car.pose.z + fz * s;
        const inside = pointInRect(this.axle, b);
        const state = this.onBump[i];
        if (inside && !state[a]) {
          this.events.bump = Math.max(this.events.bump, Math.min(1, speed / 5));
          // The leading axle (front going forward, rear in reverse) sets the crossing speed.
          const leading = (a === 0) === car.speedMs >= 0;
          if (leading && maxKmh !== undefined && speed * 3.6 > maxKmh) {
            this.fastBumps++;
            this.events.bumpTooFast = true;
          }
        }
        state[a] = inside;
      }
    });
  }

  /** Rolling against the driven direction further than the rule allows counts once per roll. */
  private updateRollback(car: CarState, dt: number): void {
    const limit = this.layout.rules?.rollbackM;
    if (limit === undefined) return;
    const v = car.speedMs;
    const against = (car.selector === 'D' && v < -ROLLING_MS) || (car.selector === 'R' && v > ROLLING_MS);
    if (!against) {
      this.rolled = 0;
      this.rollCounted = false;
      return;
    }
    this.rolled += Math.abs(v) * dt;
    if (this.rolled > limit && !this.rollCounted) {
      this.rollCounted = true;
      this.rollbacks++;
      this.events.rollback = true;
    }
  }

  private updatePathIndex(pose: Pose): void {
    const p = this.path;
    if (!p) return;
    const lo = Math.max(0, this.pathIndex - 20);
    const hi = Math.min(p.poses.length - 1, this.pathIndex + 60);
    let best = this.pathIndex;
    let bestD = Infinity;
    for (let i = lo; i <= hi; i++) {
      const q = p.poses[i];
      const d = Math.hypot(q.x - pose.x, q.z - pose.z) + 1.5 * angleDiff(q.yaw, pose.yaw);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    this.pathIndex = best;
  }

  private fail(reason: string): void {
    this.finished = true;
    this.result = { score: { points: 0, stars: 1, breakdown: [] }, timeS: this.timeS, verdict: null, usedCheckpoint: this.usedCheckpoint, failed: reason };
  }

  private finish(verdict: ParkingVerdict | null): void {
    this.finished = true;
    const alignment = verdict && this.layout.target ? alignmentOf(verdict, this.layout.target, this.dim) : 1;
    const score = scoreRun(
      {
        timeS: this.timeS,
        directionChanges: this.directionChanges,
        idealDirectionChanges: this.idealDirectionChanges,
        collisions: this.collisions,
        conesHit: this.conesHit,
        kerbTouches: this.kerbTouches,
        kerbPenalty: this.layout.rules?.kerbPenalty,
        rollbacks: this.rollbacks,
        fastBumps: this.fastBumps,
        alignment,
      },
      this.layout.parTimeS,
      this.difficulty,
    );
    if (this.usedCheckpoint && score.stars === 3) score.stars = 2;
    this.result = { score, timeS: this.timeS, verdict, usedCheckpoint: this.usedCheckpoint };
  }
}
