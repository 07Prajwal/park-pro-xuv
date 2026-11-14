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

interface Drive {
  poses: Pose[];
  layout: LevelLayout;
  session: LevelSession;
}

/**
 * Drive the physics car through the ideal segments like a careful learner, with only the
 * W and S pedals: steer while stationary, feather the pedal in the segment's direction to
 * hold a walking pace (a little more on a hill), and brake with the opposite pedal on the
 * mark. At a parking stop, apply the parking brake and wait until the session accepts it.
 * A level session scores the drive alongside.
 */
async function drive(levelId: number, d: Difficulty = 'normal'): Promise<Drive> {
  const def = LEVELS[levelId - 1];
  const session = new LevelSession(def, d, CAR);
  const layout = session.layout;
  const { ctx, car } = await makeLevelWorld(layout);
  const hilly = layout.surfaces.length > 0;
  car.reset(layout.spawn);
  run(ctx, car, input(), 0.5);
  getReady(ctx, car);
  const poses: Pose[] = [];
  const step = (ctx: PhysicsContext, inp: ReturnType<typeof input>, seconds: number) =>
    run(ctx, car, inp, seconds, () => {
      const pose = poseOf(car);
      poses.push(pose);
      session.update({ pose, y: car.body.translation().y, speedMs: car.speedMs, selector: car.drivetrain.selector, parkingBrake: car.parkingBrake }, dt);
    });
  /** Pedal inputs for driving in `dir` (+1 W, -1 S) with `gas` and braking with the opposite pedal. */
  const pedals = (dir: number, gas: number, brake: number, steer: number) => {
    const driving = dir > 0 ? { forward: gas } : { back: gas };
    const braking = dir > 0 ? { back: brake } : { forward: brake };
    return input({ ...(brake > 0 ? braking : driving), steer });
  };
  const stop = (dir: number, steer: number) => {
    for (let t = 0; t < 5 && Math.abs(car.speedMs) > 0.02; t += dt) step(ctx, pedals(dir, 0, 1, steer), dt);
  };
  const secure = (dir: number) => {
    stop(dir, 0);
    car.parkingBrake = true;
    step(ctx, input(), 2);
  };

  let dir = layout.ideal![0].dir;
  for (const seg of layout.ideal!) {
    dir = seg.dir;
    // Steer to the mark while standing still, then let the parking brake go.
    for (let t = 0; t < 4 && Math.abs(car.steerPosition - seg.steer) > 0.005; t += dt) step(ctx, input({ steer: seg.steer }), dt);
    car.parkingBrake = false;
    // Drive at a walking pace and stop on the segment length.
    let travelled = 0;
    let last = rearAxle(poseOf(car));
    for (let t = 0; t < 40 && travelled < seg.dist - 0.005; t += dt) {
      const remaining = seg.dist - travelled;
      const target = Math.min(1.2, Math.sqrt(2 * 1.2 * remaining) + 0.05);
      const v = car.speedMs * seg.dir;
      const brake = v > target + 0.15 ? Math.min(1, (v - target) * 2) : 0;
      // Just above the crawl threshold (~0.2 pedal), a little more to build up speed.
      const gas = v < target ? Math.min(hilly ? 0.7 : 0.45, 0.21 + (target - v) * 0.5) : 0;
      step(ctx, pedals(seg.dir, gas, brake, seg.steer), dt);
      const now = rearAxle(poseOf(car));
      travelled += Math.hypot(now.x - last.x, now.z - last.z) * (v >= 0 ? 1 : -1);
      last = now;
    }
    stop(seg.dir, seg.steer);
    if (seg.stop) secure(seg.dir);
  }
  secure(dir);
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
