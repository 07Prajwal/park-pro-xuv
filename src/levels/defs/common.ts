/**
 * Shared helpers for the level definitions: car constants, seeded random
 * numbers, an empty layout, parked-car placement and hint wording.
 */

import { XUV_7XO } from '../../config';
import { endPose } from '../idealPath';
import type { LevelLayout, ParkedCar, Pose } from '../types';

export const CAR = XUV_7XO;
export const LINE_W = 0.11;
export const HALF_PI = Math.PI / 2;
export const REAR_OVERHANG = CAR.lengthM - CAR.wheelbaseM - CAR.frontOverhangM;
/** Footprint centre is this far ahead of the physics origin (front overhang differs from rear). */
export const FOOT_OFF = (CAR.frontOverhangM - REAR_OVERHANG) / 2;

export const PARKED_COLOURS = [0xe8e8e6, 0xb9bcbf, 0x6b6e72, 0x1b1c1f, 0x8e1016, 0x1f3f7a, 0xd8d2c4, 0x3c4a3e];

export function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function emptyLayout(): LevelLayout {
  return {
    spawn: { x: 0, z: 0, yaw: 0 },
    lines: [],
    kerbs: [],
    pavements: [],
    blocks: [],
    floors: [],
    surfaces: [],
    bumps: [],
    cones: [],
    parkedCars: [],
    vehicles: [],
    parTimeS: 60,
  };
}

/** A parked car with a random size and colour. */
export function randomCar(r: () => number, x: number, z: number, yaw: number, extra: Partial<ParkedCar> = {}): ParkedCar {
  return {
    x,
    z,
    yaw,
    scale: [0.86, 0.93, 1][Math.floor(r() * 3)],
    colour: PARKED_COLOURS[Math.floor(r() * PARKED_COLOURS.length)],
    ...extra,
  };
}

/** Pose (physics origin) at the end of the first segment of a manoeuvre. */
export function firstStop(L: LevelLayout): Pose | null {
  return L.ideal ? endPose(L.spawn, L.ideal.slice(0, 1), CAR) : null;
}

export const metres = (m: number) => `${(Math.round(m * 10) / 10).toFixed(1)} m`;

export const lockWord = (steer: number) => {
  const a = Math.abs(steer);
  const side = steer > 0 ? 'left' : 'right';
  return a > 0.95 ? `fully ${side}` : a > 0.7 ? `about three-quarters ${side}` : `about half ${side}`;
};

/** Physics-origin pose that puts the car's footprint centre at (x, z) facing `yaw`. */
export function poseForCentre(x: number, z: number, yaw: number): Pose {
  return { x: x - Math.sin(yaw) * FOOT_OFF, z: z - Math.cos(yaw) * FOOT_OFF, yaw };
}
