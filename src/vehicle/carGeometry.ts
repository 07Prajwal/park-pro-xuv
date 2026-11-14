/**
 * XUV 7XO exterior and wheel geometry, sized from CarDimensions.
 *
 * The lower body is a lofted surface (see bodyLoft.ts) with an open cabin; the
 * glasshouse and roof sit on the beltline. Details follow the XUV 7XO: slim
 * upper lamps joined by a full-width LED bar, lower projector headlamps, a large
 * studded grille, connected tail-lamp bar, blacked-out B-pillars, roof rails,
 * flush door handles, black wheel-arch cladding and Indian number plates.
 *
 * Local frame: +Z forward, +Y up, +X left; origin on the ground at the middle of
 * the footprint (VehicleVisual offsets it to the physics origin between the axles).
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CarDimensions, PaintColour } from '../config';
import { buildLoftedBody } from './bodyLoft';

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
  /** Inner half-width of the cabin and roof height, for fitting the interior. */
  cabinHalfWidth: number;
  roofY: number;
  paint: THREE.MeshPhysicalMaterial;
  lamps: CarLampMaterials;
  /** Headlamp centres (body frame), for attaching the real light sources. */
  headlampPositions: THREE.Vector3[];
  /** Outer mirror glass centres (body frame), for the mirror cameras. */
  mirrorPositions: THREE.Vector3[];
}

/** Glasshouse half-width factor by height (inward lean of the side glass). */
function glassTaper(y: number): number {
  return 1 - 0.18 * Math.min(Math.max((y - 1.06) / 0.6, 0), 1);
}

/**
 * Narrow an extruded slab by height and round its ends in plan view, with welded
 * vertices so it shades smoothly (extrusions are flat-shaded by default).
 */
function warpWidth(src: THREE.BufferGeometry, taper: (y: number) => number, endRound: number, endLen: number): THREE.BufferGeometry {
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
  return g;
}

/** White Indian private-registration plate texture. */
function plateTexture(text: string): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4f4f0';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#111';
  g.lineWidth = 6;
  g.strokeRect(6, 6, 500, 116);
  g.fillStyle = '#111';
  g.font = 'bold 78px "Arial Narrow", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 262, 68);
  g.font = 'bold 22px Arial, sans-serif';
  g.fillStyle = '#1a3a8a';
  g.fillText('IND', 34, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildCarBody(d: CarDimensions, paintColour: PaintColour): CarBody {
  const group = new THREE.Group();
  const L = d.lengthM;
  const W = d.widthM;
  const rearOverhang = L - d.wheelbaseM - d.frontOverhangM;
  const axleF = L / 2 - d.frontOverhangM;
  const axleR = -L / 2 + rearOverhang;
  const wheelY = d.wheelRadiusM + 0.02;
  const zF = L / 2;
  const zR = -L / 2;

  // --- Materials.
  const paint = new THREE.MeshPhysicalMaterial({
    color: paintColour.hex,
    metalness: paintColour.metalness,
    roughness: paintColour.roughness,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.1,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x0b0e12,
    metalness: 0,
    roughness: 0.02,
    transparent: true,
    opacity: 0.78,
    envMapIntensity: 1.6,
    depthWrite: false,
  });
  const pianoBlack = new THREE.MeshPhysicalMaterial({ color: 0x050506, metalness: 0.2, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 });
  const cladding = new THREE.MeshStandardMaterial({ color: 0x151618, roughness: 0.82, metalness: 0 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.75, metalness: 0 });
  const seam = new THREE.MeshStandardMaterial({ color: 0x070707, roughness: 0.9, metalness: 0 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 1, roughness: 0.12 });
  const satin = new THREE.MeshStandardMaterial({ color: 0xa8adb2, metalness: 0.9, roughness: 0.35 });
  const lensClear = new THREE.MeshPhysicalMaterial({ color: 0x20252b, metalness: 0.6, roughness: 0.08, clearcoat: 1 });
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
  const box = (w: number, h: number, dz: number, r: number, mat: THREE.Material, x: number, y: number, z: number, shadow = true) => {
    const m = add(new RoundedBoxGeometry(w, h, dz, 2, r), mat, shadow);
    m.position.set(x, y, z);
    return m;
  };

  // --- Lofted lower body with open cabin.
  const loft = buildLoftedBody(d);
  add(loft.paint, paint);
  add(loft.trim, trim);
  add(loft.cladding, cladding);
  add(loft.shutLines, seam, false);

  // --- Glasshouse (all glass) and painted roof on top of it.
  const glassW = 2 * (loft.sideX(0, 1.0) - 0.035);
  const gh = new THREE.Shape();
  gh.moveTo(0.95, 1.05);
  gh.lineTo(0.06, 1.6);
  gh.quadraticCurveTo(-0.12, 1.66, -0.45, 1.66);
  gh.lineTo(-1.85, 1.64);
  gh.quadraticCurveTo(-2.1, 1.63, -2.17, 1.52);
  gh.lineTo(-2.25, 1.07);
  gh.lineTo(0.95, 1.05);
  add(warpWidth(extrudeProfile(gh, glassW, 0.06), glassTaper, 0.06, 0.5), glass, false);

  const roof = new THREE.Shape();
  roof.moveTo(0.02, 1.62);
  roof.quadraticCurveTo(-0.12, 1.685, -0.45, 1.685);
  roof.lineTo(-1.85, 1.665);
  roof.quadraticCurveTo(-2.1, 1.655, -2.19, 1.54);
  roof.lineTo(-2.12, 1.53);
  roof.quadraticCurveTo(-2.02, 1.62, -1.85, 1.625);
  roof.lineTo(-0.45, 1.645);
  roof.quadraticCurveTo(-0.15, 1.645, 0.02, 1.62);
  add(warpWidth(extrudeProfile(roof, glassW + 0.02, 0.06), glassTaper, 0.06, 0.5), paint);

  // Blacked-out A-, B- and D-pillars give the floating-roof look (A-pillars are also visible from inside).
  const glassHalf = (y: number) => (glassW / 2) * glassTaper(y);
  for (const sx of [-1, 1]) {
    const pts = [
      new THREE.Vector3(sx * (glassHalf(1.06) * 0.95 - 0.01), 1.06, 0.93),
      new THREE.Vector3(sx * (glassHalf(1.33) * 0.98 - 0.015), 1.34, 0.5),
      new THREE.Vector3(sx * (glassHalf(1.6) - 0.02), 1.61, 0.05),
      new THREE.Vector3(sx * (glassHalf(1.66) - 0.03), 1.665, -0.25),
    ];
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.032, 10, false), pianoBlack);
  }
  const lean = Math.atan2(glassHalf(1.1) - glassHalf(1.6), 0.5);
  for (const sx of [-1, 1]) {
    const b = box(0.012, 0.52, 0.1, 0.004, pianoBlack, sx * (glassHalf(1.36) + 0.003), 1.36, -0.62);
    b.rotation.z = sx * lean;
    const dp = box(0.02, 0.46, 0.34, 0.008, pianoBlack, sx * (glassHalf(1.33) - 0.004), 1.33, -1.78);
    dp.rotation.z = sx * lean;
  }
  for (const sx of [-1, 1]) {
    box(0.035, 0.045, 1.7, 0.015, satin, sx * (glassHalf(1.68) - 0.1), 1.71, -1.0);
  }

  // --- Black wheel-arch flares and sill cladding.
  const flare = archFlare(d.wheelRadiusM + 0.07, 0.06, 0.04);
  for (const az of [axleF, axleR]) {
    for (const sx of [-1, 1]) {
      const f = add(flare, cladding);
      f.position.set(sx * (loft.sideX(az, wheelY + 0.3) - 0.005), wheelY, az);
      if (sx < 0) f.rotation.y = Math.PI;
    }
  }
  const sillLen = axleF - axleR - 2 * (d.wheelRadiusM + 0.07) - 0.12;
  for (const sx of [-1, 1]) {
    box(0.05, 0.1, sillLen, 0.02, cladding, sx * (loft.sideX(0, 0.4) - 0.012), 0.38, (axleF + axleR) / 2);
  }

  // --- Front: upper LED bar and slim lamps, studded grille, lower projector headlamps.
  const fz = zF;
  box(W * 0.74, 0.022, 0.03, 0.01, lamps.drl, 0, 0.838, fz - 0.004, false);
  const headlampPositions: THREE.Vector3[] = [];
  for (const sx of [-1, 1]) {
    box(0.3, 0.05, 0.04, 0.02, lensClear, sx * 0.6, 0.8, fz - 0.006, false);
    box(0.13, 0.02, 0.03, 0.009, sx > 0 ? lamps.indicatorLeft : lamps.indicatorRight, sx * 0.66, 0.805, fz + 0.012, false);
    // Lower projector cluster: three lenses in a dark housing.
    box(0.26, 0.1, 0.04, 0.03, pianoBlack, sx * 0.64, 0.6, fz - 0.005, false);
    for (let i = 0; i < 3; i++) {
      const lens = add(new THREE.CylinderGeometry(0.026, 0.026, 0.02, 20), lamps.headlamp, false);
      lens.rotation.x = Math.PI / 2;
      lens.position.set(sx * (0.55 + i * 0.075), 0.6, fz + 0.018);
    }
    headlampPositions.push(new THREE.Vector3(sx * 0.62, 0.6, fz + 0.05));
  }
  // Grille: piano-black frame with a grid of chrome studs.
  box(1.02, 0.28, 0.05, 0.03, pianoBlack, 0, 0.66, fz - 0.005);
  const studs: THREE.BufferGeometry[] = [];
  for (let r = 0; r < 4; r++) {
    for (let c = -7; c <= 7; c++) {
      const g = new THREE.SphereGeometry(0.011, 8, 6);
      g.translate(c * 0.062 + (r % 2) * 0.031, 0.565 + r * 0.062, fz + 0.022);
      studs.push(g);
    }
  }
  add(mergeGeometries(studs), chrome, false);
  box(0.16, 0.05, 0.02, 0.01, chrome, 0, 0.665, fz + 0.03, false); // badge
  box(1.24, 0.09, 0.05, 0.03, pianoBlack, 0, 0.47, fz - 0.01);
  box(0.95, 0.05, 0.05, 0.02, satin, 0, 0.39, fz - 0.02);

  // --- Rear: connected tail bar, C-shaped clusters, reverse lamps, skid plate.
  const rz = zR;
  box(W * 0.72, 0.03, 0.03, 0.012, lamps.tail, 0, 0.94, rz + 0.004, false);
  for (const sx of [-1, 1]) {
    box(0.24, 0.08, 0.04, 0.025, lamps.brake, sx * 0.64, 0.9, rz - 0.004, false);
    box(0.12, 0.022, 0.03, 0.01, sx > 0 ? lamps.indicatorLeft : lamps.indicatorRight, sx * 0.64, 0.84, rz - 0.01, false);
    box(0.12, 0.04, 0.03, 0.012, lamps.reverse, sx * 0.6, 0.5, rz - 0.01, false);
  }
  box(0.9, 0.07, 0.05, 0.025, satin, 0, 0.42, rz + 0.01);
  box(W * 0.8, 0.1, 0.06, 0.03, cladding, 0, 0.5, rz + 0.02);

  // --- Number plates (front on the lower intake, rear on the tailgate).
  const plateTex = plateTexture('MH 01 XU 7070');
  const plateMat = new THREE.MeshStandardMaterial({ map: plateTex, color: plateTex ? 0xffffff : 0xf0f0ea, roughness: 0.4, metalness: 0.1 });
  const plateGeo = new THREE.PlaneGeometry(0.5, 0.12);
  const fp = add(plateGeo, plateMat, false);
  fp.position.set(0, 0.47, fz + 0.019);
  const rp = add(plateGeo, plateMat, false);
  rp.position.set(0, 0.7, rz - 0.003);
  rp.rotation.y = Math.PI;

  // --- Mirrors (with indicator strips) and flush door handles.
  const mirrorPositions: THREE.Vector3[] = [];
  for (const sx of [-1, 1]) {
    const mx = loft.sideX(0.8, 1.0);
    box(0.2, 0.12, 0.1, 0.04, paint, sx * (mx + 0.11), 1.17, 0.78);
    box(0.12, 0.04, 0.06, 0.015, pianoBlack, sx * (mx + 0.02), 1.13, 0.8);
    box(0.12, 0.012, 0.02, 0.005, sx > 0 ? lamps.indicatorLeft : lamps.indicatorRight, sx * (mx + 0.13), 1.13, 0.83, false);
    box(0.17, 0.09, 0.005, 0.003, chrome, sx * (mx + 0.11), 1.17, 0.727, false);
    mirrorPositions.push(new THREE.Vector3(sx * (mx + 0.11), 1.17, 0.72));
    for (const hz of [0.3, -0.85]) {
      box(0.012, 0.025, 0.16, 0.005, chrome, sx * (loft.sideX(hz, 1.0) + 0.002), 1.0, hz, false);
    }
  }

  return { group, paint, lamps, headlampPositions, mirrorPositions, cabinHalfWidth: loft.sideX(0, 0.9) - 0.09, roofY: 1.645 };
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
  g.rotateY(Math.PI / 2);
  g.translate(-thickness / 2, 0, 0);
  return g;
}

export interface WheelParts {
  /** Steering pivot (rotates about Y). Holds the caliper and the spinning group. */
  pivot: THREE.Group;
  /** Spinning group (rotates about X). */
  spin: THREE.Group;
}

type WheelGeometry = { tyre: THREE.BufferGeometry; rim: THREE.BufferGeometry; barrel: THREE.BufferGeometry; disc: THREE.BufferGeometry; caliper: THREE.BufferGeometry; cap: THREE.BufferGeometry };
/** 'high' for the player's car; 'low' (about a tenth of the triangles) for instanced parked cars. */
export type WheelDetail = 'high' | 'low';
const sharedWheel: Partial<Record<WheelDetail, WheelGeometry>> = {};
let sharedWheelMats: { rubber: THREE.Material; alloy: THREE.Material; alloyDark: THREE.Material; pocket: THREE.Material; disc: THREE.Material; caliper: THREE.Material } | null = null;

/** Tyre with rounded shoulders, 5 twin-spoke alloy, brake disc and caliper. Outer face points +X. */
export function buildWheel(d: CarDimensions, outwardSign: 1 | -1, detail: WheelDetail = 'high'): WheelParts {
  const r = d.wheelRadiusM;
  const w = d.wheelWidthM;
  const rimR = 0.2413; // 19 inch
  const hi = detail === 'high';
  if (!sharedWheel[detail]) {
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
    const tyre = new THREE.LatheGeometry(tyreProfile, hi ? 48 : 24);
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
    const rim = new THREE.ExtrudeGeometry(face, {
      depth: 0.025,
      bevelEnabled: true,
      bevelThickness: 0.01,
      bevelSize: 0.008,
      bevelSegments: hi ? 3 : 1,
      curveSegments: hi ? 40 : 8,
    });
    rim.rotateY(Math.PI / 2); // face normal -> +X
    rim.translate(w / 2 - 0.05, 0, 0);

    const barrel = new THREE.CylinderGeometry(rimR - 0.006, rimR - 0.006, w - 0.03, hi ? 40 : 20, 1, true);
    barrel.rotateZ(Math.PI / 2);
    const disc = new THREE.CylinderGeometry(0.17, 0.17, 0.026, 40);
    disc.rotateZ(Math.PI / 2);
    disc.translate(w / 2 - 0.12, 0, 0);
    const cap = new THREE.CylinderGeometry(0.03, 0.032, 0.02, 24);
    cap.rotateZ(Math.PI / 2);
    cap.translate(w / 2 - 0.02, 0, 0);
    const caliper = new RoundedBoxGeometry(0.06, 0.12, 0.16, 2, 0.02);
    caliper.translate(w / 2 - 0.12, 0.12, -0.06);
    sharedWheel[detail] = { tyre, rim, barrel, disc, caliper, cap };
    sharedWheelMats ??= {
      rubber: new THREE.MeshStandardMaterial({ color: 0x1a1a1b, roughness: 0.88, metalness: 0 }),
      alloy: new THREE.MeshPhysicalMaterial({ color: 0xc9ccd0, metalness: 0.95, roughness: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.1 }),
      alloyDark: new THREE.MeshStandardMaterial({ color: 0x2d2f33, metalness: 0.8, roughness: 0.45 }),
      pocket: new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.7, roughness: 0.4 }),
      disc: new THREE.MeshStandardMaterial({ color: 0x8a8c8f, metalness: 0.9, roughness: 0.5 }),
      caliper: new THREE.MeshStandardMaterial({ color: 0x1f1f22, metalness: 0.4, roughness: 0.5 }),
    };
  }
  const g = sharedWheel[detail]!;
  const mats = sharedWheelMats!;

  const pivot = new THREE.Group();
  const spin = new THREE.Group();
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], parent: THREE.Object3D) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
  };
  mk(g.tyre, mats.rubber, spin);
  mk(g.rim, [mats.alloy, mats.pocket], spin); // diamond-cut: machined spoke faces, gunmetal sides
  mk(g.barrel, mats.alloyDark, spin);
  mk(g.disc, mats.disc, spin);
  mk(g.cap, mats.alloy, spin);
  mk(g.caliper, mats.caliper, pivot);
  pivot.add(spin);
  if (outwardSign < 0) pivot.scale.x = -1; // mirror so the alloy face points outward on the right side
  return { pivot, spin };
}
