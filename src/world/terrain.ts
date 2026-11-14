/**
 * Height of the drivable surface (ground, ramps, decks) at a point. Pure maths,
 * shared by the level validation, the guides, markings and the car reset.
 *
 * Surfaces can overlap in plan (a deck above a ground-floor lane), so a query
 * takes a reference height: the highest surface that is no more than one step
 * above it wins. Following a path, pass the previous height as the reference.
 */

import type { OrientedRect, Surface } from '../levels/types';

/** Largest climb between neighbouring samples that still counts as the same floor. */
const STEP_M = 0.8;

export const PARAPET_H = 1.0;
const PARAPET_T = 0.2;

/** Parapet walls of a ramp: thin strips outside its edges whose top follows the slope, solid to the ground. */
export function surfaceWalls(s: Surface): Surface[] {
  const out: Surface[] = [];
  const r = s.rect;
  const lx = Math.cos(r.yaw);
  const lz = -Math.sin(r.yaw);
  const sides: number[] = [];
  if (s.walls?.left) sides.push(1);
  if (s.walls?.right) sides.push(-1);
  for (const side of sides) {
    const off = side * (r.w / 2 + PARAPET_T / 2);
    out.push({
      rect: { x: r.x + lx * off, z: r.z + lz * off, yaw: r.yaw, w: PARAPET_T, l: r.l },
      h0: s.h0 + PARAPET_H,
      h1: s.h1 + PARAPET_H,
      material: 'concrete',
    });
  }
  return out;
}

/** Top height of a surface at a distance `along` its forward axis from its centre. */
export function surfaceTop(s: Surface, along: number): number {
  return s.h0 + ((s.h1 - s.h0) * (along + s.rect.l / 2)) / s.rect.l;
}

/** Bottom of a surface: its slab underside, or just below the ground when it is solid. */
export function surfaceBottom(s: Surface, along: number): number {
  return s.slabM ? surfaceTop(s, along) - s.slabM : -0.02;
}

/** The eight corners of a surface's solid (world coordinates, xyz triples), for a convex-hull collider. */
export function surfaceHull(s: Surface): Float32Array {
  const r = s.rect;
  const fx = Math.sin(r.yaw);
  const fz = Math.cos(r.yaw);
  const pts: number[] = [];
  for (const along of [-r.l / 2, r.l / 2])
    for (const across of [-r.w / 2, r.w / 2])
      for (const y of [surfaceTop(s, along), surfaceBottom(s, along)]) pts.push(r.x + fz * across + fx * along, y, r.z - fx * across + fz * along);
  return new Float32Array(pts);
}

export interface TerrainSample {
  h: number;
  /** Height gradient: dh/dx and dh/dz. */
  gx: number;
  gz: number;
}

export class Terrain {
  constructor(private readonly surfaces: readonly Surface[]) {}

  height(x: number, z: number, refY = 0): number {
    return this.sample(x, z, refY).h;
  }

  sample(x: number, z: number, refY = 0, out: TerrainSample = { h: 0, gx: 0, gz: 0 }): TerrainSample {
    out.h = 0;
    out.gx = 0;
    out.gz = 0;
    for (const s of this.surfaces) {
      const r = s.rect;
      const fx = Math.sin(r.yaw);
      const fz = Math.cos(r.yaw);
      const dx = x - r.x;
      const dz = z - r.z;
      const along = dx * fx + dz * fz;
      const across = dx * fz - dz * fx;
      if (Math.abs(along) > r.l / 2 + 1e-6 || Math.abs(across) > r.w / 2 + 1e-6) continue;
      const grad = (s.h1 - s.h0) / r.l;
      const h = s.h0 + grad * (along + r.l / 2);
      if (h > refY + STEP_M || h <= out.h) continue;
      out.h = h;
      out.gx = grad * fx;
      out.gz = grad * fz;
    }
    return out;
  }

  /** Height for a rectangle tagged with a floor level (markings, zones). */
  heightFor(r: OrientedRect, x = r.x, z = r.z): number {
    return this.height(x, z, r.level ?? 0);
  }

  /** Nose-up pitch (radians) of a car at (x, z) heading `yaw`. */
  pitch(x: number, z: number, yaw: number, refY = 0): number {
    const s = this.sample(x, z, refY);
    return Math.atan(s.gx * Math.sin(yaw) + s.gz * Math.cos(yaw));
  }
}
