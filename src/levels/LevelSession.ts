/**
 * One attempt at a level: timer, penalties (direction changes, collisions,
 * cones, kerb touches), gate progress, the parking verdict, the checkpoint
 * (last pose where the car stood still) and the progress hint along the ideal
 * manoeuvre. Renderer-agnostic; the game feeds it the car state every frame.
 */

import type { CarDimensions } from '../config';
import { angleDiff, pointInRect, rectSeparation, tyreRects } from './geometry';
import { samplePath, type SampledPath } from './idealPath';
import { alignmentOf, evaluateParking, scoreRun, type ParkingVerdict, type Score } from './scoring';
import type { Difficulty, LevelDef, LevelLayout, OrientedRect, Pose } from './types';

export interface CarState {
  pose: Pose;
  speedMs: number;
  selector: string;
  parkingBrake: boolean;
}

export interface SessionResult {
  score: Score;
  timeS: number;
  verdict: ParkingVerdict | null;
  usedCheckpoint: boolean;
}

const MOVING_MS = 0.25;
const STOPPED_MS = 0.05;
const CHECKPOINT_STILL_S = 0.6;
const CONTACT_COOLDOWN_S = 1.0;
const KERB_COOLDOWN_S = 1.0;
const PARKED_STILL_S = 0.4;

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
  directionChanges = 0;
  gateIndex = 0;
  usedCheckpoint = false;
  checkpoint: Pose;
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
  }

  get isParkingLevel(): boolean {
    return !!this.layout.target;
  }

  get isCourse(): boolean {
    return !!this.layout.gates?.length;
  }

  /** Current hint from the ideal manoeuvre, or the gate instruction. */
  get hint(): string {
    if (this.finished) return '';
    if (this.isCourse) return this.layout.gates![this.gateIndex]?.label ?? '';
    const segs = this.layout.ideal;
    if (!segs || !this.path) return '';
    if (this.pathIndex >= this.path.poses.length - 3) return 'Stop, select P (or apply the parking brake).';
    return segs[this.path.segment[this.pathIndex]].hint;
  }

  /** Next gate rectangle (course levels). */
  get nextGate(): OrientedRect | null {
    return this.isCourse && !this.finished ? (this.layout.gates![this.gateIndex]?.rect ?? null) : null;
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

  /** Returns true when a new kerb touch was registered this frame. */
  update(car: CarState, dt: number): boolean {
    if (this.finished) return false;
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
      if (this.stillTime > CHECKPOINT_STILL_S) this.checkpoint = { ...car.pose };
    } else {
      this.stillTime = 0;
    }

    const newKerb = this.updateKerb(car.pose, dt);
    this.updatePathIndex(car.pose);

    if (this.isCourse) {
      const g = this.layout.gates![this.gateIndex];
      if (g && pointInRect(car.pose, g.rect)) {
        this.gateIndex++;
        if (this.gateIndex >= this.layout.gates!.length) this.finish(null);
      }
    } else if (this.layout.target) {
      this.verdict = evaluateParking(car.pose, this.layout.target, this.dim);
      const secured = car.selector === 'P' || car.parkingBrake;
      if (this.verdict.ok && Math.abs(car.speedMs) < STOPPED_MS && secured) {
        this.parkedTime += dt;
        if (this.parkedTime > PARKED_STILL_S) this.finish(this.verdict);
      } else {
        this.parkedTime = 0;
      }
    }
    return newKerb;
  }

  restoreCheckpoint(): Pose {
    this.usedCheckpoint = true;
    this.lastDir = 0;
    return { ...this.checkpoint };
  }

  private updateKerb(pose: Pose, dt: number): boolean {
    this.kerbCooldown -= dt;
    if (!this.layout.kerbs.length) return false;
    tyreRects(pose, this.dim, this.tyres);
    let on = false;
    for (const t of this.tyres) {
      for (const k of this.layout.kerbs) {
        if (rectSeparation(t, k) < 0) {
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
        alignment,
      },
      this.layout.parTimeS,
      this.difficulty,
    );
    if (this.usedCheckpoint && score.stars === 3) score.stars = 2;
    this.result = { score, timeS: this.timeS, verdict, usedCheckpoint: this.usedCheckpoint };
  }
}
