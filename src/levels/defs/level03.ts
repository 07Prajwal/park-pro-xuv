import { solveStraightArcStraight } from '../idealPath';
import type { Difficulty, LevelDef, LevelLayout } from '../types';
import { bestManoeuvre } from '../validate';
import { bayLot } from './bayLot';
import { CAR, FOOT_OFF, HALF_PI, lockWord } from './common';

/** Level 3: drive forwards into a 90° bay between two parked cars. */
function forwardBay(d: Difficulty): LevelLayout {
  const { layout: L, bw, bl, aisle } = bayLot(d, 31);
  const z0 = -aisle + CAR.widthM / 2 + 0.45;
  L.spawn = { x: -17, z: z0, yaw: HALF_PI };
  const target = { x: 0, z: bl / 2 - FOOT_OFF, yaw: 0 };
  L.target = {
    zone: { x: 0, z: bl / 2, yaw: 0, w: bw, l: bl },
    facing: 'forward',
    maxAngleDeg: { beginner: 10, normal: 6, hard: 4 }[d],
  };
  const hints = (s: number): [string, string, string] => [
    'Drive slowly along the far side of the aisle. Start turning when your front bumper is level with the middle of the empty bay.',
    `Turn the wheel ${lockWord(s)} and drive forward slowly. Watch your left mirror: the front-left corner swings out towards the parked car.`,
    'Straighten the wheel as the car lines up with the bay, then drive in slowly until the front is about 30 cm from the wheel stop.',
  ];
  L.ideal = bestManoeuvre(
    L,
    [-1, -0.9, -0.8].map((s) => solveStraightArcStraight(L.spawn, target, 1, { dir: 1, steer: s }, 1, CAR, hints(s))),
    CAR,
  );
  L.parTimeS = { beginner: 45, normal: 40, hard: 35 }[d];
  return L;
}

export const level03: LevelDef = {
  id: 3,
  title: 'Forward bay parking (90°)',
  summary: 'Drive forwards into an empty bay between two parked cars.',
  technique: [
    'Keep to the far side of the aisle to give yourself room to turn.',
    'Start turning when your front bumper is level with the middle of the bay; the front corner swings wide.',
    'Straighten up inside the bay and stop just short of the wheel stop.',
  ],
  build: forwardBay,
};
