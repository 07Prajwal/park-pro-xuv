import { solveStraightArcStraight } from '../idealPath';
import type { Difficulty, LevelDef, LevelLayout } from '../types';
import { bestManoeuvre } from '../validate';
import { CAR, emptyLayout, FOOT_OFF, firstStop, HALF_PI, LINE_W, lockWord, metres, randomCar, rng } from './common';

/** Level 5: enter a 45° bay from a narrow one-way aisle. */
function angleBay(d: Difficulty): LevelLayout {
  const L = emptyLayout();
  const bw = { beginner: 3.0, normal: 2.6, hard: 2.4 }[d];
  const bl = 5.3;
  const aisle = { beginner: 6, normal: 5.2, hard: 4.6 }[d];
  const yaw = Math.PI / 4; // bay forward direction: (+X, +Z)
  const f = { x: Math.sin(yaw), z: Math.cos(yaw) };
  const left = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  const pitch = bw / Math.sin(yaw);
  const r = rng(59);
  const n = 4;
  const bayCentre = (i: number) => ({ x: i * pitch + f.x * (bl / 2), z: f.z * (bl / 2) });
  for (let i = -n; i <= n + 1; i++) {
    const c = bayCentre(i);
    L.lines.push({ x: c.x + left.x * (bw / 2), z: c.z + left.z * (bw / 2), yaw, w: LINE_W, l: bl });
  }
  const backZ = f.z * bl;
  L.lines.push({ x: 0, z: backZ, yaw: 0, w: (2 * n + 3) * pitch, l: LINE_W });
  for (let i = -n; i <= n; i++) {
    if (i === 0 || i === 2) continue;
    const c = bayCentre(i);
    L.parkedCars.push(randomCar(r, c.x + f.x * 0.1, c.z + f.z * 0.1, yaw));
  }
  L.kerbs.push({ x: 0, z: backZ + 0.35, yaw: 0, w: (2 * n + 3) * pitch, l: 0.3 });
  // One-way aisle bounded by a low wall.
  L.blocks.push({ rect: { x: 0, z: -aisle - 0.15, yaw: 0, w: (2 * n + 3) * pitch, l: 0.3 }, height: 0.9 });
  for (let x = -16; x <= 16; x += 8) L.lines.push({ x, z: -aisle / 2, yaw: HALF_PI, w: 0.12, l: 3 });

  L.spawn = { x: -18, z: -aisle + CAR.widthM / 2 + 0.6, yaw: HALF_PI };
  const c0 = bayCentre(0);
  const target = { x: c0.x - f.x * FOOT_OFF, z: c0.z - f.z * FOOT_OFF, yaw };
  L.target = { zone: { x: c0.x, z: c0.z, yaw, w: bw, l: bl }, facing: 'forward', maxAngleDeg: { beginner: 10, normal: 6, hard: 4 }[d] };
  const hints = (s: number): [string, string, string] => [
    'Drive along the aisle, about 0.6 m from the wall. Angle bays are entered forwards, in your direction of travel.',
    `When the bay opens up on your right, turn the wheel ${lockWord(s)} and roll in.`,
    'Straighten the wheel once the car is in line with the bay and stop before the wheel stop.',
  ];
  L.ideal = bestManoeuvre(
    L,
    [-1, -0.85, -0.7, -0.55, -0.45].map((s) => solveStraightArcStraight(L.spawn, target, 1, { dir: 1, steer: s }, 1, CAR, hints(s))),
    CAR,
  );
  const stop = firstStop(L);
  if (stop && L.ideal) {
    const before = -bw * Math.SQRT1_2 - (stop.x + CAR.wheelbaseM / 2 + CAR.frontOverhangM);
    L.ideal[0].hint = `Drive along the aisle, about 0.6 m from the wall. Start turning when your front bumper is about ${metres(before)} before the first line of the empty bay.`;
  }
  L.parTimeS = { beginner: 35, normal: 30, hard: 25 }[d];
  return L;
}

export const level05: LevelDef = {
  id: 5,
  title: 'Angle parking (45°)',
  summary: 'Enter an angled bay from a narrow one-way aisle.',
  technique: [
    'Approach close to the wall side of the aisle.',
    'When the bay opens, turn into it smoothly — angle bays need less steering than 90° bays.',
    'Straighten and stop before the wheel stop. Select P.',
  ],
  build: angleBay,
};
