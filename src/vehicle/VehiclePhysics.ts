/**
 * Rapier raycast-vehicle wrapper for the XUV.
 *
 * Owns the chassis rigid body and the vehicle controller, converts pedals and
 * steering into wheel commands every fixed step (via the Drivetrain), handles
 * the parking brake, auto-hold and park pawl, and records the previous and
 * current state so the renderer can interpolate between steps.
 *
 * This module is renderer-agnostic (no Three.js) so it can be unit-tested in Node.
 */

import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { CarDimensions, VehicleTuning } from '../config';
import { MS_TO_KMH, PHYSICS } from '../config';
import { WHEEL_QUERY_GROUPS } from '../core/collisionGroups';
import type { DriveInput } from '../input/InputState';
import { Drivetrain, type DrivetrainConfig, type ShiftResult } from './Drivetrain';
import { ackermannAngles, maxCentreSteerAngle, speedLockFactor, type WheelAngles } from './steering';

type Rapier = typeof RAPIER_NS;

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
  readonly drivetrain: Drivetrain;
  readonly wheelConnections: Vec3Like[] = [];

  prev = makeSnapshot();
  curr = makeSnapshot();

  /** Smoothed steering position, -1..1 (+ = left). */
  steerPosition = 0;
  /** Signed forward speed, m/s. */
  speedMs = 0;
  throttle = 0;
  braking = 0;
  /** Electronic parking brake applied. */
  parkingBrake = true;
  autoHoldEnabled = false;
  /** Auto-hold is currently holding the car. */
  autoHoldActive = false;

  /** Latest driver-facing message (e.g. refused shift) and its age. */
  message = '';
  messageAge = 0;

  private readonly maxCentreSteer: number;
  private readonly angles: WheelAngles = { left: 0, right: 0 };
  private readonly scratch: Vec3Like = { x: 0, y: 0, z: 0 };
  private spawn: Spawn;

  constructor(
    R: Rapier,
    private readonly world: RAPIER_NS.World,
    readonly dim: CarDimensions,
    readonly tuning: VehicleTuning,
    drivetrainCfg: DrivetrainConfig,
    spawn: Spawn,
  ) {
    this.spawn = { ...spawn };
    this.maxCentreSteer = maxCentreSteerAngle(dim);
    this.drivetrain = new Drivetrain(drivetrainCfg, dim.wheelRadiusM);

    const rearOverhang = dim.lengthM - dim.wheelbaseM - dim.frontOverhangM;
    const boxHalfH = (dim.heightM - dim.groundClearanceM) / 2;
    const boxCentreY = dim.groundClearanceM + boxHalfH;
    const boxCentreZ = (dim.frontOverhangM - rearOverhang) / 2;

    this.body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, 0.05, spawn.z)
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

  get stopped(): boolean {
    return Math.abs(this.speedMs) < this.tuning.stoppedSpeedMs;
  }

  /** Current centre (bicycle-model) steer angle in radians. */
  get centreSteerAngle(): number {
    return this.steerPosition * this.maxCentreSteer * speedLockFactor(this.speedKmh, this.tuning.steering);
  }

  /** Brake lamps are lit by the pedal or by auto-hold. */
  get brakeLamps(): boolean {
    return this.braking > 0.05 || this.autoHoldActive;
  }

  // --- Driver controls -------------------------------------------------------

  /** Move the selector one step: -1 towards P, +1 towards D. */
  shiftSelector(dir: -1 | 1): ShiftResult {
    const r = this.drivetrain.stepSelector(dir, this.braking > 0.1, this.speedKmh);
    if (!r.ok && r.reason) this.notify(r.reason);
    return r;
  }

  toggleIgnition(): void {
    const dt = this.drivetrain;
    if (dt.engineRunning || dt.cranking) {
      if (!this.stopped) {
        this.notify('Stop the car before switching off');
        return;
      }
      dt.stopEngine();
      return;
    }
    const r = dt.startEngine();
    if (!r.ok && r.reason) this.notify(r.reason);
  }

  toggleParkingBrake(): void {
    this.parkingBrake = !this.parkingBrake;
    this.notify(this.parkingBrake ? 'Parking brake applied' : 'Parking brake released');
  }

  toggleAutoHold(): void {
    this.autoHoldEnabled = !this.autoHoldEnabled;
    if (!this.autoHoldEnabled) this.autoHoldActive = false;
    this.notify(this.autoHoldEnabled ? 'Auto hold on' : 'Auto hold off');
  }

  notify(msg: string): void {
    this.message = msg;
    this.messageAge = 0;
  }

  // --- Simulation ------------------------------------------------------------

  /** Call once per fixed step BEFORE `world.step()`. */
  update(input: DriveInput, dt: number): void {
    const t = this.tuning;
    const vc = this.controller;
    const dtn = this.drivetrain;
    copySnapshot(this.curr, this.prev);
    this.messageAge += dt;

    // Rapier's currentVehicleSpeed() includes the residual vertical velocity the
    // suspension holds at rest, so project the chassis velocity onto its forward axis.
    const v = this.body.linvel();
    const q = this.curr.quat;
    this.speedMs =
      v.x * 2 * (q.x * q.z + q.w * q.y) + v.y * 2 * (q.y * q.z - q.w * q.x) + v.z * (1 - 2 * (q.x * q.x + q.y * q.y));
    const absSpeed = Math.abs(this.speedMs);
    const stopped = absSpeed < t.stoppedSpeedMs;

    this.throttle = input.forward;
    this.braking = input.back;
    const inDrive = dtn.selector === 'D' || dtn.selector === 'R';

    // Drive-away release of the electronic parking brake.
    if (this.parkingBrake && inDrive && dtn.engineRunning && this.throttle > 0.15) {
      this.parkingBrake = false;
      this.notify('Parking brake released');
    }

    // Auto hold: keeps the brakes on after a stop until the accelerator is pressed.
    if (this.autoHoldEnabled && inDrive) {
      if (stopped && this.braking > 0.2) this.autoHoldActive = true;
      if (this.throttle > 0.05) this.autoHoldActive = false;
    } else {
      this.autoHoldActive = false;
    }

    // --- Steering: rate-limited towards the target, self-centring when released.
    const st = t.steering;
    const assist = t.steeringAssist ? 1.6 : 1;
    const target = clamp(input.steer, -1, 1);
    const rate =
      Math.abs(target) < 1e-3
        ? (assist / st.returnToCentreS) * clamp(absSpeed / 4, 0.35, 1)
        : assist / st.centreToLockS;
    this.steerPosition = approach(this.steerPosition, target, rate * dt);
    ackermannAngles(this.centreSteerAngle, this.dim, this.angles);
    vc.setWheelSteering(WHEEL_FL, this.angles.left);
    vc.setWheelSteering(WHEEL_FR, this.angles.right);

    // --- Drivetrain -> tractive force at the wheels.
    dtn.update(this.throttle, this.speedMs, dt);
    const force = dtn.wheelForce;
    const frontDrive = (force * t.drive.frontDriveBias) / 2;
    const rearDrive = (force * (1 - t.drive.frontDriveBias)) / 2;

    // --- Brakes.
    const b = t.brakes;
    let serviceF = this.braking * b.maxBrakeForceN;
    if (this.autoHoldActive) serviceF = Math.max(serviceF, 0.5 * b.maxBrakeForceN);
    let frontBrake = (serviceF * b.frontBias) / 2;
    let rearBrake = (serviceF * (1 - b.frontBias)) / 2;
    if (this.parkingBrake) rearBrake += b.parkingBrakeForceN / 2;
    if (dtn.selector === 'P') frontBrake += b.parkPawlForceN / 2; // pawl locks the driven (front) wheels

    this.applyWheelForces(WHEEL_FL, frontDrive, frontBrake, dt);
    this.applyWheelForces(WHEEL_FR, frontDrive, frontBrake, dt);
    this.applyWheelForces(WHEEL_RL, rearDrive, rearBrake, dt);
    this.applyWheelForces(WHEEL_RR, rearDrive, rearBrake, dt);

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

    vc.updateVehicle(dt, undefined, WHEEL_QUERY_GROUPS);
  }

  /** Call once per fixed step AFTER `world.step()`. */
  postStep(): void {
    this.captureInto(this.curr);
  }

  /** Teleport back to the spawn point (or a new one), zeroing all motion. Keeps the engine state. */
  reset(spawn?: Spawn): void {
    if (spawn) this.spawn = { ...spawn };
    const s = this.spawn;
    this.body.setTranslation({ x: s.x, y: 0.05, z: s.z }, true);
    this.body.setRotation(yawQuat(s.yaw), true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steerPosition = 0;
    this.speedMs = 0;
    this.drivetrain.selector = 'P';
    this.parkingBrake = true;
    this.autoHoldActive = false;
    this.captureInto(this.curr);
    copySnapshot(this.curr, this.prev);
  }

  dispose(): void {
    this.world.removeVehicleController(this.controller);
    this.world.removeRigidBody(this.body);
  }

  /**
   * Rapier (like Bullet) ignores a wheel's brake whenever its engine force is non-zero,
   * so combine drive and brake into a single command per wheel:
   * whichever wins along the direction of (impending) motion is applied.
   */
  private applyWheelForces(i: number, driveF: number, brakeF: number, dt: number): void {
    const vc = this.controller;
    if (brakeF <= 0) {
      vc.setWheelEngineForce(i, driveF);
      vc.setWheelBrake(i, 0);
      return;
    }
    const dir = Math.abs(this.speedMs) > 0.05 ? Math.sign(this.speedMs) : Math.sign(driveF) || 1;
    const net = driveF * dir - brakeF;
    if (net > 0) {
      vc.setWheelEngineForce(i, dir * net);
      vc.setWheelBrake(i, 0);
    } else {
      vc.setWheelEngineForce(i, 0);
      vc.setWheelBrake(i, -net * dt); // Rapier expects a per-step impulse
    }
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
