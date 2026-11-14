import { describe, expect, it } from 'vitest';
import { XUV_7XO } from '../src/config';
import { scoreRun } from '../src/levels/scoring';
import { ParkingSensors, REAR } from '../src/vehicle/ParkingSensors';
import { getReady, input, makeWorld, run } from './helpers';

describe('parking sensors', () => {
  it('measure the distance to a wall behind the car within 5 cm', async () => {
    const { ctx, car } = await makeWorld();
    const d = XUV_7XO;
    const rearZ = -d.wheelbaseM / 2 - (d.lengthM - d.wheelbaseM - d.frontOverhangM);
    const gap = 1.0;
    ctx.world.createCollider(ctx.R.ColliderDesc.cuboid(3, 1, 0.1).setTranslation(0, 1, rearZ - gap - 0.1));
    getReady(ctx, car);
    run(ctx, car, input(), 0.2);
    const sensors = new ParkingSensors(ctx.R, ctx.world, car.body, d);
    sensors.update(0.016, car.drivetrain.selector, car.speedKmh, true);
    expect(sensors.active).toBe(true);
    const centre = Math.min(sensors.distances[REAR[1]], sensors.distances[REAR[2]]);
    expect(Math.abs(centre - gap)).toBeLessThan(0.05);
    expect(sensors.nearest).not.toBeNull();
  });

  it('are off in D above 12 km/h and on in D below it and in R', async () => {
    const { ctx, car } = await makeWorld();
    const sensors = new ParkingSensors(ctx.R, ctx.world, car.body, XUV_7XO);
    sensors.update(0.016, 'D', 20, true);
    expect(sensors.active).toBe(false);
    sensors.update(0.016, 'D', 8, true);
    expect(sensors.active).toBe(true);
    sensors.update(0.016, 'R', 5, true);
    expect(sensors.active).toBe(true);
  });
});

describe('scoring', () => {
  const clean = { timeS: 30, directionChanges: 1, idealDirectionChanges: 1, collisions: 0, conesHit: 0, kerbTouches: 0, alignment: 1 };

  it('a clean run within par time earns three stars', () => {
    const s = scoreRun(clean, 40, 'normal');
    expect(s.points).toBe(100);
    expect(s.stars).toBe(3);
  });

  it('one collision drops to two stars, two collisions and a correction to one', () => {
    expect(scoreRun({ ...clean, collisions: 1 }, 40, 'normal').stars).toBe(2);
    expect(scoreRun({ ...clean, collisions: 2, directionChanges: 2 }, 40, 'normal').stars).toBe(1);
  });

  it('hard is stricter than beginner for the same run', () => {
    const run = { ...clean, timeS: 60, kerbTouches: 1, alignment: 0.6 };
    expect(scoreRun(run, 40, 'hard').points).toBeLessThan(scoreRun(run, 40, 'beginner').points);
  });
});
