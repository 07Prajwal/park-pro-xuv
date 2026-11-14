/**
 * Data model for parking levels. A level definition builds a concrete layout
 * for a difficulty; everything is plain data so levels are easy to add.
 *
 * World frame: +Y up, +Z and +X on the ground. A pose is the physics origin of
 * the car (on the ground, midway between the axles) and its yaw: rotation about
 * +Y, with forward = (sin yaw, cos yaw).
 */

export type Difficulty = 'beginner' | 'normal' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['beginner', 'normal', 'hard'];

export interface Pose {
  x: number;
  z: number;
  yaw: number;
}

/** Oriented rectangle on the ground: centre, yaw, width (across) and length (along its forward). */
export interface OrientedRect {
  x: number;
  z: number;
  yaw: number;
  w: number;
  l: number;
}

export interface ParkedCar {
  x: number;
  z: number;
  yaw: number;
  /** Uniform scale of the parked-car model (1 = XUV-sized; 0.85 is about a hatchback). */
  scale: number;
  colour: number;
}

/** One piece of a manoeuvre: drive `dist` metres (rear-axle arc length) with the wheel held at `steer`. */
export interface Segment {
  /** +1 forward (D), -1 reverse (R). */
  dir: 1 | -1;
  /** Steering position, -1 (full right) .. +1 (full left). */
  steer: number;
  dist: number;
  /** Instruction shown while the driver is in this part of the manoeuvre. */
  hint: string;
}

export interface ParkingTarget {
  zone: OrientedRect;
  /** Required heading: the car's forward must match the zone's forward ('forward'), its reverse ('reverse'), or either. */
  facing: 'forward' | 'reverse' | 'any';
  maxAngleDeg: number;
  /** For kerbside parking: kerb line the car must be close to. */
  kerb?: { rect: OrientedRect; maxGapM: number };
}

export interface Gate {
  rect: OrientedRect;
  label: string;
}

export interface LevelLayout {
  spawn: Pose;
  /** Painted lines (bay markings, lane lines). */
  lines: OrientedRect[];
  /** Low kerbs (15 cm): tyres touching them counts as a kerb touch. */
  kerbs: OrientedRect[];
  /** Tall solid blocks: walls, pillars. */
  blocks: { rect: OrientedRect; height: number }[];
  cones: { x: number; z: number }[];
  parkedCars: ParkedCar[];
  target?: ParkingTarget;
  /** Ordered checkpoints for course levels (the last one is the finish). */
  gates?: Gate[];
  /** The ideal manoeuvre from `spawn`, for the guide line, hints and ghost replay. */
  ideal?: Segment[];
  /** Time for full marks on time, seconds. */
  parTimeS: number;
}

export interface LevelDef {
  id: number;
  title: string;
  summary: string;
  /** Step-by-step technique shown on the tutorial card. */
  technique: string[];
  build(d: Difficulty): LevelLayout;
}
