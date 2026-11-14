import { describe, expect, it } from 'vitest';
import { XUV_7XO } from '../src/config';
import { carFootprint, rectSeparation, tyreRects } from '../src/levels/geometry';
import { LEVELS } from '../src/levels/levels';
import { evaluateParking } from '../src/levels/scoring';
import type { OrientedRect, Pose } from '../src/levels/types';
import { obstacleRects } from '../src/levels/validate';
import type { VehiclePhysics } from '../src/vehicle/VehiclePhysics';
import { dt, getReady, input, makeWorld, run } from './helpers';

const CAR = XUV_7XO;

function poseOf(car: VehiclePhysics): Pose {
  const p = car.body.translation();
  const q = car.body.rotation();
  return { x: p.x, z: p.z, yaw: Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y)) };
}

function rearAxle(p: Pose): { x: number; z: number } {
  return { x: p.x - (Math.sin(p.yaw) * CAR.wheelbaseM) / 2, z: p.z - (Math.cos(p.yaw) * CAR.wheelbaseM) / 2 };
}

/**
 * Drive the physics car through the ideal segments like a careful learner:
 * stop, select the gear, steer while stationary, creep, and brake on the mark.
 * Returns every pose visited.
 */
async function drive(levelId: number): Promise<{ poses: Pose[]; layout: ReturnType<(typeof LEVELS)[number]['build']> }> {
  const layout = LEVELS[levelId - 1].build('normal');
  const { ctx, car } = await makeWorld();
  car.reset(layout.spawn);
  run(ctx, car, input(), 0.5);
  getReady(ctx, car, layout.ideal![0].dir > 0 ? 'D' : 'R');
  const poses: Pose[] = [];
  const record = () => poses.push(poseOf(car));

  for (const seg of layout.ideal!) {
    // Stop and select the right gear.
    run(ctx, car, input({ back: 1, steer: seg.steer }), 0.4, record);
    const want = seg.dir > 0 ? 'D' : 'R';
    for (let i = 0; i < 3 && car.drivetrain.selector !== want; i++) car.shiftSelector(want === 'R' ? -1 : 1);
    expect(car.drivetrain.selector).toBe(want);
    // Steer to the mark while holding the brake.
    for (let t = 0; t < 4 && Math.abs(car.steerPosition - seg.steer) > 0.005; t += dt) run(ctx, car, input({ back: 1, steer: seg.steer }), dt, record);
    // Creep (no throttle) and brake to stop on the segment length.
    let travelled = 0;
    let last = rearAxle(poseOf(car));
    for (let t = 0; t < 30 && travelled < seg.dist - 0.005; t += dt) {
      const remaining = seg.dist - travelled;
      const target = Math.min(1.2, Math.sqrt(2 * 1.2 * remaining) + 0.05);
      const v = Math.abs(car.speedMs);
      const brake = v > target ? Math.min(1, (v - target) * 2) : 0;
      run(ctx, car, input({ back: brake, steer: seg.steer }), dt, record);
      const now = rearAxle(poseOf(car));
      travelled += Math.hypot(now.x - last.x, now.z - last.z);
      last = now;
    }
  }
  run(ctx, car, input({ back: 1, steer: 0 }), 0.8, record);
  return { poses, layout };
}

function clearance(poses: Pose[], layout: Parameters<typeof obstacleRects>[0]): number {
  const obs = obstacleRects(layout, CAR);
  const fp: OrientedRect = { x: 0, z: 0, yaw: 0, w: 0, l: 0 };
  const tyres: OrientedRect[] = [];
  let min = Infinity;
  for (const p of poses) {
    carFootprint(p, CAR, fp);
    for (const o of obs) min = Math.min(min, rectSeparation(fp, o));
    tyreRects(p, CAR, tyres);
    for (const t of tyres) for (const k of layout.kerbs) min = Math.min(min, rectSeparation(t, k));
  }
  return min;
}

describe('the physics car can execute the ideal manoeuvre', () => {
  for (const id of [4, 6]) {
    it(`level ${id} (normal): ends correctly parked without touching anything`, async () => {
      const { poses, layout } = await drive(id);
      const end = poses[poses.length - 1];
      const v = evaluateParking(end, layout.target!, CAR);
      expect(v.reason ?? 'ok').toBe('ok');
      expect(clearance(poses, layout)).toBeGreaterThan(0);
    }, 30000);
  }
});
