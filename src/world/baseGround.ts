/**
 * Permanent ground shared by every level: the ground collider, grass to the
 * horizon, the photo-textured asphalt lot and street lamps around it. Level
 * content (markings, kerbs, cones, parked cars) is built by `LevelProps`.
 */

import * as THREE from 'three';
import type { RigidBody } from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RENDER } from '../config';
import type { GameAssets } from '../core/assets';
import type { PhysicsContext } from '../core/physics';
import { createSurfaceMaterial } from './surfaceMaterial';

export interface BaseGround {
  /** Collider handle of the ground (contacts with it are not collisions). */
  groundHandle: number;
  /** Fixed body that level colliders can attach to. */
  statics: RigidBody;
}

export const LOT = { x0: -70, x1: 70, z0: -75, z1: 70 };

export function buildBaseGround(scene: THREE.Scene, phys: PhysicsContext, assets: GameAssets): BaseGround {
  const { R, world } = phys;
  const statics = world.createRigidBody(R.RigidBodyDesc.fixed());
  const ground = world.createCollider(
    R.ColliderDesc.cuboid(RENDER.groundHalfM, 0.5, RENDER.groundHalfM).setTranslation(0, -0.5, 0).setFriction(1.0),
    statics,
  );

  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(RENDER.groundHalfM * 2, RENDER.groundHalfM * 2),
    createSurfaceMaterial(assets.surfaces.grass, { tileM: 3.5, macro: 0.55, color: 0xd9dccb, normalScale: 0.8 }),
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.03;
  grass.receiveShadow = true;
  scene.add(grass);

  const asphalt = new THREE.Mesh(
    new THREE.PlaneGeometry(LOT.x1 - LOT.x0, LOT.z1 - LOT.z0),
    createSurfaceMaterial(assets.surfaces.asphalt, { tileM: 4, macro: 0.45, color: 0xcfcfcf }),
  );
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.position.set((LOT.x0 + LOT.x1) / 2, 0, (LOT.z0 + LOT.z1) / 2);
  asphalt.receiveShadow = true;
  scene.add(asphalt);

  const lamps: { x: number; z: number; yaw: number }[] = [];
  for (let z = -60; z <= 60; z += 30) {
    lamps.push({ x: LOT.x0 + 2, z, yaw: Math.PI / 2 }, { x: LOT.x1 - 2, z, yaw: -Math.PI / 2 });
  }
  addLamps(scene, phys, statics, lamps);
  return { groundHandle: ground.handle, statics };
}

/** Galvanised 8 m street lamp with an arm and LED luminaire. */
function addLamps(scene: THREE.Scene, phys: PhysicsContext, body: RigidBody, lamps: { x: number; z: number; yaw: number }[]): void {
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
