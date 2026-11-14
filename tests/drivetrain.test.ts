/**
 * Automatic transmission / engine behaviour, driven only by the W and S pedals
 * (there is no gear selector and no idle creep).
 */
import { describe, expect, it } from 'vitest';
import { XUV_DRIVETRAIN } from '../src/config';
import { dt, getReady, input, makeWorld, run } from './helpers';

describe('drivetrain in the vehicle', () => {
  it('does not move without a pedal: no idle creep', async () => {
    const { ctx, car } = await makeWorld();
    getReady(ctx, car);
    const z0 = car.curr.pos.z;
    run(ctx, car, input(), 12);
    expect(Math.abs(car.curr.pos.z - z0)).toBeLessThan(0.05);
    expect(Math.abs(car.speedKmh)).toBeLessThan(0.5);
  });

  it('a key press starts a stopped engine and then drives the car', async () => {
    const { ctx, car } = await makeWorld();
    expect(car.drivetrain.engineRunning).toBe(false);
    car.parkingBrake = false;
    const z0 = car.curr.pos.z;
    run(ctx, car, input({ forward: 0.6 }), 4);
    expect(car.drivetrain.engineRunning).toBe(true);
    expect(car.curr.pos.z - z0).toBeGreaterThan(1);
  });

  it('W drives forward in D and S drives backwards in R from a standstill', async () => {
    const { ctx, car } = await makeWorld();
    getReady(ctx, car);
    run(ctx, car, input({ forward: 0.4 }), 2);
    expect(car.drivetrain.selector).toBe('D');
    expect(car.speedMs).toBeGreaterThan(0.5);
    run(ctx, car, input(), 4); // let go: the car stops
    expect(Math.abs(car.speedMs)).toBeLessThan(0.05);
    run(ctx, car, input({ back: 0.4 }), 2);
    expect(car.drivetrain.selector).toBe('R');
    expect(car.speedMs).toBeLessThan(-0.5);
  });

  it('letting go of the pedal brings the car to a stop within a few metres and holds it', async () => {
    const { ctx, car } = await makeWorld();
    getReady(ctx, car);
    run(ctx, car, input({ forward: 0.5 }), 3);
    const v0 = car.speedMs;
    expect(v0).toBeGreaterThan(3);
    const z0 = car.curr.pos.z;
    run(ctx, car, input(), 8);
    expect(Math.abs(car.speedMs)).toBeLessThan(0.05);
    const stopDist = car.curr.pos.z - z0;
    expect(stopDist).toBeLessThan((v0 * v0) / (2 * 2.5) + 0.5); // slows at 2.5 m/s² or better
    expect(stopDist).toBeGreaterThan(0.5 * ((v0 * v0) / (2 * 4)));
    const z1 = car.curr.pos.z;
    run(ctx, car, input(), 5);
    expect(Math.abs(car.curr.pos.z - z1)).toBeLessThan(0.01);
  });

  it('S brakes a car moving forward to a stop, waits a moment, then reverses', async () => {
    const { ctx, car } = await makeWorld();
    getReady(ctx, car);
    run(ctx, car, input({ forward: 1 }), 5);
    expect(car.speedKmh).toBeGreaterThan(20);
    let stoppedAt = -1;
    let t = 0;
    let slowestReverse = 0;
    run(ctx, car, input({ back: 1 }), 5, () => {
      t += dt;
      if (stoppedAt < 0 && car.speedMs < 0.2) stoppedAt = t;
      if (stoppedAt >= 0 && t < stoppedAt + 0.2) slowestReverse = Math.min(slowestReverse, car.speedMs);
    });
    expect(stoppedAt).toBeGreaterThan(0);
    expect(slowestReverse).toBeGreaterThan(-0.3); // still braking during the pause
    expect(car.drivetrain.selector).toBe('R');
    expect(car.speedMs).toBeLessThan(-1); // then reversing
  });

  it('W brakes a reversing car to a stop before driving forward', async () => {
    const { ctx, car } = await makeWorld();
    getReady(ctx, car);
    run(ctx, car, input({ back: 0.6 }), 3);
    expect(car.speedMs).toBeLessThan(-0.8);
    run(ctx, car, input({ forward: 1 }), 5);
    expect(car.drivetrain.selector).toBe('D');
    expect(car.speedMs).toBeGreaterThan(0.5);
  });

  it('AC-3: 0-100 km/h in 9-13 s through at least 4 gears without exceeding the rev limit', async () => {
    const { ctx, car } = await makeWorld();
    getReady(ctx, car);
    let t = 0;
    let reached = -1;
    let maxGear = 1;
    let maxRpm = 0;
    run(ctx, car, input({ forward: 1 }), 20, () => {
      t += dt;
      maxGear = Math.max(maxGear, car.drivetrain.gear);
      maxRpm = Math.max(maxRpm, car.drivetrain.engineRpm);
      if (reached < 0 && car.speedKmh >= 100) reached = t;
    });
    expect(reached).toBeGreaterThan(9);
    expect(reached).toBeLessThan(13);
    expect(maxGear).toBeGreaterThanOrEqual(4);
    expect(maxRpm).toBeLessThanOrEqual(XUV_DRIVETRAIN.revLimitRpm + 50);
  });

  it('engine idles near idle rpm after starting and stays there at a standstill', async () => {
    const { ctx, car } = await makeWorld();
    getReady(ctx, car);
    run(ctx, car, input(), 3);
    expect(Math.abs(car.speedKmh)).toBeLessThan(0.5);
    expect(car.drivetrain.engineRpm).toBeGreaterThan(600);
    expect(car.drivetrain.engineRpm).toBeLessThan(800);
  });

  it('cruises at 120 km/h in 6th with lock-up near 1900 rpm', async () => {
    const { ctx, car } = await makeWorld();
    getReady(ctx, car);
    for (let i = 0; i < 4000 && car.speedKmh < 120; i++) run(ctx, car, input({ forward: 1 }), dt);
    run(ctx, car, input({ forward: 0.45 }), 12);
    expect(car.drivetrain.gear).toBe(6);
    expect(car.drivetrain.lockedUp).toBe(true);
    expect(car.drivetrain.engineRpm).toBeGreaterThan(1500);
    expect(car.drivetrain.engineRpm).toBeLessThan(2400);
  });
});
