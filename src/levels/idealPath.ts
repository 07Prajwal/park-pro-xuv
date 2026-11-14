/**
 * Ideal manoeuvres: segment lists (straight or constant-steer arcs, forward or
 * reverse) turned into dense pose samples with the same kinematic bicycle model
 * the reverse guidelines use (the rear axle doesn't steer, so the car rotates
 * about a point on the rear-axle line).
 *
 * Also contains the small solvers the level definitions use to place the
 * manoeuvre exactly into the target bay.
 */

import type { CarDimensions } from '../config';
import { maxCentreSteerAngle } from '../vehicle/steering';
import type { Pose, Segment } from './types';

export interface SampledPath {
  poses: Pose[];
  /** Index of the segment each pose belongs to. */
  segment: number[];
  /** Cumulative travelled distance at each pose. */
  s: number[];
}

/** Curvature (1/m) of the rear-axle path for a steering position (-1..1). */
export function curvature(steer: number, d: CarDimensions): number {
  return Math.tan(steer * maxCentreSteerAngle(d)) / d.wheelbaseM;
}

/** Advance a physics-origin pose along one segment by distance `ds` (>= 0). */
export function advance(p: Pose, seg: Segment, ds: number, d: CarDimensions, out: Pose): Pose {
  const halfWb = d.wheelbaseM / 2;
  // Rear axle position.
  let rx = p.x - Math.sin(p.yaw) * halfWb;
  let rz = p.z - Math.cos(p.yaw) * halfWb;
  const k = curvature(seg.steer, d);
  const s = ds * seg.dir;
  let yaw = p.yaw;
  if (Math.abs(k) < 1e-9) {
    rx += Math.sin(yaw) * s;
    rz += Math.cos(yaw) * s;
  } else {
    const yaw1 = yaw + k * s;
    // Integral of (sin, cos)(yaw) d(s) along the arc.
    rx += (Math.cos(yaw) - Math.cos(yaw1)) / k;
    rz += (Math.sin(yaw1) - Math.sin(yaw)) / k;
    yaw = yaw1;
  }
  out.yaw = yaw;
  out.x = rx + Math.sin(yaw) * halfWb;
  out.z = rz + Math.cos(yaw) * halfWb;
  return out;
}

export function samplePath(start: Pose, segs: Segment[], d: CarDimensions, step = 0.1): SampledPath {
  const poses: Pose[] = [{ ...start }];
  const segment: number[] = [0];
  const s: number[] = [0];
  let cur: Pose = { ...start };
  let total = 0;
  segs.forEach((seg, i) => {
    const n = Math.max(1, Math.ceil(seg.dist / step));
    const ds = seg.dist / n;
    for (let j = 0; j < n; j++) {
      const next = advance(cur, seg, ds, d, { x: 0, z: 0, yaw: 0 });
      total += ds;
      poses.push(next);
      segment.push(i);
      s.push(total);
      cur = next;
    }
  });
  return { poses, segment, s };
}

export function endPose(start: Pose, segs: Segment[], d: CarDimensions): Pose {
  let cur: Pose = { ...start };
  for (const seg of segs) cur = advance(cur, seg, seg.dist, d, { x: 0, z: 0, yaw: 0 });
  return cur;
}

/**
 * Straight -> arc -> straight into a target pose. The arc (steer, signed yaw
 * change) is given; the two straight lengths are solved so the car ends exactly
 * at `target`. Returns null when either straight would be negative.
 */
export function solveStraightArcStraight(
  start: Pose,
  target: Pose,
  dir1: 1 | -1,
  arc: { dir: 1 | -1; steer: number },
  dir2: 1 | -1,
  d: CarDimensions,
  hints: [string, string, string],
): Segment[] | null {
  const k = curvature(arc.steer, d);
  // Arc length needed for the heading change from start to target yaw.
  let dYaw = target.yaw - start.yaw;
  dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
  const arcLen = (dYaw / k) * arc.dir;
  if (!(arcLen > 0)) return null;
  // Arc displacement from the origin of a zero-length first straight.
  const arcSeg: Segment = { dir: arc.dir, steer: arc.steer, dist: arcLen, hint: hints[1] };
  const p0 = advance(start, arcSeg, arcLen, d, { x: 0, z: 0, yaw: 0 });
  // p0 + a * dir1 * f(start.yaw) + b * dir2 * f(target.yaw) = target
  const ax = Math.sin(start.yaw) * dir1;
  const az = Math.cos(start.yaw) * dir1;
  const bx = Math.sin(target.yaw) * dir2;
  const bz = Math.cos(target.yaw) * dir2;
  const ex = target.x - p0.x;
  const ez = target.z - p0.z;
  const det = ax * bz - az * bx;
  if (Math.abs(det) < 1e-6) return null;
  const a = (ex * bz - ez * bx) / det;
  const b = (ax * ez - az * ex) / det;
  if (a < -1e-6 || b < -1e-6) return null;
  return [
    { dir: dir1, steer: 0, dist: Math.max(a, 0), hint: hints[0] },
    arcSeg,
    { dir: dir2, steer: 0, dist: Math.max(b, 0), hint: hints[2] },
  ].filter((sg) => sg.dist > 1e-3);
}
