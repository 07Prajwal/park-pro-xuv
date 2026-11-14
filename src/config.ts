/**
 * Central configuration: vehicle dimensions, physics tuning and engine-loop settings.
 *
 * Units: 1 world unit = 1 metre, mass in kg, forces in newtons, angles in radians
 * unless the name says otherwise.
 *
 * Coordinate convention (vehicle local frame and world):
 *   +Y up, +Z vehicle forward, +X vehicle LEFT (right-handed).
 *   The vehicle body origin sits on the ground plane, midway between the axles.
 */

export interface CarDimensions {
  name: string;
  lengthM: number;
  widthM: number; // excluding mirrors
  heightM: number;
  wheelbaseM: number;
  trackFrontM: number;
  trackRearM: number;
  frontOverhangM: number; // front axle to front bumper
  groundClearanceM: number;
  wheelRadiusM: number;
  wheelWidthM: number;
  /** Kerb-to-kerb turning radius, measured at the outer front wheel. */
  turningRadiusM: number;
}

/** Mahindra XUV 7XO AX7 (approximate real-world figures). */
export const XUV_7XO: CarDimensions = {
  name: 'Mahindra XUV 7XO AX7',
  lengthM: 4.695,
  widthM: 1.89,
  heightM: 1.755,
  wheelbaseM: 2.75,
  trackFrontM: 1.62,
  trackRearM: 1.62,
  frontOverhangM: 0.95,
  groundClearanceM: 0.2,
  wheelRadiusM: 0.376, // 245/55 R19
  wheelWidthM: 0.245,
  turningRadiusM: 5.4,
};

/** Hyundai Eon - used only as a comparison ghost/footprint. */
export const HYUNDAI_EON: CarDimensions = {
  name: 'Hyundai Eon',
  lengthM: 3.495,
  widthM: 1.55,
  heightM: 1.5,
  wheelbaseM: 2.38,
  trackFrontM: 1.386,
  trackRearM: 1.369,
  frontOverhangM: 0.6,
  groundClearanceM: 0.17,
  wheelRadiusM: 0.28,
  wheelWidthM: 0.155,
  turningRadiusM: 4.6,
};

export const PHYSICS = {
  /** Fixed physics step (60 Hz). Rendering interpolates between steps. */
  fixedDt: 1 / 60,
  /** Max physics steps per rendered frame before we drop time (avoids spiral of death). */
  maxSubSteps: 5,
  gravity: 9.81,
} as const;

export interface VehicleTuning {
  massKg: number;
  /** Centre-of-mass height above ground. Lower = less body roll. */
  comHeightM: number;

  suspension: {
    restLengthM: number;
    maxTravelM: number;
    /** Rapier stiffness (scaled internally by chassis mass). */
    stiffness: number;
    compressionDamping: number;
    relaxationDamping: number;
    maxForceN: number;
  };

  tyre: {
    /** Longitudinal grip coefficient (~mu). Lower = earlier wheelspin/lock. */
    frictionSlipFront: number;
    frictionSlipRear: number;
    sideFrictionStiffness: number;
  };

  steering: {
    /** Seconds to turn the wheel from centre to full lock with a held key. */
    centreToLockS: number;
    /** Seconds to self-centre from full lock when the key is released (at speed). */
    returnToCentreS: number;
    /** Speed (km/h) above which the max steer angle starts to shrink. */
    reductionStartKmh: number;
    /** Speed (km/h) at which the max steer angle reaches `minLockFactor`. */
    reductionEndKmh: number;
    minLockFactor: number;
  };

  drive: {
    /** Peak tractive force at the wheels (traction/torque limited), N. */
    maxTractiveForceN: number;
    /** Wheel power used for the constant-power region above low speed, W. */
    wheelPowerW: number;
    maxReverseForceN: number;
    maxReverseSpeedKmh: number;
    /** Fraction of tractive force sent to the front axle (XUV 7XO AX7 diesel AT = FWD). */
    frontDriveBias: number;
  };

  brakes: {
    /** Total max service-brake force across all wheels, N. */
    maxBrakeForceN: number;
    frontBias: number;
    /** Rear-axle handbrake force, N. */
    handbrakeForceN: number;
  };

  resistance: {
    /** 0.5 * rho * Cd * A (kg/m). */
    aeroDragCoeff: number;
    rollingResistanceCoeff: number;
  };

  /** Below this |speed| (m/s) the vehicle counts as stopped (gear changes, hold). */
  stoppedSpeedMs: number;
}

export const XUV_TUNING: VehicleTuning = {
  massKg: 1950,
  comHeightM: 0.68,

  suspension: {
    restLengthM: 0.3,
    maxTravelM: 0.22,
    stiffness: 28,
    compressionDamping: 2.6,
    relaxationDamping: 3.4,
    maxForceN: 100000,
  },

  tyre: {
    frictionSlipFront: 1.6,
    frictionSlipRear: 1.75,
    sideFrictionStiffness: 1.0,
  },

  steering: {
    centreToLockS: 1.1,
    returnToCentreS: 0.9,
    reductionStartKmh: 15,
    reductionEndKmh: 120,
    minLockFactor: 0.18,
  },

  drive: {
    maxTractiveForceN: 7200,
    wheelPowerW: 115000,
    maxReverseForceN: 4200,
    maxReverseSpeedKmh: 18,
    frontDriveBias: 1.0,
  },

  brakes: {
    maxBrakeForceN: 17500,
    frontBias: 0.65,
    handbrakeForceN: 6000,
  },

  resistance: {
    aeroDragCoeff: 0.5 * 1.2 * 0.38 * 2.75,
    rollingResistanceCoeff: 0.013,
  },

  stoppedSpeedMs: 0.15,
};

export const RENDER = {
  maxPixelRatio: 2,
  shadowMapSize: 2048,
  /** Half-size of the shadow camera frustum that follows the car (m). */
  shadowRadiusM: 30,
  fogNear: 120,
  fogFar: 380,
} as const;

export const MS_TO_KMH = 3.6;
