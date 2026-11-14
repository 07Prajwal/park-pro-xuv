import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { XUV_7XO } from '../src/config';
import { GuideVisuals } from '../src/levels/GuideVisuals';
import { endPose, samplePath } from '../src/levels/idealPath';
import { LEVELS } from '../src/levels/levels';

describe('ghost replay', () => {
  it('drives the ideal manoeuvre, pauses at the gear change and finishes at the end pose', () => {
    const L = LEVELS[3].build('normal');
    const guides = new GuideVisuals(new THREE.Scene(), XUV_7XO);
    guides.setIdeal(samplePath(L.spawn, L.ideal!, XUV_7XO, 0.1), L.ideal);
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
});
