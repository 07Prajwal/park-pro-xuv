import type { Difficulty, LevelLayout } from '../types';
import { emptyLayout, LINE_W, randomCar, rng } from './common';

export interface BayLot {
  layout: LevelLayout;
  bw: number;
  bl: number;
  aisle: number;
}

/**
 * Two facing rows of 90° bays across an aisle (levels 3 and 4). The target bay
 * is at x = 0 in the row opening towards -Z; the aisle runs along X.
 */
export function bayLot(d: Difficulty, seed: number): BayLot {
  const L = emptyLayout();
  const bw = { beginner: 3.0, normal: 2.6, hard: 2.4 }[d];
  const bl = 5.3;
  const aisle = { beginner: 8.4, normal: 7.6, hard: 7.6 }[d];
  const r = rng(seed);
  const n = 4;
  for (let i = -n; i <= n + 1; i++) L.lines.push({ x: (i - 0.5) * bw, z: bl / 2, yaw: 0, w: LINE_W, l: bl });
  L.lines.push({ x: 0, z: bl, yaw: 0, w: (2 * n + 1) * bw, l: LINE_W });
  // Opposite row across the aisle.
  const oz = -aisle - bl / 2;
  for (let i = -n; i <= n + 1; i++) L.lines.push({ x: (i - 0.5) * bw, z: oz, yaw: 0, w: LINE_W, l: bl });
  L.lines.push({ x: 0, z: -aisle - bl, yaw: 0, w: (2 * n + 1) * bw, l: LINE_W });
  for (let i = -n; i <= n; i++) {
    if (i !== 0 && i !== 3) L.parkedCars.push(randomCar(r, i * bw, bl / 2 + 0.15, r() < 0.5 ? 0 : Math.PI));
    if (i !== -2) L.parkedCars.push(randomCar(r, i * bw, oz - 0.15, r() < 0.5 ? 0 : Math.PI));
  }
  // Wheel-stop kerbs at the back of both rows, and a wall behind the bay row.
  L.kerbs.push({ x: 0, z: bl + 0.2, yaw: 0, w: (2 * n + 1) * bw, l: 0.3 }, { x: 0, z: -aisle - bl - 0.2, yaw: 0, w: (2 * n + 1) * bw, l: 0.3 });
  L.blocks.push({ rect: { x: 0, z: bl + 1.2, yaw: 0, w: (2 * n + 1) * bw + 2, l: 0.3 }, height: 1.1 });
  return { layout: L, bw, bl, aisle };
}
