/**
 * Ultrasonic parking sensors: four in the front bumper and four in the rear,
 * modelled as horizontal ray casts at bumper height. Centre sensors look
 * straight ahead / back (range 1.5 m); corner sensors look diagonally outward
 * (range 0.6 m), like real bumper sensors.
 *
 * Active in R, and in D below 12 km/h. Renderer-agnostic (testable in Node).
 */

import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { CarDimensions } from '../config';

type Rapier = typeof RAPIER_NS;

export const SENSOR_COUNT = 8;
/** Index ranges: 0-3 front (left corner, left centre, right centre, right corner), 4-7 rear in the same order. */
export const FRONT = [0, 1, 2, 3] as const;
export const REAR = [4, 5, 6, 7] as const;
export const SENSOR_ACTIVE_MAX_KMH = 12;
const CENTRE_RANGE_M = 1.5;
const CORNER_RANGE_M = 0.6;
const HEIGHT_M = 0.5;
const UPDATE_INTERVAL_S = 0.05;

interface Sensor {
  /** Body-frame origin (physics origin frame) and direction. */
  ox: number;
  oz: number;
  dx: number;
  dz: number;
  range: number;
}

export class ParkingSensors {
  /** Distance to the nearest obstacle per sensor, metres (Infinity when nothing in range). */
  readonly distances = new Float32Array(SENSOR_COUNT).fill(Infinity);
  active = false;
  /** Nearest distance over the active sensors, or null when inactive. */
  nearest: number | null = null;

  private readonly sensors: Sensor[] = [];
  private readonly ray: RAPIER_NS.Ray;
  private timer = 0;

  constructor(
    R: Rapier,
    private readonly world: RAPIER_NS.World,
    private readonly body: RAPIER_NS.RigidBody,
    dim: CarDimensions,
  ) {
    const rearOverhang = dim.lengthM - dim.wheelbaseM - dim.frontOverhangM;
    const zFront = dim.wheelbaseM / 2 + dim.frontOverhangM - 0.02;
    const zRear = -dim.wheelbaseM / 2 - rearOverhang + 0.02;
    const cornerX = dim.widthM / 2 - 0.16;
    const innerX = 0.35;
    const diag = Math.SQRT1_2;
    for (const [z, fwd] of [
      [zFront, 1],
      [zRear, -1],
    ] as const) {
      // Left (+X) corner, left centre, right centre, right (-X) corner.
      this.sensors.push(
        { ox: cornerX, oz: z - fwd * 0.12, dx: diag, dz: fwd * diag, range: CORNER_RANGE_M },
        { ox: innerX, oz: z, dx: 0, dz: fwd, range: CENTRE_RANGE_M },
        { ox: -innerX, oz: z, dx: 0, dz: fwd, range: CENTRE_RANGE_M },
        { ox: -cornerX, oz: z - fwd * 0.12, dx: -diag, dz: fwd * diag, range: CORNER_RANGE_M },
      );
    }
    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  }

  /** Call once per rendered frame after the physics step. */
  update(dt: number, selector: string, speedKmh: number, force = false): void {
    this.active = selector === 'R' || (selector === 'D' && Math.abs(speedKmh) < SENSOR_ACTIVE_MAX_KMH);
    if (!this.active) {
      this.nearest = null;
      this.distances.fill(Infinity);
      return;
    }
    this.timer -= dt;
    if (this.timer > 0 && !force) return;
    this.timer = UPDATE_INTERVAL_S;

    const t = this.body.translation();
    const q = this.body.rotation();
    let nearest = Infinity;
    for (let i = 0; i < SENSOR_COUNT; i++) {
      const s = this.sensors[i];
      rotate(q, s.ox, HEIGHT_M, s.oz, this.ray.origin);
      this.ray.origin.x += t.x;
      this.ray.origin.y += t.y;
      this.ray.origin.z += t.z;
      rotate(q, s.dx, 0, s.dz, this.ray.dir);
      const hit = this.world.castRay(this.ray, s.range, true, undefined, undefined, undefined, this.body);
      const d = hit ? hit.timeOfImpact : Infinity;
      this.distances[i] = d;
      if (d < nearest) nearest = d;
    }
    this.nearest = nearest;
  }
}

function rotate(q: { x: number; y: number; z: number; w: number }, x: number, y: number, z: number, out: { x: number; y: number; z: number }): void {
  // v' = v + 2w(q x v) + 2 q x (q x v)
  const cx = q.y * z - q.z * y;
  const cy = q.z * x - q.x * z;
  const cz = q.x * y - q.y * x;
  out.x = x + 2 * (q.w * cx + q.y * cz - q.z * cy);
  out.y = y + 2 * (q.w * cy + q.z * cx - q.x * cz);
  out.z = z + 2 * (q.w * cz + q.x * cy - q.y * cx);
}
