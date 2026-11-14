/**
 * Headless physics checks for the XUV vehicle model (runs in Node via Vitest).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PHYSICS, XUV_7XO, XUV_TUNING } from '../src/config';
import { createPhysics, type PhysicsContext } from '../src/core/physics';
import type { DriveInput } from '../src/input/InputState';
import { ackermannAngles, maxCentreSteerAngle, outerFrontRadius } from '../src/vehicle/steering';
import { VehiclePhysics, WHEEL_FL } from '../src/vehicle/VehiclePhysics';

const dt = PHYSICS.fixedDt;

function input(partial: Partial<DriveInput> = {}): DriveInput {
  return { forward: 0, back: 0, steer: 0, handbrake: false, ...partial };
}

function run(ctx: PhysicsContext, car: VehiclePhysics, inp: DriveInput, seconds: number, each?: () => void): void {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    car.update(inp, dt);
    ctx.world.step();
    car.postStep();
    each?.();
  }
}

describe('steering geometry', () => {
  it('full-lock outer front wheel traces the configured turning radius', () => {
    const r = outerFrontRadius(maxCentreSteerAngle(XUV_7XO), XUV_7XO);
    expect(r).toBeCloseTo(XUV_7XO.turningRadiusM, 6);
  });

  it('inner wheel steers more than outer wheel (Ackermann)', () => {
    const out = { left: 0, right: 0 };
    ackermannAngles(0.5, XUV_7XO, out);
    expect(out.left).toBeGreaterThan(out.right);
    ackermannAngles(-0.5, XUV_7XO, out);
    expect(Math.abs(out.right)).toBeGreaterThan(Math.abs(out.left));
  });
});

describe('XUV vehicle physics', () => {
  let ctx: PhysicsContext;
  let car: VehiclePhysics;

  beforeEach(async () => {
    ctx = await createPhysics();
    ctx.world.createCollider(ctx.R.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0));
    car = new VehiclePhysics(ctx.R, ctx.world, XUV_7XO, XUV_TUNING, { x: 0, z: 0, yaw: 0 });
    run(ctx, car, input(), 1.5); // settle on suspension
  });

  it('settles on its suspension with all wheels in contact and body level', () => {
    for (let i = 0; i < 4; i++) expect(car.controller.wheelIsInContact(i)).toBe(true);
    expect(Math.abs(car.curr.pos.y)).toBeLessThan(0.1);
    expect(Math.abs(car.speedMs)).toBeLessThan(0.05);
  });

  it('accelerates forward (+Z) to 100 km/h in a realistic 8-14 s', () => {
    let reached = -1;
    let elapsed = 0;
    run(ctx, car, input({ forward: 1 }), 20, () => {
      elapsed += dt;
      if (reached < 0 && car.speedKmh >= 100) reached = elapsed;
    });
    expect(car.curr.pos.z).toBeGreaterThan(50);
    expect(reached).toBeGreaterThan(8);
    expect(reached).toBeLessThan(14);
  });

  it('brakes from 80 km/h to a stop in a realistic distance (23-36 m, ~40 m from 100 km/h)', () => {
    // Accelerate until 80 km/h.
    for (let i = 0; i < 3000 && car.speedKmh < 80; i++) run(ctx, car, input({ forward: 1 }), dt);
    const z0 = car.curr.pos.z;
    let dist = -1;
    run(ctx, car, input({ back: 1 }), 8, () => {
      if (dist < 0 && car.speedMs < 0.2) dist = car.curr.pos.z - z0;
    });
    expect(dist).toBeGreaterThan(23);
    expect(dist).toBeLessThan(36);
  });

  it('positive steer turns left and low-speed full-lock circle matches the ~5.4 m turning radius', () => {
    // Crawl forward at full left lock and record the outer (front-right) wheel path.
    const xs: number[] = [];
    const zs: number[] = [];
    const conn = car.wheelConnections[1]; // FR = outer wheel in a left turn
    run(ctx, car, input({ steer: 1 }), 1.5); // wind on full lock while stopped
    run(ctx, car, input({ steer: 1, forward: 0.12 }), 14, () => {
      if (car.speedKmh > 8) car.body.setLinvel(scale(car.body.linvel(), 8 / car.speedKmh), true);
      const p = car.curr.pos;
      const q = car.curr.quat;
      const w = rotate(q, conn);
      xs.push(p.x + w.x);
      zs.push(p.z + w.z);
    });
    expect(car.controller.wheelSteering(WHEEL_FL)!).toBeGreaterThan(0);
    // Turning left from heading +Z means moving towards +X.
    expect(Math.max(...xs)).toBeGreaterThan(3);
    const r = fitCircleRadius(xs.slice(xs.length / 3), zs.slice(zs.length / 3));
    expect(r).toBeGreaterThan(XUV_7XO.turningRadiusM * 0.92);
    expect(r).toBeLessThan(XUV_7XO.turningRadiusM * 1.12);
  });

  it('holding brake at standstill engages reverse and the car backs up slowly (<= 18 km/h)', () => {
    run(ctx, car, input({ back: 1 }), 6);
    expect(car.gear).toBe('R');
    expect(car.curr.pos.z).toBeLessThan(-3);
    expect(car.speedKmh).toBeGreaterThan(-18.5);
  });
});

function scale(v: { x: number; y: number; z: number }, k: number) {
  return { x: v.x * k, y: v.y * k, z: v.z * k };
}

function rotate(q: { x: number; y: number; z: number; w: number }, v: { x: number; y: number; z: number }) {
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

/** Algebraic least-squares circle fit (Kasa). */
function fitCircleRadius(xs: number[], zs: number[]): number {
  const n = xs.length;
  let sx = 0, sz = 0, sxx = 0, szz = 0, sxz = 0, sxxx = 0, szzz = 0, sxzz = 0, sxxz = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i], z = zs[i];
    sx += x; sz += z; sxx += x * x; szz += z * z; sxz += x * z;
    sxxx += x * x * x; szzz += z * z * z; sxzz += x * z * z; sxxz += x * x * z;
  }
  const A = n * sxx - sx * sx;
  const B = n * sxz - sx * sz;
  const C = n * szz - sz * sz;
  const D = 0.5 * (n * (sxxx + sxzz) - sx * (sxx + szz));
  const E = 0.5 * (n * (sxxz + szzz) - sz * (sxx + szz));
  const det = A * C - B * B;
  const cx = (D * C - B * E) / det;
  const cz = (A * E - B * D) / det;
  let r = 0;
  for (let i = 0; i < n; i++) r += Math.hypot(xs[i] - cx, zs[i] - cz);
  return r / n;
}
