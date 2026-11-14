import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { XUV_7XO } from '../src/config';
import { buildLoftedBody } from '../src/vehicle/bodyLoft';

/** Area-weighted average face normal of the triangles whose centroid satisfies `pick`. */
function avgNormal(g: THREE.BufferGeometry, pick: (c: THREE.Vector3) => boolean): THREE.Vector3 {
  const p = g.getAttribute('position');
  const idx = g.getIndex()!;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const centroid = new THREE.Vector3();
  const sum = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(p, idx.getX(i));
    b.fromBufferAttribute(p, idx.getX(i + 1));
    c.fromBufferAttribute(p, idx.getX(i + 2));
    centroid.copy(a).add(b).add(c).divideScalar(3);
    if (!pick(centroid)) continue;
    n.subVectors(b, a).cross(c.clone().sub(a));
    sum.add(n);
  }
  return sum.normalize();
}

describe('lofted body', () => {
  const body = buildLoftedBody(XUV_7XO);
  const L = XUV_7XO.lengthM;

  it('fits the real dimensions', () => {
    body.paint.computeBoundingBox();
    const bb = body.paint.boundingBox!;
    expect(bb.max.z - bb.min.z).toBeCloseTo(L, 2);
    expect(bb.max.x - bb.min.x).toBeLessThanOrEqual(XUV_7XO.widthM);
    expect(bb.max.x - bb.min.x).toBeGreaterThan(XUV_7XO.widthM - 0.05);
  });

  it('faces outward: sides, bonnet, end caps', () => {
    const left = avgNormal(body.paint, (c) => c.x > 0.8 && c.y > 0.6 && c.y < 0.9 && Math.abs(c.z) < 0.5);
    expect(left.x).toBeGreaterThan(0.9);
    const right = avgNormal(body.paint, (c) => c.x < -0.8 && c.y > 0.6 && c.y < 0.9 && Math.abs(c.z) < 0.5);
    expect(right.x).toBeLessThan(-0.9);
    const bonnet = avgNormal(body.paint, (c) => Math.abs(c.x) < 0.5 && c.z > 1.2 && c.z < 2 && c.y > 0.9);
    expect(bonnet.y).toBeGreaterThan(0.9);
    const front = avgNormal(body.paint, (c) => c.z > L / 2 - 0.001);
    expect(front.z).toBeGreaterThan(0.9);
    const rear = avgNormal(body.paint, (c) => c.z < -L / 2 + 0.001);
    expect(rear.z).toBeLessThan(-0.9);
  });

  it('cabin floor faces up into the cabin and underbody faces down', () => {
    const floor = avgNormal(body.trim, (c) => Math.abs(c.x) < 0.4 && c.z < 0.5 && c.z > -1);
    expect(floor.y).toBeGreaterThan(0.9);
    const under = avgNormal(body.cladding, (c) => Math.abs(c.x) < 0.4 && Math.abs(c.z) < 0.5);
    expect(under.y).toBeLessThan(-0.9);
  });

  it('leaves the wheels uncovered under the arches', () => {
    // Above the axle, the side wall must start above the top of the tyre.
    const axleF = L / 2 - XUV_7XO.frontOverhangM;
    const tyreTop = XUV_7XO.wheelRadiusM * 2 + 0.02;
    expect(body.sideX(axleF, tyreTop - 0.05)).toBeGreaterThan(0); // queries clamp, must not throw
    const p = body.paint.getAttribute('position');
    let lowest = Infinity;
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getZ(i) - axleF) < 0.01 && Math.abs(p.getX(i)) > 0.8) lowest = Math.min(lowest, p.getY(i));
    }
    expect(lowest).toBeGreaterThan(tyreTop);
  });
});
