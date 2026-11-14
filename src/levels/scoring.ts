/**
 * Parking verdict (is the car correctly parked?) and the 1-3 star score.
 */

import type { CarDimensions } from '../config';
import { angleDiff, carFootprint, pointInRect, rectCorners, rectSeparation } from './geometry';
import type { Difficulty, OrientedRect, ParkingTarget, Pose } from './types';

export interface ParkingVerdict {
  inside: boolean;
  angleDeg: number;
  /** Body-to-kerb gap for kerbside targets, metres (negative = over the kerb). */
  kerbGapM?: number;
  /** Sideways offset of the car centre from the zone centre line, metres. */
  offsetM: number;
  ok: boolean;
  /** Short reason when not ok. */
  reason?: string;
}

const FP: OrientedRect = { x: 0, z: 0, yaw: 0, w: 0, l: 0 };

export function evaluateParking(p: Pose, t: ParkingTarget, d: CarDimensions): ParkingVerdict {
  const fp = carFootprint(p, d, FP);
  const inside = rectCorners(fp).every((c) => pointInRect(c, t.zone, -1e-6));
  const wantYaw = t.facing === 'reverse' ? t.zone.yaw + Math.PI : t.zone.yaw;
  let ang = angleDiff(p.yaw, wantYaw);
  if (t.facing === 'any') ang = Math.min(ang, angleDiff(p.yaw, t.zone.yaw + Math.PI));
  const angleDeg = (ang * 180) / Math.PI;
  const lx = Math.cos(t.zone.yaw);
  const lz = -Math.sin(t.zone.yaw);
  const offsetM = Math.abs((fp.x - t.zone.x) * lx + (fp.z - t.zone.z) * lz);
  let kerbGapM: number | undefined;
  let reason: string | undefined;
  if (t.kerb) kerbGapM = rectSeparation(fp, t.kerb.rect);
  if (!inside) reason = 'Not fully inside the space';
  else if (angleDeg > t.maxAngleDeg) reason = `Not straight: ${angleDeg.toFixed(1)}° off (max ${t.maxAngleDeg}°)`;
  else if (t.kerb && kerbGapM !== undefined && kerbGapM > t.kerb.maxGapM)
    reason = `Too far from the kerb: ${(kerbGapM * 100).toFixed(0)} cm (max ${(t.kerb.maxGapM * 100).toFixed(0)} cm)`;
  return { inside, angleDeg, kerbGapM, offsetM, ok: !reason, reason };
}

export interface RunStats {
  timeS: number;
  /** Direction changes (forward <-> reverse) made by the driver. */
  directionChanges: number;
  /** Direction changes in the ideal manoeuvre. */
  idealDirectionChanges: number;
  collisions: number;
  conesHit: number;
  kerbTouches: number;
  /** Points per kerb touch before strictness (default 5). */
  kerbPenalty?: number;
  /** Times the car rolled against the selected gear on a slope. */
  rollbacks?: number;
  /** Speed bumps crossed too fast. */
  fastBumps?: number;
  /** 0..1, where 1 is perfectly aligned and centred (parking levels). */
  alignment: number;
}

export interface Score {
  points: number;
  stars: 1 | 2 | 3;
  breakdown: { label: string; value: number }[];
}

const STRICTNESS: Record<Difficulty, number> = { beginner: 0.7, normal: 1, hard: 1.3 };

export function scoreRun(s: RunStats, parTimeS: number, d: Difficulty): Score {
  const k = STRICTNESS[d];
  const over = parTimeS > 0 ? Math.max(0, s.timeS - parTimeS) : 0;
  const breakdown = [
    { label: 'Time', value: -Math.min(25, (over / 2) * k) },
    { label: 'Corrections', value: -Math.max(0, s.directionChanges - s.idealDirectionChanges) * 5 * k },
    { label: 'Collisions', value: -s.collisions * 20 * k },
    { label: 'Cones', value: -s.conesHit * 8 * k },
    { label: 'Kerb touches', value: -s.kerbTouches * (s.kerbPenalty ?? 5) * k },
    { label: 'Rolling back', value: -(s.rollbacks ?? 0) * 10 * k },
    { label: 'Speed bumps too fast', value: -(s.fastBumps ?? 0) * 8 * k },
    { label: 'Alignment', value: -(1 - Math.min(1, Math.max(0, s.alignment))) * 20 * k },
  ].map((b) => ({ label: b.label, value: Math.round(b.value) }));
  const points = Math.max(0, 100 + breakdown.reduce((a, b) => a + b.value, 0));
  const stars = points >= 85 ? 3 : points >= 65 ? 2 : 1;
  return { points, stars, breakdown };
}

/** Alignment quality 0..1 from a verdict: half angle error, half centring. */
export function alignmentOf(v: ParkingVerdict, t: ParkingTarget, d: CarDimensions): number {
  const angleQ = 1 - Math.min(1, v.angleDeg / t.maxAngleDeg);
  const slack = Math.max(0.05, (t.zone.w - d.widthM) / 2);
  const centreQ = t.kerb ? 1 - Math.min(1, Math.max(0, v.kerbGapM ?? 0) / t.kerb.maxGapM) : 1 - Math.min(1, v.offsetM / slack);
  return 0.5 * angleQ + 0.5 * centreQ;
}
