/**
 * Rapier raycast-vehicle wrapper for the XUV.
 *
 * Owns the chassis rigid body and the vehicle controller, converts driver input
 * into steering / engine / brake commands every fixed step, and records the
 * previous and current state so the renderer can interpolate between steps.
 *
 * This module is renderer-agnostic (no Three.js) so it can be unit-tested in Node.
 */

import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { CarDimensions, VehicleTuning } from '../config';
import { MS_TO_KMH, PHYSICS } from '../config';
import type { DriveInput } from '../input/InputState';
import { ackermannAngles, maxCentreSteerAngle, speedLockFactor, type WheelAngles } from './steering';

type Rapier = typeof RAPIER_NS;

export type SimpleGear = 'D' | 'R';

export interface Spawn {
  x: number;
  z: number;
  /** Heading in radians; 0 faces +Z. */
  yaw: number;
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}
export interface QuatLike extends Vec3Like {
  w: number;
}

export const WHEEL_FL = 0;
export const WHEEL_FR = 1;
export const WHEEL_RL = 2;
export const WHEEL_RR = 3;
export const WHEEL_COUNT = 4;

/** Interpolatable per-step snapshot. */
export interface VehicleSnapshot {
  pos: Vec3Like;
  quat: QuatLike;
  suspension: Float32Array;
  spin: Float32Array;
  steer: Float32Array;
}

function makeSnapshot(): VehicleSnapshot {
  return {
    pos: { x: 0, y: 0, z: 0 },
    quat: { x: 0, y: 0, z: 0, w: 1 },
    suspension: new Float32Array(WHEEL_COUNT),
    spin: new Float32Array(WHEEL_COUNT),
    steer: new Float32Array(WHEEL_COUNT),
  };
}

export class VehiclePhysics {
  readonly body: RAPIER_NS.RigidBody;
  readonly controller: RAPIER_NS.DynamicRayCastVehicleController;
  readonly wheelConnections: Vec3Like[] = [];

  prev = makeSnapshot();
  curr = makeSnapshot();

  /** Smoothed steering position, -1..1 (+ = left). */
  steerPosition = 0;
  gear: SimpleGear = 'D';
  /** Signed forward speed, m/s. */
  speedMs = 0;
  throttle = 0;
  braking = 0;

  private readonly maxCentreSteer: number;
  private readonly angles: WheelAngles = { left: 0, right: 0 };
  private readonly scratch: Vec3Like = { x: 0, y: 0, z: 0 };
  private gearHoldTimer = 0;
  private spawn: Spawn;

  constructor(
    R: Rapier,
    private readonly world: RAPIER_NS.World,
    readonly dim: CarDimensions,
    readonly tuning: VehicleTuning,
    spawn: Spawn,
  ) {
    this.spawn = { ...spawn };
    this.maxCentreSteer = maxCentreSteerAngle(dim);

    const rearOverhang = dim.lengthM - dim.wheelbaseM - dim.frontOverhangM;
    const boxHalfH = (dim.heightM - dim.groundClearanceM) / 2;
    const boxCentreY = dim.groundClearanceM + boxHalfH;
    const boxCentreZ = (dim.frontOverhangM - rearOverhang) / 2;

    const settleY = 0.05;
    this.body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, settleY, spawn.z)
        .setRotation(yawQuat(spawn.yaw))
        .setCanSleep(false)
        .setCcdEnabled(true)
        .setLinearDamping(0)
        .setAngularDamping(0.4),
    );

    const m = tuning.massKg;
    const lx = dim.widthM;
    const ly = boxHalfH * 2;
    const lz = dim.lengthM;
    world.createCollider(
      R.ColliderDesc.cuboid(dim.widthM / 2, boxHalfH, dim.lengthM / 2)
        .setTranslation(0, boxCentreY, boxCentreZ)
        .setMassProperties(
          m,
          { x: 0, y: tuning.comHeightM - boxCentreY, z: -boxCentreZ },
          { x: (m / 12) * (ly * ly + lz * lz), y: (m / 12) * (lx * lx + lz * lz), z: (m / 12) * (lx * lx + ly * ly) },
          { x: 0, y: 0, z: 0, w: 1 },
        )
        .setFriction(0.3)
        .setRestitution(0.05)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );

    const vc = world.createVehicleController(this.body);
    vc.indexUpAxis = 1;
    vc.setIndexForwardAxis = 2;
    this.controller = vc;

    const s = tuning.suspension;
    const connY = dim.wheelRadiusM + s.restLengthM * 0.8;
    const halfWb = dim.wheelbaseM / 2;
    const conns: Vec3Like[] = [
      { x: dim.trackFrontM / 2, y: connY, z: halfWb },
      { x: -dim.trackFrontM / 2, y: connY, z: halfWb },
      { x: dim.trackRearM / 2, y: connY, z: -halfWb },
      { x: -dim.trackRearM / 2, y: connY, z: -halfWb },
    ];
    const down = { x: 0, y: -1, z: 0 };
    const axle = { x: -1, y: 0, z: 0 };
    for (let i = 0; i < WHEEL_COUNT; i++) {
      vc.addWheel(conns[i], down, axle, s.restLengthM, dim.wheelRadiusM);
      vc.setWheelSuspensionStiffness(i, s.stiffness);
      vc.setWheelSuspensionCompression(i, s.compressionDamping);
      vc.setWheelSuspensionRelaxation(i, s.relaxationDamping);
      vc.setWheelMaxSuspensionTravel(i, s.maxTravelM);
      vc.setWheelMaxSuspensionForce(i, s.maxForceN);
      vc.setWheelFrictionSlip(i, i < 2 ? tuning.tyre.frictionSlipFront : tuning.tyre.frictionSlipRear);
      vc.setWheelSideFrictionStiffness(i, tuning.tyre.sideFrictionStiffness);
      this.wheelConnections.push(conns[i]);
    }

    this.captureInto(this.curr);
    this.captureInto(this.prev);
  }

  get speedKmh(): number {
    return this.speedMs * MS_TO_KMH;
  }

  /** Current centre (bicycle-model) steer angle in radians. */
  get centreSteerAngle(): number {
    return this.steerPosition * this.maxCentreSteer * speedLockFactor(this.speedKmh, this.tuning.steering);
  }

  /** Call once per fixed step BEFORE `world.step()`. */
  update(input: DriveInput, dt: number): void {
    const t = this.tuning;
    const vc = this.controller;
    copySnapshot(this.curr, this.prev);

    // Rapier's currentVehicleSpeed() includes the residual vertical velocity the
    // suspension holds at rest, so project the chassis velocity onto its forward axis.
    const v = this.body.linvel();
    const q = this.curr.quat;
    this.speedMs =
      v.x * 2 * (q.x * q.z + q.w * q.y) + v.y * 2 * (q.y * q.z - q.w * q.x) + v.z * (1 - 2 * (q.x * q.x + q.y * q.y));
    const absSpeed = Math.abs(this.speedMs);
    const stopped = absSpeed < t.stoppedSpeedMs;

    // --- Stage-1 simple automatic: hold "back" at standstill to engage R, "forward" to engage D.
    const wantsGear: SimpleGear | null =
      this.gear === 'D' && input.back > 0.1 && input.forward < 0.1
        ? 'R'
        : this.gear === 'R' && input.forward > 0.1 && input.back < 0.1
          ? 'D'
          : null;
    if (wantsGear && stopped) {
      this.gearHoldTimer += dt;
      if (this.gearHoldTimer > 0.2) {
        this.gear = wantsGear;
        this.gearHoldTimer = 0;
      }
    } else {
      this.gearHoldTimer = 0;
    }
    const accelPedal = this.gear === 'D' ? input.forward : input.back;
    const brakePedal = this.gear === 'D' ? input.back : input.forward;
    this.throttle = accelPedal;
    this.braking = brakePedal;

    // --- Steering: rate-limited towards the target, self-centring when released.
    const st = t.steering;
    const target = clamp(input.steer, -1, 1);
    let rate: number;
    if (Math.abs(target) < 1e-3) {
      rate = (1 / st.returnToCentreS) * clamp(absSpeed / 4, 0.35, 1);
    } else {
      rate = 1 / st.centreToLockS;
    }
    this.steerPosition = approach(this.steerPosition, target, rate * dt);

    ackermannAngles(this.centreSteerAngle, this.dim, this.angles);
    vc.setWheelSteering(WHEEL_FL, this.angles.left);
    vc.setWheelSteering(WHEEL_FR, this.angles.right);

    // --- Drive force.
    const d = t.drive;
    let force = 0;
    if (this.gear === 'D') {
      force = accelPedal * Math.min(d.maxTractiveForceN, d.wheelPowerW / Math.max(absSpeed, 0.1));
    } else {
      const revLimit = d.maxReverseSpeedKmh / MS_TO_KMH;
      const fade = 1 - clamp(-this.speedMs / revLimit, 0, 1);
      force = -accelPedal * d.maxReverseForceN * fade;
    }
    const front = (force * d.frontDriveBias) / 2;
    const rear = (force * (1 - d.frontDriveBias)) / 2;
    vc.setWheelEngineForce(WHEEL_FL, front);
    vc.setWheelEngineForce(WHEEL_FR, front);
    vc.setWheelEngineForce(WHEEL_RL, rear);
    vc.setWheelEngineForce(WHEEL_RR, rear);

    // --- Brakes. Rapier expects a per-step impulse, so convert force * dt.
    const b = t.brakes;
    let brakeF = brakePedal * b.maxBrakeForceN;
    // Hold the car at standstill when no throttle is applied.
    if (stopped && accelPedal < 0.05) brakeF = Math.max(brakeF, 0.5 * b.maxBrakeForceN);
    const frontImp = ((brakeF * b.frontBias) / 2) * dt;
    let rearImp = ((brakeF * (1 - b.frontBias)) / 2) * dt;
    if (input.handbrake) rearImp += (b.handbrakeForceN / 2) * dt;
    vc.setWheelBrake(WHEEL_FL, frontImp);
    vc.setWheelBrake(WHEEL_FR, frontImp);
    vc.setWheelBrake(WHEEL_RL, rearImp);
    vc.setWheelBrake(WHEEL_RR, rearImp);

    // --- Aero drag + rolling resistance as an impulse against the horizontal velocity.
    const sp = Math.hypot(v.x, v.z);
    if (sp > 1e-3) {
      const r = t.resistance;
      const rolling = r.rollingResistanceCoeff * t.massKg * PHYSICS.gravity * Math.min(sp / 0.5, 1);
      const f = r.aeroDragCoeff * sp * sp + rolling;
      const k = (-f * dt) / sp;
      this.scratch.x = v.x * k;
      this.scratch.y = 0;
      this.scratch.z = v.z * k;
      this.body.applyImpulse(this.scratch, true);
    }

    vc.updateVehicle(dt);
  }

  /** Call once per fixed step AFTER `world.step()`. */
  postStep(): void {
    this.captureInto(this.curr);
  }

  /** Teleport back to the spawn point (or a new one), zeroing all motion. */
  reset(spawn?: Spawn): void {
    if (spawn) this.spawn = { ...spawn };
    const s = this.spawn;
    this.body.setTranslation({ x: s.x, y: 0.05, z: s.z }, true);
    this.body.setRotation(yawQuat(s.yaw), true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steerPosition = 0;
    this.gear = 'D';
    this.speedMs = 0;
    this.captureInto(this.curr);
    copySnapshot(this.curr, this.prev);
  }

  dispose(): void {
    this.world.removeVehicleController(this.controller);
    this.world.removeRigidBody(this.body);
  }

  private captureInto(s: VehicleSnapshot): void {
    const p = this.body.translation();
    const q = this.body.rotation();
    s.pos.x = p.x;
    s.pos.y = p.y;
    s.pos.z = p.z;
    s.quat.x = q.x;
    s.quat.y = q.y;
    s.quat.z = q.z;
    s.quat.w = q.w;
    const vc = this.controller;
    for (let i = 0; i < WHEEL_COUNT; i++) {
      s.suspension[i] = vc.wheelSuspensionLength(i) ?? this.tuning.suspension.restLengthM;
      s.spin[i] = vc.wheelRotation(i) ?? 0;
      s.steer[i] = vc.wheelSteering(i) ?? 0;
    }
  }
}

function copySnapshot(from: VehicleSnapshot, to: VehicleSnapshot): void {
  to.pos.x = from.pos.x;
  to.pos.y = from.pos.y;
  to.pos.z = from.pos.z;
  to.quat.x = from.quat.x;
  to.quat.y = from.quat.y;
  to.quat.z = from.quat.z;
  to.quat.w = from.quat.w;
  to.suspension.set(from.suspension);
  to.spin.set(from.spin);
  to.steer.set(from.steer);
}

function yawQuat(yaw: number): QuatLike {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}
