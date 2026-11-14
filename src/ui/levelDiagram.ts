/**
 * Top-down SVG diagram of a level, drawn from its layout: kerbs, bay lines,
 * parked cars, cones, the target space, the ideal manoeuvre (blue forward,
 * amber reverse) and the car at the start and end. Screen up is +Z; like the
 * in-game top-down view, +X (the car's left when heading +Z) is to the left.
 */

import type { CarDimensions } from '../config';
import { carFootprint, rectCorners, type Vec2 } from '../levels/geometry';
import { endPose, samplePath } from '../levels/idealPath';
import type { LevelLayout, OrientedRect } from '../levels/types';

const W = 420;
const H = 210;

export function levelDiagram(L: LevelLayout, d: CarDimensions): string {
  // Bounds from everything except very long kerbs/lines.
  const pts: Vec2[] = [];
  const addRect = (r: OrientedRect) => pts.push(...rectCorners(r).map((c) => ({ ...c })));
  addRect(carFootprint(L.spawn, d));
  if (L.target) addRect(L.target.zone);
  for (const c of L.parkedCars) addRect({ x: c.x, z: c.z, yaw: c.yaw, w: d.widthM * c.scale, l: d.lengthM * c.scale });
  for (const c of L.cones) pts.push(c);
  for (const g of L.gates ?? []) addRect(g.rect);
  const path = L.ideal ? samplePath(L.spawn, L.ideal, d, 0.25) : null;
  if (path) pts.push(...path.poses);
  let x0 = Math.min(...pts.map((p) => p.x)) - 2;
  let x1 = Math.max(...pts.map((p) => p.x)) + 2;
  let z0 = Math.min(...pts.map((p) => p.z)) - 2;
  let z1 = Math.max(...pts.map((p) => p.z)) + 2;
  // Keep the aspect ratio of the viewBox.
  const scale = Math.min(W / (x1 - x0), H / (z1 - z0));
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  x0 = cx - W / scale / 2;
  x1 = cx + W / scale / 2;
  z0 = cz - H / scale / 2;
  z1 = cz + H / scale / 2;
  const sx = (x: number) => ((x1 - x) * scale).toFixed(1);
  const sy = (z: number) => ((z1 - z) * scale).toFixed(1);
  const poly = (r: OrientedRect, attrs: string) =>
    `<polygon points="${rectCorners(r)
      .map((c) => `${sx(c.x)},${sy(c.z)}`)
      .join(' ')}" ${attrs}/>`;

  const out: string[] = [];
  out.push(`<rect width="${W}" height="${H}" fill="#3b3d40"/>`);
  for (const k of L.kerbs) out.push(poly(k, 'fill="#9a968e"'));
  for (const b of L.blocks) out.push(poly(b.rect, 'fill="#6f6b66"'));
  for (const l of L.lines) out.push(poly({ ...l, w: Math.max(l.w, 0.15), l: Math.max(l.l, 0.15) }, 'fill="#e9e7df" opacity="0.85"'));
  if (L.target) out.push(poly(L.target.zone, 'fill="rgba(61,220,132,0.18)" stroke="#3ddc84" stroke-width="2" stroke-dasharray="6 4"'));
  (L.gates ?? []).forEach((g, i) => {
    out.push(poly(g.rect, 'fill="rgba(61,220,132,0.12)" stroke="#3ddc84" stroke-width="1.5"'));
    out.push(`<text x="${sx(g.rect.x)}" y="${sy(g.rect.z)}" fill="#3ddc84" font-size="12" text-anchor="middle" dominant-baseline="middle">${i + 1}</text>`);
  });
  for (const c of L.parkedCars) {
    const hex = `#${c.colour.toString(16).padStart(6, '0')}`;
    out.push(poly({ x: c.x, z: c.z, yaw: c.yaw, w: d.widthM * c.scale, l: d.lengthM * c.scale }, `fill="${hex}" stroke="#111" stroke-width="1" opacity="0.9"`));
  }
  for (const c of L.cones) out.push(`<circle cx="${sx(c.x)}" cy="${sy(c.z)}" r="${Math.max(2, 0.2 * scale).toFixed(1)}" fill="#ff6a1a"/>`);
  if (path && L.ideal) {
    let run: string[] = [];
    let dir = L.ideal[path.segment[0]].dir;
    const flush = () => {
      if (run.length > 1)
        out.push(`<polyline points="${run.join(' ')}" fill="none" stroke="${dir > 0 ? '#3aa0ff' : '#ffb020'}" stroke-width="2.5" stroke-linecap="round"/>`);
    };
    path.poses.forEach((p, i) => {
      const dd = L.ideal![path.segment[i]].dir;
      const pt = `${sx(p.x)},${sy(p.z)}`;
      if (dd !== dir) {
        flush();
        run = [run[run.length - 1] ?? pt];
        dir = dd;
      }
      run.push(pt);
    });
    flush();
    out.push(poly(carFootprint(endPose(L.spawn, L.ideal, d), d), 'fill="none" stroke="#3ddc84" stroke-width="1.5"'));
  }
  // Start car with a heading arrow.
  const start = carFootprint(L.spawn, d);
  out.push(poly(start, 'fill="rgba(255,255,255,0.25)" stroke="#fff" stroke-width="1.5"'));
  const tip = { x: L.spawn.x + Math.sin(L.spawn.yaw) * 3.2, z: L.spawn.z + Math.cos(L.spawn.yaw) * 3.2 };
  out.push(`<line x1="${sx(L.spawn.x)}" y1="${sy(L.spawn.z)}" x2="${sx(tip.x)}" y2="${sy(tip.z)}" stroke="#fff" stroke-width="2" marker-end="url(#arr)"/>`);

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Level diagram">
<defs><marker id="arr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#fff"/></marker></defs>
${out.join('\n')}
</svg>`;
}
