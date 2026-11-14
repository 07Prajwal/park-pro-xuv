/**
 * Steering geometry helpers (pure functions, no allocations when `out` is reused).
 *
 * Positive angles steer LEFT (rotation about +Y when +Z is forward).
 */

import type { CarDimensions, VehicleTuning } from '../config';

export interface WheelAngles {
  left: number;
  right: number;
}

/**
 * Lateral distance from the turn centre to the middle of the rear axle when the
 * outer front wheel traces `turningRadiusM` (i.e. at full lock).
 */
export function minRearAxleRadius(dim: CarDimensions): number {
  const L = dim.wheelbaseM;
  const R = dim.turningRadiusM;
  return Math.sqrt(R * R - L * L) - dim.trackFrontM / 2;
}

/** Equivalent "bicycle model" steer angle at full lock. */
export function maxCentreSteerAngle(dim: CarDimensions): number {
  return Math.atan(dim.wheelbaseM / minRearAxleRadius(dim));
}

/**
 * Ackermann split of a centre (bicycle) steer angle into left/right wheel angles,
 * so the inner wheel turns more than the outer one and neither tyre scrubs.
 */
export function ackermannAngles(centreAngle: number, dim: CarDimensions, out: WheelAngles): WheelAngles {
  const a = Math.abs(centreAngle);
  if (a < 1e-5) {
    out.left = centreAngle;
    out.right = centreAngle;
    return out;
  }
  const L = dim.wheelbaseM;
  const halfTrack = dim.trackFrontM / 2;
  const rc = L / Math.tan(a);
  const inner = Math.atan(L / (rc - halfTrack));
  const outer = Math.atan(L / (rc + halfTrack));
  if (centreAngle > 0) {
    out.left = inner;
    out.right = outer;
  } else {
    out.left = -outer;
    out.right = -inner;
  }
  return out;
}

/** Radius traced by the outer front wheel for a given centre steer angle. */
export function outerFrontRadius(centreAngle: number, dim: CarDimensions): number {
  const a = Math.abs(centreAngle);
  if (a < 1e-5) return Infinity;
  const L = dim.wheelbaseM;
  const rc = L / Math.tan(a);
  const lateral = rc + dim.trackFrontM / 2;
  return Math.sqrt(lateral * lateral + L * L);
}

/** Speed-sensitive lock factor: 1 at parking speeds, shrinking towards `minLockFactor` at highway speeds. */
export function speedLockFactor(speedKmh: number, tuning: VehicleTuning['steering']): number {
  const s = Math.abs(speedKmh);
  if (s <= tuning.reductionStartKmh) return 1;
  if (s >= tuning.reductionEndKmh) return tuning.minLockFactor;
  const t = (s - tuning.reductionStartKmh) / (tuning.reductionEndKmh - tuning.reductionStartKmh);
  // Smoothstep for a natural feel rather than a linear ramp.
  const k = t * t * (3 - 2 * t);
  return 1 + (tuning.minLockFactor - 1) * k;
}
