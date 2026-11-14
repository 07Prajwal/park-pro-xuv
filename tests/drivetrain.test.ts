/**
 * Automatic transmission / engine behaviour (Stage 2 acceptance criteria).
 */
import { describe, expect, it } from 'vitest';
import { XUV_7XO, XUV_DRIVETRAIN } from '../src/config';
import { Drivetrain } from '../src/vehicle/Drivetrain';
import { dt, getReady, input, makeWorld, run } from './helpers';

describe('selector interlocks (AC-2)', () => {
  const make = () => new Drivetrain(XUV_DRIVETRAIN, XUV_7XO.wheelRadiusM);

  it('refuses to leave P without the brake', () => {
    const d = make();
    expect(d.requestSelector('D', false, 0).ok).toBe(false);
    expect(d.selector).toBe('P');
    expect(d.requestSelector('D', true, 0).ok).toBe(true);
  });

  it('refuses to leave P when rolling above 1.5 km/h', () => {
    const d = make();
    expect(d.requestSelector('R', true, 2).ok).toBe(false);
  });

  it('refuses R or P above 3 km/h forwards, and D above 3 km/h backwards', () => {
    const d = make();
    d.requestSelector('D', true, 0);
    expect(d.requestSelector('R', false, 10).ok).toBe(false);
    expect(d.requestSelector('P', false, 10).ok).toBe(false);
    expect(d.selector).toBe('D');
    expect(d.requestSelector('N', false, 30).ok).toBe(true);
    d.requestSelector('R', true, 0);
    expect(d.requestSelector('D', false, -8).ok).toBe(false);
  });
});

describe('drivetrain in the vehicle', () => {
  it('AC-1: creeps to 5-9 km/h in D with no throttle and no brake', async () => {
    const { ctx, car } = await makeWorld();
    getReady(ctx, car);
    run(ctx, car, input(), 12);
    expect(car.speedKmh).toBeGreaterThan(5);
    expect(car.speedKmh).toBeLessThan(9);
    expect(car.drivetrain.gear).toBe(1);
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

  it('AC-5: in P, full throttle revs the engine but the car stays put', async () => {
    const { ctx, car } = await makeWorld();
    car.toggleIgnition();
    run(ctx, car, input(), 2);
    car.parkingBrake = false;
    const z0 = car.curr.pos.z;
    let maxRpm = 0;
    run(ctx, car, input({ forward: 1 }), 4, () => {
      maxRpm = Math.max(maxRpm, car.drivetrain.engineRpm);
    });
    expect(Math.abs(car.curr.pos.z - z0)).toBeLessThan(0.05);
    expect(maxRpm).toBeGreaterThan(3000);
  });

  it('engine idles near idle rpm after starting and holds at a stop on the brake in D', async () => {
    const { ctx, car } = await makeWorld();
    getReady(ctx, car);
    run(ctx, car, input({ back: 1 }), 3);
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
