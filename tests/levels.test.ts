import { describe, expect, it } from 'vitest';
import { XUV_7XO } from '../src/config';
import { carFootprint, pointInRect, rectCorners } from '../src/levels/geometry';
import { endPose, samplePath } from '../src/levels/idealPath';
import { LEVELS } from '../src/levels/levels';
import { evaluateParking } from '../src/levels/scoring';
import { DIFFICULTIES } from '../src/levels/types';
import { pathClearance } from '../src/levels/validate';
import { Terrain } from '../src/world/terrain';

const CAR = XUV_7XO;

describe('level ideal manoeuvres', () => {
  for (const level of LEVELS.filter((l) => l.id >= 3)) {
    for (const d of DIFFICULTIES) {
      it(`level ${level.id} (${d}) ends parked, within tolerance, without touching anything`, () => {
        const L = level.build(d);
        expect(L.ideal, 'an ideal manoeuvre exists').toBeDefined();
        const segs = L.ideal!;
        const end = endPose(L.spawn, segs, CAR);
        const verdict = evaluateParking(end, L.target!, CAR);
        expect(verdict.inside, 'footprint inside the zone').toBe(true);
        expect(verdict.angleDeg).toBeLessThanOrEqual(L.target!.maxAngleDeg);
        expect(verdict.reason ?? 'ok').toBe('ok');
        const clearance = pathClearance(L, segs, CAR);
        expect(clearance, 'clearance along the path (m)').toBeGreaterThanOrEqual(0.05);
      });
    }
  }

  it('reverse manoeuvres actually reverse into bays 4 and 6', () => {
    for (const id of [4, 6]) {
      const segs = LEVELS[id - 1].build('normal').ideal!;
      expect(segs.some((s) => s.dir === -1)).toBe(true);
      expect(segs[segs.length - 1].dir).toBe(-1);
    }
  });

  for (const d of DIFFICULTIES) {
    it(`level 8 (${d}): the ideal path passes every gate in order, on the gate's floor`, () => {
      const L = LEVELS[7].build(d);
      const terrain = new Terrain(L.surfaces);
      const path = samplePath(L.spawn, L.ideal!, CAR, 0.1).poses;
      let gate = 0;
      let y = 0;
      for (const p of path) {
        y = terrain.height(p.x, p.z, y);
        const g = L.gates![gate];
        if (g && pointInRect(p, g.rect) && Math.abs((g.rect.level ?? 0) - y) < 1.5) gate++;
      }
      expect(gate).toBe(L.gates!.length);
      expect(y).toBeGreaterThan(2.5);
    });

    it(`level 12 (${d}): the ideal path stops in the uphill space before the downhill one`, () => {
      const L = LEVELS[11].build(d);
      const i = L.ideal!.findIndex((s) => s.stop);
      expect(i).toBeGreaterThan(0);
      const v = evaluateParking(endPose(L.spawn, L.ideal!.slice(0, i + 1), CAR), L.stops![0], CAR);
      expect(v.reason ?? 'ok').toBe('ok');
      expect(L.stops![0].secure).toBe('both');
      expect(L.target!.secure).toBe('both');
    });
  }

  it('sampled path is continuous', () => {
    const L = LEVELS[5].build('normal');
    const p = samplePath(L.spawn, L.ideal!, CAR, 0.1).poses;
    for (let i = 1; i < p.length; i++) {
      expect(Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z)).toBeLessThan(0.15);
    }
  });

  it('footprint corners span the car length and width', () => {
    const c = rectCorners(carFootprint({ x: 0, z: 0, yaw: 0 }, CAR));
    expect(c[0].z - c[3].z).toBeCloseTo(CAR.lengthM, 6);
    expect(c[0].x - c[1].x).toBeCloseTo(CAR.widthM, 6);
  });
});
