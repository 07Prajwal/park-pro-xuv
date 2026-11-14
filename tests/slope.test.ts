import { describe, expect, it } from 'vitest';
import { XUV_7XO } from '../src/config';
import { endPose } from '../src/levels/idealPath';
import { LEVELS } from '../src/levels/levels';
import { DIFFICULTIES, type Pose } from '../src/levels/types';
import type { VehiclePhysics } from '../src/vehicle/VehiclePhysics';
import { Terrain } from '../src/world/terrain';
import { getReady, input, makeLevelWorld, run } from './helpers';

const CAR = XUV_7XO;

function place(car: VehiclePhysics, terrain: Terrain, p: Pose, refY = 0): void {
  const y = terrain.height(p.x, p.z, refY);
  car.reset({ ...p, y, pitch: terrain.pitch(p.x, p.z, p.yaw, y) });
}

describe('holding the car on a hill', () => {
  for (const d of DIFFICULTIES) {
    const L = LEVELS[11].build(d);
    const terrain = new Terrain(L.surfaces);
    const ideal = L.ideal!;
    const stopAt = ideal.findIndex((s) => s.stop);
    const spots: [string, Pose][] = [
      ['uphill space', endPose(L.spawn, ideal.slice(0, stopAt + 1), CAR)],
      ['downhill space', endPose(L.spawn, ideal, CAR)],
    ];
    for (const [name, pose] of spots) {
      for (const hold of ['P', 'parking brake'] as const) {
        it(`${d}: held by ${hold} alone in the ${name}, drifts under 2 cm in 10 s`, async () => {
          const { ctx, car } = await makeLevelWorld(L);
          place(car, terrain, pose, 100);
          if (hold === 'P') car.parkingBrake = false;
          else car.drivetrain.selector = 'N';
          run(ctx, car, input(), 1);
          const a = car.body.translation();
          run(ctx, car, input(), 10);
          const b = car.body.translation();
          expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(0.02);
        }, 30000);
      }
    }
  }
});

describe('car park ramp', () => {
  it('the car drives from the street up the ramp onto the deck', async () => {
    const L = LEVELS[7].build('normal');
    const terrain = new Terrain(L.surfaces);
    const deck = L.surfaces.find((s) => s.slabM)!;
    const { ctx, car } = await makeLevelWorld(L);
    const ramp = L.surfaces.filter((s) => s.h0 !== s.h1);
    const x = ramp[0].rect.x;
    const zTop = Math.max(...ramp.map((s) => s.rect.z + s.rect.l / 2));
    place(car, terrain, { x, z: zTop + 4, yaw: Math.PI });
    getReady(ctx, car, 'D');
    let maxY = 0;
    for (let t = 0; t < 30; t += 0.1) {
      const v = Math.abs(car.speedMs);
      run(ctx, car, input({ forward: v < 2.5 ? 0.35 : 0, back: v > 3.5 ? 0.3 : 0 }), 0.1);
      maxY = Math.max(maxY, car.body.translation().y);
      if (car.body.translation().z < deck.rect.z + deck.rect.l / 2 - 6) break;
    }
    const p = car.body.translation();
    expect(p.z).toBeLessThan(deck.rect.z + deck.rect.l / 2 - 6);
    expect(p.y).toBeGreaterThan(deck.h0 - 0.2);
    expect(Math.abs(p.x - x)).toBeLessThan(0.5);
  }, 30000);
});
