import type { Difficulty, LevelDef, LevelLayout } from '../types';
import { CAR, HALF_PI } from './common';
import { kerbsideStreet } from './level06';
import { reverseParallel } from './parallelPark';

/**
 * Level 7: the parallel-parking street with a taller (20 cm) kerb that
 * scrapes alloys. Finish closer to the kerb than in level 6; one kerb touch
 * costs heavily and a second ends the attempt.
 */
function kerbLimit(d: Difficulty): LevelLayout {
  const { layout: L, gap } = kerbsideStreet({ beginner: 7.4, normal: 6.9, hard: 6.6 }[d], 0.18);
  L.kerbHeightM = 0.2;
  L.target = {
    zone: { x: 0, z: CAR.widthM / 2 + 0.2, yaw: HALF_PI, w: CAR.widthM + 0.4, l: gap },
    facing: 'forward',
    maxAngleDeg: { beginner: 6, normal: 4, hard: 3 }[d],
    kerb: { rect: L.kerbs[0], maxGapM: { beginner: 0.4, normal: 0.3, hard: 0.25 }[d] },
  };
  L.rules = { kerbTouchLimit: 1, kerbPenalty: 25 };
  L.ideal = reverseParallel(L, { gapX0: -gap / 2, gapX1: gap / 2, kerbZ: 0, finalGapM: 0.15, spawn: L.spawn, frontName: 'front parked car' });
  if (L.ideal) {
    const last = L.ideal[L.ideal.length - 1];
    last.hint = 'Turn the wheel fully right and keep reversing until parallel. Watch the left mirror: stop turning before the rear tyre reaches the kerb.';
  }
  L.parTimeS = { beginner: 75, normal: 65, hard: 55 }[d];
  return L;
}

export const level07: LevelDef = {
  id: 7,
  title: 'Parallel parking with a kerb limit',
  summary: 'Park within 30 cm of a tall kerb. One kerb touch costs 25 points; a second ends the attempt.',
  technique: [
    'Set up exactly as in level 6, alongside the front car about 0.8 m away.',
    'Reverse with full left lock to about 45°, then straighten. From here on, watch the kerb in the left mirror rather than the car in front.',
    'Full right lock to come parallel. If the rear tyre is about to touch, stop, pull forward a little and correct — a correction costs less than a scrape.',
  ],
  build: kerbLimit,
};
