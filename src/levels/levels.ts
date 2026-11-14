/**
 * Parking levels 1-6. Each level builds its layout for a difficulty; parking
 * levels also derive their ideal manoeuvre (used for the guide line, the hints
 * and the ghost replay) from the layout, so changing a gap or bay size keeps the
 * demonstration exact.
 *
 * Bay sizes follow Indian practice (about 2.5 x 5 m bays, 6-7.5 m aisles).
 * Kerbside parking is on the LEFT, as in India.
 */

import { XUV_7XO } from '../config';
import { minRearAxleRadius } from '../vehicle/steering';
import { endPose, solveStraightArcStraight } from './idealPath';
import type { Difficulty, LevelDef, LevelLayout, OrientedRect, ParkedCar, Segment } from './types';
import { bestManoeuvre } from './validate';

const CAR = XUV_7XO;
const LINE_W = 0.11;
const HALF_PI = Math.PI / 2;
/** Footprint centre is this far ahead of the physics origin (front overhang differs from rear). */
const FOOT_OFF = (CAR.frontOverhangM - (CAR.lengthM - CAR.wheelbaseM - CAR.frontOverhangM)) / 2;

const PARKED_COLOURS = [0xe8e8e6, 0xb9bcbf, 0x6b6e72, 0x1b1c1f, 0x8e1016, 0x1f3f7a, 0xd8d2c4, 0x3c4a3e];

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function emptyLayout(): LevelLayout {
  return { spawn: { x: 0, z: 0, yaw: 0 }, lines: [], kerbs: [], blocks: [], cones: [], parkedCars: [], parTimeS: 60 };
}

const REAR_OVERHANG = CAR.lengthM - CAR.wheelbaseM - CAR.frontOverhangM;

/** Pose (physics origin) at the end of the first segment of a manoeuvre. */
function firstStop(L: LevelLayout): { x: number; z: number; yaw: number } | null {
  return L.ideal ? endPose(L.spawn, L.ideal.slice(0, 1), CAR) : null;
}

const metres = (m: number) => `${(Math.round(m * 10) / 10).toFixed(1)} m`;

const lockWord = (steer: number) => {
  const a = Math.abs(steer);
  const side = steer > 0 ? 'left' : 'right';
  return a > 0.95 ? `fully ${side}` : a > 0.7 ? `about three-quarters ${side}` : `about half ${side}`;
};

// --- Level 1: free practice lot --------------------------------------------------

function practiceLot(): LevelLayout {
  const L = emptyLayout();
  const bw = 2.6;
  const bl = 5.2;
  const bays = 10;
  const x0 = -((bays * bw) / 2);
  const row1 = 20;
  const row2 = row1 + bl * 2 + 7;
  for (const [rowZ, dir] of [
    [row1, 1],
    [row2, -1],
  ] as const) {
    for (let i = 0; i <= bays; i++) L.lines.push({ x: x0 + i * bw, z: rowZ + (dir * bl) / 2, yaw: 0, w: LINE_W, l: bl });
    L.lines.push({ x: 0, z: rowZ + dir * bl, yaw: 0, w: bays * bw, l: LINE_W });
  }
  for (let z = -60; z < 14; z += 6) L.lines.push({ x: 0, z, yaw: 0, w: 0.12, l: 3 });
  L.lines.push({ x: -3.6, z: -23, yaw: 0, w: 0.12, l: 74 }, { x: 3.6, z: -23, yaw: 0, w: 0.12, l: 74 });
  const halfW = (bays * bw) / 2 + 3;
  const kz0 = row1 - 2;
  const kz1 = row2 + bl + 2;
  L.kerbs.push(
    { x: -halfW, z: (kz0 + kz1) / 2, yaw: 0, w: 0.3, l: kz1 - kz0 },
    { x: halfW, z: (kz0 + kz1) / 2, yaw: 0, w: 0.3, l: kz1 - kz0 },
    { x: 0, z: kz1, yaw: 0, w: halfW * 2 + 0.3, l: 0.3 },
  );
  for (let i = 0; i < 4; i++) L.blocks.push({ rect: { x: x0 + (3 + i * 2) * bw, z: row1 + bl + 0.3, yaw: 0, w: 0.45, l: 0.45 }, height: 3.2 });
  for (let i = 0; i < 6; i++) L.cones.push({ x: (i % 2 === 0 ? 1 : -1) * 1.5 + 12, z: -40 + i * 7 });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    L.cones.push({ x: -28 + Math.cos(a) * 6.2, z: -18 + Math.sin(a) * 6.2 });
  }
  L.spawn = { x: 0, z: -55, yaw: 0 };
  L.parTimeS = 0;
  return L;
}

// --- Level 2: cone slalom and U-turn ---------------------------------------------

function coneCourse(d: Difficulty): LevelLayout {
  const L = emptyLayout();
  const spacing = { beginner: 9, normal: 7.5, hard: 6.5 }[d];
  const depth = { beginner: 13, normal: 11, hard: 9.5 }[d];
  const z0 = -30;
  const n = 6;
  const gates: { rect: OrientedRect; label: string }[] = [];
  for (let i = 0; i < n; i++) {
    const z = z0 + i * spacing;
    L.cones.push({ x: 0, z });
    const side = i % 2 === 0 ? -1 : 1;
    gates.push({ rect: { x: side * 1.9, z, yaw: 0, w: 3, l: 1.2 }, label: `Cone ${i + 1}: pass on the ${side < 0 ? 'right' : 'left'}` });
  }
  const zLast = z0 + (n - 1) * spacing;
  const zFar = zLast + depth;
  // Turn-around area: a cone wall at the far end, and the return lane 8.5 m to the left.
  for (let x = -4; x <= 13; x += 1.5) L.cones.push({ x, z: zFar });
  gates.push({ rect: { x: 4.2, z: zFar - 3.5, yaw: 0, w: 8.4, l: 7 }, label: 'Make a U-turn to the left without touching the far cones' });
  const laneX = 9;
  for (let z = z0 - 4; z <= zLast; z += 5) {
    L.cones.push({ x: laneX - 2.4, z }, { x: laneX + 2.4, z });
  }
  gates.push({ rect: { x: laneX, z: z0 - 4, yaw: 0, w: 4.4, l: 1.5 }, label: 'Return through the lane to the finish' });
  L.gates = gates;
  L.lines.push({ x: 0, z: z0 - 8, yaw: 0, w: 3, l: LINE_W }, { x: laneX, z: z0 - 6, yaw: 0, w: 4.8, l: LINE_W });
  L.spawn = { x: 0, z: z0 - 14, yaw: 0 };
  L.parTimeS = { beginner: 70, normal: 60, hard: 50 }[d];
  return L;
}

// --- Levels 3 and 4: perpendicular bays --------------------------------------------

interface BayLot {
  layout: LevelLayout;
  bw: number;
  bl: number;
  aisle: number;
}

function bayLot(d: Difficulty, seed: number): BayLot {
  const L = emptyLayout();
  const bw = { beginner: 3.0, normal: 2.6, hard: 2.4 }[d];
  const bl = 5.3;
  const aisle = { beginner: 8.4, normal: 7.6, hard: 7.6 }[d];
  const r = rng(seed);
  const n = 4;
  // Bay row (opening towards -Z) with the target bay at x = 0.
  for (let i = -n; i <= n + 1; i++) L.lines.push({ x: (i - 0.5) * bw, z: bl / 2, yaw: 0, w: LINE_W, l: bl });
  L.lines.push({ x: 0.5 * bw * 0 + 0, z: bl, yaw: 0, w: (2 * n + 1) * bw, l: LINE_W });
  // Opposite row across the aisle.
  const oz = -aisle - bl / 2;
  for (let i = -n; i <= n + 1; i++) L.lines.push({ x: (i - 0.5) * bw, z: oz, yaw: 0, w: LINE_W, l: bl });
  L.lines.push({ x: 0, z: -aisle - bl, yaw: 0, w: (2 * n + 1) * bw, l: LINE_W });
  const park = (x: number, z: number, nose: number): ParkedCar => ({
    x,
    z,
    yaw: nose,
    scale: [0.86, 0.93, 1][Math.floor(r() * 3)],
    colour: PARKED_COLOURS[Math.floor(r() * PARKED_COLOURS.length)],
  });
  for (let i = -n; i <= n; i++) {
    if (i !== 0 && i !== 3) L.parkedCars.push(park(i * bw, bl / 2 + 0.15, r() < 0.5 ? 0 : Math.PI));
    if (i !== -2) L.parkedCars.push(park(i * bw, oz - 0.15, r() < 0.5 ? 0 : Math.PI));
  }
  // Wheel-stop kerbs at the back of both rows, and a wall behind the bay row.
  L.kerbs.push({ x: 0, z: bl + 0.2, yaw: 0, w: (2 * n + 1) * bw, l: 0.3 }, { x: 0, z: -aisle - bl - 0.2, yaw: 0, w: (2 * n + 1) * bw, l: 0.3 });
  L.blocks.push({ rect: { x: 0, z: bl + 1.2, yaw: 0, w: (2 * n + 1) * bw + 2, l: 0.3 }, height: 1.1 });
  return { layout: L, bw, bl, aisle };
}

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
    `Turn the wheel ${lockWord(s)} and creep forward. Watch your left mirror: the front-left corner swings out towards the parked car.`,
    'Straighten the wheel as the car lines up with the bay, then creep in until the front is about 30 cm from the wheel stop.',
  ];
  L.ideal = bestManoeuvre(
    L,
    [-1, -0.9, -0.8].map((s) => solveStraightArcStraight(L.spawn, target, 1, { dir: 1, steer: s }, 1, CAR, hints(s))),
    CAR,
  );
  L.parTimeS = { beginner: 45, normal: 40, hard: 35 }[d];
  return L;
}

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

// --- Level 5: 45-degree angle bays ------------------------------------------------------

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
    L.parkedCars.push({
      x: c.x + f.x * 0.1,
      z: c.z + f.z * 0.1,
      yaw,
      scale: [0.86, 0.93, 1][Math.floor(r() * 3)],
      colour: PARKED_COLOURS[Math.floor(r() * PARKED_COLOURS.length)],
    });
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

// --- Level 6: reverse parallel parking on the left kerb ----------------------------------

function parallel(d: Difficulty): LevelLayout {
  const L = emptyLayout();
  const gap = { beginner: 7.6, normal: 7.0, hard: 6.6 }[d];
  const parkedScale = 0.94;
  const pl = CAR.lengthM * parkedScale;
  const pw = CAR.widthM * parkedScale;
  const kerbGap = 0.25;
  // Kerb along X; its road face at z = 0, pavement towards -Z.
  L.kerbs.push({ x: 0, z: -0.15, yaw: 0, w: 80, l: 0.3 });
  L.kerbs.push({ x: 0, z: -1.8, yaw: 0, w: 80, l: 3 });
  const lane = 3.5;
  for (let x = -36; x <= 36; x += 6) L.lines.push({ x, z: lane * 2 - 0.2, yaw: HALF_PI, w: 0.12, l: 3 });
  const pz = kerbGap + pw / 2;
  const front = { x: gap / 2 + pl / 2, z: pz, yaw: HALF_PI, scale: parkedScale, colour: 0xb9bcbf };
  const rear = { x: -gap / 2 - pl / 2, z: pz, yaw: HALF_PI, scale: parkedScale, colour: 0x8e1016 };
  L.parkedCars.push(front, rear, { x: front.x + pl + 1.6, z: pz, yaw: HALF_PI, scale: 0.86, colour: 0x1f3f7a });
  L.parkedCars.push({ x: rear.x - pl - 1.4, z: pz, yaw: HALF_PI, scale: 1, colour: 0xe8e8e6 });

  // Start alongside the front parked car, 0.8 m away.
  const zs = pz + pw / 2 + 0.8 + CAR.widthM / 2;
  L.spawn = { x: -14, z: zs, yaw: HALF_PI };
  const zf = kerbGap + 0.03 + CAR.widthM / 2;
  const maxKerbGap = { beginner: 0.5, normal: 0.35, hard: 0.3 }[d];
  L.target = {
    zone: { x: 0, z: kerbGap + CAR.widthM / 2 + 0.1, yaw: HALF_PI, w: CAR.widthM + 0.5, l: gap },
    facing: 'forward',
    maxAngleDeg: { beginner: 8, normal: 5, hard: 4 }[d],
    kerb: { rect: L.kerbs[0], maxGapM: maxKerbGap },
  };

  // Reverse S: full left lock for theta, straight d, full right lock for theta.
  const R = minRearAxleRadius(CAR);
  const dz = zs - zf;
  const candidates: (Segment[] | null)[] = [];
  // The car may finish anywhere from just clear of the rear car to the centre of the gap:
  // finishing deeper keeps the front corner clear of the front car during the counter-steer.
  const xfMin = -gap / 2 + 0.2 + CAR.lengthM / 2 - FOOT_OFF;
  const xfMax = -FOOT_OFF;
  for (let deg = 25; deg <= 60; deg += 2) {
    const th = (deg * Math.PI) / 180;
    const straight = (dz - 2 * R * (1 - Math.cos(th))) / Math.sin(th);
    if (straight < 0) continue;
    // Distance the rear axle moves back along the kerb during the S.
    const back = 2 * R * Math.sin(th) + straight * Math.cos(th);
    const arc = R * th;
    const deg5 = Math.round(deg / 5) * 5;
    for (let j = 0; j <= 8; j++) {
      const xf = xfMin + ((xfMax - xfMin) * j) / 8;
      const a = xf + back - L.spawn.x;
      if (a < 0) continue;
      candidates.push([
        { dir: 1, steer: 0, dist: a, hint: '' },
        { dir: -1, steer: 1, dist: arc, hint: `Select R. Turn the wheel fully left and reverse slowly until the car is at about ${deg5}° to the kerb.` },
        ...(straight > 0.02
          ? [{ dir: -1 as const, steer: 0, dist: straight, hint: 'Straighten the wheel and reverse straight back until your front-left corner clears the parked car.' }]
          : []),
        { dir: -1, steer: -1, dist: arc, hint: 'Turn the wheel fully right and keep reversing until the car is parallel to the kerb. Watch the left mirror for the kerb.' },
      ]);
    }
  }
  L.ideal = bestManoeuvre(L, candidates, CAR);
  const stop = firstStop(L);
  if (stop && L.ideal) {
    const short = front.x - pl / 2 - (stop.x - CAR.wheelbaseM / 2 - REAR_OVERHANG);
    L.ideal[0].hint = `Drive up alongside the front parked car, about 0.8 m away. Stop when your rear bumper is ${metres(short)} short of its rear bumper.`;
  }
  L.parTimeS = { beginner: 70, normal: 60, hard: 50 }[d];
  return L;
}

export const LEVELS: LevelDef[] = [
  {
    id: 1,
    title: 'Free practice lot',
    summary: 'An empty lot with bays, pillars and cones. Get a feel for the XUV’s size, creep and turning circle.',
    technique: [
      'Start the engine (I), hold the brake and select D. Release the brake and let the car creep.',
      'Drive through the cone slalom and around the cone ring at full lock to feel the 5.4 m turning radius.',
      'Practise stopping with your front bumper on a bay line — use the bonnet and top-down cameras to check.',
    ],
    build: () => practiceLot(),
  },
  {
    id: 2,
    title: 'Cone slalom and U-turn',
    summary: 'Weave through the cones, make a U-turn at the far end and come back through the return lane.',
    technique: [
      'Pass each cone on the side shown by the gate markers, without touching any cone.',
      'Slow down before the far end: a U-turn needs about 11 m kerb to kerb in the XUV.',
      'Turn fully left early and return through the lane to the finish line.',
    ],
    build: coneCourse,
  },
  {
    id: 3,
    title: 'Forward bay parking (90°)',
    summary: 'Drive forwards into an empty bay between two parked cars.',
    technique: [
      'Keep to the far side of the aisle to give yourself room to turn.',
      'Start turning when your front bumper is level with the middle of the bay; the front corner swings wide.',
      'Straighten up inside the bay and stop just short of the wheel stop. Select P.',
    ],
    build: forwardBay,
  },
  {
    id: 4,
    title: 'Reverse bay parking (90°)',
    summary: 'Reverse into a bay between two parked cars — the most common way to park in India.',
    technique: [
      'Drive past the bay and stop with your rear bumper about one bay-width past it (the hint gives the exact distance).',
      'Select R, turn fully towards the bay and reverse slowly, checking both mirrors.',
      'Straighten up and reverse until the red guideline reaches the wheel stop. Select P.',
    ],
    build: reverseBay,
  },
  {
    id: 5,
    title: 'Angle parking (45°)',
    summary: 'Enter an angled bay from a narrow one-way aisle.',
    technique: [
      'Approach close to the wall side of the aisle.',
      'When the bay opens, turn into it smoothly — angle bays need less steering than 90° bays.',
      'Straighten and stop before the wheel stop. Select P.',
    ],
    build: angleBay,
  },
  {
    id: 6,
    title: 'Parallel parking (reverse, left kerb)',
    summary: 'Reverse into a gap between two parked cars along the kerb.',
    technique: [
      'Stop alongside the front car, about 0.8 m away, with your rear bumper a little short of its rear bumper (the hint gives the distance).',
      'Full left lock and reverse until about 45° to the kerb.',
      'Full right lock and reverse until parallel, close to the kerb without touching it. Select P.',
    ],
    build: parallel,
  },
];
