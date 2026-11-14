import { PHYSICS, XUV_7XO, XUV_DRIVETRAIN, XUV_TUNING } from '../src/config';
import { createPhysics, type PhysicsContext } from '../src/core/physics';
import type { DriveInput } from '../src/input/InputState';
import { VehiclePhysics } from '../src/vehicle/VehiclePhysics';

export const dt = PHYSICS.fixedDt;

export function input(partial: Partial<DriveInput> = {}): DriveInput {
  return { forward: 0, back: 0, steer: 0, horn: false, ...partial };
}

export function run(ctx: PhysicsContext, car: VehiclePhysics, inp: DriveInput, seconds: number, each?: () => void): void {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    car.update(inp, dt);
    ctx.world.step();
    car.postStep();
    each?.();
  }
}

/** Flat world with the XUV parked (P, parking brake on, engine off), settled on its suspension. */
export async function makeWorld(): Promise<{ ctx: PhysicsContext; car: VehiclePhysics }> {
  const ctx = await createPhysics();
  ctx.world.createCollider(ctx.R.ColliderDesc.cuboid(800, 0.5, 800).setTranslation(0, -0.5, 0));
  const car = new VehiclePhysics(ctx.R, ctx.world, XUV_7XO, XUV_TUNING, XUV_DRIVETRAIN, { x: 0, z: 0, yaw: 0 });
  run(ctx, car, input(), 1.5);
  return { ctx, car };
}

/** Start the engine, hold the brake, select `gear` and release the parking brake. */
export function getReady(ctx: PhysicsContext, car: VehiclePhysics, gear: 'D' | 'R' = 'D'): void {
  car.toggleIgnition();
  run(ctx, car, input({ back: 1 }), 2);
  const steps = gear === 'D' ? 3 : 1;
  for (let i = 0; i < steps; i++) {
    const r = car.shiftSelector(1);
    if (!r.ok) throw new Error(`shift refused: ${r.reason}`);
  }
  car.parkingBrake = false;
}
