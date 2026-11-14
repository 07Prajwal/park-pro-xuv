/**
 * Builds a level's physical content from its layout: ramps and decks, worn
 * painted markings, rounded kerbs and paved footpaths that follow the slope,
 * walls and buildings in concrete / brick / plaster, speed bumps, knock-over
 * traffic cones, instanced parked cars and street vehicles, and a highlight
 * outline for the target space / next gate.
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
import type { Block, Floor, LevelLayout, OrientedRect, Surface, WallMaterial } from '../levels/types';
import { STREET_VEHICLE_SIZE } from '../levels/validate';
import { parkedCarQuat, ParkedCarInstances } from './parkedCars';
import { StreetVehicleInstances } from './streetProps';
import { applyWorldUv, createSurfaceMaterial } from './surfaceMaterial';
import { surfaceBottom, surfaceHull, surfaceTop, surfaceWalls, Terrain, type TerrainSample } from './terrain';

const DEFAULT_KERB_H = 0.15;
const CONE_H = 0.72;
const CONE_R = 0.17;
const BUMP_H = 0.075;
const MARK_Y = 0.012;
const FLOOR_Y = 0.006;
/** Sky light under a deck. */
const COVERED_ENV = 0.3;
/** Strength of the strip-light fill under a deck. */
const COVERED_FILL = 0.35;
const UP = new THREE.Vector3(0, 1, 0);

interface Cone {
  body: RigidBody;
  homeX: number;
  homeZ: number;
}

export class LevelProps {
  readonly group = new THREE.Group();
  /** Collider handles of kerbs and pavements (wheels riding on them are not collisions). */
  readonly kerbHandles = new Set<number>();
  /** Collider handles of drivable ramps, decks and speed bumps (contacts are not collisions). */
  readonly groundHandles = new Set<number>();
  /** Collider handle -> cone index. */
  readonly coneHandles = new Map<number, number>();
  /** Height of the drivable surface of the current level. */
  terrain = new Terrain([]);

  private readonly mats: {
    concrete: THREE.MeshStandardMaterial;
    asphalt: THREE.MeshStandardMaterial;
    brick: THREE.MeshStandardMaterial;
    plaster: THREE.MeshStandardMaterial;
    pavers: THREE.MeshStandardMaterial;
    light: THREE.MeshStandardMaterial;
    bump: THREE.MeshStandardMaterial;
  };
  /** Block materials: house paint and tints come from vertex colours. */
  private readonly blockMats: Record<WallMaterial, THREE.Material>;
  private readonly covered = new Map<THREE.Material, THREE.Material>();
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
  private street: StreetVehicleInstances | null = null;
  private owned: { geometry: THREE.BufferGeometry }[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly m2 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly ts: TerrainSample = { h: 0, gx: 0, gz: 0 };

  constructor(
    scene: THREE.Scene,
    private readonly phys: PhysicsContext,
    assets: GameAssets,
  ) {
    scene.add(this.group);
    const S = assets.surfaces;
    this.mats = {
      concrete: createSurfaceMaterial(S.concrete, { tileM: 1.5, triplanar: true, color: 0xe6e2da }),
      asphalt: createSurfaceMaterial(S.asphalt, { tileM: 4, macro: 0.45, triplanar: true, color: 0xcfcfcf }),
      brick: createSurfaceMaterial(S.brick, { tileM: 1.2, triplanar: true }),
      plaster: createSurfaceMaterial(S.plaster, { tileM: 2.5, triplanar: true, macro: 0.3 }),
      pavers: createSurfaceMaterial(S.pavers, { tileM: 1.6, triplanar: true, color: 0xd8d2c8 }),
      light: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3df, emissiveIntensity: 2.5, roughness: 0.4 }),
      bump: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }),
    };
    this.blockMats = {
      concrete: tintable(this.mats.concrete),
      brick: tintable(this.mats.brick),
      plaster: tintable(this.mats.plaster),
      light: this.mats.light,
    };
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
    this.terrain = new Terrain(layout.surfaces);

    for (const s of layout.surfaces) this.addSurface(s, body);
    const walls = layout.surfaces.flatMap(surfaceWalls);
    for (const w of walls) this.addSurface(w, body, false);
    if (layout.floors.length) this.addFloors(layout.floors);
    if (layout.lines.length) this.addMarkings(layout.lines);
    const kerbH = layout.kerbHeightM ?? DEFAULT_KERB_H;
    for (const h of this.addOnTerrain(layout.kerbs, kerbH, 0.04, this.mats.concrete, body)) this.kerbHandles.add(h);
    for (const h of this.addOnTerrain(layout.pavements, kerbH, 0.02, this.mats.pavers, body)) this.kerbHandles.add(h);
    if (layout.blocks.length) this.addBlocks(layout.blocks, body);
    if (layout.bumps.length) this.addBumps(layout.bumps, body);
    if (layout.cones.length) this.addCones(layout.cones);

    if (layout.parkedCars.length) {
      this.parked = new ParkedCarInstances(layout.parkedCars);
      this.group.add(this.parked.group);
      const d = XUV_7XO;
      for (const c of layout.parkedCars) {
        const hh = (d.heightM - 0.25) * 0.5 * c.scale;
        const q = parkedCarQuat(c, this.q);
        this.p.set(0, 0.25 * c.scale + hh, 0).applyQuaternion(q);
        world.createCollider(
          R.ColliderDesc.cuboid((d.widthM / 2) * c.scale, hh, (d.lengthM / 2) * c.scale)
            .setTranslation(c.x + this.p.x, (c.y ?? 0) + this.p.y, c.z + this.p.z)
            .setRotation(q)
            .setFriction(0.4),
          body,
        );
      }
    }
    if (layout.vehicles.length) {
      this.street = new StreetVehicleInstances(layout.vehicles);
      this.group.add(this.street.group);
      for (const v of layout.vehicles) {
        const s = STREET_VEHICLE_SIZE[v.kind];
        world.createCollider(
          R.ColliderDesc.cuboid(s.w / 2, s.h / 2, s.l / 2)
            .setTranslation(v.x, s.h / 2, v.z)
            .setRotation(yawQuat(v.yaw))
            .setFriction(0.4),
          body,
        );
      }
    }
  }

  /** Outline a target zone or gate on the drivable surface (null hides it). */
  showZone(r: OrientedRect | null, colour = 0x3ddc84): void {
    this.highlight.visible = !!r;
    if (!r) return;
    this.highlightMat.color.setHex(colour);
    const t = 0.12;
    const edges = [
      [0, r.l / 2, r.w + t, t],
      [0, -r.l / 2, r.w + t, t],
      [r.w / 2, 0, t, r.l],
      [-r.w / 2, 0, t, r.l],
    ];
    const root = this.rootOnTerrain(r, MARK_Y + 0.008, this.m2);
    edges.forEach(([across, along, w, l], i) => {
      this.m.compose(this.p.set(across, 0, along), this.q.identity(), this.s.set(w, 1, l)).premultiply(root);
      this.highlight.setMatrixAt(i, this.m);
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
    this.groundHandles.clear();
    this.coneHandles.clear();
    this.parked?.dispose();
    this.parked = null;
    this.street?.dispose();
    this.street = null;
    for (const o of this.group.children) {
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    }
    for (const o of this.owned) o.geometry.dispose();
    this.owned = [];
    this.group.clear();
    this.highlight.visible = false;
    this.terrain = new Terrain([]);
  }

  /** The same material with reduced sky lighting, for things under a deck. */
  private coveredMat(mat: THREE.Material): THREE.Material {
    let c = this.covered.get(mat);
    if (!c) {
      const m = (mat as THREE.MeshStandardMaterial).clone();
      m.envMapIntensity = COVERED_ENV;
      // The car park's strip lighting: an even fill proportional to the surface colour.
      if (m.map) {
        m.emissive.setHex(0xfff6ea);
        m.emissiveMap = m.map;
        m.emissiveIntensity = COVERED_FILL;
      }
      m.onBeforeCompile = mat.onBeforeCompile;
      m.customProgramCacheKey = mat.customProgramCacheKey;
      this.covered.set(mat, m);
      c = m;
    }
    return c;
  }

  private addMesh(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], shadows = true): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    this.owned.push(mesh);
    this.group.add(mesh);
    return mesh;
  }

  /** Terrain sample under a rectangle (on its tagged floor level). */
  private sampleAt(r: OrientedRect, x = r.x, z = r.z): TerrainSample {
    return this.terrain.sample(x, z, r.level ?? 0, this.ts);
  }

  /** Orientation of the terrain plane under a rectangle, combined with its yaw. */
  private tiltQuat(s: TerrainSample, yaw: number, out: THREE.Quaternion): THREE.Quaternion {
    this.p.set(-s.gx, 1, -s.gz).normalize();
    out.setFromUnitVectors(UP, this.p);
    return out.multiply(this.q2.setFromAxisAngle(UP, yaw));
  }

  /** Matrix placing a rectangle's local frame on the terrain, `lift` above it. */
  private rootOnTerrain(r: OrientedRect, lift: number, out: THREE.Matrix4): THREE.Matrix4 {
    const s = this.sampleAt(r);
    const h = s.h;
    const q = this.tiltQuat(s, r.yaw, this.q);
    return out.compose(this.p.set(r.x, h + lift, r.z), q, this.s.set(1, 1, 1));
  }

  /**
   * A ramp or deck: a box whose top follows the slope, solid to the ground or a
   * slab with a ceiling beneath. Drivable unless `ground` is false (a parapet).
   */
  private addSurface(s: Surface, body: RigidBody, ground = true): void {
    const { R, world } = this.phys;
    const r = s.rect;
    const top = (along: number) => surfaceTop(s, along);
    const bottom = (along: number) => surfaceBottom(s, along);
    const geo = new THREE.BoxGeometry(r.w, 1, r.l, 1, 1, Math.max(1, Math.round(r.l / 4)));
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const along = pos.getZ(i);
      pos.setY(i, pos.getY(i) > 0 ? top(along) : bottom(along));
    }
    geo.computeVertexNormals();
    geo.rotateY(r.yaw);
    geo.translate(r.x, 0, r.z);
    const c = this.mats.concrete;
    const topMat = s.material === 'concrete' || !ground ? c : this.mats.asphalt;
    // BoxGeometry groups: +x, -x, +y (top), -y (bottom), +z, -z.
    this.addMesh(geo, [c, c, topMat, s.slabM ? this.coveredMat(c) : c, c, c]);

    const desc = R.ColliderDesc.convexHull(surfaceHull(s));
    if (!desc) return;
    const col = world.createCollider(desc.setFriction(1.0), body);
    if (ground) this.groundHandles.add(col.handle);
  }

  private addFloors(floors: Floor[]): void {
    for (const f of floors) {
      const r = f.rect;
      const geo = new THREE.PlaneGeometry(r.w, r.l);
      geo.rotateX(-Math.PI / 2);
      geo.rotateY(r.yaw);
      geo.translate(r.x, FLOOR_Y, r.z);
      const base = f.material === 'pavers' ? this.mats.pavers : this.mats.concrete;
      this.addMesh(geo, f.covered ? this.coveredMat(base) : base, false);
    }
  }

  private addMarkings(rects: OrientedRect[]): void {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.InstancedMesh(geo, this.paintMat, rects.length);
    rects.forEach((r, i) => {
      this.rootOnTerrain(r, MARK_Y, this.m2);
      mesh.setMatrixAt(i, this.m.makeScale(r.w, 1, r.l).premultiply(this.m2));
    });
    mesh.receiveShadow = true;
    this.owned.push(mesh);
    this.group.add(mesh);
  }

  /** Low rounded boxes (kerbs, footpaths) sheared to follow the terrain, with tilted cuboid colliders; returns the handles. */
  private addOnTerrain(rects: OrientedRect[], height: number, radius: number, mat: THREE.Material, body: RigidBody): number[] {
    if (!rects.length) return [];
    const { R, world } = this.phys;
    const handles: number[] = [];
    const geos = rects.map((r) => {
      const s = this.sampleAt(r);
      const g = new RoundedBoxGeometry(r.w, height, r.l, 3, Math.min(radius, r.w / 2 - 0.001, r.l / 2 - 0.001, height / 2 - 0.001));
      g.rotateY(r.yaw);
      g.translate(r.x, s.h + height / 2, r.z);
      shearToSlope(g, r.x, r.z, s.gx, s.gz);
      const q = this.tiltQuat(s, r.yaw, this.q);
      this.p.set(0, height / 2, 0).applyQuaternion(q);
      handles.push(
        world.createCollider(
          R.ColliderDesc.cuboid(r.w / 2, height / 2, r.l / 2)
            .setTranslation(r.x + this.p.x, s.h + this.p.y, r.z + this.p.z)
            .setRotation(q),
          body,
        ).handle,
      );
      return g;
    });
    this.addMesh(mergeGeometries(geos)!, mat);
    for (const g of geos) g.dispose();
    return handles;
  }

  /** Walls, pillars, buildings: merged per material (house paint as vertex colour), with cuboid colliders. */
  private addBlocks(blocks: Block[], body: RigidBody): void {
    const { R, world } = this.phys;
    const groups = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[] }>();
    const col = new THREE.Color();
    for (const b of blocks) {
      const r = b.rect;
      const base = b.base ?? 0;
      const material: WallMaterial = b.material ?? 'concrete';
      const radius = material === 'light' ? 0.01 : 0.03;
      const g = new RoundedBoxGeometry(r.w, b.height, r.l, material === 'light' ? 1 : 3, Math.min(radius, r.w / 2 - 0.001, r.l / 2 - 0.001, b.height / 2 - 0.001));
      g.rotateY(r.yaw);
      g.translate(r.x, base + b.height / 2, r.z);
      col.setHex(b.tint ?? 0xffffff);
      const n = g.attributes.position.count;
      const cols = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) cols.set([col.r, col.g, col.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      const key = `${material}:${b.covered && material !== 'light' ? 1 : 0}`;
      let entry = groups.get(key);
      if (!entry) {
        const m = this.blockMats[material];
        entry = { mat: b.covered && material !== 'light' ? this.coveredMat(m) : m, geos: [] };
        groups.set(key, entry);
      }
      entry.geos.push(g);
      if (material !== 'light') {
        world.createCollider(
          R.ColliderDesc.cuboid(r.w / 2, b.height / 2, r.l / 2)
            .setTranslation(r.x, base + b.height / 2, r.z)
            .setRotation(yawQuat(r.yaw)),
          body,
        );
      }
    }
    for (const [key, { mat, geos }] of groups) {
      this.addMesh(mergeGeometries(geos)!, mat, !key.startsWith('light'));
      for (const g of geos) g.dispose();
    }
  }

  /** Rounded concrete speed humps painted in yellow and black bands, with convex-hull colliders. */
  private addBumps(bumps: OrientedRect[], body: RigidBody): void {
    const { R, world } = this.phys;
    const N = 12;
    const geos: THREE.BufferGeometry[] = [];
    const yellow = new THREE.Color(0xe3b51d);
    const black = new THREE.Color(0x1d1d1d);
    for (const r of bumps) {
      const profile: [number, number][] = [];
      for (let i = 0; i <= N; i++) {
        const u = -r.l / 2 + (r.l * i) / N;
        profile.push([u, (BUMP_H * (1 + Math.cos((2 * Math.PI * u) / r.l))) / 2]);
      }
      const shape = new THREE.Shape(profile.map(([u, y]) => new THREE.Vector2(u, y)));
      const s = this.sampleAt(r);
      const q = this.tiltQuat(s, r.yaw, this.q);
      this.m.compose(this.p.set(r.x, s.h, r.z), q, this.s.set(1, 1, 1));
      const stripes = Math.max(2, Math.round(r.w / 0.5));
      for (let k = 0; k < stripes; k++) {
        const w = r.w / stripes;
        const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false, curveSegments: 1 });
        // Profile in the local (along, up) plane, extruded across: along -> +Z, across -> +X.
        g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1));
        g.translate(-r.w / 2 + k * w, 0, 0);
        g.applyMatrix4(this.m);
        const c = k % 2 ? black : yellow;
        const n = g.attributes.position.count;
        const cols = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) cols.set([c.r, c.g, c.b], i * 3);
        g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        geos.push(g.index ? g.toNonIndexed() : g);
      }
      const pts: number[] = [];
      for (const across of [-r.w / 2, r.w / 2])
        for (const [u, y] of profile) {
          this.p.set(across, y, u).applyMatrix4(this.m);
          pts.push(this.p.x, this.p.y, this.p.z);
        }
      const desc = R.ColliderDesc.convexHull(new Float32Array(pts));
      if (desc) this.groundHandles.add(world.createCollider(desc.setFriction(1.0), body).handle);
    }
    this.addMesh(mergeGeometries(geos)!, this.mats.bump);
    for (const g of geos) g.dispose();
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

/** Copy of a world-UV material that multiplies in vertex colours. */
function tintable(mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const m = mat.clone();
  m.vertexColors = true;
  m.onBeforeCompile = mat.onBeforeCompile;
  m.customProgramCacheKey = mat.customProgramCacheKey;
  return m;
}

/** Raise each vertex by the slope's height change from (cx, cz), keeping vertical faces vertical. */
function shearToSlope(g: THREE.BufferGeometry, cx: number, cz: number, gx: number, gz: number): void {
  if (!gx && !gz) return;
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) + gx * (pos.getX(i) - cx) + gz * (pos.getZ(i) - cz));
  g.computeVertexNormals();
}

function yawQuat(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
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
