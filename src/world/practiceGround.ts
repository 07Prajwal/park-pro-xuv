/**
 * Stage-1 flat practice ground: a large asphalt plane with a 1 m / 5 m scale grid,
 * a marked parking lot, low kerbs, cones and pillars. Repeated objects use
 * InstancedMesh (one draw call per type) and share a single static rigid body.
 */

import * as THREE from 'three';
import type { PhysicsContext } from '../core/physics';

const GROUND_HALF = 300;
const BAY_W = 2.6;
const BAY_L = 5.2;
const LINE_W = 0.1;

interface Rect {
  x: number;
  z: number;
  w: number; // size along X
  l: number; // size along Z
}

export function buildPracticeGround(scene: THREE.Scene, phys: PhysicsContext): void {
  const { R, world } = phys;

  // --- Ground (physics + visual).
  const ground = world.createRigidBody(R.RigidBodyDesc.fixed());
  world.createCollider(
    R.ColliderDesc.cuboid(GROUND_HALF, 0.5, GROUND_HALF).setTranslation(0, -0.5, 0).setFriction(1.0),
    ground,
  );

  const tex = makeAsphaltTexture();
  tex.repeat.set(GROUND_HALF / 5, GROUND_HALF / 5); // texture tile = 10 m
  const groundMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_HALF * 2, GROUND_HALF * 2),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }),
  );
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // --- Lot markings: two facing rows of bays along X, with a 7 m aisle.
  const lines: Rect[] = [];
  const bays = 10;
  const rowStartX = -((bays * BAY_W) / 2);
  for (const rowZ of [20, 20 + BAY_L * 2 + 7]) {
    const dir = rowZ === 20 ? 1 : -1;
    for (let i = 0; i <= bays; i++) {
      lines.push({ x: rowStartX + i * BAY_W, z: rowZ + (dir * BAY_L) / 2, w: LINE_W, l: BAY_L });
    }
    lines.push({ x: 0, z: rowZ + dir * BAY_L, w: bays * BAY_W, l: LINE_W });
  }
  // Dashed centre lane leading to the lot.
  for (let z = -40; z < 15; z += 4) lines.push({ x: 0, z, w: LINE_W * 1.4, l: 2 });
  addInstancedRects(scene, lines, 0.004, 0.001, new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.7 }), false);

  // --- Low kerbs framing the lot (solid, 15 cm high).
  const kerbH = 0.15;
  const lotHalfW = (bays * BAY_W) / 2 + 3;
  const lotZ0 = 20 - 2;
  const lotZ1 = 20 + BAY_L * 2 + 7 + BAY_L + 2;
  const kerbs: Rect[] = [
    { x: -lotHalfW, z: (lotZ0 + lotZ1) / 2, w: 0.3, l: lotZ1 - lotZ0 },
    { x: lotHalfW, z: (lotZ0 + lotZ1) / 2, w: 0.3, l: lotZ1 - lotZ0 },
    { x: 0, z: lotZ1, w: lotHalfW * 2, l: 0.3 },
  ];
  addInstancedRects(scene, kerbs, kerbH, kerbH / 2, new THREE.MeshStandardMaterial({ color: 0xc9c5bb, roughness: 0.9 }), true);
  addBoxColliders(phys, kerbs, kerbH);

  // --- Pillars (40 cm square, like a basement) at the aisle edge of the near row.
  const pillars: Rect[] = [];
  for (let i = 0; i < 4; i++) pillars.push({ x: rowStartX + (2 + i * 2) * BAY_W + BAY_W, z: 20 + BAY_L + 0.3, w: 0.4, l: 0.4 });
  addInstancedRects(scene, pillars, 3, 1.5, new THREE.MeshStandardMaterial({ color: 0x9a9fa6, roughness: 0.8 }), true);
  addBoxColliders(phys, pillars, 3);

  // --- Cones: a slalom on the approach and a turning-circle ring.
  const cones: { x: number; z: number }[] = [];
  for (let i = 0; i < 6; i++) cones.push({ x: (i % 2 === 0 ? 1 : -1) * 1.5 + 8, z: -30 + i * 7 });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    cones.push({ x: -25 + Math.cos(a) * 6.2, z: -10 + Math.sin(a) * 6.2 });
  }
  addCones(scene, phys, cones);
}

function addInstancedRects(
  scene: THREE.Scene,
  rects: Rect[],
  height: number,
  centreY: number,
  mat: THREE.Material,
  castShadow: boolean,
): void {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, rects.length);
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  rects.forEach((r, i) => {
    p.set(r.x, centreY, r.z);
    s.set(r.w, height, r.l);
    mesh.setMatrixAt(i, m.compose(p, q, s));
  });
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function addBoxColliders(phys: PhysicsContext, rects: Rect[], height: number): void {
  const { R, world } = phys;
  const body = world.createRigidBody(R.RigidBodyDesc.fixed());
  for (const r of rects) {
    world.createCollider(R.ColliderDesc.cuboid(r.w / 2, height / 2, r.l / 2).setTranslation(r.x, height / 2, r.z), body);
  }
}

function addCones(scene: THREE.Scene, phys: PhysicsContext, cones: { x: number; z: number }[]): void {
  const h = 0.7;
  const r = 0.18;
  const geo = new THREE.ConeGeometry(r, h, 12);
  geo.translate(0, h / 2, 0);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xff6a00, roughness: 0.6 }), cones.length);
  const m = new THREE.Matrix4();
  const { R, world } = phys;
  const body = world.createRigidBody(R.RigidBodyDesc.fixed());
  cones.forEach((c, i) => {
    mesh.setMatrixAt(i, m.makeTranslation(c.x, 0, c.z));
    world.createCollider(R.ColliderDesc.cone(h / 2, r).setTranslation(c.x, h / 2, c.z), body);
  });
  mesh.castShadow = true;
  scene.add(mesh);
}

/** Procedural asphalt with a faint 1 m grid and stronger 5 m lines (10 m tile). */
function makeAsphaltTexture(): THREE.CanvasTexture {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#4a4c50';
  g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 18;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const px = size / 10;
  for (let i = 0; i <= 10; i++) {
    g.strokeStyle = i % 5 === 0 ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)';
    g.lineWidth = i % 5 === 0 ? 2 : 1;
    g.beginPath();
    g.moveTo(i * px, 0);
    g.lineTo(i * px, size);
    g.moveTo(0, i * px);
    g.lineTo(size, i * px);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
