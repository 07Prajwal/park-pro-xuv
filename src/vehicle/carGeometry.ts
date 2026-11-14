/**
 * Procedural SUV body and wheel geometry, sized from CarDimensions.
 *
 * The body is a side-profile Shape (with wheel-arch cut-outs) extruded across the
 * car's width with a generous bevel, so every edge is rounded like pressed sheet
 * metal. The glasshouse and roof are separate bevelled extrusions sitting on the
 * beltline. Stage 3 refines styling details (grille, lamps, mirrors, cockpit).
 *
 * Local frame: +Z forward, +Y up, +X left; origin on the ground at the middle of
 * the footprint (VehicleVisual offsets it to the physics origin between the axles).
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CarDimensions, PaintColour } from '../config';

export interface CarLampMaterials {
  drl: THREE.MeshStandardMaterial;
  headlamp: THREE.MeshStandardMaterial;
  tail: THREE.MeshStandardMaterial;
  brake: THREE.MeshStandardMaterial;
  reverse: THREE.MeshStandardMaterial;
  indicatorLeft: THREE.MeshStandardMaterial;
  indicatorRight: THREE.MeshStandardMaterial;
}

export interface CarBody {
  group: THREE.Group;
  paint: THREE.MeshPhysicalMaterial;
  lamps: CarLampMaterials;
}

const BEVEL = 0.05;
/** Bevel of the main body extrusion; the profile is inset by this so the bevelled body meets the real dimensions. */
const BODY_BEVEL = 0.07;

/** Body half-width factor by height: slight under-body tuck, full at the shoulder, tumblehome up to the beltline. */
function bodyTaper(y: number): number {
  if (y < 0.5) return 0.975 + 0.025 * Math.max(0, (y - 0.3) / 0.2);
  if (y < 0.8) return 1;
  return 1 - 0.05 * Math.pow(Math.min((y - 0.8) / 0.35, 1), 1.5);
}

/** Glasshouse half-width factor by height (strong inward lean of the side glass). */
function glassTaper(y: number): number {
  return 1 - 0.18 * Math.min(Math.max((y - 1.06) / 0.6, 0), 1);
}

/**
 * Narrow an extruded slab by height (tumblehome) and round its ends in plan view,
 * so the body reads as curved pressed panels rather than a box.
 */
function warpWidth(src: THREE.BufferGeometry, taper: (y: number) => number, endRound: number, endLen: number): THREE.BufferGeometry {
  // Extrusions are non-indexed (flat-shaded); weld vertices so the panels shade smoothly.
  src.deleteAttribute('normal');
  src.deleteAttribute('uv');
  const g = mergeVertices(src, 1e-4);
  g.computeBoundingBox();
  const zMax = g.boundingBox!.max.z;
  const zMin = g.boundingBox!.min.z;
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const t = Math.max(0, 1 - Math.min(zMax - z, z - zMin) / endLen);
    pos.setX(i, pos.getX(i) * taper(y) * (1 - endRound * t * t));
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** Extrude a side profile (x = car Z, y = height) across the car width, centred on X = 0. */
function extrudeProfile(shape: THREE.Shape, width: number, bevel: number, bevelSegments = 5): THREE.ExtrudeGeometry {
  const depth = width - 2 * bevel;
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments,
    curveSegments: 32,
  });
  g.rotateY(-Math.PI / 2); // shape X -> car Z, extrusion -> car -X
  g.translate(depth / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

export function buildCarBody(d: CarDimensions, paintColour: PaintColour): CarBody {
  const group = new THREE.Group();
  const L = d.lengthM;
  const W = d.widthM;
  const rearOverhang = L - d.wheelbaseM - d.frontOverhangM;
  const zf = L / 2 - BODY_BEVEL;
  const zr = -L / 2 + BODY_BEVEL;
  const axleF = L / 2 - d.frontOverhangM;
  const axleR = -L / 2 + rearOverhang;
  const wheelY = d.wheelRadiusM + 0.02;
  const archR = d.wheelRadiusM + 0.09 + BEVEL;

  // --- Materials.
  const paint = new THREE.MeshPhysicalMaterial({
    color: paintColour.hex,
    metalness: paintColour.metalness,
    roughness: paintColour.roughness,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.1,
  });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a0d11, metalness: 0, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.0, envMapIntensity: 1.5 });
  const pianoBlack = new THREE.MeshPhysicalMaterial({ color: 0x050506, metalness: 0.2, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 });
  const cladding = new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.78, metalness: 0 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 1, roughness: 0.12 });
  const satin = new THREE.MeshStandardMaterial({ color: 0xa8adb2, metalness: 0.9, roughness: 0.35 });
  const lamp = (color: number, emissive: number) =>
    new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 0, roughness: 0.15, metalness: 0.1 });
  const lamps: CarLampMaterials = {
    drl: lamp(0xdfe6ee, 0xeaf3ff),
    headlamp: lamp(0x9aa3ad, 0xfff6e8),
    tail: lamp(0x4a0508, 0xff1a10),
    brake: lamp(0x4a0508, 0xff1a10),
    reverse: lamp(0xbfc3c7, 0xffffff),
    indicatorLeft: lamp(0x6b4a14, 0xff8a00),
    indicatorRight: lamp(0x6b4a14, 0xff8a00),
  };

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  // --- Main body side profile with wheel arches.
  const sill = 0.3;
  const bumperBottom = 0.4;
  const body = new THREE.Shape();
  body.moveTo(zf - 0.06, bumperBottom);
  body.quadraticCurveTo(zf + 0.01, 0.52, zf, 0.66);
  body.quadraticCurveTo(zf - 0.01, 0.82, zf - 0.07, 0.9);
  body.quadraticCurveTo(zf - 0.2, 0.99, zf - 0.55, 1.02);
  body.lineTo(0.92, 1.1);
  body.lineTo(-1.9, 1.12);
  body.quadraticCurveTo(-2.22, 1.12, zr + 0.04, 1.02);
  body.quadraticCurveTo(zr - 0.01, 0.82, zr, 0.6);
  body.quadraticCurveTo(zr + 0.01, 0.45, zr + 0.08, bumperBottom);
  body.lineTo(axleR - archR - 0.02, bumperBottom);
  body.absarc(axleR, wheelY, archR, Math.PI + 0.05, -0.05, true);
  body.lineTo(axleR + archR + 0.08, sill);
  body.lineTo(axleF - archR - 0.08, sill);
  body.lineTo(axleF - archR, wheelY - archR * Math.sin(0.05));
  body.absarc(axleF, wheelY, archR, Math.PI + 0.05, -0.05, true);
  body.lineTo(zf - 0.06, bumperBottom);
  const bodyGeo = warpWidth(extrudeProfile(body, W - 0.02, BODY_BEVEL, 6), bodyTaper, 0.14, 0.45);
  add(bodyGeo, paint);
  const bodyHalf = (y: number) => ((W - 0.02) / 2) * bodyTaper(y);

  // --- Glasshouse (all glass) and painted roof on top of it.
  const glassW = 2 * bodyHalf(1.1) - 0.04;
  const gh = new THREE.Shape();
  gh.moveTo(0.95, 1.06);
  gh.lineTo(0.06, 1.6);
  gh.quadraticCurveTo(-0.12, 1.66, -0.45, 1.66);
  gh.lineTo(-1.85, 1.64);
  gh.quadraticCurveTo(-2.1, 1.63, -2.17, 1.52);
  gh.lineTo(-2.25, 1.08);
  gh.lineTo(0.95, 1.06);
  const ghGeo = warpWidth(extrudeProfile(gh, glassW, 0.07), glassTaper, 0.1, 0.5);
  add(ghGeo, glass);

  const roof = new THREE.Shape();
  roof.moveTo(0.02, 1.62);
  roof.quadraticCurveTo(-0.12, 1.685, -0.45, 1.685);
  roof.lineTo(-1.85, 1.665);
  roof.quadraticCurveTo(-2.1, 1.655, -2.19, 1.54);
  roof.lineTo(-2.12, 1.53);
  roof.quadraticCurveTo(-2.02, 1.62, -1.85, 1.625);
  roof.lineTo(-0.45, 1.645);
  roof.quadraticCurveTo(-0.15, 1.645, 0.02, 1.62);
  const roofGeo = warpWidth(extrudeProfile(roof, glassW + 0.02, 0.07), glassTaper, 0.1, 0.5);
  add(roofGeo, paint);

  // Pillars on the glass sides (black B-pillar, painted D-pillar), leaning with the glass.
  const glassHalf = (y: number) => (glassW / 2) * glassTaper(y);
  const lean = Math.atan2(glassHalf(1.1) - glassHalf(1.6), 0.5);
  for (const sx of [-1, 1]) {
    const b = add(new RoundedBoxGeometry(0.012, 0.5, 0.09, 2, 0.004), pianoBlack);
    b.position.set(sx * (glassHalf(1.36) + 0.002), 1.36, -0.62);
    b.rotation.z = sx * lean;
    const dp = add(new RoundedBoxGeometry(0.02, 0.46, 0.34, 2, 0.008), paint);
    dp.position.set(sx * (glassHalf(1.33) - 0.004), 1.33, -1.78);
    dp.rotation.z = sx * lean;
  }

  // Roof rails.
  for (const sx of [-1, 1]) {
    const rail = add(new RoundedBoxGeometry(0.035, 0.045, 1.7, 2, 0.015), satin);
    rail.position.set(sx * (glassHalf(1.68) - 0.1), 1.71, -1.0);
  }

  // --- Black cladding: wheel-arch flares and sill strips.
  const flare = archFlare(d.wheelRadiusM + 0.09, 0.055, 0.05);
  for (const az of [axleF, axleR]) {
    for (const sx of [-1, 1]) {
      const f = add(flare, cladding);
      f.position.set(sx * (W / 2 - 0.02), wheelY, az);
      if (sx < 0) f.rotation.y = Math.PI;
    }
  }
  for (const sx of [-1, 1]) {
    const s = add(new RoundedBoxGeometry(0.06, 0.12, axleF - axleR - 2 * (archR - BEVEL) - 0.08, 2, 0.025), cladding);
    s.position.set(sx * (bodyHalf(sill) - 0.01), sill + 0.03, (axleF + axleR) / 2);
  }

  // --- Front: grille, connected DRL bar, split headlamps, skid plate.
  const grilleSlats: THREE.BufferGeometry[] = [];
  for (let i = -6; i <= 6; i++) {
    const g = new RoundedBoxGeometry(0.018, 0.26, 0.02, 1, 0.006);
    g.translate(i * 0.075, 0, 0);
    grilleSlats.push(g);
  }
  const grille = add(new RoundedBoxGeometry(1.06, 0.3, 0.06, 3, 0.03), pianoBlack);
  grille.position.set(0, 0.66, L / 2 - 0.015);
  const slats = add(mergeGeometries(grilleSlats), chrome);
  slats.position.set(0, 0.66, L / 2 + 0.012);

  const drl = add(new RoundedBoxGeometry(W * 0.8, 0.025, 0.03, 2, 0.01), lamps.drl, false);
  drl.position.set(0, 0.885, L / 2 - 0.04);
  for (const sx of [-1, 1]) {
    const head = add(new RoundedBoxGeometry(0.3, 0.11, 0.05, 3, 0.03), lamps.headlamp, false);
    head.position.set(sx * 0.6, 0.74, L / 2);
    const ind = add(new RoundedBoxGeometry(0.14, 0.025, 0.03, 2, 0.01), sx > 0 ? lamps.indicatorLeft : lamps.indicatorRight, false);
    ind.position.set(sx * 0.66, 0.835, L / 2 - 0.015);
  }
  const skidF = add(new RoundedBoxGeometry(1.0, 0.08, 0.06, 2, 0.025), satin);
  skidF.position.set(0, 0.43, L / 2 - 0.04);
  const lowerF = add(new RoundedBoxGeometry(W * 0.82, 0.12, 0.08, 2, 0.04), cladding);
  lowerF.position.set(0, 0.5, L / 2 - 0.02);

  // --- Rear: connected tail-lamp bar, corner clusters, reverse lamps, skid plate.
  const tailBar = add(new RoundedBoxGeometry(W * 0.8, 0.035, 0.03, 2, 0.012), lamps.tail, false);
  tailBar.position.set(0, 1.0, -L / 2 + 0.025);
  for (const sx of [-1, 1]) {
    const cluster = add(new RoundedBoxGeometry(0.26, 0.09, 0.05, 3, 0.025), lamps.brake, false);
    cluster.position.set(sx * 0.66, 0.96, -L / 2 + 0.01);
    const ind = add(new RoundedBoxGeometry(0.14, 0.025, 0.03, 2, 0.01), sx > 0 ? lamps.indicatorLeft : lamps.indicatorRight, false);
    ind.position.set(sx * 0.66, 0.9, -L / 2);
    const rev = add(new RoundedBoxGeometry(0.12, 0.04, 0.03, 2, 0.012), lamps.reverse, false);
    rev.position.set(sx * 0.6, 0.5, -L / 2);
  }
  const skidR = add(new RoundedBoxGeometry(0.9, 0.07, 0.06, 2, 0.025), satin);
  skidR.position.set(0, 0.44, -L / 2 + 0.03);
  const lowerR = add(new RoundedBoxGeometry(W * 0.82, 0.12, 0.08, 2, 0.04), cladding);
  lowerR.position.set(0, 0.52, -L / 2 + 0.03);

  // --- Mirrors (with indicator strips) and flush door handles.
  for (const sx of [-1, 1]) {
    const housing = add(new RoundedBoxGeometry(0.2, 0.12, 0.1, 3, 0.04), paint);
    const mx = bodyHalf(1.15);
    housing.position.set(sx * (mx + 0.11), 1.17, 0.78);
    const stalk = add(new RoundedBoxGeometry(0.12, 0.04, 0.06, 2, 0.015), pianoBlack);
    stalk.position.set(sx * (mx + 0.02), 1.13, 0.8);
    const ind = add(new RoundedBoxGeometry(0.12, 0.012, 0.02, 1, 0.005), sx > 0 ? lamps.indicatorLeft : lamps.indicatorRight, false);
    ind.position.set(sx * (mx + 0.13), 1.13, 0.83);
    for (const hz of [0.3, -0.75]) {
      const h = add(new RoundedBoxGeometry(0.012, 0.025, 0.16, 1, 0.005), chrome, false);
      h.position.set(sx * (bodyHalf(1.0) + 0.002), 1.0, hz);
    }
  }

  return { group, paint, lamps };
}

/** Half-ring flare around a wheel arch (in the Z-Y plane, thin in X). */
function archFlare(innerR: number, widthR: number, thickness: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const a0 = -0.12;
  const a1 = Math.PI + 0.12;
  s.absarc(0, 0, innerR + widthR, a0, a1, false);
  s.absarc(0, 0, innerR, a1, a0, true);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelSegments: 3,
    curveSegments: 32,
  });
  g.rotateY(Math.PI / 2); // shape X -> car -Z... extrusion -> +X
  g.translate(-thickness / 2, 0, 0);
  return g;
}

export interface WheelParts {
  /** Steering pivot (rotates about Y). Holds the caliper and the spinning group. */
  pivot: THREE.Group;
  /** Spinning group (rotates about X). */
  spin: THREE.Group;
}

let sharedWheel: { tyre: THREE.BufferGeometry; rim: THREE.BufferGeometry; barrel: THREE.BufferGeometry; disc: THREE.BufferGeometry; caliper: THREE.BufferGeometry; cap: THREE.BufferGeometry } | null = null;
let sharedWheelMats: { rubber: THREE.Material; alloy: THREE.Material; alloyDark: THREE.Material; disc: THREE.Material; caliper: THREE.Material } | null = null;

/** Tyre with rounded shoulders, 5 twin-spoke alloy, brake disc and caliper. Outer face points +X. */
export function buildWheel(d: CarDimensions, outwardSign: 1 | -1): WheelParts {
  const r = d.wheelRadiusM;
  const w = d.wheelWidthM;
  const rimR = 0.2413; // 19 inch
  if (!sharedWheel) {
    const hw = w / 2;
    const tyreProfile = [
      new THREE.Vector2(rimR - 0.005, -hw + 0.012),
      new THREE.Vector2(rimR + 0.03, -hw),
      new THREE.Vector2(r - 0.035, -hw + 0.004),
      new THREE.Vector2(r - 0.008, -hw + 0.022),
      new THREE.Vector2(r, -hw + 0.05),
      new THREE.Vector2(r, hw - 0.05),
      new THREE.Vector2(r - 0.008, hw - 0.022),
      new THREE.Vector2(r - 0.035, hw - 0.004),
      new THREE.Vector2(rimR + 0.03, hw),
      new THREE.Vector2(rimR - 0.005, hw - 0.012),
    ];
    const tyre = new THREE.LatheGeometry(tyreProfile, 48);
    tyre.rotateZ(-Math.PI / 2); // lathe axis Y -> X

    // Alloy face: disc with spoke windows, extruded with a soft bevel.
    const face = new THREE.Shape();
    face.absarc(0, 0, rimR - 0.004, 0, Math.PI * 2, false);
    const spokes = 5;
    for (let i = 0; i < spokes; i++) {
      for (const half of [-1, 1]) {
        const c = (i / spokes) * Math.PI * 2 + half * 0.2;
        const span = 0.21;
        const hole = new THREE.Path();
        hole.absarc(0, 0, rimR - 0.03, c - span / 2, c + span / 2, false);
        hole.absarc(0, 0, 0.085, c + span / 2 + 0.05, c - span / 2 - 0.05, true);
        hole.closePath();
        face.holes.push(hole);
      }
    }
    const rim = new THREE.ExtrudeGeometry(face, { depth: 0.025, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.008, bevelSegments: 3, curveSegments: 40 });
    rim.rotateY(Math.PI / 2); // face normal -> +X
    rim.translate(w / 2 - 0.05, 0, 0);

    const barrel = new THREE.CylinderGeometry(rimR - 0.006, rimR - 0.006, w - 0.03, 40, 1, true);
    barrel.rotateZ(Math.PI / 2);
    const disc = new THREE.CylinderGeometry(0.17, 0.17, 0.026, 40);
    disc.rotateZ(Math.PI / 2);
    disc.translate(w / 2 - 0.12, 0, 0);
    const cap = new THREE.CylinderGeometry(0.03, 0.032, 0.02, 24);
    cap.rotateZ(Math.PI / 2);
    cap.translate(w / 2 - 0.02, 0, 0);
    const caliper = new RoundedBoxGeometry(0.06, 0.12, 0.16, 2, 0.02);
    caliper.translate(w / 2 - 0.12, 0.12, -0.06);
    sharedWheel = { tyre, rim, barrel, disc, caliper, cap };
    sharedWheelMats = {
      rubber: new THREE.MeshStandardMaterial({ color: 0x1a1a1b, roughness: 0.88, metalness: 0 }),
      alloy: new THREE.MeshPhysicalMaterial({ color: 0xc9ccd0, metalness: 0.95, roughness: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.1 }),
      alloyDark: new THREE.MeshStandardMaterial({ color: 0x2d2f33, metalness: 0.8, roughness: 0.45 }),
      disc: new THREE.MeshStandardMaterial({ color: 0x8a8c8f, metalness: 0.9, roughness: 0.5 }),
      caliper: new THREE.MeshStandardMaterial({ color: 0x1f1f22, metalness: 0.4, roughness: 0.5 }),
    };
  }
  const g = sharedWheel;
  const mats = sharedWheelMats!;

  const pivot = new THREE.Group();
  const spin = new THREE.Group();
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
  };
  mk(g.tyre, mats.rubber, spin);
  mk(g.rim, mats.alloy, spin);
  mk(g.barrel, mats.alloyDark, spin);
  mk(g.disc, mats.disc, spin);
  mk(g.cap, mats.alloy, spin);
  mk(g.caliper, mats.caliper, pivot);
  pivot.add(spin);
  if (outwardSign < 0) pivot.scale.x = -1; // mirror so the alloy face points outward on the right side
  return { pivot, spin };
}
