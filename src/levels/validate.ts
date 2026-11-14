/**
 * Clearance of a manoeuvre against a level's obstacles: the car body must keep
 * clear of parked cars, blocks and cones, and the tyres must not touch kerbs.
 * Used to choose the best ideal manoeuvre and by the solvability tests.
 */

import type { CarDimensions } from '../config';
import { carFootprint, rectSeparation, tyreRects } from './geometry';
import { samplePath } from './idealPath';
import type { LevelLayout, OrientedRect, Segment } from './types';

const CONE_SIZE = 0.36;

export function obstacleRects(layout: LevelLayout, d: CarDimensions): OrientedRect[] {
  const out: OrientedRect[] = [];
  for (const c of layout.parkedCars) out.push({ x: c.x, z: c.z, yaw: c.yaw, w: d.widthM * c.scale, l: d.lengthM * c.scale });
  for (const b of layout.blocks) out.push(b.rect);
  for (const c of layout.cones) out.push({ x: c.x, z: c.z, yaw: 0, w: CONE_SIZE, l: CONE_SIZE });
  return out;
}

/** Minimum clearance (metres) along the manoeuvre; negative means a collision or kerb touch. */
export function pathClearance(layout: LevelLayout, segs: Segment[], d: CarDimensions, step = 0.05): number {
  const obstacles = obstacleRects(layout, d);
  const path = samplePath(layout.spawn, segs, d, step);
  const fp: OrientedRect = { x: 0, z: 0, yaw: 0, w: 0, l: 0 };
  const tyres: OrientedRect[] = [];
  let min = Infinity;
  for (const p of path.poses) {
    carFootprint(p, d, fp);
    for (const o of obstacles) min = Math.min(min, rectSeparation(fp, o));
    if (layout.kerbs.length) {
      tyreRects(p, d, tyres);
      for (const t of tyres) for (const k of layout.kerbs) min = Math.min(min, rectSeparation(t, k));
    }
  }
  return min;
}

/** Pick the candidate manoeuvre with the largest clearance (null entries are skipped). */
export function bestManoeuvre(layout: LevelLayout, candidates: (Segment[] | null)[], d: CarDimensions): Segment[] | undefined {
  let best: Segment[] | undefined;
  let bestC = -Infinity;
  for (const c of candidates) {
    if (!c) continue;
    const cl = pathClearance(layout, c, d, 0.1);
    if (cl > bestC) {
      bestC = cl;
      best = c;
    }
  }
  return best;
}
