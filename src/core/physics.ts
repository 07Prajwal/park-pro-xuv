/**
 * Rapier bootstrap. The compat build inlines its WASM, so it works from a static
 * site and offline, and in Node for tests.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { PHYSICS } from '../config';

export type Rapier = typeof RAPIER;

export interface PhysicsContext {
  R: Rapier;
  world: RAPIER.World;
  events: RAPIER.EventQueue;
}

let initPromise: Promise<void> | null = null;

export async function createPhysics(): Promise<PhysicsContext> {
  initPromise ??= RAPIER.init();
  await initPromise;
  const world = new RAPIER.World({ x: 0, y: -PHYSICS.gravity, z: 0 });
  world.timestep = PHYSICS.fixedDt;
  return { R: RAPIER, world, events: new RAPIER.EventQueue(true) };
}
