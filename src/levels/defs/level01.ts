import type { LevelDef, LevelLayout } from '../types';
import { emptyLayout, LINE_W } from './common';

/** Level 1: an empty lot with two rows of bays, pillars, a cone slalom and a cone ring. */
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

export const level01: LevelDef = {
  id: 1,
  title: 'Free practice lot',
  summary: 'An empty lot with bays, pillars and cones. Get a feel for the XUV’s size, its brakes and turning circle.',
  technique: [
    'Press W to start the engine and drive forward; the car stops as soon as you let go. Press S to brake; once the car has stopped, S reverses.',
    'Drive through the cone slalom and around the cone ring at full lock to feel the 5.4 m turning radius.',
    'Practise stopping with your front bumper on a bay line — use the bonnet and top-down cameras to check.',
  ],
  build: () => practiceLot(),
};
