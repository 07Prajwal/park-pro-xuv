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
  /**
   * Height of the floor the rectangle lies on, when it is not the ground (for
   * example 3 for a car-park deck). Markings and zones are placed on the drivable
   * surface nearest to this height.
   */
  level?: number;
}

/**
 * Raised drivable surface: a deck (h0 equal to h1) or a ramp whose height rises
 * linearly along the rectangle's forward axis, from h0 at its back edge to h1 at
 * its front edge.
 */
export interface Surface {
  rect: OrientedRect;
  h0: number;
  h1: number;
  /** Parapet walls (1 m above the surface) along the left / right edges (relative to the rect's forward). */
  walls?: { left?: boolean; right?: boolean };
  /** Slab thickness: a deck with an open underside (a ceiling). Without it the surface is solid down to the ground. */
  slabM?: number;
  /** Top finish (default asphalt). */
  material?: 'asphalt' | 'concrete';
}

/** 'light' is an emissive ceiling strip. */
export type WallMaterial = 'concrete' | 'brick' | 'plaster' | 'light';

export interface Block {
  rect: OrientedRect;
  height: number;
  /** Height of the block's bottom (default 0, the ground). */
  base?: number;
  material?: WallMaterial;
  /** Colour multiplier (house paint on plaster). */
  tint?: number;
  /** Under a deck: rendered with reduced sky lighting. */
  covered?: boolean;
}

/** Flat floor finish laid over the asphalt (car-park concrete, paved driveway). */
export interface Floor {
  rect: OrientedRect;
  material: 'concrete' | 'pavers';
  covered?: boolean;
}

export interface ParkedCar {
  x: number;
  z: number;
  yaw: number;
  /** Uniform scale of the parked-car model (1 = XUV-sized; 0.85 is about a hatchback). */
  scale: number;
  colour: number;
  /** Ground height under the car (default 0). */
  y?: number;
  /** Nose-up pitch in radians when parked on a slope (default 0). */
  pitch?: number;
}

export type StreetVehicleKind = 'auto' | 'scooter';

/** Parked auto-rickshaw or two-wheeler (obstacles on Indian streets). */
export interface StreetVehicle {
  kind: StreetVehicleKind;
  x: number;
  z: number;
  yaw: number;
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
  /** The driver stops and secures the car at the end of this segment (an intermediate parking stop). */
  stop?: boolean;
}

export interface ParkingTarget {
  zone: OrientedRect;
  /** Required heading: the car's forward must match the zone's forward ('forward'), its reverse ('reverse'), or either. */
  facing: 'forward' | 'reverse' | 'any';
  maxAngleDeg: number;
  /** For kerbside parking: kerb line the car must be close to. */
  kerb?: { rect: OrientedRect; maxGapM: number };
  /** The parking brake must be applied (Space) as well as the car being stopped, e.g. when parking on a hill. */
  needsParkingBrake?: boolean;
  /** Short name used in messages, e.g. "uphill space". */
  name?: string;
}

export interface Gate {
  rect: OrientedRect;
  label: string;
}

/** Extra rules that change how an attempt is scored or failed. */
export interface LevelRules {
  /** Kerb touches allowed; one more ends the attempt as failed. */
  kerbTouchLimit?: number;
  /** Points lost per kerb touch (default 5). */
  kerbPenalty?: number;
  /** Crossing a speed bump faster than this (km/h) is penalised. */
  bumpMaxKmh?: number;
  /** Rolling against the driven direction (backwards after W, forwards after S) further than this (m) is penalised. */
  rollbackM?: number;
}

export interface LevelLayout {
  spawn: Pose;
  /** Painted lines (bay markings, lane lines). */
  lines: OrientedRect[];
  /** Low kerbs: tyres touching them counts as a kerb touch. */
  kerbs: OrientedRect[];
  /** Height of the kerbs (default 0.15 m). */
  kerbHeightM?: number;
  /** Raised paved footpaths (kerb height); tyres on them count as kerb touches too. */
  pavements: OrientedRect[];
  /** Tall solid blocks: walls, pillars, gate posts, buildings. */
  blocks: Block[];
  floors: Floor[];
  /** Ramps and decks. */
  surfaces: Surface[];
  /** Speed bumps; `l` is the length along the direction of travel. */
  bumps: OrientedRect[];
  cones: { x: number; z: number }[];
  parkedCars: ParkedCar[];
  vehicles: StreetVehicle[];
  /** Intermediate parking stops, completed in order before `target`. */
  stops?: ParkingTarget[];
  target?: ParkingTarget;
  /** Ordered checkpoints, completed before any parking (the last one finishes a course level). */
  gates?: Gate[];
  /** The ideal manoeuvre from `spawn`, for the guide line, hints and ghost replay. */
  ideal?: Segment[];
  rules?: LevelRules;
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
