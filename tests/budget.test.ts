import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { GameAssets, PbrSet } from '../src/core/assets';
import { createPhysics } from '../src/core/physics';
import { LEVELS } from '../src/levels/levels';
import { DIFFICULTIES } from '../src/levels/types';
import { LevelProps } from '../src/world/levelProps';

/** Level content (props, parked cars, street vehicles) must stay within this many triangles. */
const BUDGET = 2_000_000;

// LevelProps paints a wear mask on a 2D canvas; a no-op canvas is enough to count geometry in Node.
const ctx2d = new Proxy({}, { get: () => () => {} });
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };

function fakeAssets(): GameAssets {
  const set = (): PbrSet => ({ map: new THREE.Texture(), normalMap: new THREE.Texture(), orm: new THREE.Texture() });
  return {
    skyBackground: new THREE.Texture(),
    skyHdr: new THREE.DataTexture(),
    sunDirection: new THREE.Vector3(0, 1, 0),
    surfaces: { asphalt: set(), grass: set(), concrete: set(), brick: set(), plaster: set(), pavers: set() },
  };
}

function triangles(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible) return;
    const g = m.geometry;
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    n += tris * ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1);
  });
  return n;
}

describe('triangle budget', () => {
  it(`every level stays under ${BUDGET / 1e6}M triangles of level content`, async () => {
    const phys = await createPhysics();
    const scene = new THREE.Scene();
    const props = new LevelProps(scene, phys, fakeAssets());
    const counts: string[] = [];
    for (const level of LEVELS) {
      for (const d of DIFFICULTIES) {
        props.build(level.build(d));
        const n = triangles(props.group);
        counts.push(`${level.id}/${d}: ${(n / 1e3).toFixed(0)}k`);
        expect(n, `level ${level.id} (${d})`).toBeLessThan(BUDGET);
      }
    }
    console.log(counts.join('  '));
    props.dispose();
  }, 60000);
});
