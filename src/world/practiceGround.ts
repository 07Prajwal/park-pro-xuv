/**
 * Free-practice lot: photo-textured asphalt surrounded by grass, worn painted bay
 * markings, rounded concrete kerbs, pillars, traffic cones and street lamps.
 *
 * Repeated objects share geometry and are either instanced (cones, lamps, lines)
 * or merged into one mesh (kerbs, pillars), and all static colliders hang off a
 * single fixed rigid body.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RENDER } from '../config';
import type { GameAssets } from '../core/assets';
import type { PhysicsContext } from '../core/physics';
import { applyWorldUv, createSurfaceMaterial } from './surfaceMaterial';

const BAY_W = 2.6;
const BAY_L = 5.2;
const LINE_W = 0.11;

interface Rect {
  x: number;
  z: number;
  w: number; // size along X
  l: number; // size along Z
}

export function buildPracticeGround(scene: THREE.Scene, phys: PhysicsContext, assets: GameAssets): void {
  const { R, world } = phys;
  const statics = world.createRigidBody(R.RigidBodyDesc.fixed());

  // --- Ground collider (flat, everywhere).
  world.createCollider(
    R.ColliderDesc.cuboid(RENDER.groundHalfM, 0.5, RENDER.groundHalfM).setTranslation(0, -0.5, 0).setFriction(1.0),
    statics,
  );

  // --- Grass field to the horizon, slightly below the asphalt.
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(RENDER.groundHalfM * 2, RENDER.groundHalfM * 2),
    createSurfaceMaterial(assets.surfaces.grass, { tileM: 3.5, macro: 0.55, color: 0xd9dccb, normalScale: 0.8 }),
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.03;
  grass.receiveShadow = true;
  scene.add(grass);

  // --- Asphalt lot.
  const lot = { x0: -70, x1: 70, z0: -75, z1: 70 };
  const asphalt = new THREE.Mesh(
    new THREE.PlaneGeometry(lot.x1 - lot.x0, lot.z1 - lot.z0),
    createSurfaceMaterial(assets.surfaces.asphalt, { tileM: 4, macro: 0.45, color: 0xcfcfcf }),
  );
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.position.set((lot.x0 + lot.x1) / 2, 0, (lot.z0 + lot.z1) / 2);
  asphalt.receiveShadow = true;
  scene.add(asphalt);

  // --- Painted markings: two facing rows of bays with a 7 m aisle, plus an approach lane.
  const lines: Rect[] = [];
  const bays = 10;
  const rowStartX = -((bays * BAY_W) / 2);
  const row1 = 20;
  const row2 = row1 + BAY_L * 2 + 7;
  for (const [rowZ, dir] of [
    [row1, 1],
    [row2, -1],
  ] as const) {
    for (let i = 0; i <= bays; i++) lines.push({ x: rowStartX + i * BAY_W, z: rowZ + (dir * BAY_L) / 2, w: LINE_W, l: BAY_L });
    lines.push({ x: 0, z: rowZ + dir * BAY_L, w: bays * BAY_W, l: LINE_W });
  }
  for (let z = -60; z < 14; z += 6) lines.push({ x: 0, z, w: 0.12, l: 3 });
  lines.push({ x: -3.6, z: -23, w: 0.12, l: 74 }, { x: 3.6, z: -23, w: 0.12, l: 74 });
  addMarkings(scene, lines);

  // --- Rounded concrete kerbs framing the lot (solid, 15 cm high).
  const kerbH = 0.15;
  const lotHalfW = (bays * BAY_W) / 2 + 3;
  const kz0 = row1 - 2;
  const kz1 = row2 + BAY_L + 2;
  const kerbs: Rect[] = [
    { x: -lotHalfW, z: (kz0 + kz1) / 2, w: 0.3, l: kz1 - kz0 },
    { x: lotHalfW, z: (kz0 + kz1) / 2, w: 0.3, l: kz1 - kz0 },
    { x: 0, z: kz1, w: lotHalfW * 2 + 0.3, l: 0.3 },
  ];
  const concrete = createSurfaceMaterial(assets.surfaces.concrete, { tileM: 1.5, triplanar: true, color: 0xe6e2da });
  addRoundedBlocks(scene, phys, statics, kerbs, kerbH, 0.04, concrete);

  // --- Square pillars at the aisle edge of the near row.
  const pillars: Rect[] = [];
  for (let i = 0; i < 4; i++) pillars.push({ x: rowStartX + (3 + i * 2) * BAY_W, z: row1 + BAY_L + 0.3, w: 0.45, l: 0.45 });
  addRoundedBlocks(scene, phys, statics, pillars, 3.2, 0.03, concrete);

  // --- Traffic cones: a slalom on the approach and a turning-circle ring.
  const cones: { x: number; z: number }[] = [];
  for (let i = 0; i < 6; i++) cones.push({ x: (i % 2 === 0 ? 1 : -1) * 1.5 + 12, z: -40 + i * 7 });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    cones.push({ x: -28 + Math.cos(a) * 6.2, z: -18 + Math.sin(a) * 6.2 });
  }
  addCones(scene, phys, statics, cones);

  // --- Street lamps around the lot.
  const lamps: { x: number; z: number; yaw: number }[] = [];
  for (let z = -60; z <= 60; z += 30) {
    lamps.push({ x: lot.x0 + 2, z, yaw: Math.PI / 2 }, { x: lot.x1 - 2, z, yaw: -Math.PI / 2 });
  }
  addLamps(scene, phys, statics, lamps);
}

/** Worn road paint: instanced quads with a procedural wear mask (alpha-tested). */
function addMarkings(scene: THREE.Scene, rects: Rect[]): void {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xe9e7df,
    roughness: 0.72,
    alphaMap: makeWearTexture(),
    alphaTest: 0.35,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  applyWorldUv(mat, 1.6, 0, false);
  const mesh = new THREE.InstancedMesh(geo, mat, rects.length);
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  rects.forEach((r, i) => mesh.setMatrixAt(i, m.compose(p.set(r.x, 0.004, r.z), q, s.set(r.w, 1, r.l))));
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function addRoundedBlocks(
  scene: THREE.Scene,
  phys: PhysicsContext,
  body: import('@dimforge/rapier3d-compat').RigidBody,
  rects: Rect[],
  height: number,
  radius: number,
  mat: THREE.Material,
): void {
  const geos = rects.map((r) => {
    const g = new RoundedBoxGeometry(r.w, height, r.l, 3, radius);
    g.translate(r.x, height / 2, r.z);
    return g;
  });
  const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  for (const r of rects) {
    phys.world.createCollider(
      phys.R.ColliderDesc.cuboid(r.w / 2, height / 2, r.l / 2).setTranslation(r.x, height / 2, r.z),
      body,
    );
  }
}

/** Standard 75 cm traffic cone: orange body, two reflective bands, black base. */
function addCones(
  scene: THREE.Scene,
  phys: PhysicsContext,
  body: import('@dimforge/rapier3d-compat').RigidBody,
  cones: { x: number; z: number }[],
): void {
  const h = 0.72;
  const profile = [
    new THREE.Vector2(0.0, 0.035),
    new THREE.Vector2(0.17, 0.035),
    new THREE.Vector2(0.155, 0.08),
    new THREE.Vector2(0.03, h - 0.01),
    new THREE.Vector2(0.024, h),
    new THREE.Vector2(0.0, h),
  ];
  const coneGeo = new THREE.LatheGeometry(profile, 24);
  const bandGeo = mergeGeometries([band(0.3, 0.1, h), band(0.47, 0.06, h)]);
  const baseGeo = new RoundedBoxGeometry(0.4, 0.035, 0.4, 2, 0.012);
  baseGeo.translate(0, 0.0175, 0);

  const orange = new THREE.MeshPhysicalMaterial({ color: 0xff5a0a, roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.4 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.25, metalness: 0.1 });
  const black = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.85 });

  const m = new THREE.Matrix4();
  for (const [geo, mat] of [
    [coneGeo, orange],
    [bandGeo, white],
    [baseGeo, black],
  ] as const) {
    const mesh = new THREE.InstancedMesh(geo, mat, cones.length);
    cones.forEach((c, i) => mesh.setMatrixAt(i, m.makeTranslation(c.x, 0, c.z)));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  for (const c of cones) {
    phys.world.createCollider(phys.R.ColliderDesc.cone(h / 2, 0.17).setTranslation(c.x, h / 2, c.z), body);
  }

  /** Reflective band hugging the cone surface between heights y0 and y0+hgt. */
  function band(y0: number, hgt: number, coneH: number): THREE.BufferGeometry {
    const rAt = (y: number) => 0.155 + ((0.03 - 0.155) * (y - 0.08)) / (coneH - 0.09) + 0.002;
    return new THREE.LatheGeometry([new THREE.Vector2(rAt(y0), y0), new THREE.Vector2(rAt(y0 + hgt), y0 + hgt)], 24);
  }
}

/** Galvanised 8 m street lamp with an arm and LED luminaire. */
function addLamps(
  scene: THREE.Scene,
  phys: PhysicsContext,
  body: import('@dimforge/rapier3d-compat').RigidBody,
  lamps: { x: number; z: number; yaw: number }[],
): void {
  const poleH = 8;
  const pole = new THREE.CylinderGeometry(0.06, 0.1, poleH, 16);
  pole.translate(0, poleH / 2, 0);
  const plinth = new THREE.CylinderGeometry(0.2, 0.22, 0.5, 16);
  plinth.translate(0, 0.25, 0);
  const arm = new THREE.CylinderGeometry(0.04, 0.05, 1.6, 10);
  arm.rotateX(Math.PI / 2);
  arm.translate(0, poleH - 0.1, 0.75);
  const steel = mergeGeometries([pole, plinth, arm]);
  const head = new RoundedBoxGeometry(0.32, 0.09, 0.7, 2, 0.03);
  head.translate(0, poleH - 0.12, 1.55);

  const steelMat = new THREE.MeshStandardMaterial({ color: 0x9da3a8, metalness: 0.85, roughness: 0.38 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0x3a3d40, metalness: 0.6, roughness: 0.45 });

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  for (const [geo, mat] of [
    [steel, steelMat],
    [head, headMat],
  ] as const) {
    const mesh = new THREE.InstancedMesh(geo, mat, lamps.length);
    lamps.forEach((l, i) => mesh.setMatrixAt(i, m.compose(p.set(l.x, 0, l.z), q.setFromAxisAngle(up, l.yaw), s)));
    mesh.castShadow = true;
    scene.add(mesh);
  }
  for (const l of lamps) {
    phys.world.createCollider(phys.R.ColliderDesc.cylinder(poleH / 2, 0.12).setTranslation(l.x, poleH / 2, l.z), body);
  }
}

/** Tileable wear mask: mostly opaque paint with scuffs and chips (white = paint). */
function makeWearTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e6e6e6';
  g.fillRect(0, 0, size, size);
  const rnd = mulberry32(7);
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 0.5 + rnd() * rnd() * 5;
    const v = Math.floor(rnd() * 120);
    g.fillStyle = `rgb(${v},${v},${v})`;
    for (const dx of [-size, 0, size])
      for (const dy of [-size, 0, size]) {
        g.beginPath();
        g.arc(x + dx, y + dy, r, 0, Math.PI * 2);
        g.fill();
      }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
