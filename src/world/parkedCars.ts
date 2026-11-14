/**
 * Parked cars: the XUV body (without interior) baked once into one merged
 * geometry per material, then drawn as instanced meshes, so a whole car park
 * costs about a dozen draw calls. Per-instance colour tints the paint, and
 * uniform scale gives a mix of hatchback / sedan / SUV sizes.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PAINT_COLOURS, XUV_7XO } from '../config';
import { buildCarBody, buildWheel } from '../vehicle/carGeometry';
import type { ParkedCar } from '../levels/types';

interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  tinted: boolean;
}

let prototype: Part[] | null = null;

/** Geometry restricted to one draw group (shares no buffers with the source). */
function groupSlice(g: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(g.attributes)) out.setAttribute(name, g.attributes[name].clone());
  const idx = g.index!;
  out.setIndex(Array.from(idx.array.slice(start, start + count)));
  return out;
}

/** Bake into the prototype frame: positions/normals transformed; mirrored transforms re-wound. */
function bake(src: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  const g = src.clone();
  if (!g.index) g.setIndex(Array.from({ length: g.attributes.position.count }, (_, i) => i));
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  g.applyMatrix4(m);
  if (m.determinant() < 0) {
    const a = g.index!.array;
    const flipped = Array.from(a);
    for (let i = 0; i < flipped.length; i += 3) [flipped[i + 1], flipped[i + 2]] = [flipped[i + 2], flipped[i + 1]];
    g.setIndex(flipped);
  }
  g.clearGroups();
  return g;
}

function buildPrototype(): Part[] {
  const d = XUV_7XO;
  const body = buildCarBody(d, PAINT_COLOURS[0]);
  const root = new THREE.Group();
  root.add(body.group);
  for (const [x, z] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    const { pivot } = buildWheel(d, x > 0 ? 1 : -1, 'low');
    pivot.position.set((x * d.trackFrontM) / 2, d.wheelRadiusM, (z * d.wheelbaseM) / 2 - (d.frontOverhangM - (d.lengthM - d.wheelbaseM - d.frontOverhangM)) / 2);
    root.add(pivot);
  }
  root.updateMatrixWorld(true);

  const lampMats = new Set<THREE.Material>(Object.values(body.lamps));
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const geo = mesh.geometry;
    const pieces: [THREE.BufferGeometry, THREE.Material][] =
      Array.isArray(mesh.material) && geo.groups.length && geo.index
        ? geo.groups.map((gr) => [groupSlice(geo, gr.start, gr.count), mats[gr.materialIndex ?? 0]])
        : [[geo, mats[0]]];
    for (const [g, mat] of pieces) {
      const list = buckets.get(mat) ?? [];
      list.push(bake(g, mesh.matrixWorld));
      buckets.set(mat, list);
    }
  });

  const parts: Part[] = [];
  for (const [mat, geos] of buckets) {
    let material = mat;
    const tinted = mat === body.paint;
    if (tinted) {
      const p = body.paint.clone();
      p.color.setHex(0xffffff);
      material = p;
    } else if (lampMats.has(mat)) {
      material = mat.clone();
      (material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
    } else if ((mat as THREE.MeshPhysicalMaterial).transparent) {
      // Parked cars have no interior: darker, almost opaque glass.
      const g = (mat as THREE.MeshPhysicalMaterial).clone();
      g.opacity = 0.94;
      material = g;
    }
    parts.push({ geometry: mergeGeometries(geos)!, material, tinted });
  }
  return parts;
}

export class ParkedCarInstances {
  readonly group = new THREE.Group();

  constructor(cars: ParkedCar[]) {
    if (!cars.length) return;
    prototype ??= buildPrototype();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    for (const part of prototype) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, cars.length);
      cars.forEach((car, i) => {
        mesh.setMatrixAt(i, m.compose(p.set(car.x, 0, car.z), q.setFromAxisAngle(up, car.yaw), s.setScalar(car.scale)));
        if (part.tinted) mesh.setColorAt(i, c.setHex(car.colour));
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
  }

  /** Releases the instance buffers; the shared prototype geometry stays cached. */
  dispose(): void {
    for (const o of this.group.children) (o as THREE.InstancedMesh).dispose();
    this.group.clear();
  }
}
