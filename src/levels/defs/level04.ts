import { solveStraightArcStraight } from '../idealPath';
import type { Difficulty, LevelDef, LevelLayout } from '../types';
import { bestManoeuvre } from '../validate';
import { bayLot } from './bayLot';
import { CAR, FOOT_OFF, firstStop, HALF_PI, lockWord, metres, REAR_OVERHANG } from './common';

/** Level 4: reverse into a 90° bay between two parked cars, nose out. */
function reverseBay(d: Difficulty): LevelLayout {
  const { layout: L, bw, bl } = bayLot(d, 47);
  const z0 = { beginner: -4.4, normal: -4.3, hard: -4.4 }[d];
  L.spawn = { x: -17, z: z0, yaw: HALF_PI };
  // Nose out: the car faces -Z when parked.
  const target = { x: 0, z: bl / 2 + FOOT_OFF, yaw: Math.PI };
  L.target = {
    zone: { x: 0, z: bl / 2, yaw: Math.PI, w: bw, l: bl },
    facing: 'forward',
    maxAngleDeg: { beginner: 10, normal: 6, hard: 4 }[d],
  };
  const hints = (s: number): [string, string, string] => [
    'Drive past the empty bay along the middle of the aisle and stop.',
    `Select R. Turn the wheel ${lockWord(s)} and reverse slowly. Check the reverse camera and both mirrors as the rear swings into the bay.`,
    'When the car is straight, centre the wheel and reverse straight back until the red guideline touches the wheel stop.',
  ];
  L.ideal = bestManoeuvre(
    L,
    [-1, -0.92, -0.85].map((s) => solveStraightArcStraight(L.spawn, target, 1, { dir: -1, steer: s }, -1, CAR, hints(s))),
    CAR,
  );
  const stop = firstStop(L);
  if (stop && L.ideal) {
    const past = stop.x - CAR.wheelbaseM / 2 - REAR_OVERHANG - bw / 2;
    L.ideal[0].hint = `Drive past the empty bay along the middle of the aisle. Stop when your rear bumper is about ${metres(past)} past the far line of the bay.`;
  }
  L.parTimeS = { beginner: 60, normal: 50, hard: 45 }[d];
  return L;
}

export const level04: LevelDef = {
  id: 4,
  title: 'Reverse bay parking (90°)',
  summary: 'Reverse into a bay between two parked cars — the most common way to park in India.',
  technique: [
    'Drive past the bay and stop with your rear bumper about one bay-width past it (the hint gives the exact distance).',
    'Select R, turn fully towards the bay and reverse slowly, checking both mirrors.',
    'Straighten up and reverse until the red guideline reaches the wheel stop. Select P.',
  ],
  build: reverseBay,
};
