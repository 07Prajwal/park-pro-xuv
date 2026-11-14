/**
 * 2D ground-plane geometry for levels: oriented rectangles, the car footprint,
 * overlap / clearance tests and point containment. Pure and allocation-light;
 * used at runtime for success checks and by the tests that prove every level
 * is solvable.
 */

import type { CarDimensions } from '../config';
import type { OrientedRect, Pose } from './types';

export interface Vec2 {
  x: number;
  z: number;
}

/** Forward (sin, cos) and left (cos, -sin) axes for a yaw. */
export function axes(yaw: number): { fx: number; fz: number; lx: number; lz: number } {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  return { fx: s, fz: c, lx: c, lz: -s };
}

/** Corners of an oriented rectangle (front-left, front-right, rear-right, rear-left). */
export function rectCorners(r: OrientedRect, out: Vec2[] = [{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }]): Vec2[] {
  const a = axes(r.yaw);
  const hl = r.l / 2;
  const hw = r.w / 2;
  const signs = [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ];
  for (let i = 0; i < 4; i++) {
    const [f, l] = signs[i];
    out[i].x = r.x + a.fx * hl * f + a.lx * hw * l;
    out[i].z = r.z + a.fz * hl * f + a.lz * hw * l;
  }
  return out;
}

/** The car's body footprint as an oriented rectangle for a physics-origin pose. */
export function carFootprint(p: Pose, d: CarDimensions, out: OrientedRect = { x: 0, z: 0, yaw: 0, w: 0, l: 0 }): OrientedRect {
  const rearOverhang = d.lengthM - d.wheelbaseM - d.frontOverhangM;
  const off = (d.frontOverhangM - rearOverhang) / 2; // footprint centre ahead of the origin
  out.x = p.x + Math.sin(p.yaw) * off;
  out.z = p.z + Math.cos(p.yaw) * off;
  out.yaw = p.yaw;
  out.w = d.widthM;
  out.l = d.lengthM;
  return out;
}

/** True if point p is inside rectangle r (with an optional inward margin). */
export function pointInRect(p: Vec2, r: OrientedRect, margin = 0): boolean {
  const a = axes(r.yaw);
  const dx = p.x - r.x;
  const dz = p.z - r.z;
  const along = dx * a.fx + dz * a.fz;
  const across = dx * a.lx + dz * a.lz;
  return Math.abs(along) <= r.l / 2 - margin && Math.abs(across) <= r.w / 2 - margin;
}

/**
 * Signed separation between two oriented rectangles: positive = gap (lower
 * bound of the true distance, exact along separating axes), negative = overlap
 * depth along the least-penetration axis.
 */
export function rectSeparation(a: OrientedRect, b: OrientedRect): number {
  const ca = rectCorners(a, SCRATCH_A);
  const cb = rectCorners(b, SCRATCH_B);
  let best = -Infinity;
  for (const r of [a, b]) {
    const ax = axes(r.yaw);
    for (const [ux, uz] of [
      [ax.fx, ax.fz],
      [ax.lx, ax.lz],
    ]) {
      let minA = Infinity;
      let maxA = -Infinity;
      let minB = Infinity;
      let maxB = -Infinity;
      for (let i = 0; i < 4; i++) {
        const pa = ca[i].x * ux + ca[i].z * uz;
        const pb = cb[i].x * ux + cb[i].z * uz;
        minA = Math.min(minA, pa);
        maxA = Math.max(maxA, pa);
        minB = Math.min(minB, pb);
        maxB = Math.max(maxB, pb);
      }
      const gap = Math.max(minB - maxA, minA - maxB);
      best = Math.max(best, gap);
    }
  }
  return best;
}

const SCRATCH_A: Vec2[] = [{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }];
const SCRATCH_B: Vec2[] = [{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }];

/** Smallest absolute angle between two yaws, radians (0..PI). */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

/** Tyre contact patches (one rectangle per wheel) for a pose. */
export function tyreRects(p: Pose, d: CarDimensions, out: OrientedRect[]): OrientedRect[] {
  const a = axes(p.yaw);
  const hw = d.wheelbaseM / 2;
  const tracks = [d.trackFrontM / 2, -d.trackFrontM / 2, d.trackRearM / 2, -d.trackRearM / 2];
  for (let i = 0; i < 4; i++) {
    const f = i < 2 ? hw : -hw;
    const r = out[i] ?? (out[i] = { x: 0, z: 0, yaw: 0, w: 0, l: 0 });
    r.x = p.x + a.fx * f + a.lx * tracks[i];
    r.z = p.z + a.fz * f + a.lz * tracks[i];
    r.yaw = p.yaw;
    r.w = d.wheelWidthM;
    r.l = d.wheelRadiusM * 1.2;
  }
  return out;
}
