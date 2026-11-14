import { solveStraightArcStraight } from '../idealPath';
import type { Difficulty, LevelDef, LevelLayout } from '../types';
import { bestManoeuvre } from '../validate';
import { CAR, emptyLayout, firstStop, HALF_PI, lockWord, metres, poseForCentre, REAR_OVERHANG, rng } from './common';
import { houseRow } from './level09';

const WALL_H = 1.8;
const POST = 0.45;

/**
 * Level 13: reverse out of a walled driveway in a gated housing society onto
 * the road, turning so the car ends up in the left lane (for India, the far
 * lane when heading +X), then drive away and stop.
 */
function reverseOut(d: Difficulty): LevelLayout {
  const L = emptyLayout();
  const r = rng(127);
  const G = { beginner: 4.0, normal: 3.8, hard: 3.7 }[d];
  const W = { beginner: 8.4, normal: 8.0, hard: 7.6 }[d];
  const postX = G / 2 + POST / 2;
  // House side at +Z: compound wall along z = 0 with the gate, a walled driveway, the house.
  L.blocks.push(
    { rect: { x: (-40 - postX - POST / 2) / 2, z: 0.115, yaw: 0, w: 40 - postX - POST / 2, l: 0.23 }, height: WALL_H, material: 'brick' },
    { rect: { x: (40 + postX + POST / 2) / 2, z: 0.115, yaw: 0, w: 40 - postX - POST / 2, l: 0.23 }, height: WALL_H, material: 'brick' },
    { rect: { x: -postX, z: POST / 2, yaw: 0, w: POST, l: POST }, height: 2.1, material: 'plaster', tint: 0xe9e5de },
    { rect: { x: postX, z: POST / 2, yaw: 0, w: POST, l: POST }, height: 2.1, material: 'plaster', tint: 0xe9e5de },
    { rect: { x: -postX - POST / 2 - G / 2, z: 0.4, yaw: 0, w: G, l: 0.06 }, height: 1.6, base: 0.04, material: 'plaster', tint: 0x2e3134 },
    { rect: { x: -(G / 2 + 0.7), z: 5, yaw: 0, w: 0.23, l: 9.1 }, height: WALL_H, material: 'plaster', tint: 0xf1e4c6 },
    { rect: { x: G / 2 + 0.7, z: 5, yaw: 0, w: 0.23, l: 9.1 }, height: WALL_H, material: 'plaster', tint: 0xc4dccf },
    { rect: { x: 0, z: 12.6, yaw: 0, w: 12, l: 5 }, height: 6.5, material: 'plaster', tint: 0xe2c2cf },
  );
  L.floors.push({ rect: { x: 0, z: 5, yaw: 0, w: G + 1.2, l: 10 }, material: 'pavers' });
  // Road along X; far kerb, pavement and houses at z < -W.
  L.kerbs.push({ x: 0, z: -W - 0.15, yaw: 0, w: 80, l: 0.3 });
  L.pavements.push({ x: 0, z: -W - 1.2, yaw: 0, w: 80, l: 1.8 });
  L.blocks.push(...houseRow(r, -40, 40, -W - 2.1, -1));
  for (let x = -36; x <= 36; x += 6) L.lines.push({ x, z: -W / 2, yaw: HALF_PI, w: 0.12, l: 3 });

  L.spawn = poseForCentre(0, 5.6, 0);
  L.target = {
    zone: { x: 10, z: (-3 * W) / 4, yaw: HALF_PI, w: W / 2 - 0.1, l: 10 },
    facing: 'forward',
    maxAngleDeg: { beginner: 10, normal: 8, hard: 6 }[d],
    name: 'left lane',
  };
  // The deeper into the far lane the car finishes, the later it can start turning
  // and the wider its front swings past the gate post; try several finishing lines.
  const nearZ = -W / 2 - 0.2 - CAR.widthM / 2;
  const farZ = -W + 0.35 + CAR.widthM / 2;
  const finishes = [0, 0.25, 0.5, 0.75, 1].map((t) => poseForCentre(10, nearZ + t * (farZ - nearZ), HALF_PI));
  const hints = (s: number): [string, string, string] => [
    '',
    `Turn the wheel ${lockWord(s)} and keep reversing. The front swings towards the gate post on your left — watch the left mirror.`,
    'Press W, straighten the wheel and drive away in the left lane, then stop.',
  ];
  L.ideal = bestManoeuvre(
    L,
    finishes.flatMap((target) =>
      [-1, -0.95, -0.9, -0.85, -0.8, -0.75].map((s) => solveStraightArcStraight(L.spawn, target, -1, { dir: -1, steer: s }, 1, CAR, hints(s))),
    ),
    CAR,
  );
  const stop = firstStop(L);
  if (stop && L.ideal) {
    const out = -(stop.z - CAR.wheelbaseM / 2 - REAR_OVERHANG);
    L.ideal[0].hint = `Press S and reverse straight out slowly, looking both ways. Start turning when your rear bumper is about ${metres(out)} out into the road.`;
  }
  L.parTimeS = { beginner: 40, normal: 35, hard: 30 }[d];
  return L;
}

export const level13: LevelDef = {
  id: 13,
  title: 'Driveway reverse-out',
  summary: 'Reverse out of a walled driveway onto the road and drive away in the left lane.',
  technique: [
    'The walls hide the road: reverse out very slowly and look both ways using the rear camera and mirrors.',
    'Keep straight until the rear is well out into the road, then turn the wheel fully right.',
    'Watch the front swing towards the gate post as the car turns.',
    'Stop when the car is straight in the far (left) lane, press W and drive away, then stop.',
  ],
  build: reverseOut,
};
