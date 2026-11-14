import { describe, expect, it } from 'vitest';
import { XUV_7XO } from '../src/config';
import { reverseAxlePose, type Pose2 } from '../src/cameras/reverseGuidelines';
import { dt, getReady, input, makeWorld, run } from './helpers';

describe('reverse guidelines', () => {
  it('straight wheel predicts a straight line backwards', () => {
    const p = reverseAxlePose(2, 0, XUV_7XO.wheelbaseM, { x: 0, z: 0, yaw: 0 });
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.z).toBeCloseTo(-2, 6);
  });

  it('predicted path matches the physics car reversing 3 m at half lock (within 15 cm)', async () => {
    const { ctx, car } = await makeWorld();
    // Wind the steering to half lock while holding the brake, before selecting R.
    run(ctx, car, input({ back: 1, steer: 0.5 }), 2);
    getReady(ctx, car, 'R');
    run(ctx, car, input({ back: 1, steer: 0.5 }), 1);

    const angle = car.centreSteerAngle;
    expect(angle).toBeGreaterThan(0.1);

    // Rear-axle centre in world space (body frame: rear axle at z = -wheelbase / 2).
    const halfWb = XUV_7XO.wheelbaseM / 2;
    const axle = () => {
      const t = car.body.translation();
      const q = car.body.rotation();
      const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
      return { x: t.x - Math.sin(yaw) * halfWb, z: t.z - Math.cos(yaw) * halfWb, yaw };
    };
    const start = axle();

    // Creep backwards (brake released, no throttle) until the rear axle has travelled 3 m along its path.
    let travelled = 0;
    let last = start;
    for (let i = 0; i < 60 * 30 && travelled < 3; i++) {
      run(ctx, car, input({ steer: 0.5 }), dt);
      const now = axle();
      travelled += Math.hypot(now.x - last.x, now.z - last.z);
      last = now;
    }
    expect(travelled).toBeGreaterThanOrEqual(3);

    const predicted: Pose2 = reverseAxlePose(travelled, angle, XUV_7XO.wheelbaseM, { x: 0, z: 0, yaw: 0 });
    // Rotate the prediction (start-relative) into world space.
    const c = Math.cos(start.yaw);
    const s = Math.sin(start.yaw);
    const px = start.x + predicted.x * c + predicted.z * s;
    const pz = start.z - predicted.x * s + predicted.z * c;
    const err = Math.hypot(last.x - px, last.z - pz);
    expect(err).toBeLessThan(0.15);
  });
});
