/**
 * Reverse-camera guidelines, in two styles:
 *  - 'fixed': straight red / yellow / green lines the width of the car with distance
 *    marks. They never move, so they show where the car goes if the wheel is straight.
 *  - 'path': a separate cyan line that follows the steering wheel: the predicted path
 *    of the rear bumper corners for the current steering angle, ending in a bar.
 *
 * Path model: kinematic bicycle model about the middle of the rear axle (the rear
 * wheels don't steer, so the car rotates about a centre on the rear-axle line).
 * Coordinates are the physics body frame: +Z forward, +X left, origin midway
 * between the axles on the ground.
 */

import * as THREE from 'three';
import type { CarDimensions } from '../config';

/** Render layer seen only by cameras that show guidelines (reverse camera, 360° view). */
export const GUIDE_LAYER = 1;
/** How far behind the bumper the guidelines reach, metres. */
export const GUIDE_LENGTH_M = 3;

export interface Pose2 {
  x: number;
  z: number;
  /** Heading: rotation about +Y; forward is (sin, cos). */
  yaw: number;
}

/**
 * Pose of the rear-axle centre after reversing `distance` metres with a fixed
 * centre steer angle, starting from (0, 0, yaw 0) at the rear axle.
 */
export function reverseAxlePose(distance: number, centreSteerAngle: number, wheelbaseM: number, out: Pose2): Pose2 {
  const k = Math.tan(centreSteerAngle) / wheelbaseM; // path curvature
  const s = -distance;
  const yaw = k * s;
  if (Math.abs(k) < 1e-6) {
    out.x = 0;
    out.z = s;
  } else {
    out.x = (1 - Math.cos(yaw)) / k;
    out.z = Math.sin(yaw) / k;
  }
  out.yaw = yaw;
  return out;
}

const COLOUR_NEAR = new THREE.Color(0xff3b30);
const COLOUR_MID = new THREE.Color(0xffcc00);
const COLOUR_FAR = new THREE.Color(0x34c759);
const COLOUR_PATH = new THREE.Color(0x29b6f6);
const SAMPLES = 32;

export type GuidelineStyle = 'fixed' | 'path';

interface Mark {
  /** Distance behind the bumper, metres. */
  d: number;
  /** 0 for a full bar, else the length of a tick at each line. */
  tick: number;
}

/** Fixed lines: full bar at 0.5 m, side ticks at 1 m and 2 m. The path line ends in one full bar. */
const FIXED_MARKS: readonly Mark[] = [
  { d: 0.5, tick: 0 },
  { d: 1, tick: 0.3 },
  { d: 2, tick: 0.3 },
];
const PATH_MARKS: readonly Mark[] = [{ d: GUIDE_LENGTH_M, tick: 0 }];

export class ReverseGuidelines {
  readonly mesh: THREE.Mesh;

  private readonly positions: Float32Array;
  private readonly attr: THREE.BufferAttribute;
  private readonly marks: readonly Mark[];
  private readonly lineHalfW: number;
  private readonly barHalfW: number;
  private readonly lift: number;
  private readonly halfW: number;
  private readonly rearOverhang: number;
  private readonly rearAxleZ: number;
  private readonly pose: Pose2 = { x: 0, z: 0, yaw: 0 };
  private readonly line = [new Float32Array(SAMPLES * 2), new Float32Array(SAMPLES * 2)];
  private lastAngle = NaN;

  constructor(
    private readonly dim: CarDimensions,
    style: GuidelineStyle = 'fixed',
  ) {
    const path = style === 'path';
    this.marks = path ? PATH_MARKS : FIXED_MARKS;
    // The steering line is wider and drawn underneath, so the fixed lines stay visible on top of it.
    this.lineHalfW = path ? 0.05 : 0.025;
    this.barHalfW = path ? 0.04 : 0.02;
    this.lift = 0.02;
    this.halfW = dim.widthM / 2;
    this.rearOverhang = dim.lengthM - dim.wheelbaseM - dim.frontOverhangM;
    this.rearAxleZ = -dim.wheelbaseM / 2;

    const vertCount = 2 * SAMPLES * 2 + this.marks.length * 2 * 4;
    this.positions = new Float32Array(vertCount * 3);
    const colours = new Float32Array(vertCount * 3);
    const index: number[] = [];

    // Two side lines: SAMPLES cross-sections of 2 vertices each.
    for (let l = 0; l < 2; l++) {
      const base = l * SAMPLES * 2;
      for (let i = 0; i < SAMPLES; i++) {
        const d = (i / (SAMPLES - 1)) * GUIDE_LENGTH_M;
        const c = path ? COLOUR_PATH : d < 0.5 ? COLOUR_NEAR : d < 1 ? COLOUR_MID : COLOUR_FAR;
        for (let k = 0; k < 2; k++) c.toArray(colours, (base + i * 2 + k) * 3);
        if (i < SAMPLES - 1) {
          const a = base + i * 2;
          index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
    }
    // Distance marks: two quads each (left and right halves, or ticks).
    let v = 2 * SAMPLES * 2;
    for (const m of this.marks) {
      const c = path ? COLOUR_PATH : m.d <= 0.5 ? COLOUR_NEAR : m.d <= 1 ? COLOUR_MID : COLOUR_FAR;
      for (let q = 0; q < 2; q++) {
        for (let k = 0; k < 4; k++) c.toArray(colours, (v + k) * 3);
        index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
        v += 4;
      }
    }

    const geo = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.positions, 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.attr);
    geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geo.setIndex(index);

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.layers.set(GUIDE_LAYER);
    this.mesh.renderOrder = path ? 10 : 11;
    this.mesh.frustumCulled = false;
    this.update(0);
  }

  /** Bumper-corner position (body frame) after reversing `d` metres. */
  corner(d: number, side: 1 | -1, centreSteerAngle: number, out: { x: number; z: number }): void {
    const p = reverseAxlePose(d, centreSteerAngle, this.dim.wheelbaseM, this.pose);
    const lx = side * this.halfW;
    const lz = -this.rearOverhang;
    const c = Math.cos(p.yaw);
    const s = Math.sin(p.yaw);
    out.x = p.x + lx * c + lz * s;
    out.z = this.rearAxleZ + p.z - lx * s + lz * c;
  }

  /** Rebuild the guideline geometry for the current steering angle (skipped if unchanged). */
  update(centreSteerAngle: number): void {
    if (Math.abs(centreSteerAngle - this.lastAngle) < 1e-4) return;
    this.lastAngle = centreSteerAngle;
    const P = this.positions;
    const y = this.lift;
    const tmp = { x: 0, z: 0 };

    for (let l = 0; l < 2; l++) {
      const side = l === 0 ? 1 : -1;
      const pts = this.line[l];
      for (let i = 0; i < SAMPLES; i++) {
        this.corner((i / (SAMPLES - 1)) * GUIDE_LENGTH_M, side, centreSteerAngle, tmp);
        pts[i * 2] = tmp.x;
        pts[i * 2 + 1] = tmp.z;
      }
      const base = l * SAMPLES * 2;
      for (let i = 0; i < SAMPLES; i++) {
        const i0 = Math.max(i - 1, 0);
        const i1 = Math.min(i + 1, SAMPLES - 1);
        let tx = pts[i1 * 2] - pts[i0 * 2];
        let tz = pts[i1 * 2 + 1] - pts[i0 * 2 + 1];
        const len = Math.hypot(tx, tz) || 1;
        tx /= len;
        tz /= len;
        const nx = -tz * this.lineHalfW;
        const nz = tx * this.lineHalfW;
        const o = (base + i * 2) * 3;
        P[o] = pts[i * 2] + nx;
        P[o + 1] = y;
        P[o + 2] = pts[i * 2 + 1] + nz;
        P[o + 3] = pts[i * 2] - nx;
        P[o + 4] = y;
        P[o + 5] = pts[i * 2 + 1] - nz;
      }
    }

    let v = 2 * SAMPLES * 2;
    const L = { x: 0, z: 0 };
    const R = { x: 0, z: 0 };
    for (const m of this.marks) {
      this.corner(m.d, 1, centreSteerAngle, L);
      this.corner(m.d, -1, centreSteerAngle, R);
      let bx = R.x - L.x;
      let bz = R.z - L.z;
      const width = Math.hypot(bx, bz) || 1;
      bx /= width;
      bz /= width;
      const px = -bz * this.barHalfW;
      const pz = bx * this.barHalfW;
      const len = m.tick > 0 ? m.tick : width / 2;
      // Left half / tick starts at the left line, right half / tick at the right line.
      for (const [sx, sz, dir] of [
        [L.x, L.z, 1],
        [R.x, R.z, -1],
      ] as const) {
        const ex = sx + bx * len * dir;
        const ez = sz + bz * len * dir;
        const o = v * 3;
        P[o] = sx + px;
        P[o + 1] = y;
        P[o + 2] = sz + pz;
        P[o + 3] = sx - px;
        P[o + 4] = y;
        P[o + 5] = sz - pz;
        P[o + 6] = ex + px;
        P[o + 7] = y;
        P[o + 8] = ez + pz;
        P[o + 9] = ex - px;
        P[o + 10] = y;
        P[o + 11] = ez - pz;
        v += 4;
      }
    }
    this.attr.needsUpdate = true;
  }
}
