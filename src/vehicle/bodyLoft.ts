/**
 * Lofted SUV lower body: a single smooth surface swept through ~300 cross-sections
 * along the car's length, like a real car's class-A surface.
 *
 * Every cross-section ring has the same number of points, so the surface is one
 * continuous grid with smooth normals. The ring describes (left half, mirrored):
 * underbody -> wheel-well wall -> sill -> side wall (with shoulder and
 * tumblehome) -> either the bonnet/boot top or, along the cabin, a "tub" that
 * dips down to the floor so the interior is open beneath the glasshouse.
 * Wheel arches come from the side wall's lower edge rising over each wheel.
 *
 * Frame: +Z forward, +Y up, +X left; origin on the ground at the centre of the footprint.
 */

import * as THREE from 'three';
import type { CarDimensions } from '../config';

/** Monotone cubic interpolation through (z, value) keys sorted by z (no overshoot). */
function curve(keys: [number, number][]): (z: number) => number {
  const n = keys.length;
  const xs = keys.map((k) => k[0]);
  const ys = keys.map((k) => k[1]);
  const d: number[] = [];
  const m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (z: number) => {
    if (z <= xs[0]) return ys[0];
    if (z >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (z > xs[i + 1]) i++;
    const hh = xs[i + 1] - xs[i];
    const t = (z - xs[i]) / hh;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * hh * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * hh * m[i + 1]
    );
  };
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

const SIDE_POINTS = 9;
const TOP_POINTS = 10;
/** Left-half ring layout: 4 underbody/well/sill points, side wall, top or tub. */
const HALF = 4 + SIDE_POINTS + TOP_POINTS;
const RING = HALF * 2 - 2;
/** First half-ring index of the side wall and of the top/tub. */
const SIDE0 = 4;
const TOP0 = SIDE0 + SIDE_POINTS;
/** Quads starting at or after this half-ring index are interior trim inside the cabin. */
const TRIM0 = TOP0 + 2;
/** Quads before this half-ring index are black underbody / sill cladding. */
const CLAD_END = SIDE0 + 1;

export interface LoftedBody {
  paint: THREE.BufferGeometry;
  trim: THREE.BufferGeometry;
  cladding: THREE.BufferGeometry;
  /** Thin dark door shut lines. */
  shutLines: THREE.BufferGeometry;
  /** Outer half-width of the side wall at (z, y), for placing details on the surface. */
  sideX(z: number, y: number): number;
  /** Height of the top surface (bonnet / beltline / boot) at z. */
  topY(z: number): number;
  /** Z of the front / rear face at mid-bumper height. */
  frontZ: number;
  rearZ: number;
}

export function buildLoftedBody(d: CarDimensions): LoftedBody {
  const L = d.lengthM;
  const zF = L / 2;
  const zR = -L / 2;
  const rearOverhang = L - d.wheelbaseM - d.frontOverhangM;
  const axleF = zF - d.frontOverhangM;
  const axleR = zR + rearOverhang;
  const wheelY = d.wheelRadiusM + 0.02;
  const archR = d.wheelRadiusM + 0.07;
  const wellX = d.trackFrontM / 2 - d.wheelWidthM / 2 - 0.05;
  const hwMax = d.widthM / 2 - 0.005;
  const floorY = 0.5;
  const cabinFront = 0.9;
  const cabinRear = zR + 0.12;

  const top = curve([
    [zR, 0.98],
    [zR + 0.035, 1.05],
    [zR + 0.12, 1.09],
    [-1.6, 1.11],
    [0.9, 1.08],
    [1.5, 1.04],
    [zF - 0.32, 1.0],
    [zF - 0.1, 0.96],
    [zF - 0.025, 0.92],
    [zF, 0.86],
  ]);
  const bottom = curve([
    [zR, 0.52],
    [zR + 0.05, 0.42],
    [axleR - 0.3, 0.4],
    [axleR + 0.3, 0.31],
    [axleF - 0.3, 0.31],
    [axleF + 0.3, 0.4],
    [zF - 0.05, 0.4],
    [zF, 0.5],
  ]);
  const under = curve([
    [zR, 0.36],
    [zR + 0.4, 0.27],
    [zF - 0.4, 0.25],
    [zF, 0.34],
  ]);
  const halfW = curve([
    [zR, 0.8],
    [zR + 0.035, 0.87],
    [zR + 0.14, 0.92],
    [zR + 0.4, hwMax],
    [zF - 0.5, hwMax],
    [zF - 0.2, 0.925],
    [zF - 0.05, 0.885],
    [zF, 0.8],
  ]);
  const cabin = (z: number) => smoothstep(cabinFront + 0.03, cabinFront, z) * smoothstep(cabinRear - 0.04, cabinRear, z);

  const archTop = (z: number) => {
    let y = -Infinity;
    for (const a of [axleF, axleR]) {
      const dz = z - a;
      if (Math.abs(dz) < archR) y = Math.max(y, wheelY + Math.sqrt(archR * archR - dz * dz));
    }
    return y;
  };

  /** Side wall half-width factor by normalised height t (0 = sill, 1 = shoulder). */
  const sideF = (t: number) =>
    t <= 0.75 ? 0.955 + 0.045 * Math.sin((Math.PI / 2) * (t / 0.75)) : 1 - 0.035 * ((t - 0.75) / 0.25) ** 2;

  /** Left-half ring at z (x >= 0), written into `out` as [x0, y0, x1, y1, ...]. */
  function halfRing(z: number, out: Float64Array): void {
    const hw = halfW(z);
    const yTop = top(z);
    const arch = archTop(z);
    const sideBot = Math.max(bottom(z), arch);
    const yU = Math.min(under(z), sideBot);
    const yS = yTop - 0.07;
    const c = cabin(z);
    let k = 0;
    const put = (x: number, y: number) => {
      out[k++] = x;
      out[k++] = y;
    };
    put(0, yU);
    put(wellX, yU);
    put(wellX, sideBot);
    put(hw * 0.93, sideBot);
    for (let j = 0; j < SIDE_POINTS; j++) {
      const t = j / (SIDE_POINTS - 1);
      const y = sideBot + 0.03 + t * (yS - sideBot - 0.03);
      put(hw * sideF(t), y);
    }
    const xs = hw * sideF(1);
    const floorSide = Math.max(floorY, arch + 0.03);
    const tub: [number, number][] = [
      [xs * 0.995, yS + (yTop - yS) * 0.6],
      [xs - 0.025, yTop],
      [xs - 0.06, yTop - 0.005],
      [xs - 0.075, yTop - 0.06],
      [xs - 0.085, (yTop + floorSide) / 2],
      [xs - 0.085, floorSide + 0.04],
      [xs - 0.11, floorSide],
      [wellX - 0.03, floorSide],
      [wellX - 0.03, floorY],
      [0, floorY],
    ];
    const n = 5; // superellipse exponent: flat bonnet with rounded shoulder
    for (let j = 1; j <= TOP_POINTS; j++) {
      const phi = (j / TOP_POINTS) * (Math.PI / 2);
      const tx = j === TOP_POINTS ? 0 : xs * Math.pow(Math.cos(phi), 2 / n);
      const ty = yS + (yTop - yS) * Math.pow(Math.sin(phi), 2 / n);
      const [ux, uy] = tub[j - 1];
      put(tx + (ux - tx) * c, ty + (uy - ty) * c);
    }
  }

  // Section positions: dense at the ends, plus exact samples around each wheel arch.
  const zs: number[] = [];
  const NZ = 240;
  for (let j = 0; j < NZ; j++) {
    const u = j / (NZ - 1);
    zs.push(zR + L * (u - (0.6 * Math.sin(2 * Math.PI * u)) / (2 * Math.PI)));
  }
  for (const a of [axleF, axleR]) {
    for (let i = 0; i <= 40; i++) {
      const ang = (i / 40) * Math.PI;
      zs.push(a + archR * Math.cos(ang) * 0.999);
    }
  }
  for (const zc of [cabinFront, cabinFront + 0.03, cabinRear, cabinRear - 0.04]) zs.push(zc);
  zs.sort((a, b) => a - b);
  const sections = zs.filter((z, i) => i === 0 || z - zs[i - 1] > 1e-4);
  const S = sections.length;

  const ringBuf = new Float64Array(HALF * 2);
  const pos = new Float32Array(S * RING * 3);
  for (let j = 0; j < S; j++) {
    const z = sections[j];
    halfRing(z, ringBuf);
    for (let r = 0; r < RING; r++) {
      // Ring order: left half (index 0..HALF-1, bottom centre to top centre), then the
      // mirrored right half back down (excluding the shared centre points).
      const h = r < HALF ? r : RING - r;
      const sx = r < HALF ? 1 : -1;
      const o = (j * RING + r) * 3;
      pos[o] = sx * ringBuf[h * 2];
      pos[o + 1] = ringBuf[h * 2 + 1];
      pos[o + 2] = z;
    }
  }

  const paintIdx: number[] = [];
  const trimIdx: number[] = [];
  const cladIdx: number[] = [];
  for (let j = 0; j < S - 1; j++) {
    const inCabin = cabin(sections[j]) > 0.5 && cabin(sections[j + 1]) > 0.5;
    for (let r = 0; r < RING; r++) {
      const r1 = (r + 1) % RING;
      // Half-ring index of this quad's lower edge (mirrored for the right half).
      const h = r < HALF - 1 ? r : RING - r1;
      const a = j * RING + r;
      const b = j * RING + r1;
      const c = (j + 1) * RING + r;
      const e = (j + 1) * RING + r1;
      const list = h < CLAD_END ? cladIdx : inCabin && h >= TRIM0 ? trimIdx : paintIdx;
      list.push(a, b, c, b, e, c);
    }
  }

  const make = (index: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(index);
    return g;
  };
  // Shared position buffer: compute smooth normals once over the whole surface.
  const all = make([...paintIdx, ...trimIdx, ...cladIdx]);
  all.computeVertexNormals();
  const normal = all.getAttribute('normal');
  const withNormals = (index: number[]) => {
    const g = make(index);
    g.setAttribute('normal', normal);
    return g;
  };

  const paint = mergeCaps(withNormals(paintIdx), pos, 0, S - 1);
  const trim = withNormals(trimIdx);
  const cladding = withNormals(cladIdx);

  // Side-wall x at (z, y) by interpolating the ring's side points.
  function sideX(z: number, y: number): number {
    halfRing(z, ringBuf);
    for (let i = SIDE0; i < TOP0 - 1; i++) {
      const y0 = ringBuf[i * 2 + 1];
      const y1 = ringBuf[(i + 1) * 2 + 1];
      if (y >= y0 && y <= y1) {
        const t = (y - y0) / (y1 - y0 || 1);
        return ringBuf[i * 2] + (ringBuf[(i + 1) * 2] - ringBuf[i * 2]) * t;
      }
    }
    return y < ringBuf[SIDE0 * 2 + 1] ? ringBuf[SIDE0 * 2] : ringBuf[(TOP0 - 1) * 2];
  }

  // Door shut lines: B-pillar line, front door leading edge, rear door trailing edge.
  const lines: THREE.BufferGeometry[] = [];
  for (const zl of [cabinFront - 0.02, -0.62, -1.5]) {
    const yLow = Math.max(bottom(zl), archTop(zl)) + 0.05;
    const yHigh = top(zl) - 0.02;
    const segs = 14;
    const p: number[] = [];
    const idx: number[] = [];
    for (const sx of [1, -1]) {
      const base = p.length / 3;
      for (let i = 0; i <= segs; i++) {
        const y = yLow + ((yHigh - yLow) * i) / segs;
        const x = sideX(zl, y) + 0.0015;
        p.push(sx * x, y, zl - 0.002, sx * x, y, zl + 0.002);
        if (i < segs) {
          const a = base + i * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    lines.push(g);
  }
  const shutLines = mergeAll(lines);

  return { paint, trim, cladding, shutLines, sideX, topY: top, frontZ: zF, rearZ: zR };
}

/** Add flat end caps (own vertices with flat normals) to the painted surface. */
function mergeCaps(surface: THREE.BufferGeometry, pos: Float32Array, first: number, last: number): THREE.BufferGeometry {
  const caps: THREE.BufferGeometry[] = [];
  for (const [j, dir] of [
    [first, -1],
    [last, 1],
  ] as const) {
    const p: number[] = [];
    let cx = 0;
    let cy = 0;
    for (let r = 0; r < RING; r++) {
      const o = (j * RING + r) * 3;
      cx += pos[o];
      cy += pos[o + 1];
    }
    cx /= RING;
    cy /= RING;
    const z = pos[j * RING * 3 + 2];
    const idx: number[] = [];
    p.push(cx, cy, z);
    for (let r = 0; r < RING; r++) {
      const o = (j * RING + r) * 3;
      p.push(pos[o], pos[o + 1], z);
      const a = 1 + r;
      const b = 1 + ((r + 1) % RING);
      if (dir > 0) idx.push(0, a, b);
      else idx.push(0, b, a);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    caps.push(g);
  }
  // Surface + caps into one indexed geometry.
  return mergeAll([surface, ...caps]);
}

function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let vCount = 0;
  let iCount = 0;
  for (const g of geos) {
    vCount += g.getAttribute('position').count;
    iCount += g.getIndex()!.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const index = new Uint32Array(iCount);
  let vo = 0;
  let io = 0;
  for (const g of geos) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos[(vo + i) * 3] = p.getX(i);
      pos[(vo + i) * 3 + 1] = p.getY(i);
      pos[(vo + i) * 3 + 2] = p.getZ(i);
      nor[(vo + i) * 3] = n.getX(i);
      nor[(vo + i) * 3 + 1] = n.getY(i);
      nor[(vo + i) * 3 + 2] = n.getZ(i);
    }
    const idx = g.getIndex()!;
    for (let i = 0; i < idx.count; i++) index[io + i] = idx.getX(i) + vo;
    vo += p.count;
    io += idx.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}
