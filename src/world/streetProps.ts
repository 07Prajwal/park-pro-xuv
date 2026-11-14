/**
 * Parked auto-rickshaws and scooters: each model is assembled once from simple
 * rounded parts, baked into one merged geometry per material and drawn as
 * instanced meshes. Per-instance colour tints the painted body panels.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { StreetVehicle, StreetVehicleKind } from '../levels/types';

interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  tinted: boolean;
}

const prototypes: Partial<Record<StreetVehicleKind, Part[]>> = {};

function box(w: number, h: number, l: number, r: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new RoundedBoxGeometry(w, h, l, 2, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, l / 2 - 0.001));
  g.translate(x, y, z);
  return g;
}

/** Wheel lying along X (axle across the vehicle). */
function wheel(radius: number, width: number, x: number, z: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, width, 18);
  g.rotateZ(Math.PI / 2);
  g.translate(x, radius, z);
  return g;
}

function tube(r: number, from: THREE.Vector3, to: THREE.Vector3): THREE.BufferGeometry {
  const len = from.distanceTo(to);
  const g = new THREE.CylinderGeometry(r, r, len, 8);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()));
  g.translate(from.x, from.y, from.z);
  return g;
}

function clean(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') out.deleteAttribute(name);
  out.clearGroups();
  return out;
}

function parts(list: [THREE.BufferGeometry[], THREE.Material, boolean][]): Part[] {
  return list.map(([geos, material, tinted]) => {
    const merged = mergeGeometries(geos.map(clean))!;
    for (const g of geos) g.dispose();
    return { geometry: merged, material, tinted };
  });
}

const tyreMat = () => new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
const chromeMat = () => new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.9, roughness: 0.3 });
const paintMat = () => new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.35 });

/** Bajaj-style three-wheeler, about 2.65 m long, origin on the ground at its centre, facing +Z. */
function buildAuto(): Part[] {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const yellow = new THREE.MeshPhysicalMaterial({ color: 0xf0bd16, roughness: 0.45, clearcoat: 0.4, clearcoatRoughness: 0.4 });
  const canvas = new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.95 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fb2b8, roughness: 0.08, transparent: true, opacity: 0.35, depthWrite: false });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xf4f1e6, roughness: 0.15, emissive: 0x000000 });
  const posts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    posts.push(tube(0.018, v(sx * 0.6, 0.85, -1.15), v(sx * 0.6, 1.64, -1.15)));
    posts.push(tube(0.018, v(sx * 0.6, 0.85, 0.15), v(sx * 0.57, 1.64, 0.45)));
    posts.push(tube(0.016, v(sx * 0.42, 1.0, 0.82), v(sx * 0.5, 1.62, 0.7)));
  }
  return parts([
    // Lower body tub and the front cowl: the colour that varies (green, black).
    [[box(1.3, 0.55, 1.55, 0.08, 0, 0.6, -0.48), box(0.62, 0.72, 0.5, 0.12, 0, 0.62, 0.95), box(0.9, 0.18, 0.5, 0.06, 0, 0.42, 0.55)], paintMat(), true],
    // Yellow upper panels: the scuttle under the windscreen and the rear-seat sides.
    [[box(1.0, 0.16, 0.36, 0.05, 0, 0.98, 0.84), box(1.31, 0.14, 1.45, 0.05, 0, 0.92, -0.5)], yellow, false],
    // Canvas roof and back.
    [[box(1.32, 0.08, 2.0, 0.04, 0, 1.68, -0.28), box(1.26, 0.8, 0.06, 0.02, 0, 1.26, -1.2), box(1.1, 0.42, 0.62, 0.06, 0, 0.98, -0.75)], canvas, false],
    [[...posts, tube(0.016, v(-0.35, 1.05, 0.95), v(0.35, 1.05, 0.95))], chromeMat(), false],
    [[box(0.86, 0.6, 0.02, 0.01, 0, 1.33, 0.76)], glass, false],
    [[wheel(0.2, 0.12, 0, 0.98), wheel(0.2, 0.12, -0.58, -0.85), wheel(0.2, 0.12, 0.58, -0.85)], tyreMat(), false],
    [[box(0.16, 0.12, 0.05, 0.03, 0, 0.82, 1.21)], lamp, false],
  ]);
}

/** Step-through scooter on its side stand, about 1.8 m long, facing +Z. */
function buildScooter(): Part[] {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2b2d, roughness: 0.7 });
  const seat = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.6 });
  return parts([
    [[box(0.46, 0.66, 0.16, 0.07, 0, 0.66, 0.56), box(0.42, 0.42, 0.78, 0.15, 0, 0.56, -0.45), box(0.2, 0.12, 0.34, 0.05, 0, 0.32, 0.72), box(0.3, 0.12, 0.16, 0.05, 0, 1.02, 0.58)], paintMat(), true],
    [[box(0.34, 0.07, 0.56, 0.02, 0, 0.3, 0.16), box(0.3, 0.08, 0.3, 0.03, 0, 0.36, -0.86)], dark, false],
    [[box(0.3, 0.1, 0.7, 0.05, 0, 0.8, -0.42)], seat, false],
    [[tube(0.016, v(-0.34, 1.04, 0.6), v(0.34, 1.04, 0.6)), tube(0.022, v(0, 0.2, 0.68), v(0, 1.0, 0.6)), tube(0.008, v(0.22, 1.06, 0.6), v(0.3, 1.22, 0.62)), tube(0.008, v(-0.22, 1.06, 0.6), v(-0.3, 1.22, 0.62))], chromeMat(), false],
    [[wheel(0.2, 0.1, 0, 0.66), wheel(0.2, 0.1, 0, -0.6)], tyreMat(), false],
  ]);
}

export class StreetVehicleInstances {
  readonly group = new THREE.Group();

  constructor(vehicles: StreetVehicle[]) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const lean = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3(1, 1, 1);
    const c = new THREE.Color();
    for (const kind of ['auto', 'scooter'] as const) {
      const list = vehicles.filter((v) => v.kind === kind);
      if (!list.length) continue;
      const proto = (prototypes[kind] ??= kind === 'auto' ? buildAuto() : buildScooter());
      for (const part of proto) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        list.forEach((v, i) => {
          q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, v.yaw);
          // Scooters lean onto their side stand.
          if (kind === 'scooter') q.multiply(lean.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.12));
          mesh.setMatrixAt(i, m.compose(p.set(v.x, 0, v.z), q, s));
          if (part.tinted) mesh.setColorAt(i, c.setHex(v.colour));
        });
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        this.group.add(mesh);
      }
    }
  }

  dispose(): void {
    for (const o of this.group.children) (o as THREE.InstancedMesh).dispose();
    this.group.clear();
  }
}
