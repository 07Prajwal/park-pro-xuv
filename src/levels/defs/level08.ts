import { curvature, endPose, solveStraightArcStraight } from '../idealPath';
import type { Block, Difficulty, LevelDef, LevelLayout, OrientedRect, Segment, Surface } from '../types';
import { bestManoeuvre } from '../validate';
import { maxCentreSteerAngle } from '../../vehicle/steering';
import { CAR, emptyLayout, FOOT_OFF, HALF_PI, LINE_W, lockWord, metres, randomCar, REAR_OVERHANG, rng } from './common';

/** Deck height and slab. */
const H = 3.0;
const SLAB = 0.3;
/** Deck footprint. */
const DX0 = -10;
const DX1 = 16.6;
const DZ0 = -20;
const DZ1 = 12;
/** Ramp: centre line x, from the ground at RZ0 up to the deck edge at DZ1, heading -Z. */
const RX = 13;
const RZ0 = 40;
const TRANSITION = 3.5;

/**
 * Level 8: an Indian mall-style car park with a covered ground floor (stilt
 * parking) under an open roof deck. Drive the narrow pillar lane over two speed
 * bumps, make a U-turn round to the ramp, climb to the deck and reverse into a
 * bay between parked cars.
 */
function carPark(d: Difficulty): LevelLayout {
  const L = emptyLayout();
  const r = rng(83);
  const lane = { beginner: 6.0, normal: 5.4, hard: 5.0 }[d];
  const rampW = { beginner: 6.4, normal: 5.6, hard: 5.0 }[d];
  const bw = { beginner: 3.0, normal: 2.6, hard: 2.5 }[d];
  const bl = 5.3;
  const ceiling = H - SLAB;
  const covered = (rect: OrientedRect, height = ceiling, material: Block['material'] = 'concrete'): Block => ({ rect, height, material, covered: true });

  // --- Deck and ramp.
  L.surfaces.push({
    rect: { x: (DX0 + DX1) / 2, z: (DZ0 + DZ1) / 2, yaw: 0, w: DX1 - DX0, l: DZ1 - DZ0, level: H },
    h0: H,
    h1: H,
    slabM: SLAB,
    material: 'concrete',
  });
  const g = H / (2 * TRANSITION * 0.5 + (RZ0 - DZ1 - 2 * TRANSITION));
  let z = RZ0;
  let h = 0;
  for (const [len, grad] of [
    [TRANSITION, g / 2],
    [RZ0 - DZ1 - 2 * TRANSITION, g],
    [TRANSITION, g / 2],
  ]) {
    const s: Surface = {
      rect: { x: RX, z: z - len / 2, yaw: Math.PI, w: rampW, l: len },
      h0: h,
      h1: h + grad * len,
      walls: { left: true, right: true },
      material: 'concrete',
    };
    L.surfaces.push(s);
    z -= len;
    h = s.h1;
  }

  // --- Ground floor: concrete floor, perimeter walls with the lane openings, pillars, light strips.
  L.floors.push({ rect: { x: (DX0 + DX1) / 2, z: (DZ0 + DZ1) / 2, yaw: 0, w: DX1 - DX0, l: DZ1 - DZ0 }, material: 'concrete', covered: true });
  const innerX = 9.2;
  const open = lane / 2 + 0.6;
  L.blocks.push(
    covered({ x: DX0 + 0.12, z: (DZ0 + DZ1) / 2, yaw: 0, w: 0.24, l: DZ1 - DZ0 }),
    covered({ x: innerX, z: (DZ0 + DZ1) / 2, yaw: 0, w: 0.24, l: DZ1 - DZ0 }),
  );
  for (const wz of [DZ0 + 0.12, DZ1 - 0.12]) {
    L.blocks.push(
      covered({ x: (DX0 - open) / 2, z: wz, yaw: 0, w: -open - DX0, l: 0.24 }),
      covered({ x: (innerX + open) / 2, z: wz, yaw: 0, w: innerX - open, l: 0.24 }),
    );
  }
  const pillarZ = [-16.5, -9, -1.5, 6];
  for (const pz of pillarZ) {
    for (const px of [-(lane / 2 + 0.3), lane / 2 + 0.3, -(lane / 2 + 0.3 + bl + 0.6)]) L.blocks.push(covered({ x: px, z: pz, yaw: 0, w: 0.6, l: 0.6 }));
  }
  for (let lz = DZ0 + 3; lz < DZ1 - 2; lz += 6) {
    L.blocks.push({ rect: { x: 0, z: lz, yaw: 0, w: 0.12, l: 1.4 }, height: 0.05, base: ceiling - 0.06, material: 'light', covered: true });
  }
  // Ground-floor bays between the pillars on both sides of the lane, about half taken.
  for (const side of [1, -1]) {
    const bx = side * (lane / 2 + 0.6 + bl / 2);
    L.lines.push({ x: side * (lane / 2 + 0.6), z: (DZ0 + DZ1) / 2, yaw: 0, w: LINE_W, l: DZ1 - DZ0 - 1 });
    for (let i = 0; i < pillarZ.length - 1; i++) {
      for (const k of [-1, 1]) {
        const cz = (pillarZ[i] + pillarZ[i + 1]) / 2 + k * 1.75;
        if (r() < 0.55) L.parkedCars.push(randomCar(r, bx, cz, r() < 0.5 ? HALF_PI : -HALF_PI));
      }
    }
  }
  L.bumps.push({ x: 0, z: DZ0 + 1.6, yaw: 0, w: lane, l: 1.2 }, { x: 0, z: (pillarZ[1] + pillarZ[2]) / 2, yaw: 0, w: lane, l: 1.2 });
  L.lines.push({ x: 0, z: DZ0 - 4, yaw: 0, w: lane, l: 0.3 });

  // --- Deck: parapets (open at the ramp landing), bays along the left of the aisle, a speed bump.
  const parapet = (rect: OrientedRect): Block => ({ rect, height: 1.0, base: H, material: 'concrete' });
  const rampX0 = RX - rampW / 2 - 0.2;
  L.blocks.push(
    parapet({ x: DX0 + 0.1, z: (DZ0 + DZ1) / 2, yaw: 0, w: 0.2, l: DZ1 - DZ0 }),
    parapet({ x: DX1 - 0.1, z: (DZ0 + DZ1) / 2, yaw: 0, w: 0.2, l: DZ1 - DZ0 }),
    parapet({ x: (DX0 + DX1) / 2, z: DZ0 + 0.1, yaw: 0, w: DX1 - DX0, l: 0.2 }),
    parapet({ x: (DX0 + rampX0) / 2, z: DZ1 - 0.1, yaw: 0, w: rampX0 - DX0, l: 0.2 }),
  );
  const rampX1 = RX + rampW / 2 + 0.2;
  if (DX1 - 0.2 - rampX1 > 0.05) L.blocks.push(parapet({ x: (rampX1 + DX1 - 0.2) / 2, z: DZ1 - 0.1, yaw: 0, w: DX1 - 0.2 - rampX1, l: 0.2 }));
  const aisleX0 = 9.8;
  const bayX = aisleX0 - bl / 2;
  const bays: number[] = [];
  for (let zc = DZ1 - 2 - bw / 2; zc > DZ0 + 1 + bw / 2; zc -= bw) bays.push(zc);
  const targetIdx = 4;
  for (let i = 0; i <= bays.length; i++) {
    const zb = (bays[i] ?? bays[i - 1] - bw) + bw / 2;
    L.lines.push({ x: bayX, z: zb, yaw: HALF_PI, w: LINE_W, l: bl, level: H });
  }
  L.lines.push({ x: aisleX0 - bl, z: (bays[0] + bays[bays.length - 1]) / 2, yaw: 0, w: LINE_W, l: bays.length * bw, level: H });
  bays.forEach((zc, i) => {
    if (i === targetIdx || i === 7) return;
    L.parkedCars.push(randomCar(r, bayX - 0.15, zc, r() < 0.6 ? HALF_PI : -HALF_PI, { y: H }));
  });
  L.kerbs.push({ x: aisleX0 - bl - 0.25, z: (bays[0] + bays[bays.length - 1]) / 2, yaw: 0, w: 0.3, l: bays.length * bw, level: H });
  // A second, back-to-back row on the far side of the wheel stops.
  bays.forEach((zc) => {
    if (r() < 0.45) L.parkedCars.push(randomCar(r, aisleX0 - bl - 0.55 - bl / 2, zc, r() < 0.5 ? HALF_PI : -HALF_PI, { y: H }));
  });
  L.bumps.push({ x: (aisleX0 + DX1 - 0.2) / 2, z: DZ1 - 4, yaw: 0, w: DX1 - 0.2 - aisleX0, l: 1.2, level: H });

  // --- Ideal: up the lane, U-turn left onto the ramp line, then reverse into the bay.
  L.spawn = { x: 0, z: DZ0 - 14, yaw: 0 };
  const turnStartZ = RZ0 + 6;
  const uRadius = RX / 2;
  const uSteer = Math.atan(CAR.wheelbaseM / uRadius) / maxCentreSteerAngle(CAR);
  const head: Segment[] = [
    { dir: 1, steer: 0, dist: turnStartZ - L.spawn.z, hint: '' },
    { dir: 1, steer: uSteer, dist: Math.PI / Math.abs(curvature(uSteer, CAR)), hint: '' },
  ];
  const afterU = endPose(L.spawn, head, CAR);
  const zc = bays[targetIdx];
  L.target = {
    zone: { x: bayX, z: zc, yaw: HALF_PI, w: bw, l: bl, level: H },
    facing: 'forward',
    maxAngleDeg: { beginner: 10, normal: 6, hard: 4 }[d],
  };
  const target = { x: bayX - FOOT_OFF, z: zc, yaw: HALF_PI };
  const hints = (s: number): [string, string, string] => [
    '',
    `Press S to reverse. Turn the wheel ${lockWord(s)} and reverse slowly into the bay, watching the pillar and the parked cars in both mirrors.`,
    'Straighten up and reverse until the red guideline reaches the wheel stop, then stop.',
  ];
  const tails = [1, 0.92, 0.85].map((s) => solveStraightArcStraight(afterU, target, 1, { dir: -1, steer: s }, -1, CAR, hints(s)));
  L.ideal = bestManoeuvre(
    L,
    tails.map((t) => (t ? [...head, ...t] : null)),
    CAR,
  );
  if (L.ideal) {
    const stop = endPose(L.spawn, L.ideal.slice(0, 3), CAR);
    const past = zc - bw / 2 - (stop.z + CAR.wheelbaseM / 2 + REAR_OVERHANG);
    L.ideal[2].hint = `On the deck, drive past the empty bay on your left. Stop when your rear bumper is about ${metres(past)} past its far line.`;
  }
  L.gates = [
    { rect: { x: 0, z: DZ0 + 3, yaw: 0, w: lane, l: 2 }, label: 'Drive into the car park slowly: speed bump at the entrance (10 km/h or less).' },
    { rect: { x: 0, z: DZ1 + 1, yaw: 0, w: lane, l: 2 }, label: 'Keep to the middle of the pillar lane, over the second bump and out of the far end.' },
    { rect: { x: RX, z: RZ0 + 1.5, yaw: 0, w: rampW, l: 3 }, label: 'Turn left round to the foot of the ramp — start the turn late and use most of the space.' },
    { rect: { x: RX, z: DZ1 - 1.5, yaw: 0, w: rampW, l: 3, level: H }, label: 'Climb the ramp at a steady speed with a little accelerator. Do not stop halfway.' },
  ];
  L.rules = { bumpMaxKmh: 10 };
  L.parTimeS = { beginner: 120, normal: 105, hard: 95 }[d];
  return L;
}

export const level08: LevelDef = {
  id: 8,
  title: 'Multi-level car park',
  summary: 'Pillar lane, speed bumps and a ramp to the roof deck, then reverse into a bay between parked cars.',
  technique: [
    'Cross speed bumps at walking pace: brake before the bump, roll over it, then accelerate gently.',
    'In the pillar lane, judge the gap with both door mirrors and keep the car in the middle.',
    'On the ramp, keep a steady speed with a little pressure on W. If you let go, the car holds still on the slope.',
    'On the deck, drive past the bay, stop, and reverse in with the wheel turned towards it, then stop.',
  ],
  build: carPark,
};
