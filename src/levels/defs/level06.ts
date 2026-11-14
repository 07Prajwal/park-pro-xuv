import type { Difficulty, LevelDef, LevelLayout } from '../types';
import { CAR, emptyLayout, HALF_PI } from './common';
import { reverseParallel } from './parallelPark';

export interface KerbsideStreet {
  layout: LevelLayout;
  gap: number;
  /** Parked-car length and width. */
  pl: number;
  pw: number;
  kerbGap: number;
}

/**
 * Street along +X with a kerb (road face at z = 0) and a pavement on the
 * left, and a parked line with a gap of `gap` metres centred at x = 0.
 */
export function kerbsideStreet(gap: number, kerbGap = 0.25): KerbsideStreet {
  const L = emptyLayout();
  const parkedScale = 0.94;
  const pl = CAR.lengthM * parkedScale;
  const pw = CAR.widthM * parkedScale;
  L.kerbs.push({ x: 0, z: -0.15, yaw: 0, w: 80, l: 0.3 });
  L.pavements.push({ x: 0, z: -1.8, yaw: 0, w: 80, l: 3 });
  const lane = 3.5;
  for (let x = -36; x <= 36; x += 6) L.lines.push({ x, z: lane * 2 - 0.2, yaw: HALF_PI, w: 0.12, l: 3 });
  const pz = kerbGap + pw / 2;
  const front = { x: gap / 2 + pl / 2, z: pz, yaw: HALF_PI, scale: parkedScale, colour: 0xb9bcbf };
  const rear = { x: -gap / 2 - pl / 2, z: pz, yaw: HALF_PI, scale: parkedScale, colour: 0x8e1016 };
  L.parkedCars.push(front, rear, { x: front.x + pl + 1.6, z: pz, yaw: HALF_PI, scale: 0.86, colour: 0x1f3f7a });
  L.parkedCars.push({ x: rear.x - pl - 1.4, z: pz, yaw: HALF_PI, scale: 1, colour: 0xe8e8e6 });
  // Start alongside the front parked car, 0.8 m away.
  L.spawn = { x: -14, z: pz + pw / 2 + 0.8 + CAR.widthM / 2, yaw: HALF_PI };
  return { layout: L, gap, pl, pw, kerbGap };
}

/** Level 6: reverse parallel parking into a gap on the left kerb. */
function parallel(d: Difficulty): LevelLayout {
  const { layout: L, gap, kerbGap } = kerbsideStreet({ beginner: 7.6, normal: 7.0, hard: 6.6 }[d]);
  L.target = {
    zone: { x: 0, z: kerbGap + CAR.widthM / 2 + 0.1, yaw: HALF_PI, w: CAR.widthM + 0.5, l: gap },
    facing: 'forward',
    maxAngleDeg: { beginner: 8, normal: 5, hard: 4 }[d],
    kerb: { rect: L.kerbs[0], maxGapM: { beginner: 0.5, normal: 0.35, hard: 0.3 }[d] },
  };
  L.ideal = reverseParallel(L, { gapX0: -gap / 2, gapX1: gap / 2, kerbZ: 0, finalGapM: kerbGap + 0.03, spawn: L.spawn, frontName: 'front parked car' });
  L.parTimeS = { beginner: 70, normal: 60, hard: 50 }[d];
  return L;
}

export const level06: LevelDef = {
  id: 6,
  title: 'Parallel parking (reverse, left kerb)',
  summary: 'Reverse into a gap between two parked cars along the kerb.',
  technique: [
    'Stop alongside the front car, about 0.8 m away, with your rear bumper a little short of its rear bumper (the hint gives the distance).',
    'Full left lock and reverse until about 45° to the kerb.',
    'Full right lock and reverse until parallel, close to the kerb without touching it, then stop.',
  ],
  build: parallel,
};
