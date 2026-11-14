import { describe, expect, it } from 'vitest';
import { XUV_7XO } from '../src/config';
import { LevelSession } from '../src/levels/LevelSession';
import { LEVELS } from '../src/levels/levels';
import { evaluateParking } from '../src/levels/scoring';
import type { Difficulty, LevelLayout, Pose } from '../src/levels/types';
import { ClearanceChecker } from '../src/levels/validate';
import type { VehiclePhysics } from '../src/vehicle/VehiclePhysics';
import { Terrain } from '../src/world/terrain';
import type { PhysicsContext } from '../src/core/physics';
import { dt, getReady, input, makeLevelWorld, run } from './helpers';

const CAR = XUV_7XO;

function poseOf(car: VehiclePhysics): Pose {
  const p = car.body.translation();
  const q = car.body.rotation();
  return { x: p.x, z: p.z, yaw: Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y)) };
}

function rearAxle(p: Pose): { x: number; z: number } {
  return { x: p.x - (Math.sin(p.yaw) * CAR.wheelbaseM) / 2, z: p.z - (Math.cos(p.yaw) * CAR.wheelbaseM) / 2 };
}

function shiftTo(car: VehiclePhysics, gear: 'P' | 'R' | 'N' | 'D'): void {
  const order = ['P', 'R', 'N', 'D'];
  for (let i = 0; i < 4 && car.drivetrain.selector !== gear; i++) car.shiftSelector(order.indexOf(gear) < order.indexOf(car.drivetrain.selector) ? -1 : 1);
  expect(car.drivetrain.selector).toBe(gear);
}

interface Drive {
  poses: Pose[];
  layout: LevelLayout;
  session: LevelSession;
}

/**
 * Drive the physics car through the ideal segments like a careful learner:
 * stop, select the gear, steer while stationary, creep (with a little
 * accelerator on a hill), and brake on the mark. At a parking stop, secure the
 * car (parking brake and P) until the session accepts it, then pull away with
 * the foot on the brake. A level session scores the drive alongside.
 */
async function drive(levelId: number, d: Difficulty = 'normal'): Promise<Drive> {
  const def = LEVELS[levelId - 1];
  const session = new LevelSession(def, d, CAR);
  const layout = session.layout;
  const { ctx, car } = await makeLevelWorld(layout);
  const hilly = layout.surfaces.length > 0;
  car.reset(layout.spawn);
  run(ctx, car, input(), 0.5);
  getReady(ctx, car, layout.ideal![0].dir > 0 ? 'D' : 'R');
  const poses: Pose[] = [];
  const step = (ctx: PhysicsContext, inp: ReturnType<typeof input>, seconds: number) =>
    run(ctx, car, inp, seconds, () => {
      const pose = poseOf(car);
      poses.push(pose);
      session.update({ pose, y: car.body.translation().y, speedMs: car.speedMs, selector: car.drivetrain.selector, parkingBrake: car.parkingBrake }, dt);
    });
  const secure = () => {
    step(ctx, input({ back: 1 }), 0.6);
    car.parkingBrake = true;
    shiftTo(car, 'P');
    step(ctx, input(), 2);
  };

  for (const seg of layout.ideal!) {
    // Stop and select the right gear; a secured car is released with the foot on the brake.
    step(ctx, input({ back: 1, steer: seg.steer }), 0.4);
    shiftTo(car, seg.dir > 0 ? 'D' : 'R');
    car.parkingBrake = false;
    // Steer to the mark while holding the brake.
    for (let t = 0; t < 4 && Math.abs(car.steerPosition - seg.steer) > 0.005; t += dt) step(ctx, input({ back: 1, steer: seg.steer }), dt);
    // Creep and brake to stop on the segment length.
    let travelled = 0;
    let last = rearAxle(poseOf(car));
    for (let t = 0; t < 40 && travelled < seg.dist - 0.005; t += dt) {
      const remaining = seg.dist - travelled;
      const target = Math.min(1.2, Math.sqrt(2 * 1.2 * remaining) + 0.05);
      const v = car.speedMs * seg.dir;
      const brake = v > target ? Math.min(1, (v - target) * 2) : 0;
      const gas = hilly && v < target - 0.25 ? Math.min(0.5, (target - v) * 0.6) : 0;
      step(ctx, input({ forward: gas, back: brake, steer: seg.steer }), dt);
      const now = rearAxle(poseOf(car));
      travelled += Math.hypot(now.x - last.x, now.z - last.z) * (v >= 0 ? 1 : -1);
      last = now;
    }
    if (seg.stop) secure();
  }
  secure();
  return { poses, layout, session };
}

function clearance(poses: Pose[], layout: LevelLayout): number {
  const checker = new ClearanceChecker(layout, CAR);
  return checker.along(poses, new Terrain(layout.surfaces).height(poses[0].x, poses[0].z));
}

describe('the physics car can execute the ideal manoeuvre', () => {
  for (const id of [4, 6, 11, 12]) {
    it(`level ${id} (normal): ends correctly parked without touching anything, and the session finishes`, async () => {
      const { poses, layout, session } = await drive(id);
      const end = poses[poses.length - 1];
      const v = evaluateParking(end, layout.target!, CAR);
      expect(v.reason ?? 'ok').toBe('ok');
      expect(clearance(poses, layout)).toBeGreaterThan(0);
      expect(session.finished).toBe(true);
      expect(session.result?.failed).toBeUndefined();
      expect(session.kerbTouches).toBe(0);
      expect(session.rollbacks).toBe(0);
      if (layout.stops) expect(session.stopIndex).toBe(layout.stops.length);
    }, 60000);
  }
});
