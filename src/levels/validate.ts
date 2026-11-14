/**
 * Clearance of a manoeuvre against a level's obstacles: the car body (and its
 * door mirrors, for tall obstacles) must keep clear of parked vehicles, walls,
 * pillars and cones, and the tyres must not touch kerbs or pavements. Every
 * obstacle has a height range, so a car on a deck is not blocked by the pillars
 * of the floor below. Used to choose the best ideal manoeuvre and by the tests.
 */

import type { CarDimensions } from '../config';
import { surfaceWalls, Terrain } from '../world/terrain';
import { carFootprint, rectCorners, rectSeparation, tyreRects } from './geometry';
import { samplePath } from './idealPath';
import type { LevelLayout, OrientedRect, Pose, Segment, StreetVehicleKind } from './types';

const CONE_SIZE = 0.36;
const CONE_H = 0.72;
/** Height band of the door mirror glass above the floor. */
const MIRROR_Y0 = 1.05;
const MIRROR_Y1 = 1.25;
/** Lowest point of the body sides (bumpers clear kerbs, wheel stops and pavements). */
const BODY_Y0 = 0.25;
/** Kerbs further than this above or below the car's floor are on another level. */
const LEVEL_TOLERANCE = 0.6;

export const STREET_VEHICLE_SIZE: Record<StreetVehicleKind, { w: number; l: number; h: number }> = {
  auto: { w: 1.32, l: 2.65, h: 1.72 },
  scooter: { w: 0.72, l: 1.8, h: 1.15 },
};

export interface Obstacle {
  rect: OrientedRect;
  y0: number;
  y1: number;
}

export function obstacles(layout: LevelLayout, d: CarDimensions): Obstacle[] {
  const out: Obstacle[] = [];
  for (const c of layout.parkedCars) {
    const y = c.y ?? 0;
    out.push({ rect: { x: c.x, z: c.z, yaw: c.yaw, w: d.widthM * c.scale, l: d.lengthM * c.scale }, y0: y, y1: y + d.heightM * c.scale });
  }
  for (const b of layout.blocks) {
    const base = b.base ?? 0;
    out.push({ rect: b.rect, y0: base, y1: base + b.height });
  }
  for (const c of layout.cones) out.push({ rect: { x: c.x, z: c.z, yaw: 0, w: CONE_SIZE, l: CONE_SIZE }, y0: 0, y1: CONE_H });
  for (const v of layout.vehicles) {
    const s = STREET_VEHICLE_SIZE[v.kind];
    out.push({ rect: { x: v.x, z: v.z, yaw: v.yaw, w: s.w, l: s.l }, y0: 0, y1: s.h });
  }
  for (const s of layout.surfaces) for (const w of surfaceWalls(s)) out.push({ rect: w.rect, y0: 0, y1: Math.max(w.h0, w.h1) });
  return out;
}

/** 2D obstacle rectangles (all heights). */
export function obstacleRects(layout: LevelLayout, d: CarDimensions): OrientedRect[] {
  return obstacles(layout, d).map((o) => o.rect);
}

/** Kerbs and pavements: rectangles the tyres must not touch, with their floor height. */
export function kerbRects(layout: LevelLayout): { rect: OrientedRect; y: number }[] {
  return [...layout.kerbs, ...layout.pavements].map((rect) => ({ rect, y: rect.level ?? 0 }));
}

/** The two door-mirror heads as small rectangles. */
export function mirrorRects(p: Pose, d: CarDimensions, out: OrientedRect[] = [newRect(), newRect()]): OrientedRect[] {
  const fp = carFootprint(p, d);
  const fx = Math.sin(p.yaw);
  const fz = Math.cos(p.yaw);
  const across = d.mirrorSpanM / 2 - 0.09;
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? 1 : -1;
    const o = out[i];
    o.x = fp.x + fx * d.mirrorAheadM + fz * across * side;
    o.z = fp.z + fz * d.mirrorAheadM - fx * across * side;
    o.yaw = p.yaw;
    o.w = 0.18;
    o.l = 0.12;
  }
  return out;
}

function newRect(): OrientedRect {
  return { x: 0, z: 0, yaw: 0, w: 0, l: 0 };
}

interface Box {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

function boundsOf(r: OrientedRect): Box {
  const c = rectCorners(r);
  return {
    x0: Math.min(c[0].x, c[1].x, c[2].x, c[3].x),
    x1: Math.max(c[0].x, c[1].x, c[2].x, c[3].x),
    z0: Math.min(c[0].z, c[1].z, c[2].z, c[3].z),
    z1: Math.max(c[0].z, c[1].z, c[2].z, c[3].z),
  };
}

/** Clearance of a car pose against one level; precomputes obstacle bounds once. */
export class ClearanceChecker {
  private readonly obs: (Obstacle & Box)[];
  private readonly kerbs: ({ rect: OrientedRect; y: number } & Box)[];
  private readonly fp = newRect();
  private readonly tyres: OrientedRect[] = [];
  private readonly mirrors = [newRect(), newRect()];
  readonly terrain: Terrain;

  constructor(
    layout: LevelLayout,
    private readonly d: CarDimensions,
  ) {
    this.obs = obstacles(layout, d).map((o) => ({ ...o, ...boundsOf(o.rect) }));
    this.kerbs = kerbRects(layout).map((k) => ({ ...k, ...boundsOf(k.rect) }));
    this.terrain = new Terrain(layout.surfaces);
  }

  /** Minimum clearance (metres) at pose `p` on a floor at height `y`; stops early below `floor`. */
  at(p: Pose, y: number, floor = -Infinity): number {
    const d = this.d;
    const fp = carFootprint(p, d, this.fp);
    const reach = d.lengthM / 2 + 1.5;
    let min = Infinity;
    for (const o of this.obs) {
      if (o.x1 < p.x - reach || o.x0 > p.x + reach || o.z1 < p.z - reach || o.z0 > p.z + reach) continue;
      if (o.y0 < y + d.heightM && o.y1 > y + BODY_Y0) min = Math.min(min, rectSeparation(fp, o.rect));
      if (o.y0 < y + MIRROR_Y1 && o.y1 > y + MIRROR_Y0) {
        for (const m of mirrorRects(p, d, this.mirrors)) min = Math.min(min, rectSeparation(m, o.rect));
      }
      if (min < floor) return min;
    }
    tyreRects(p, d, this.tyres);
    for (const k of this.kerbs) {
      if (k.x1 < p.x - reach || k.x0 > p.x + reach || k.z1 < p.z - reach || k.z0 > p.z + reach) continue;
      if (Math.abs(k.y - y) > LEVEL_TOLERANCE) continue;
      for (const t of this.tyres) min = Math.min(min, rectSeparation(t, k.rect));
      if (min < floor) return min;
    }
    return min;
  }

  /** Minimum clearance along a sequence of poses, following the floor height from `startY`. */
  along(poses: Pose[], startY = 0, floor = -Infinity): number {
    let y = startY;
    let min = Infinity;
    for (const p of poses) {
      y = this.terrain.height(p.x, p.z, y);
      min = Math.min(min, this.at(p, y, floor));
      if (min < floor) return min;
    }
    return min;
  }
}

/** Minimum clearance (metres) along the manoeuvre; negative means a collision or kerb touch. */
export function pathClearance(layout: LevelLayout, segs: Segment[], d: CarDimensions, step = 0.05, floor = -Infinity, checker?: ClearanceChecker): number {
  const c = checker ?? new ClearanceChecker(layout, d);
  return c.along(samplePath(layout.spawn, segs, d, step).poses, 0, floor);
}

/** Pick the candidate manoeuvre with the largest clearance (null entries are skipped). */
export function bestManoeuvre(layout: LevelLayout, candidates: (Segment[] | null)[], d: CarDimensions): Segment[] | undefined {
  const checker = new ClearanceChecker(layout, d);
  let best: Segment[] | undefined;
  let bestC = -Infinity;
  for (const c of candidates) {
    if (!c) continue;
    const cl = pathClearance(layout, c, d, 0.1, bestC, checker);
    if (cl > bestC) {
      bestC = cl;
      best = c;
    }
  }
  return best;
}
