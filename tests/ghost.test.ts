import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { XUV_7XO } from '../src/config';
import { GuideVisuals } from '../src/levels/GuideVisuals';
import { endPose, samplePath } from '../src/levels/idealPath';
import { LEVELS } from '../src/levels/levels';
import { Terrain } from '../src/world/terrain';

describe('ghost replay', () => {
  it('drives the ideal manoeuvre, pauses at the gear change and finishes at the end pose', () => {
    const L = LEVELS[3].build('normal');
    const guides = new GuideVisuals(new THREE.Scene(), XUV_7XO);
    guides.setIdeal(samplePath(L.spawn, L.ideal!, XUV_7XO, 0.1), L.ideal, new Terrain(L.surfaces));
    expect(guides.playGhost()).toBe(true);
    const end = endPose(L.spawn, L.ideal!, XUV_7XO);
    let stoppedMidway = 0;
    let lastX = guides.ghost.position.x;
    let closest = Infinity;
    for (let t = 0; t < 120 && guides.ghostPlaying; t += 1 / 60) {
      guides.updateGhost(1 / 60);
      const p = guides.ghost.position;
      if (Math.abs(p.x - lastX) < 1e-9 && Math.hypot(p.x - end.x, p.z - end.z) > 1) stoppedMidway++;
      lastX = p.x;
      closest = Math.min(closest, Math.hypot(p.x - end.x, p.z - end.z));
    }
    expect(guides.ghostPlaying).toBe(false);
    expect(closest).toBeLessThan(0.05);
    // Initial pause plus the stop before reversing (at least ~1 s of standing still).
    expect(stoppedMidway).toBeGreaterThan(60);
  });

  it('follows the hill on level 12 and pauses at the uphill parking stop', () => {
    const L = LEVELS[11].build('hard');
    const terrain = new Terrain(L.surfaces);
    const guides = new GuideVisuals(new THREE.Scene(), XUV_7XO);
    guides.setIdeal(samplePath(L.spawn, L.ideal!, XUV_7XO, 0.1), L.ideal, terrain);
    guides.playGhost();
    const stop = L.stops![0].zone;
    let maxY = 0;
    let worstGap = 0;
    let pausedAtStop = 0;
    let last = guides.ghost.position.clone();
    for (let t = 0; t < 200 && guides.ghostPlaying; t += 1 / 60) {
      guides.updateGhost(1 / 60);
      const p = guides.ghost.position;
      maxY = Math.max(maxY, p.y);
      worstGap = Math.max(worstGap, Math.abs(p.y - terrain.height(p.x, p.z, p.y)));
      if (p.distanceTo(last) < 1e-9 && Math.abs(p.z - stop.z) < stop.l / 2) pausedAtStop++;
      last = p.clone();
    }
    expect(maxY).toBeGreaterThan(3);
    expect(worstGap).toBeLessThan(0.05);
    expect(pausedAtStop).toBeGreaterThan(30);
  });
});
