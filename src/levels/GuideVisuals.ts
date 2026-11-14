/**
 * In-world learning aids:
 * - ideal-path line on the ground (blue = forward, amber = reverse) with a car
 *   outline at every stop / direction change,
 * - predicted path of the car's corners for the current steering (main view),
 * - ghost car replaying the ideal manoeuvre,
 * - Hyundai Eon footprint inside the XUV's, to show the size difference,
 * - distance zones around the car for the 360° view, from the parking sensors.
 */

import * as THREE from 'three';
import { ZONE_LAYER } from '../cameras/CameraRig';
import { HYUNDAI_EON, PAINT_COLOURS, type CarDimensions } from '../config';
import { buildCarBody } from '../vehicle/carGeometry';
import { SENSOR_COUNT } from '../vehicle/ParkingSensors';
import { carFootprint, rectCorners } from './geometry';
import { advance, type SampledPath } from './idealPath';
import type { Pose, Segment } from './types';
import { Terrain } from '../world/terrain';


const FORWARD_COLOUR = new THREE.Color(0x3aa0ff);
const REVERSE_COLOUR = new THREE.Color(0xffb020);
const PATH_HALF_W = 0.07;
const PREDICT_SAMPLES = 24;
const GHOST_SPEED_MS = 1.6;
const GHOST_PAUSE_S = 0.9;

export class GuideVisuals {
  readonly group = new THREE.Group();
  readonly ghost: THREE.Group;
  readonly eon: THREE.Group;
  readonly zones: THREE.Group;

  private ideal: THREE.Group | null = null;
  private readonly predicted: THREE.Mesh;
  private readonly predictedPos: Float32Array;
  private readonly predictedAttr: THREE.BufferAttribute;
  private readonly zoneMeshes: THREE.Mesh[] = [];
  private readonly zoneMats = [0x34c759, 0xffcc00, 0xff3b30].map(
    (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.75, depthTest: false, depthWrite: false, side: THREE.DoubleSide }),
  );
  private ghostPath: SampledPath | null = null;
  private ghostSegs: Segment[] = [];
  private ghostT = 0;
  private ghostIndex = 0;
  private ghostPause = 0;
  private ghostStops: number[] = [];
  private ghostNextStop = 0;
  private ghostEnded = false;
  /** Ground height under each sample of the ideal path. */
  private pathY = new Float32Array(0);
  private terrain = new Terrain([]);
  private readonly ghostPitch = new THREE.Quaternion();
  private readonly tmp: Pose = { x: 0, z: 0, yaw: 0 };
  private readonly tmp2: Pose = { x: 0, z: 0, yaw: 0 };

  constructor(
    scene: THREE.Scene,
    private readonly dim: CarDimensions,
  ) {
    scene.add(this.group);

    // Predicted path: two ribbons (left and right corner), rebuilt each frame.
    const verts = 2 * PREDICT_SAMPLES * 2;
    this.predictedPos = new Float32Array(verts * 3);
    const geo = new THREE.BufferGeometry();
    this.predictedAttr = new THREE.BufferAttribute(this.predictedPos, 3);
    this.predictedAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.predictedAttr);
    const idx: number[] = [];
    for (let l = 0; l < 2; l++)
      for (let i = 0; i < PREDICT_SAMPLES - 1; i++) {
        const a = (l * PREDICT_SAMPLES + i) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    geo.setIndex(idx);
    this.predicted = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: 0x7fe3ff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 }),
    );
    this.predicted.frustumCulled = false;
    this.predicted.visible = false;
    this.group.add(this.predicted);

    this.ghost = buildGhost(dim);
    this.ghost.visible = false;
    this.group.add(this.ghost);

    this.eon = buildEonOutline(dim);
    this.eon.visible = false;

    // 360° distance zones: one bar per sensor, placed at the measured distance.
    this.zones = new THREE.Group();
    const bar = new THREE.PlaneGeometry(1, 1);
    bar.rotateX(-Math.PI / 2);
    for (let i = 0; i < SENSOR_COUNT; i++) {
      const m = new THREE.Mesh(bar, this.zoneMats[0]);
      m.layers.set(ZONE_LAYER);
      m.renderOrder = 11;
      m.visible = false;
      this.zones.add(m);
      this.zoneMeshes.push(m);
    }
  }

  /** Show the ideal path for a level (null clears it), draped over the level's terrain. */
  setIdeal(path: SampledPath | null, segs: Segment[] | undefined, terrain: Terrain): void {
    this.terrain = terrain;
    if (this.ideal) {
      this.ideal.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      this.group.remove(this.ideal);
      this.ideal = null;
    }
    this.ghostPath = path;
    this.ghostSegs = segs ?? [];
    this.stopGhost();
    if (!path || !segs) return;
    this.pathY = new Float32Array(path.poses.length);
    let y = 0;
    path.poses.forEach((p, i) => (this.pathY[i] = y = terrain.height(p.x, p.z, y)));
    const g = new THREE.Group();
    g.add(pathRibbon(path, segs, this.pathY));
    // Car outline where the driver should stop (direction changes, parking stops and the end).
    const outline = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    for (let i = 0; i < path.poses.length; i++) {
      const last = i === path.poses.length - 1;
      if (!last && !isStop(path, segs, i)) continue;
      const c = rectCorners(carFootprint(path.poses[i], this.dim));
      const py = this.pathY[i];
      const pts = [...c, c[0]].map((p) => new THREE.Vector3(p.x, terrain.height(p.x, p.z, py) + 0.03, p.z));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), outline);
      g.add(line);
    }
    this.ideal = g;
    this.group.add(g);
  }

  set idealVisible(v: boolean) {
    if (this.ideal) this.ideal.visible = v;
  }

  /** Predicted corner paths: front corners ahead in D, rear corners behind in R. */
  updatePredicted(visible: boolean, pose: Pose, steer: number, dir: 1 | -1, carY = 0): void {
    this.predicted.visible = visible;
    if (!visible) return;
    const d = this.dim;
    const length = dir > 0 ? 6 : 4;
    const seg: Segment = { dir, steer, dist: 0, hint: '' };
    const rearOverhang = d.lengthM - d.wheelbaseM - d.frontOverhangM;
    const along = dir > 0 ? d.wheelbaseM / 2 + d.frontOverhangM : -(d.wheelbaseM / 2 + rearOverhang);
    const P = this.predictedPos;
    for (let l = 0; l < 2; l++) {
      const across = (l === 0 ? 1 : -1) * (d.widthM / 2);
      for (let i = 0; i < PREDICT_SAMPLES; i++) {
        const p = advance(pose, seg, (i / (PREDICT_SAMPLES - 1)) * length, d, this.tmp);
        const fx = Math.sin(p.yaw);
        const fz = Math.cos(p.yaw);
        const cx = p.x + fx * along + fz * across;
        const cz = p.z + fz * along - fx * across;
        // Ribbon width across the travel direction (perpendicular to the heading).
        const o = ((l * PREDICT_SAMPLES + i) * 2) * 3;
        const w = 0.05;
        const h = this.terrain.height(cx, cz, carY) + 0.025;
        P[o] = cx + fz * w;
        P[o + 1] = h;
        P[o + 2] = cz - fx * w;
        P[o + 3] = cx - fz * w;
        P[o + 4] = h;
        P[o + 5] = cz + fx * w;
      }
    }
    this.predictedAttr.needsUpdate = true;
  }

  /** Distance zones from sensor readings (body frame, attached to the car root). */
  updateZones(distances: Float32Array, active: boolean): void {
    const d = this.dim;
    const rearOverhang = d.lengthM - d.wheelbaseM - d.frontOverhangM;
    const zF = d.wheelbaseM / 2 + d.frontOverhangM;
    const zR = -(d.wheelbaseM / 2 + rearOverhang);
    const xs = [d.widthM / 2 - 0.2, 0.45, -0.45, -(d.widthM / 2 - 0.2)];
    for (let i = 0; i < SENSOR_COUNT; i++) {
      const m = this.zoneMeshes[i];
      const dist = distances[i];
      m.visible = active && Number.isFinite(dist);
      if (!m.visible) continue;
      const front = i < 4;
      const corner = i % 4 === 0 || i % 4 === 3;
      const z = front ? zF : zR;
      const sgn = front ? 1 : -1;
      const reach = Math.max(0.05, dist);
      m.material = this.zoneMats[dist < 0.3 ? 2 : dist < 0.8 ? 1 : 0];
      if (corner) {
        const side = i % 4 === 0 ? 1 : -1;
        m.position.set(xs[i % 4] + side * reach * 0.7, 0.04, z + sgn * (reach * 0.7 - 0.12));
        m.rotation.set(0, side * sgn * Math.PI * 0.25, 0);
        m.scale.set(0.5, 1, 0.08);
      } else {
        m.position.set(xs[i % 4], 0.04, z + sgn * reach);
        m.rotation.set(0, 0, 0);
        m.scale.set(0.8, 1, 0.08);
      }
    }
  }

  playGhost(): boolean {
    const p = this.ghostPath;
    if (!p) return false;
    // Distances where the driver stops: direction changes and parking stops.
    this.ghostStops = [];
    for (let i = 1; i < p.poses.length - 1; i++) if (isStop(p, this.ghostSegs, i)) this.ghostStops.push(p.s[i]);
    this.ghostT = 0;
    this.ghostIndex = 0;
    this.ghostNextStop = 0;
    this.ghostEnded = false;
    this.ghostPause = 0.6;
    this.ghost.visible = true;
    this.placeGhost(p.poses[0], this.pathY[0]);
    return true;
  }

  stopGhost(): void {
    this.ghost.visible = false;
  }

  get ghostPlaying(): boolean {
    return this.ghost.visible;
  }

  updateGhost(dt: number): void {
    const p = this.ghostPath;
    if (!this.ghost.visible || !p) return;
    if (this.ghostPause > 0) {
      this.ghostPause -= dt;
      if (this.ghostPause <= 0 && this.ghostEnded) this.ghost.visible = false;
      return;
    }
    const s = p.s;
    const total = s[s.length - 1];
    this.ghostT += dt * GHOST_SPEED_MS;
    const stop = this.ghostStops[this.ghostNextStop];
    if (stop !== undefined && this.ghostT >= stop) {
      this.ghostT = stop;
      this.ghostNextStop++;
      this.ghostPause = GHOST_PAUSE_S;
    }
    if (this.ghostT >= total) {
      this.ghostT = total;
      this.ghostEnded = true;
      this.ghostPause = 1.5;
    }
    while (this.ghostIndex < s.length - 2 && s[this.ghostIndex + 1] < this.ghostT) this.ghostIndex++;
    const a = p.poses[this.ghostIndex];
    const b = p.poses[this.ghostIndex + 1];
    const f = Math.min(1, (this.ghostT - s[this.ghostIndex]) / Math.max(1e-6, s[this.ghostIndex + 1] - s[this.ghostIndex]));
    this.tmp2.x = a.x + (b.x - a.x) * f;
    this.tmp2.z = a.z + (b.z - a.z) * f;
    this.tmp2.yaw = a.yaw + (b.yaw - a.yaw) * f;
    const y = this.pathY[this.ghostIndex] + (this.pathY[this.ghostIndex + 1] - this.pathY[this.ghostIndex]) * f;
    this.placeGhost(this.tmp2, y);
  }

  private placeGhost(p: Pose, y: number): void {
    this.ghost.position.set(p.x, y, p.z);
    const pitch = this.terrain.pitch(p.x, p.z, p.yaw, y);
    this.ghost.quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.yaw).multiply(this.ghostPitch.setFromAxisAngle(X_AXIS, -pitch));
  }
}

const X_AXIS = new THREE.Vector3(1, 0, 0);

/** Sample i is the last one of a segment that ends with a stop (direction change or parking stop). */
function isStop(path: SampledPath, segs: Segment[], i: number): boolean {
  const seg = path.segment[i];
  const next = path.segment[i + 1];
  if (next === undefined || next === seg) return false;
  return !!segs[seg]?.stop || segs[next]?.dir !== segs[seg]?.dir;
}

function pathRibbon(path: SampledPath, segs: Segment[], ys: Float32Array): THREE.Mesh {
  const n = path.poses.length;
  const pos = new Float32Array(n * 2 * 3);
  const col = new Float32Array(n * 2 * 3);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = path.poses[i];
    const lx = Math.cos(p.yaw) * PATH_HALF_W;
    const lz = -Math.sin(p.yaw) * PATH_HALF_W;
    const y = ys[i] + 0.02;
    pos.set([p.x + lx, y, p.z + lz, p.x - lx, y, p.z - lz], i * 6);
    const c = segs[path.segment[i]].dir > 0 ? FORWARD_COLOUR : REVERSE_COLOUR;
    c.toArray(col, i * 6);
    c.toArray(col, i * 6 + 3);
    if (i < n - 1) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 }),
  );
  mesh.renderOrder = 3;
  return mesh;
}

/** Translucent blue-white XUV body (no wheels or interior) for the ideal-manoeuvre replay. */
function buildGhost(d: CarDimensions): THREE.Group {
  const body = buildCarBody(d, PAINT_COLOURS[0]);
  const mat = new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.32, depthWrite: false, roughness: 0.4, emissive: 0x1a4a70, emissiveIntensity: 0.6 });
  body.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.material = mat;
    m.castShadow = false;
    m.receiveShadow = false;
  });
  const rearOverhang = d.lengthM - d.wheelbaseM - d.frontOverhangM;
  body.group.position.z = (d.frontOverhangM - rearOverhang) / 2;
  const g = new THREE.Group();
  g.add(body.group);
  return g;
}

/**
 * Eon footprint (ground outline + translucent fill) and wire box centred in the XUV's,
 * body frame. Drawn on top (X-ray) because it sits inside the XUV body.
 */
function buildEonOutline(d: CarDimensions): THREE.Group {
  const e = HYUNDAI_EON;
  const rearOverhang = d.lengthM - d.wheelbaseM - d.frontOverhangM;
  const cz = (d.frontOverhangM - rearOverhang) / 2;
  const g = new THREE.Group();
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(e.widthM, e.lengthM).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xff4fa3, transparent: true, opacity: 0.22, depthWrite: false, depthTest: false }),
  );
  fill.position.set(0, 0.03, cz);
  const hw = e.widthM / 2;
  const hl = e.lengthM / 2;
  const pts = [
    [hw, hl],
    [-hw, hl],
    [-hw, -hl],
    [hw, -hl],
    [hw, hl],
  ].map(([x, z]) => new THREE.Vector3(x, 0.035, z + cz));
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xff4fa3, depthTest: false, transparent: true }));
  // A wire box at full height so it reads from the cabin and chase views too.
  const box = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(e.widthM, e.heightM, e.lengthM)),
    new THREE.LineBasicMaterial({ color: 0xff4fa3, transparent: true, opacity: 0.55, depthTest: false }),
  );
  box.position.set(0, e.heightM / 2, cz);
  for (const o of [fill, line, box]) o.renderOrder = 12;
  g.add(fill, line, box);
  return g;
}
