import { Terrain } from '../../world/terrain';
import { sBend } from '../idealPath';
import type { Block, Difficulty, LevelDef, LevelLayout, ParkingTarget, Segment, Surface } from '../types';
import { CAR, emptyLayout, FOOT_OFF, LINE_W, PARKED_COLOURS, rng } from './common';
import { HOUSE_COLOURS } from './level09';

const HALF_ROAD = 4;
const PAVE = 1.8;
const START_Z = -20;
const BAY_X = HALF_ROAD - 0.3 - CAR.widthM / 2;
const LANE_X = 1.8;

/**
 * Level 12: a hill street, up one side and down the other. Park in a marked
 * kerbside space on the way up and another on the way down; on a hill the car
 * must be held by the parking brake. Rolling back is penalised.
 */
function hill(d: Difficulty): LevelLayout {
  const L = emptyLayout();
  const r = rng(113);
  const g = { beginner: 0.06, normal: 0.1, hard: 0.14 }[d];
  const bayLen = { beginner: 7.5, normal: 7.0, hard: 6.5 }[d];
  const sections: [number, number][] = [
    [4, g / 2],
    [26, g],
    [4, g / 2],
    [14, 0],
    [4, -g / 2],
    [26, -g],
    [4, -g / 2],
  ];
  const fullW = 2 * (HALF_ROAD + 0.3 + PAVE);
  let z = START_Z;
  let h = 0;
  const secs: Surface[] = [];
  for (const [len, grad] of sections) {
    const s: Surface = { rect: { x: 0, z: z + len / 2, yaw: 0, w: fullW, l: len }, h0: h, h1: h + grad * len };
    secs.push(s);
    z += len;
    h = s.h1;
  }
  L.surfaces.push(...secs);
  const terrain = new Terrain(L.surfaces);
  const endZ = z;
  const hAt = (zz: number) => terrain.height(0, zz, 100);

  // Kerbs and pavements per section (each tilts with its section), lane dashes, house fronts.
  for (const side of [1, -1] as const) {
    L.kerbs.push({ x: side * (HALF_ROAD + 0.15), z: (-40 + START_Z) / 2, yaw: 0, w: 0.3, l: START_Z + 40 });
    L.kerbs.push({ x: side * (HALF_ROAD + 0.15), z: (endZ + 70) / 2, yaw: 0, w: 0.3, l: 70 - endZ });
    L.pavements.push({ x: side * (HALF_ROAD + 0.3 + PAVE / 2), z: (-40 + START_Z) / 2, yaw: 0, w: PAVE, l: START_Z + 40 });
    L.pavements.push({ x: side * (HALF_ROAD + 0.3 + PAVE / 2), z: (endZ + 70) / 2, yaw: 0, w: PAVE, l: 70 - endZ });
    for (const s of secs) {
      const level = (s.h0 + s.h1) / 2;
      L.kerbs.push({ x: side * (HALF_ROAD + 0.15), z: s.rect.z, yaw: 0, w: 0.3, l: s.rect.l, level });
      L.pavements.push({ x: side * (HALF_ROAD + 0.3 + PAVE / 2), z: s.rect.z, yaw: 0, w: PAVE, l: s.rect.l, level });
    }
    L.blocks.push(...hillHouses(r, side, -40, 70, HALF_ROAD + 0.3 + PAVE, hAt));
  }
  for (let dz = -38; dz < 68; dz += 6) L.lines.push({ x: 0, z: dz, yaw: 0, w: 0.12, l: 3, level: hAt(dz) });

  // Marked kerbside spaces: one on the up slope, one on the down slope.
  const upZ = START_Z + 4 + 13;
  const downZ = START_Z + 4 + 26 + 4 + 14 + 4 + 13;
  const space = (cz: number, name: string): ParkingTarget => {
    const level = hAt(cz);
    for (const e of [-1, 1]) L.lines.push({ x: HALF_ROAD - 1.2, z: cz + (e * bayLen) / 2, yaw: 0, w: 2.4, l: LINE_W, level: hAt(cz + (e * bayLen) / 2) });
    L.lines.push({ x: HALF_ROAD - 2.4, z: cz, yaw: 0, w: LINE_W, l: bayLen, level });
    return {
      zone: { x: HALF_ROAD - 1.2, z: cz, yaw: 0, w: 2.4, l: bayLen, level },
      facing: 'forward',
      maxAngleDeg: { beginner: 8, normal: 6, hard: 5 }[d],
      kerb: { rect: { x: HALF_ROAD + 0.15, z: cz, yaw: 0, w: 0.3, l: bayLen }, maxGapM: { beginner: 0.5, normal: 0.4, hard: 0.35 }[d] },
      needsParkingBrake: true,
      name,
    };
  };
  L.stops = [space(upZ, 'uphill space')];
  L.target = space(downZ, 'downhill space');

  // Parked cars facing downhill on the other side of the road, pitched to the slope.
  for (const cz of [-30, -8, 4, 22, 40, 52, 64]) {
    const s = 0.86 + 0.07 * Math.floor(r() * 3);
    const x = -(HALF_ROAD - 0.25 - (CAR.widthM * s) / 2);
    L.parkedCars.push({ x, z: cz, yaw: Math.PI, scale: s, colour: PARKED_COLOURS[Math.floor(r() * PARKED_COLOURS.length)], y: hAt(cz), pitch: terrain.pitch(x, cz, Math.PI, 100) });
  }

  // Ideal: S into the up space, stop, S out, over the top, S into the down space, stop.
  L.spawn = { x: LANE_X, z: -36, yaw: 0 };
  const lateral = BAY_X - LANE_X;
  const sIn = sBend(lateral, 0.2, CAR, ['Steer gently left into the marked space by the kerb…', '…then steer right to come straight, close to the kerb.']);
  const sOut = sBend(-lateral, 0.8, CAR, [
    'Press W to pull out to the right; the parking brake releases by itself. Check the right mirror.',
    'Straighten up in the lane.',
  ]);
  const sIn2 = sBend(lateral, 0.2, CAR, ['Steer gently left into the downhill space…', '…and straighten up close to the kerb.']);
  const settle = 1.2;
  const zf1 = upZ - FOOT_OFF;
  const zf2 = downZ - FOOT_OFF;
  const a = zf1 - settle - sIn.along - L.spawn.z;
  const c = zf2 - settle - sIn2.along - (zf1 + sOut.along);
  const ideal: Segment[] = [
    { dir: 1, steer: 0, dist: a, hint: 'Drive up the hill in the left lane. You need a little more accelerator than on the flat to keep a steady speed.' },
    ...sIn.segs,
    {
      dir: 1,
      steer: 0,
      dist: settle,
      hint: 'Stop inside the space and apply the parking brake (Space).',
      stop: true,
    },
    ...sOut.segs,
    { dir: 1, steer: 0, dist: c, hint: 'Drive over the top. Going down, cover the brake: the car speeds up on its own.' },
    ...sIn2.segs,
    { dir: 1, steer: 0, dist: settle, hint: 'Stop inside the space and apply the parking brake (Space).' },
  ];
  L.ideal = a > 0 && c > 0 ? ideal : undefined;
  L.rules = { rollbackM: 0.3 };
  L.parTimeS = { beginner: 80, normal: 75, hard: 70 }[d];
  return L;
}

/** House fronts along a sloping street; each house's base is the ground and its height clears the road beside it. */
function hillHouses(r: () => number, side: 1 | -1, z0: number, z1: number, faceX: number, hAt: (z: number) => number): Block[] {
  const out: Block[] = [];
  let z = z0;
  while (z < z1 - 0.5) {
    const len = Math.min(z1 - z, 5 + r() * 4);
    let top = 0;
    for (let s = 0; s <= 4; s++) top = Math.max(top, hAt(z + (len * s) / 4));
    out.push({
      rect: { x: side * (faceX + 3), z: z + len / 2, yaw: 0, w: 6, l: len },
      height: top + 4 + r() * 4,
      material: r() < 0.25 ? 'brick' : 'plaster',
      tint: HOUSE_COLOURS[Math.floor(r() * HOUSE_COLOURS.length)],
    });
    z += len;
  }
  return out;
}

export const level12: LevelDef = {
  id: 12,
  title: 'Uphill and downhill parking',
  summary: 'Park on the way up a hill and again on the way down. Stop in each space with the parking brake on, and don’t roll back.',
  technique: [
    'Uphill: keep a steady speed with a little extra pressure on W. When you let go the car holds still.',
    'Apply the parking brake (Space) once you have stopped inside the space.',
    'Pulling away uphill: press W smoothly; the parking brake releases by itself and the car must not roll back.',
    'Downhill: cover the brake all the way down. Good practice with a kerb: wheels turned towards the kerb downhill, away from it uphill.',
  ],
  build: hill,
};
