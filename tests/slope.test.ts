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
      for (const hold of ['automatic hold', 'parking brake'] as const) {
        it(`${d}: held by the ${hold} in the ${name} with no pedal pressed, drifts under 2 cm in 10 s`, async () => {
          const { ctx, car } = await makeLevelWorld(L);
          place(car, terrain, pose, 100);
          car.parkingBrake = hold === 'parking brake';
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

describe('pulling away on a hill', () => {
  for (const d of DIFFICULTIES) {
    const L = LEVELS[11].build(d);
    const terrain = new Terrain(L.surfaces);
    const ideal = L.ideal!;
    const stopAt = ideal.findIndex((s) => s.stop);
    const pose = endPose(L.spawn, ideal.slice(0, stopAt + 1), CAR);
    it(`${d}: full pedal uphill from the parked uphill space does not roll back more than 15 cm`, async () => {
      const { ctx, car } = await makeLevelWorld(L);
      place(car, terrain, pose, 100);
      const p = car.body.translation();
      const noseUp = terrain.pitch(pose.x, pose.z, pose.yaw, p.y) > 0;
      const dir = noseUp ? 1 : -1; // +1: W drives uphill, -1: S does
      getReady(ctx, car);
      run(ctx, car, input(), 1);
      const a = car.body.translation();
      const fx = Math.sin(pose.yaw) * dir;
      const fz = Math.cos(pose.yaw) * dir;
      let back = 0;
      run(ctx, car, noseUp ? input({ forward: 1 }) : input({ back: 1 }), 3, () => {
        const b = car.body.translation();
        back = Math.max(back, -((b.x - a.x) * fx + (b.z - a.z) * fz));
      });
      const b = car.body.translation();
      expect((b.x - a.x) * fx + (b.z - a.z) * fz).toBeGreaterThan(1); // it did drive up the hill
      expect(back).toBeLessThan(0.15);
    }, 30000);
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
    getReady(ctx, car);
    let maxY = 0;
    for (let t = 0; t < 30; t += 0.1) {
      const v = Math.abs(car.speedMs);
      run(ctx, car, v > 3.5 ? input({ back: 0.3 }) : input({ forward: v < 2.5 ? 0.45 : 0 }), 0.1);
      maxY = Math.max(maxY, car.body.translation().y);
      if (car.body.translation().z < deck.rect.z + deck.rect.l / 2 - 6) break;
    }
    const p = car.body.translation();
    expect(p.z).toBeLessThan(deck.rect.z + deck.rect.l / 2 - 6);
    expect(p.y).toBeGreaterThan(deck.h0 - 0.2);
    expect(Math.abs(p.x - x)).toBeLessThan(0.5);
  }, 30000);
});
