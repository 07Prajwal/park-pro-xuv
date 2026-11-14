import { minRearAxleRadius } from '../../vehicle/steering';
import { carFootprint, rectSeparation, tyreRects } from '../geometry';
import { endPose } from '../idealPath';
import { evaluateParking } from '../scoring';
import type { Difficulty, LevelDef, LevelLayout, Segment } from '../types';
import { ClearanceChecker, pathClearance } from '../validate';
import { CAR, emptyLayout, metres } from './common';

const DEG = Math.PI / 180;
const TURN_Z = 0;
const RUN_IN = 12;
const RUN_OUT = 3;

/** Smallest gap between any tyre and any kerb at the end of `segs` (metres). */
function tyreToKerb(L: LevelLayout, segs: Segment[]): number {
  const p = endPose(L.spawn, segs, CAR);
  let min = Infinity;
  for (const t of tyreRects(p, CAR, [])) for (const k of L.kerbs) min = Math.min(min, rectSeparation(t, k));
  return min;
}

/** Smallest gap between the car body and any wall at the end of `segs` (metres). */
function bodyToWall(L: LevelLayout, segs: Segment[]): number {
  const fp = carFootprint(endPose(L.spawn, segs, CAR), CAR);
  let min = Infinity;
  for (const b of L.blocks) min = Math.min(min, rectSeparation(fp, b.rect));
  return min;
}

/**
 * Level 11: turn round on a road narrower than the turning circle. On
 * Beginner the road is just wide enough for a U-turn in one sweep; on Normal
 * and Hard it needs a three-point (K) turn: forward on full right lock,
 * reverse on full left lock, then forward on full right lock again.
 */
function turnRound(d: Difficulty): LevelLayout {
  const L = emptyLayout();
  const W = { beginner: 11.8, normal: 8.2, hard: 7.4 }[d];
  const len = 90;
  // Road along Z between kerbs; pavements and compound walls beyond.
  for (const side of [1, -1]) {
    L.kerbs.push({ x: side * (W / 2 + 0.15), z: 0, yaw: 0, w: 0.3, l: len });
    L.pavements.push({ x: side * (W / 2 + 1.2), z: 0, yaw: 0, w: 1.8, l: len });
    L.blocks.push({ rect: { x: side * (W / 2 + 2.2), z: 0, yaw: 0, w: 0.23, l: len }, height: 1.8, material: side > 0 ? 'brick' : 'plaster', tint: 0xe9e5de });
  }
  for (let z = -40; z <= 40; z += 6) L.lines.push({ x: 0, z, yaw: 0, w: 0.12, l: 3 });
  L.spawn = { x: W / 2 - 0.6 - CAR.widthM / 2, z: TURN_Z - RUN_IN - 4, yaw: 0 };
  // Finish in the left lane for the opposite direction (the -X half of the road).
  L.target = {
    zone: { x: -W / 4, z: TURN_Z - 6, yaw: Math.PI, w: W / 2 - 0.1, l: 30 },
    facing: 'forward',
    maxAngleDeg: { beginner: 10, normal: 8, hard: 6 }[d],
    name: 'left lane',
  };

  const R = minRearAxleRadius(CAR);
  const runIn: Segment = { dir: 1, steer: 0, dist: RUN_IN, hint: 'Drive slowly in the left lane. Check behind and ahead: the road must be clear before you turn.' };
  const out: Segment = { dir: 1, steer: 0, dist: RUN_OUT, hint: 'Straighten up in the left lane, stop and select P.' };
  const ok = (segs: Segment[]) => evaluateParking(endPose(L.spawn, segs, CAR), L.target!, CAR).ok;

  const checker = new ClearanceChecker(L, CAR);
  let best: Segment[] | undefined;
  let bestC = -Infinity;
  const uTurn: Segment[] = [runIn, { dir: 1, steer: -1, dist: Math.PI * R, hint: 'Turn the wheel fully right and drive round in one sweep, slowly.' }, out];
  if (ok(uTurn)) {
    const c = pathClearance(L, uTurn, CAR, 0.1, -Infinity, checker);
    if (c >= 0.1) {
      best = uTurn;
      bestC = c;
    }
  }
  if (!best) {
    for (let t1 = 30; t1 <= 150; t1 += 4) {
      for (let t2 = 4; t1 + t2 < 180; t2 += 4) {
        const t3 = 180 - t1 - t2;
        const segs: Segment[] = [
          runIn,
          { dir: 1, steer: -1, dist: t1 * DEG * R, hint: '' },
          { dir: -1, steer: 1, dist: t2 * DEG * R, hint: '' },
          { dir: 1, steer: -1, dist: t3 * DEG * R, hint: 'Select D, turn the wheel fully right again and drive round into the left lane.' },
          out,
        ];
        if (!ok(segs)) continue;
        const c = pathClearance(L, segs, CAR, 0.1, bestC, checker);
        if (c > bestC) {
          bestC = c;
          best = segs;
        }
      }
    }
    if (best) {
      const toFar = tyreToKerb(L, best.slice(0, 2));
      const toWall = bodyToWall(L, best.slice(0, 3));
      best[1].hint = `Turn the wheel fully right and creep across. Stop when your front tyres are about ${metres(toFar)} from the far kerb.`;
      best[2].hint = `Select R. Turn the wheel fully left and reverse slowly. Stop with the rear bumper about ${metres(toWall)} from the wall behind (the kerb passes under the bumper).`;
    }
  }
  L.ideal = best;
  L.parTimeS = { beginner: 30, normal: 45, hard: 50 }[d];
  return L;
}

export const level11: LevelDef = {
  id: 11,
  title: 'U-turn and three-point turn',
  summary: 'Turn round on a road narrower than the XUV’s turning circle and finish in the left lane facing the other way.',
  technique: [
    'Stop close to the left kerb. Check both ways; the turn blocks the whole road.',
    'Full right lock and creep forward. Stop before the front tyres touch the far kerb.',
    'Select R, full left lock, and reverse slowly. The bumper may pass over the kerb — stop before the wall.',
    'Select D, full right lock again and drive away in the left lane. On a wider road (Beginner) one sweep is enough.',
  ],
  build: turnRound,
};
