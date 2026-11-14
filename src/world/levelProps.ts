/**
 * Builds a level's physical content from its layout: worn painted markings,
 * rounded concrete kerbs and blocks, knock-over traffic cones, instanced
 * parked cars, and a highlight outline for the target space / next gate.
 * Everything a level creates is owned here and removed by `dispose()`, so
 * switching or retrying a level never leaks bodies or GPU buffers.
 */

import * as THREE from 'three';
import type { RigidBody } from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { XUV_7XO } from '../config';
import type { GameAssets } from '../core/assets';
import { PROP_GROUPS } from '../core/collisionGroups';
import type { PhysicsContext } from '../core/physics';
import type { LevelLayout, OrientedRect } from '../levels/types';
import { ParkedCarInstances } from './parkedCars';
import { applyWorldUv, createSurfaceMaterial } from './surfaceMaterial';

const KERB_H = 0.15;
const CONE_H = 0.72;
const CONE_R = 0.17;
const UP = new THREE.Vector3(0, 1, 0);

interface Cone {
  body: RigidBody;
  homeX: number;
  homeZ: number;
}

export class LevelProps {
  readonly group = new THREE.Group();
  /** Collider handles of kerbs (wheels riding on them are not collisions). */
  readonly kerbHandles = new Set<number>();
  /** Collider handle -> cone index. */
  readonly coneHandles = new Map<number, number>();

  private readonly concrete: THREE.Material;
  private readonly paintMat: THREE.MeshStandardMaterial;
  private readonly coneParts: { geo: THREE.BufferGeometry; mat: THREE.Material }[];
  private readonly highlightMat = new THREE.MeshBasicMaterial({
    color: 0x3ddc84,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  private readonly highlight: THREE.InstancedMesh;

  private body: RigidBody | null = null;
  private cones: Cone[] = [];
  private coneMeshes: THREE.InstancedMesh[] = [];
  private parked: ParkedCarInstances | null = null;
  private owned: { geometry: THREE.BufferGeometry }[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);

  constructor(
    scene: THREE.Scene,
    private readonly phys: PhysicsContext,
    assets: GameAssets,
  ) {
    scene.add(this.group);
    this.concrete = createSurfaceMaterial(assets.surfaces.concrete, { tileM: 1.5, triplanar: true, color: 0xe6e2da });
    this.paintMat = new THREE.MeshStandardMaterial({
      color: 0xe9e7df,
      roughness: 0.72,
      alphaMap: makeWearTexture(),
      alphaTest: 0.35,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    applyWorldUv(this.paintMat, 1.6, 0, false);
    this.coneParts = buildConeParts();

    const quad = new THREE.PlaneGeometry(1, 1);
    quad.rotateX(-Math.PI / 2);
    this.highlight = new THREE.InstancedMesh(quad, this.highlightMat, 4);
    this.highlight.visible = false;
    this.highlight.renderOrder = 2;
    scene.add(this.highlight);
  }

  build(layout: LevelLayout): void {
    this.dispose();
    const { R, world } = this.phys;
    const body = world.createRigidBody(R.RigidBodyDesc.fixed());
    this.body = body;

    if (layout.lines.length) this.addMarkings(layout.lines);
    if (layout.kerbs.length) for (const h of this.addBlocks(layout.kerbs, KERB_H, 0.04, body)) this.kerbHandles.add(h);
    for (const b of groupByHeight(layout.blocks)) this.addBlocks(b.rects, b.height, 0.03, body);
    if (layout.cones.length) this.addCones(layout.cones);

    if (layout.parkedCars.length) {
      this.parked = new ParkedCarInstances(layout.parkedCars);
      this.group.add(this.parked.group);
      const d = XUV_7XO;
      for (const c of layout.parkedCars) {
        const hh = (d.heightM - 0.25) * 0.5 * c.scale;
        world.createCollider(
          R.ColliderDesc.cuboid((d.widthM / 2) * c.scale, hh, (d.lengthM / 2) * c.scale)
            .setTranslation(c.x, 0.25 * c.scale + hh, c.z)
            .setRotation(yawQuat(c.yaw))
            .setFriction(0.4),
          body,
        );
      }
    }
  }

  /** Outline a target zone or gate on the ground (null hides it). */
  showZone(r: OrientedRect | null, colour = 0x3ddc84): void {
    this.highlight.visible = !!r;
    if (!r) return;
    this.highlightMat.color.setHex(colour);
    const t = 0.12;
    const c = Math.cos(r.yaw);
    const sn = Math.sin(r.yaw);
    const edges = [
      [0, r.l / 2, r.w + t, t],
      [0, -r.l / 2, r.w + t, t],
      [r.w / 2, 0, t, r.l],
      [-r.w / 2, 0, t, r.l],
    ];
    this.q.setFromAxisAngle(UP, r.yaw);
    edges.forEach(([across, along, w, l], i) => {
      this.p.set(r.x + c * across + sn * along, 0.012, r.z - sn * across + c * along);
      this.highlight.setMatrixAt(i, this.m.compose(this.p, this.q, this.s.set(w, 1, l)));
    });
    this.s.set(1, 1, 1);
    this.highlight.instanceMatrix.needsUpdate = true;
  }

  /** Copy cone body poses into the instanced meshes. */
  update(): void {
    if (!this.cones.length) return;
    let moved = false;
    this.cones.forEach((cone, i) => {
      if (cone.body.isSleeping()) return;
      const t = cone.body.translation();
      const r = cone.body.rotation();
      this.q.set(r.x, r.y, r.z, r.w);
      // Body origin is the cone's mid-height; the meshes are modelled from the base.
      this.p.set(0, -CONE_H / 2, 0).applyQuaternion(this.q);
      this.p.x += t.x;
      this.p.y += t.y;
      this.p.z += t.z;
      this.m.compose(this.p, this.q, this.s);
      for (const mesh of this.coneMeshes) mesh.setMatrixAt(i, this.m);
      moved = true;
    });
    if (moved) for (const mesh of this.coneMeshes) mesh.instanceMatrix.needsUpdate = true;
  }

  /** Cones displaced more than 15 cm from where they were placed, or knocked over. */
  conesDisplaced(): number {
    let n = 0;
    for (const c of this.cones) {
      const t = c.body.translation();
      if (Math.hypot(t.x - c.homeX, t.z - c.homeZ) > 0.15 || t.y < CONE_H * 0.4) n++;
    }
    return n;
  }

  dispose(): void {
    if (this.body) this.phys.world.removeRigidBody(this.body);
    this.body = null;
    for (const c of this.cones) this.phys.world.removeRigidBody(c.body);
    this.cones = [];
    this.coneMeshes = [];
    this.kerbHandles.clear();
    this.coneHandles.clear();
    this.parked?.dispose();
    this.parked = null;
    for (const o of this.group.children) {
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    }
    for (const o of this.owned) o.geometry.dispose();
    this.owned = [];
    this.group.clear();
    this.highlight.visible = false;
  }

  private addMarkings(rects: OrientedRect[]): void {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.InstancedMesh(geo, this.paintMat, rects.length);
    rects.forEach((r, i) =>
      mesh.setMatrixAt(i, this.m.compose(this.p.set(r.x, 0.004, r.z), this.q.setFromAxisAngle(UP, r.yaw), this.s.set(r.w, 1, r.l))),
    );
    this.s.set(1, 1, 1);
    mesh.receiveShadow = true;
    this.owned.push(mesh);
    this.group.add(mesh);
  }

  /** Merged rounded concrete blocks with matching cuboid colliders; returns the collider handles. */
  private addBlocks(rects: OrientedRect[], height: number, radius: number, body: RigidBody): number[] {
    const { R, world } = this.phys;
    const geos = rects.map((r) => {
      const g = new RoundedBoxGeometry(r.w, height, r.l, 3, Math.min(radius, r.w / 2 - 0.001, r.l / 2 - 0.001));
      g.rotateY(r.yaw);
      g.translate(r.x, height / 2, r.z);
      return g;
    });
    const mesh = new THREE.Mesh(mergeGeometries(geos), this.concrete);
    for (const g of geos) g.dispose();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.owned.push(mesh);
    this.group.add(mesh);
    return rects.map(
      (r) =>
        world.createCollider(
          R.ColliderDesc.cuboid(r.w / 2, height / 2, r.l / 2)
            .setTranslation(r.x, height / 2, r.z)
            .setRotation(yawQuat(r.yaw)),
          body,
        ).handle,
    );
  }

  private addCones(cones: { x: number; z: number }[]): void {
    const { R, world } = this.phys;
    for (const { geo, mat } of this.coneParts) {
      const mesh = new THREE.InstancedMesh(geo, mat, cones.length);
      cones.forEach((c, i) => mesh.setMatrixAt(i, this.m.makeTranslation(c.x, 0, c.z)));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Cones move: bounds must cover the whole course, not the rest poses.
      mesh.frustumCulled = false;
      this.coneMeshes.push(mesh);
      this.group.add(mesh);
    }
    cones.forEach((c, i) => {
      const body = world.createRigidBody(
        R.RigidBodyDesc.dynamic().setTranslation(c.x, CONE_H / 2, c.z).setLinearDamping(0.3).setAngularDamping(0.6),
      );
      const col = world.createCollider(
        R.ColliderDesc.cone(CONE_H / 2, CONE_R).setMass(2.5).setFriction(0.8).setRestitution(0.1).setCollisionGroups(PROP_GROUPS),
        body,
      );
      this.coneHandles.set(col.handle, i);
      this.cones.push({ body, homeX: c.x, homeZ: c.z });
    });
  }
}

function yawQuat(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

function groupByHeight(blocks: { rect: OrientedRect; height: number }[]): { height: number; rects: OrientedRect[] }[] {
  const map = new Map<number, OrientedRect[]>();
  for (const b of blocks) map.set(b.height, [...(map.get(b.height) ?? []), b.rect]);
  return [...map].map(([height, rects]) => ({ height, rects }));
}

/** Standard 75 cm traffic cone: orange body, two reflective bands, black base (modelled from the base). */
function buildConeParts(): { geo: THREE.BufferGeometry; mat: THREE.Material }[] {
  const h = CONE_H;
  const profile = [
    new THREE.Vector2(0.0, 0.035),
    new THREE.Vector2(0.17, 0.035),
    new THREE.Vector2(0.155, 0.08),
    new THREE.Vector2(0.03, h - 0.01),
    new THREE.Vector2(0.024, h),
    new THREE.Vector2(0.0, h),
  ];
  const rAt = (y: number) => 0.155 + ((0.03 - 0.155) * (y - 0.08)) / (h - 0.09) + 0.002;
  const band = (y0: number, hgt: number) => new THREE.LatheGeometry([new THREE.Vector2(rAt(y0), y0), new THREE.Vector2(rAt(y0 + hgt), y0 + hgt)], 24);
  const base = new RoundedBoxGeometry(0.4, 0.035, 0.4, 2, 0.012);
  base.translate(0, 0.0175, 0);
  return [
    { geo: new THREE.LatheGeometry(profile, 24), mat: new THREE.MeshPhysicalMaterial({ color: 0xff5a0a, roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.4 }) },
    { geo: mergeGeometries([band(0.3, 0.1), band(0.47, 0.06)]), mat: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.25, metalness: 0.1 }) },
    { geo: base, mat: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.85 }) },
  ];
}

/** Tileable wear mask: mostly opaque paint with scuffs and chips (white = paint). */
function makeWearTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e6e6e6';
  g.fillRect(0, 0, size, size);
  let a = 7;
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
