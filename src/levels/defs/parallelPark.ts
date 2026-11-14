/**
 * Reverse parallel parking into a kerbside gap on the car's LEFT, shared by
 * levels 6, 7 and 9. Street along +X, the car heading +X, the kerb's road face
 * at z = kerbZ with the pavement towards -Z.
 *
 * The manoeuvre is the classic reverse S: drive up alongside the front
 * vehicle, full left lock until about 45° to the kerb, an optional straight,
 * then full right lock until parallel. The angle and the finishing position
 * are searched for the largest clearance to every obstacle.
 */

import { minRearAxleRadius } from '../../vehicle/steering';
import { endPose } from '../idealPath';
import type { LevelLayout, Pose, Segment } from '../types';
import { bestManoeuvre } from '../validate';
import { CAR, FOOT_OFF, metres, REAR_OVERHANG } from './common';

export interface ParallelOptions {
  /** Gap along +X: rear vehicle's front end (x0) to the front vehicle's rear end (x1). */
  gapX0: number;
  gapX1: number;
  kerbZ: number;
  /** Body-to-kerb gap at the end. */
  finalGapM: number;
  spawn: Pose;
  /** Name of the vehicle in front of the gap, for the first hint. */
  frontName: string;
}

export function reverseParallel(L: LevelLayout, o: ParallelOptions): Segment[] | undefined {
  const R = minRearAxleRadius(CAR);
  const zf = o.kerbZ + o.finalGapM + CAR.widthM / 2;
  const dz = o.spawn.z - zf;
  const candidates: Segment[][] = [];
  // The car may finish anywhere from just clear of the rear vehicle to the centre of the gap:
  // finishing deeper keeps the front corner clear of the front vehicle during the counter-steer.
  const xfMin = o.gapX0 + 0.2 + CAR.lengthM / 2 - FOOT_OFF;
  const xfMax = Math.max(xfMin, (o.gapX0 + o.gapX1) / 2 - FOOT_OFF);
  for (let deg = 25; deg <= 60; deg += 2) {
    const th = (deg * Math.PI) / 180;
    const straight = (dz - 2 * R * (1 - Math.cos(th))) / Math.sin(th);
    if (straight < 0) continue;
    // Distance the rear axle moves back along the kerb during the S.
    const back = 2 * R * Math.sin(th) + straight * Math.cos(th);
    const arc = R * th;
    const deg5 = Math.round(deg / 5) * 5;
    for (let j = 0; j <= 8; j++) {
      const xf = xfMin + ((xfMax - xfMin) * j) / 8;
      const a = xf + back - o.spawn.x;
      if (a < 0) continue;
      candidates.push([
        { dir: 1, steer: 0, dist: a, hint: '' },
        { dir: -1, steer: 1, dist: arc, hint: `Press S to reverse. Turn the wheel fully left and reverse slowly until the car is at about ${deg5}° to the kerb.` },
        ...(straight > 0.02
          ? [{ dir: -1 as const, steer: 0, dist: straight, hint: 'Straighten the wheel and reverse straight back until your front-left corner clears the vehicle in front.' }]
          : []),
        { dir: -1, steer: -1, dist: arc, hint: 'Turn the wheel fully right and keep reversing until the car is parallel to the kerb. Watch the left mirror for the kerb.' },
      ]);
    }
  }
  const ideal = bestManoeuvre(L, candidates, CAR);
  if (ideal) {
    const stop = endPose(o.spawn, ideal.slice(0, 1), CAR);
    const short = o.gapX1 - (stop.x - CAR.wheelbaseM / 2 - REAR_OVERHANG);
    ideal[0].hint = `Drive up alongside the ${o.frontName}, about 0.8 m away. Stop when your rear bumper is ${metres(short)} short of its rear end.`;
  }
  return ideal;
}
