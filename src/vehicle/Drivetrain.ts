/**
 * Diesel engine + torque converter + 6-speed automatic gearbox.
 *
 * Pure simulation (no Three.js / Rapier): VehiclePhysics feeds in the vehicle's
 * forward speed and pedal positions each fixed step and applies the resulting
 * tractive force at the driven wheels.
 *
 * Model summary
 *  - Engine: full-load torque curve x throttle, idle governor, friction / engine
 *    braking, rev limiter, starter sequence. Engine speed is integrated from
 *    torque balance (sub-stepped for stability).
 *  - Torque converter: pump torque = C * (we^2 - wt^2) (signed, so the wheels can
 *    drive the engine when coasting); torque multiplication falls from `stallTorqueRatio`
 *    at stall to 1.0 at the coupling point. This is what produces realistic idle creep.
 *  - Lock-up clutch: engages in higher gears at cruise, coupling engine and turbine rigidly.
 *  - Gearbox: throttle-dependent shift schedule with hysteresis, kickdown, and a short
 *    torque interruption during each shift.
 *  - Selector: P/R/N/D with real interlocks (brake to leave P, no R/P while moving).
 */

export type Gear = 'P' | 'R' | 'N' | 'D';
export const GEAR_ORDER: readonly Gear[] = ['P', 'R', 'N', 'D'];

export interface DrivetrainConfig {
  idleRpm: number;
  revLimitRpm: number;
  /** Full-load torque curve as [rpm, Nm] pairs, ascending rpm. */
  torqueCurve: readonly (readonly [number, number])[];
  engineInertia: number; // kg m^2 (engine + converter pump)
  frictionBaseNm: number;
  frictionPerRpmNm: number;
  idleGovernorGainNmPerRpm: number;
  idleGovernorMaxNm: number;

  /** Converter capacity: pump torque (Nm) at stall per rpm^2. */
  converterCapacity: number;
  stallTorqueRatio: number;
  couplingSpeedRatio: number;
  lockupMinGear: number; // 1-based
  lockupMinSpeedKmh: number;

  gearRatios: readonly number[]; // forward gears, 1st first
  reverseRatio: number;
  finalDrive: number;
  driveEfficiency: number;
  shiftTimeS: number;
  minTimeBetweenShiftsS: number;
  /** Upshift turbine rpm at zero and full throttle. */
  upshiftRpm: readonly [number, number];
  /** Downshift turbine rpm at zero and full throttle (kickdown when high). */
  downshiftRpm: readonly [number, number];

  starterCrankS: number;
  /** Max |speed| (km/h) for leaving P / selecting R or P. */
  parkShiftMaxKmh: number;
  reverseShiftMaxKmh: number;
}

export interface ShiftResult {
  ok: boolean;
  reason?: string;
}

const RPM_TO_RADS = (2 * Math.PI) / 60;
const SUB_STEPS = 8;

export class Drivetrain {
  selector: Gear = 'P';
  /** Current forward gear (1-based) while in D. */
  gear = 1;
  engineRunning = false;
  /** True while the starter motor is cranking. */
  cranking = false;
  engineRpm = 0;
  /** Converter turbine (gearbox input) rpm. */
  turbineRpm = 0;
  /** 0..1, how hard the engine is working (for audio). */
  load = 0;
  lockedUp = false;
  /** Tractive force at the driven wheels (N, + = forward). */
  wheelForce = 0;

  private crankTimer = 0;
  private shiftTimer = 0;
  private sinceShift = 10;
  private pendingGear = 1;
  private lockupBlend = 0;

  constructor(
    readonly cfg: DrivetrainConfig,
    private wheelRadius: number,
  ) {}

  get shifting(): boolean {
    return this.shiftTimer > 0;
  }

  /** Overall ratio engine->wheel for the current selector/gear (signed; 0 in P/N). */
  get ratio(): number {
    switch (this.selector) {
      case 'D':
        return this.cfg.gearRatios[this.gear - 1] * this.cfg.finalDrive;
      case 'R':
        return -this.cfg.reverseRatio * this.cfg.finalDrive;
      default:
        return 0;
    }
  }

  startEngine(): ShiftResult {
    if (this.engineRunning || this.cranking) return { ok: true };
    if (this.selector !== 'P' && this.selector !== 'N') return { ok: false, reason: 'Shift to P or N to start the engine' };
    this.cranking = true;
    this.crankTimer = 0;
    return { ok: true };
  }

  stopEngine(): void {
    this.engineRunning = false;
    this.cranking = false;
  }

  /**
   * Request a selector change. Mirrors a shift-by-wire automatic:
   * leaving P needs the brake and a standstill; R and P are refused while moving.
   */
  requestSelector(target: Gear, brakePressed: boolean, speedKmh: number): ShiftResult {
    const c = this.cfg;
    if (target === this.selector) return { ok: true };
    const absKmh = Math.abs(speedKmh);
    if (this.selector === 'P') {
      if (!brakePressed) return { ok: false, reason: 'Press the brake to shift out of P' };
      if (absKmh > c.parkShiftMaxKmh) return { ok: false, reason: 'Stop the car first' };
    }
    if (target === 'P' && absKmh > c.parkShiftMaxKmh) return { ok: false, reason: 'Stop the car before selecting P' };
    if (target === 'R' && speedKmh > c.reverseShiftMaxKmh) return { ok: false, reason: 'Stop before selecting R' };
    if (target === 'D' && speedKmh < -c.reverseShiftMaxKmh) return { ok: false, reason: 'Stop before selecting D' };
    this.selector = target;
    if (target === 'D') {
      this.gear = this.bestGearFor(Math.abs(speedKmh), 0);
      this.pendingGear = this.gear;
    }
    this.shiftTimer = target === 'D' || target === 'R' ? this.cfg.shiftTimeS : 0; // engagement thump
    this.lockupBlend = 0;
    return { ok: true };
  }

  /** Step one selector position up (towards P) or down (towards D). */
  stepSelector(dir: -1 | 1, brakePressed: boolean, speedKmh: number): ShiftResult {
    const i = GEAR_ORDER.indexOf(this.selector) + dir;
    if (i < 0 || i >= GEAR_ORDER.length) return { ok: true };
    return this.requestSelector(GEAR_ORDER[i], brakePressed, speedKmh);
  }

  /**
   * Advance the drivetrain by dt.
   * @param throttle 0..1 accelerator position
   * @param speedMs signed vehicle forward speed
   */
  update(throttle: number, speedMs: number, dt: number): void {
    const c = this.cfg;
    const wheelRadius = this.wheelRadius;
    this.updateStarter(dt);
    if (!this.engineRunning) throttle = 0;

    this.sinceShift += dt;
    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
      if (this.shiftTimer <= c.shiftTimeS / 2) this.gear = this.pendingGear;
    }
    if (this.selector === 'D') this.updateShiftSchedule(throttle, speedMs);

    const ratio = this.ratio;
    const connected = ratio !== 0;
    const wheelRads = speedMs / wheelRadius;
    const turbineRads = connected ? wheelRads * ratio : this.engineRpm * RPM_TO_RADS;
    this.turbineRpm = turbineRads / RPM_TO_RADS;

    // Lock-up clutch: rigid coupling at cruise in higher gears.
    const wantLock =
      connected &&
      this.selector === 'D' &&
      !this.shifting &&
      this.gear >= c.lockupMinGear &&
      Math.abs(speedMs) * 3.6 > c.lockupMinSpeedKmh &&
      throttle < 0.9 &&
      this.engineRunning;
    this.lockupBlend = clamp(this.lockupBlend + (wantLock ? dt / 0.6 : -dt / 0.15), 0, 1);
    this.lockedUp = this.lockupBlend >= 1;

    const h = dt / SUB_STEPS;
    let turbineTorqueSum = 0;
    let loadSum = 0;
    for (let s = 0; s < SUB_STEPS; s++) {
      const we = this.engineRpm * RPM_TO_RADS;
      const engineT = this.engineTorque(throttle, this.engineRpm);
      const frictionT = this.engineRpm > 1 ? c.frictionBaseNm + c.frictionPerRpmNm * this.engineRpm : 0;
      loadSum += throttle > 0 ? engineT / this.fullLoadTorque(this.engineRpm) : 0;

      // Converter (fluid) path.
      let pumpT = 0;
      let turbineT = 0;
      if (connected) {
        const cap = c.converterCapacity / (RPM_TO_RADS * RPM_TO_RADS); // Nm per (rad/s)^2
        pumpT = cap * (we * Math.abs(we) - turbineRads * Math.abs(turbineRads));
        const sr = we > 1e-3 ? turbineRads / we : 1;
        const tr =
          pumpT > 0 && sr < c.couplingSpeedRatio
            ? c.stallTorqueRatio + (1 - c.stallTorqueRatio) * (Math.max(sr, 0) / c.couplingSpeedRatio)
            : 1;
        turbineT = pumpT * tr;
      }

      if (this.lockupBlend > 0 && connected) {
        // Blend towards rigid coupling: engine speed follows the turbine, torque passes 1:1.
        const lockedT = engineT - frictionT;
        turbineT = turbineT * (1 - this.lockupBlend) + lockedT * this.lockupBlend;
        const target = turbineRads;
        const freeAccel = (engineT - frictionT - pumpT) / c.engineInertia;
        const freeWe = we + freeAccel * h;
        this.engineRpm = Math.max(0, (freeWe + (target - freeWe) * this.lockupBlend) / RPM_TO_RADS);
      } else {
        const accel = (engineT - frictionT - pumpT) / c.engineInertia;
        this.engineRpm = Math.max(0, this.engineRpm + (accel * h) / RPM_TO_RADS);
      }
      turbineTorqueSum += turbineT;
    }

    const turbineTorque = turbineTorqueSum / SUB_STEPS;
    this.load = clamp(loadSum / SUB_STEPS, 0, 1);
    const shiftCut = this.shifting ? 0.35 : 1;
    this.wheelForce = connected ? (turbineTorque * ratio * c.driveEfficiency * shiftCut) / wheelRadius : 0;
  }

  /** Net engine torque from fuel (throttle + idle governor), before friction. */
  private engineTorque(throttle: number, rpm: number): number {
    const c = this.cfg;
    if (this.cranking) return 0;
    if (!this.engineRunning) return 0;
    if (rpm >= c.revLimitRpm) return 0;
    const full = this.fullLoadTorque(rpm);
    const governor = clamp(
      c.frictionBaseNm + c.frictionPerRpmNm * c.idleRpm + c.idleGovernorGainNmPerRpm * (c.idleRpm - rpm),
      0,
      c.idleGovernorMaxNm,
    );
    return Math.max(throttle * full, Math.min(governor, full));
  }

  fullLoadTorque(rpm: number): number {
    const curve = this.cfg.torqueCurve;
    if (rpm <= curve[0][0]) return curve[0][1];
    for (let i = 1; i < curve.length; i++) {
      if (rpm <= curve[i][0]) {
        const [r0, t0] = curve[i - 1];
        const [r1, t1] = curve[i];
        return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
      }
    }
    return curve[curve.length - 1][1];
  }

  private updateStarter(dt: number): void {
    if (!this.cranking) {
      if (!this.engineRunning) this.engineRpm = Math.max(0, this.engineRpm - 1500 * dt);
      return;
    }
    this.crankTimer += dt;
    this.engineRpm = 220 + 40 * Math.sin(this.crankTimer * 40);
    if (this.crankTimer >= this.cfg.starterCrankS) {
      this.cranking = false;
      this.engineRunning = true;
      this.engineRpm = this.cfg.idleRpm * 1.5; // start-up flare, settles via governor
    }
  }

  private updateShiftSchedule(throttle: number, speedMs: number): void {
    const c = this.cfg;
    if (this.shifting || this.sinceShift < c.minTimeBetweenShiftsS) return;
    const wheelRpm = Math.abs(speedMs / this.wheelRadius) / RPM_TO_RADS;
    // Curved maps: relaxed driving shifts up early, only a deep pedal holds gears / kicks down.
    const thr = clamp(throttle, 0, 1);
    const up = c.upshiftRpm[0] + (c.upshiftRpm[1] - c.upshiftRpm[0]) * Math.pow(thr, 1.8);
    const down = c.downshiftRpm[0] + (c.downshiftRpm[1] - c.downshiftRpm[0]) * Math.pow(thr, 1.5);
    const rpmNow = wheelRpm * c.gearRatios[this.gear - 1] * c.finalDrive;

    if (this.gear < c.gearRatios.length && rpmNow > up) {
      this.beginShift(this.gear + 1);
    } else if (
      this.gear > 1 &&
      rpmNow < down &&
      wheelRpm * c.gearRatios[this.gear - 2] * c.finalDrive < c.revLimitRpm - 400
    ) {
      this.beginShift(this.gear - 1);
    }
  }

  private beginShift(to: number): void {
    this.pendingGear = to;
    this.shiftTimer = this.cfg.shiftTimeS;
    this.sinceShift = 0;
    this.lockupBlend = 0;
  }

  /** Gear that suits a given speed (used when engaging D while rolling). */
  private bestGearFor(speedKmh: number, throttle: number): number {
    const c = this.cfg;
    const up = c.upshiftRpm[0] + (c.upshiftRpm[1] - c.upshiftRpm[0]) * Math.pow(throttle, 1.8);
    const wheelRpm = speedKmh / 3.6 / this.wheelRadius / RPM_TO_RADS;
    let g = 1;
    while (g < c.gearRatios.length && wheelRpm * c.gearRatios[g - 1] * c.finalDrive > up) g++;
    return g;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
