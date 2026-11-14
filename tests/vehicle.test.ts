/**
 * Headless physics checks for the XUV vehicle model (runs in Node via Vitest).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { XUV_7XO } from '../src/config';
import type { PhysicsContext } from '../src/core/physics';
import { ackermannAngles, maxCentreSteerAngle, outerFrontRadius } from '../src/vehicle/steering';
import { WHEEL_FL, type VehiclePhysics } from '../src/vehicle/VehiclePhysics';
import { dt, getReady, input, makeWorld, run } from './helpers';

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
    ({ ctx, car } = await makeWorld());
  });

  it('settles on its suspension with all wheels in contact and body level', () => {
    for (let i = 0; i < 4; i++) expect(car.controller.wheelIsInContact(i)).toBe(true);
    expect(Math.abs(car.curr.pos.y)).toBeLessThan(0.1);
    expect(Math.abs(car.speedMs)).toBeLessThan(0.05);
  });

  it('AC-4: brakes from 80 km/h to a stop in a realistic distance (23-36 m, ~40 m from 100 km/h)', () => {
    getReady(ctx, car);
    for (let i = 0; i < 3000 && car.speedKmh < 80; i++) run(ctx, car, input({ forward: 1 }), dt);
    const z0 = car.curr.pos.z;
    let dist = -1;
    run(ctx, car, input({ back: 1 }), 8, () => {
      if (dist < 0 && car.speedMs < 0.2) dist = car.curr.pos.z - z0;
    });
    expect(dist).toBeGreaterThan(23);
    expect(dist).toBeLessThan(36);
  });

  it('AC-8: positive steer turns left and the low-speed full-lock circle matches the ~5.4 m turning radius', () => {
    getReady(ctx, car);
    const xs: number[] = [];
    const zs: number[] = [];
    const conn = car.wheelConnections[1]; // FR = outer wheel in a left turn
    run(ctx, car, input({ steer: 1, back: 1 }), 1.5); // wind on full lock while held on the brake
    run(ctx, car, input({ steer: 1 }), 14, () => {
      const p = car.curr.pos;
      const w = rotate(car.curr.quat, conn);
      xs.push(p.x + w.x);
      zs.push(p.z + w.z);
    });
    expect(car.controller.wheelSteering(WHEEL_FL)!).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeGreaterThan(3); // left of +Z heading is +X
    const r = fitCircleRadius(xs.slice(xs.length / 3), zs.slice(zs.length / 3));
    expect(r).toBeGreaterThan(XUV_7XO.turningRadiusM * 0.92);
    expect(r).toBeLessThan(XUV_7XO.turningRadiusM * 1.12);
  });

  it('R creeps backwards slowly with no throttle', () => {
    getReady(ctx, car, 'R');
    run(ctx, car, input(), 8);
    expect(car.curr.pos.z).toBeLessThan(-3);
    expect(car.speedKmh).toBeGreaterThan(-10);
  });
});

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
