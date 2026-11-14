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

import type { DrivetrainConfig } from './vehicle/Drivetrain';

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
  /** Overall width across the door mirrors. */
  mirrorSpanM: number;
  /** Door mirrors: distance of their centre ahead of the middle of the car's length. */
  mirrorAheadM: number;
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
  mirrorSpanM: 2.24,
  mirrorAheadM: 0.78,
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
  mirrorSpanM: 1.8,
  mirrorAheadM: 0.5,
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
    /** Fraction of tractive force sent to the front axle (XUV 7XO AX7 diesel AT = FWD). */
    frontDriveBias: number;
  };

  brakes: {
    /** Total max service-brake force across all wheels, N. */
    maxBrakeForceN: number;
    frontBias: number;
    /** Rear-axle electronic parking brake force, N. */
    parkingBrakeForceN: number;
    /** Park-pawl holding force on the driven axle, N. */
    parkPawlForceN: number;
  };

  pedals: {
    /** Seconds for a held key to take the pedal from 0 to 1 (keyboard only). */
    throttleRiseS: number;
    throttleFallS: number;
    brakeRiseS: number;
    brakeFallS: number;
    /** Pedal cap while the fine-control modifier (Shift) is held. */
    fineThrottleCap: number;
    fineBrakeCap: number;
  };

  /** Faster, lighter steering for casual play. */
  steeringAssist: boolean;

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
    frontDriveBias: 1.0,
  },

  brakes: {
    maxBrakeForceN: 17500,
    frontBias: 0.65,
    parkingBrakeForceN: 9000,
    parkPawlForceN: 30000,
  },

  pedals: {
    throttleRiseS: 0.45,
    throttleFallS: 0.2,
    brakeRiseS: 0.55,
    brakeFallS: 0.15,
    fineThrottleCap: 0.3,
    fineBrakeCap: 0.35,
  },

  steeringAssist: false,

  resistance: {
    aeroDragCoeff: 0.5 * 1.2 * 0.38 * 2.75,
    rollingResistanceCoeff: 0.013,
  },

  stoppedSpeedMs: 0.15,
};

/**
 * 2.2 L mHawk diesel (approx. 185 PS / 450 Nm) with a 6-speed torque-converter automatic.
 * Ratios and curve are approximate; tune here.
 */
export const XUV_DRIVETRAIN: DrivetrainConfig = {
  idleRpm: 750,
  revLimitRpm: 4600,
  torqueCurve: [
    [600, 150],
    [1000, 260],
    [1500, 400],
    [1750, 450],
    [2800, 450],
    [3500, 380],
    [4000, 330],
    [4600, 260],
  ],
  engineInertia: 0.25,
  frictionBaseNm: 14,
  frictionPerRpmNm: 0.006,
  idleGovernorGainNmPerRpm: 0.35,
  idleGovernorMaxNm: 70,

  converterCapacity: 450 / (2350 * 2350), // stalls at ~2350 rpm under full load
  stallTorqueRatio: 1.85,
  couplingSpeedRatio: 0.86,
  lockupMinGear: 3,
  lockupMinSpeedKmh: 45,

  gearRatios: [4.459, 2.508, 1.556, 1.142, 0.851, 0.672],
  reverseRatio: 3.185,
  finalDrive: 3.3,
  driveEfficiency: 0.9,
  shiftTimeS: 0.35,
  minTimeBetweenShiftsS: 0.9,
  upshiftRpm: [1500, 3900],
  downshiftRpm: [1050, 2500],

  starterCrankS: 0.85,
  parkShiftMaxKmh: 1.5,
  reverseShiftMaxKmh: 3,
};

export interface PaintColour {
  name: string;
  hex: number;
  metalness: number;
  roughness: number;
}

export const PAINT_COLOURS: readonly PaintColour[] = [
  { name: 'Everest White', hex: 0xdcddd9, metalness: 0.05, roughness: 0.3 },
  { name: 'Napoli Black', hex: 0x08090b, metalness: 0.5, roughness: 0.32 },
  { name: 'Dazzling Silver', hex: 0xb8bbbe, metalness: 0.85, roughness: 0.32 },
  { name: 'Red Rage', hex: 0x8e0b12, metalness: 0.45, roughness: 0.3 },
  { name: 'Deep Forest', hex: 0x1d3328, metalness: 0.55, roughness: 0.32 },
  { name: 'Electric Blue', hex: 0x173a7a, metalness: 0.6, roughness: 0.3 },
];

export const RENDER = {
  /** Half-size of the shadow camera frustum that follows the car (m). */
  shadowRadiusM: 28,
  /** Fog roughly matched to the HDRI horizon haze. */
  fogColour: 0xc4d0de,
  fogNear: 140,
  fogFar: 1100,
  cameraFar: 2500,
  groundHalfM: 1500,
} as const;

export const MS_TO_KMH = 3.6;
