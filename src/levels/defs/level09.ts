import type { Block, Difficulty, LevelDef, LevelLayout, StreetVehicle } from '../types';
import { STREET_VEHICLE_SIZE } from '../validate';
import { CAR, emptyLayout, HALF_PI, PARKED_COLOURS, rng } from './common';
import { reverseParallel } from './parallelPark';

export const HOUSE_COLOURS = [0xf1e4c6, 0xf3cfae, 0xc4dccf, 0xe2c2cf, 0xcfdbe9, 0xf2e3a6, 0xe9e5de];
const AUTO_COLOURS = [0x1f6b35, 0x1f6b35, 0x15161a];
const SCOOTER_COLOURS = [0x1b1c1f, 0xb9bcbf, 0x8e1016, 0x1f3f7a, 0xe8e8e6];

/** Row of house fronts along X between x0 and x1, their road-side face at `faceZ`, extending away from the road. */
export function houseRow(r: () => number, x0: number, x1: number, faceZ: number, away: 1 | -1, minH = 5.5, maxH = 10): Block[] {
  const out: Block[] = [];
  let x = x0;
  while (x < x1 - 0.5) {
    const w = Math.min(x1 - x, 4.5 + r() * 4.5);
    const depth = 6;
    const brick = r() < 0.2;
    out.push({
      rect: { x: x + w / 2, z: faceZ + away * (depth / 2), yaw: 0, w, l: depth },
      height: minH + r() * (maxH - minH),
      material: brick ? 'brick' : 'plaster',
      tint: brick ? 0xffffff : HOUSE_COLOURS[Math.floor(r() * HOUSE_COLOURS.length)],
    });
    x += w;
  }
  return out;
}

/**
 * Level 9: a narrow residential street. Parallel park on the left between a
 * hatchback and an auto-rickshaw, with autos, scooters and cars parked along
 * the other side and house fronts close on both sides.
 */
function narrowStreet(d: Difficulty): LevelLayout {
  const L = emptyLayout();
  const r = rng(97);
  const W = { beginner: 8.0, normal: 7.4, hard: 7.2 }[d];
  const gap = { beginner: 7.0, normal: 6.6, hard: 6.5 }[d];
  const kerbGap = 0.3;
  // Left: a 15 cm step up to a paved frontage, then the houses.
  L.kerbs.push({ x: 0, z: -0.15, yaw: 0, w: 80, l: 0.3 });
  L.pavements.push({ x: 0, z: -1.05, yaw: 0, w: 80, l: 1.5 });
  L.blocks.push(...houseRow(r, -40, 40, -1.8, -1));
  L.blocks.push(...houseRow(r, -40, 40, W + 0.4, 1));
  L.floors.push({ rect: { x: 0, z: W + 0.2, yaw: 0, w: 80, l: 0.4 }, material: 'pavers' });

  const small = 0.86;
  const pl = CAR.lengthM * small;
  const pw = CAR.widthM * small;
  const auto = STREET_VEHICLE_SIZE.auto;
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
  // Left side: hatchback in front of the gap, an auto-rickshaw behind it, more beyond.
  const front = { x: gap / 2 + pl / 2, z: kerbGap + pw / 2, yaw: HALF_PI, scale: small, colour: 0xd8d2c4 };
  L.parkedCars.push(front, { x: front.x + pl + 1.2, z: kerbGap + 0.94 * CAR.widthM * 0.5, yaw: HALF_PI, scale: 0.94, colour: 0x6b6e72 });
  const autoX = -gap / 2 - auto.l / 2;
  const vehicles: StreetVehicle[] = [{ kind: 'auto', x: autoX, z: kerbGap + auto.w / 2, yaw: HALF_PI, colour: AUTO_COLOURS[0] }];
  for (let i = 0; i < 3; i++) {
    vehicles.push({ kind: 'scooter', x: autoX - auto.l / 2 - 0.9 - i * 1.0, z: 0.75, yaw: HALF_PI + 0.5, colour: pick(SCOOTER_COLOURS) });
  }
  // Right side: a continuous parked line of autos, scooters and the odd car.
  let x = -34;
  while (x < 34) {
    const kind = r();
    if (kind < 0.35) {
      vehicles.push({ kind: 'auto', x: x + auto.l / 2, z: W - 0.2 - auto.w / 2, yaw: -HALF_PI, colour: pick(AUTO_COLOURS) });
      x += auto.l + 0.6 + r() * 0.8;
    } else if (kind < 0.75) {
      for (let i = 0; i < 3; i++) vehicles.push({ kind: 'scooter', x: x + 0.5 + i * 1.0, z: W - 0.2 - 0.7, yaw: -HALF_PI - 0.45, colour: pick(SCOOTER_COLOURS) });
      x += 3.4 + r() * 0.6;
    } else {
      L.parkedCars.push({ x: x + pl / 2, z: W - 0.2 - pw / 2, yaw: -HALF_PI, scale: small, colour: pick(PARKED_COLOURS) });
      x += pl + 0.8 + r() * 0.8;
    }
  }
  L.vehicles = vehicles;

  L.spawn = { x: -14, z: kerbGap + pw + 0.6 + CAR.widthM / 2, yaw: HALF_PI };
  L.target = {
    zone: { x: 0, z: kerbGap + CAR.widthM / 2 + 0.1, yaw: HALF_PI, w: CAR.widthM + 0.6, l: gap },
    facing: 'forward',
    maxAngleDeg: { beginner: 8, normal: 6, hard: 5 }[d],
    kerb: { rect: L.kerbs[0], maxGapM: { beginner: 0.5, normal: 0.4, hard: 0.35 }[d] },
  };
  L.ideal = reverseParallel(L, { gapX0: -gap / 2, gapX1: gap / 2, kerbZ: 0, finalGapM: kerbGap, spawn: L.spawn, frontName: 'hatchback' });
  L.parTimeS = { beginner: 75, normal: 65, hard: 55 }[d];
  return L;
}

export const level09: LevelDef = {
  id: 9,
  title: 'Narrow Indian street',
  summary: 'Parallel park between a hatchback and an auto-rickshaw on a street lined with parked vehicles on both sides.',
  technique: [
    'Drive slowly and keep about 0.6 m from the parked vehicles on your left — the other side is just as close.',
    'Line up with the hatchback in front of the gap, then reverse with full left lock to about 45°.',
    'As your front swings out, check the right mirror for the autos and scooters across the street.',
    'Full right lock to come parallel, stop close to the step and select P.',
  ],
  build: narrowStreet,
};
