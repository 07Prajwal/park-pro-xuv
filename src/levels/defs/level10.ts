import { solveStraightArcStraight } from '../idealPath';
import type { Difficulty, LevelDef, LevelLayout } from '../types';
import { bestManoeuvre } from '../validate';
import { CAR, emptyLayout, firstStop, HALF_PI, lockWord, metres, poseForCentre, rng } from './common';
import { houseRow } from './level09';

const WALL_H = 1.8;
const POST = 0.45;
/** Depth of the paved forecourt between the street and the gate. */
const D = 8;
/** Half-width of the forecourt opening onto the street. */
const OPEN = 5.5;

/**
 * Level 10: turn left off a residential street onto a paved forecourt and drive
 * straight through a narrow gate into a house compound, stopping in the porch.
 * The gate is only a little wider than the car across its door mirrors.
 */
function gateEntry(d: Difficulty): LevelLayout {
  const L = emptyLayout();
  const r = rng(101);
  const spare = { beginner: 0.5, normal: 0.35, hard: 0.25 }[d];
  const G = CAR.mirrorSpanM + spare;
  const W = { beginner: 8.0, normal: 7.4, hard: 7.0 }[d];
  // Street along +X between the front wall (z = 0) and the far kerb (z = W);
  // the forecourt runs from the street to the gate wall at z = -D.
  const postX = G / 2 + POST / 2;
  const gz = -D;
  const side = (x0: number, x1: number, z: number) => ({ x: (x0 + x1) / 2, z, yaw: 0, w: x1 - x0, l: 0.23 });
  L.blocks.push(
    { rect: side(-40, -OPEN, -0.115), height: WALL_H, material: 'brick' },
    { rect: side(OPEN, 40, -0.115), height: WALL_H, material: 'brick' },
    { rect: { x: -OPEN - 0.115, z: gz / 2, yaw: 0, w: 0.23, l: D }, height: WALL_H, material: 'brick' },
    { rect: { x: OPEN + 0.115, z: gz / 2, yaw: 0, w: 0.23, l: D }, height: WALL_H, material: 'brick' },
    { rect: side(-OPEN, -postX - POST / 2, gz - 0.115), height: WALL_H, material: 'brick' },
    { rect: side(postX + POST / 2, OPEN, gz - 0.115), height: WALL_H, material: 'brick' },
    { rect: { x: -postX, z: gz - POST / 2, yaw: 0, w: POST, l: POST }, height: 2.1, material: 'plaster', tint: 0xe9e5de },
    { rect: { x: postX, z: gz - POST / 2, yaw: 0, w: POST, l: POST }, height: 2.1, material: 'plaster', tint: 0xe9e5de },
    // Sliding gate, pushed open behind the wall.
    { rect: { x: postX + POST / 2 + G / 2, z: gz - 0.4, yaw: 0, w: G, l: 0.06 }, height: 1.6, base: 0.04, material: 'plaster', tint: 0x2e3134 },
    // Compound: side walls and the house front.
    { rect: { x: -7, z: gz - 5.2, yaw: 0, w: 0.23, l: 10 }, height: WALL_H, material: 'brick' },
    { rect: { x: 7, z: gz - 5.2, yaw: 0, w: 0.23, l: 10 }, height: WALL_H, material: 'brick' },
    { rect: { x: 0, z: gz - 13.2, yaw: 0, w: 14, l: 6 }, height: 6.5, material: 'plaster', tint: 0xf3cfae },
  );
  L.floors.push(
    { rect: { x: 0, z: gz / 2, yaw: 0, w: 2 * OPEN, l: D }, material: 'pavers' },
    { rect: { x: 0, z: gz - 5.1, yaw: 0, w: G, l: 10 }, material: 'pavers' },
  );
  L.kerbs.push({ x: 0, z: W + 0.15, yaw: 0, w: 80, l: 0.3 });
  L.pavements.push({ x: 0, z: W + 1.2, yaw: 0, w: 80, l: 1.8 });
  L.blocks.push(...houseRow(r, -40, 40, W + 2.1, 1));
  L.vehicles.push(
    { kind: 'scooter', x: 12, z: W + 0.9, yaw: -HALF_PI - 0.4, colour: 0x1b1c1f },
    { kind: 'scooter', x: 13.1, z: W + 0.9, yaw: -HALF_PI - 0.4, colour: 0x8e1016 },
  );

  L.spawn = { x: -18, z: 0.6 + CAR.widthM / 2, yaw: HALF_PI };
  const centreZ = gz - 5.4;
  L.target = {
    zone: { x: 0, z: centreZ, yaw: Math.PI, w: G, l: CAR.lengthM + 1.2 },
    facing: 'forward',
    maxAngleDeg: { beginner: 6, normal: 4, hard: 3 }[d],
    name: 'porch',
  };
  const target = poseForCentre(0, centreZ, Math.PI);
  const hints = (s: number): [string, string, string] => [
    '',
    `Turn the wheel ${lockWord(s)} onto the forecourt, lining the car up with the gate.`,
    'Be straight before the gate, centred between the posts in both mirrors. Creep through, stop in the porch and select P.',
  ];
  L.ideal = bestManoeuvre(
    L,
    [1, 0.95, 0.9, 0.85, 0.8].map((s) => solveStraightArcStraight(L.spawn, target, 1, { dir: 1, steer: s }, 1, CAR, hints(s))),
    CAR,
  );
  const stop = firstStop(L);
  if (stop && L.ideal) {
    const past = stop.x + CAR.wheelbaseM / 2 + CAR.frontOverhangM;
    L.ideal[0].hint =
      past >= 0
        ? `Keep left. Start turning when your front bumper is about ${metres(past)} past the middle of the forecourt opening.`
        : `Keep left. Start turning when your front bumper is about ${metres(-past)} before the middle of the forecourt opening.`;
  }
  L.parTimeS = { beginner: 40, normal: 35, hard: 30 }[d];
  return L;
}

export const level10: LevelDef = {
  id: 10,
  title: 'Gate entry',
  summary: 'Turn onto a forecourt and drive through a narrow gate into a house compound. The gate is barely wider than the car across its mirrors.',
  technique: [
    'Approach slowly in the left lane. The rear wheels cut inside the front wheels, so turn a little later than feels natural.',
    'Finish the turn with the car pointing straight at the gate, with room to spare before it.',
    'Use both door mirrors to centre the car between the posts; the gap each side is only a hand’s width or two.',
    'Creep in, stop in the porch and select P.',
  ],
  build: gateEntry,
};
