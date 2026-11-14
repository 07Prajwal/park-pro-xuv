/**
 * Stage-1 placeholder visual for the XUV: correctly sized blocky body, wheels
 * that steer, spin and follow suspension travel, and brake/reverse lamps.
 * Replaced by the detailed XUV 7XO model in Stage 3.
 */

import * as THREE from 'three';
import { WHEEL_COUNT, type VehiclePhysics } from './VehiclePhysics';

export class VehicleVisual {
  readonly root = new THREE.Group();

  private readonly wheelPivots: THREE.Group[] = [];
  private readonly wheelSpins: THREE.Group[] = [];
  private readonly brakeMat: THREE.MeshStandardMaterial;
  private readonly reverseMat: THREE.MeshStandardMaterial;
  private readonly tmpQ0 = new THREE.Quaternion();
  private readonly tmpQ1 = new THREE.Quaternion();

  constructor(private readonly physics: VehiclePhysics, bodyColour = 0xf2f2ee) {
    const d = physics.dim;
    const rearOverhang = d.lengthM - d.wheelbaseM - d.frontOverhangM;
    const centreZ = (d.frontOverhangM - rearOverhang) / 2;

    const paint = new THREE.MeshStandardMaterial({ color: bodyColour, metalness: 0.4, roughness: 0.35 });
    const cladding = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.8 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x1a2430, metalness: 0.2, roughness: 0.1 });
    const drl = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeaf4ff, emissiveIntensity: 1.5 });
    this.brakeMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1010, emissiveIntensity: 0.25 });
    this.reverseMat = new THREE.MeshStandardMaterial({ color: 0x777777, emissive: 0xffffff, emissiveIntensity: 0 });

    const body = new THREE.Group();
    body.position.z = centreZ;
    this.root.add(body);

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      body.add(m);
      return m;
    };

    const w = d.widthM;
    const L = d.lengthM;
    const gc = d.groundClearanceM;
    const beltY = 1.05;
    // Lower black cladding, painted main body, glasshouse and roof.
    add(new THREE.BoxGeometry(w, 0.32, L), cladding, 0, gc + 0.16, 0);
    add(new THREE.BoxGeometry(w - 0.02, beltY - gc - 0.32, L - 0.04), paint, 0, (gc + 0.32 + beltY) / 2, 0);
    const cabinLen = L * 0.62;
    const cabinH = d.heightM - beltY - 0.05;
    add(new THREE.BoxGeometry(w - 0.14, cabinH, cabinLen), glass, 0, beltY + cabinH / 2, -0.12);
    add(new THREE.BoxGeometry(w - 0.16, 0.05, cabinLen - 0.1), paint, 0, d.heightM - 0.025, -0.12);
    // Roof rails.
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.04, 0.05, cabinLen * 0.85), cladding, sx * (w / 2 - 0.12), d.heightM + 0.02, -0.12);
    // Front connected DRL bar and rear tail bar.
    add(new THREE.BoxGeometry(w * 0.9, 0.04, 0.02), drl, 0, beltY - 0.12, L / 2 + 0.005);
    add(new THREE.BoxGeometry(w * 0.92, 0.06, 0.02), this.brakeMat, 0, beltY - 0.06, -L / 2 - 0.005);
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.18, 0.06, 0.02), this.reverseMat, sx * 0.55, 0.62, -L / 2 - 0.005);

    // Wheels.
    const r = d.wheelRadiusM;
    const tyreGeo = new THREE.CylinderGeometry(r, r, d.wheelWidthM, 24);
    tyreGeo.rotateZ(Math.PI / 2);
    const rimGeo = new THREE.BoxGeometry(d.wheelWidthM + 0.01, r * 1.3, 0.07);
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.8, roughness: 0.3 });
    for (let i = 0; i < WHEEL_COUNT; i++) {
      const pivot = new THREE.Group();
      const spin = new THREE.Group();
      const tyre = new THREE.Mesh(tyreGeo, tyreMat);
      tyre.castShadow = true;
      spin.add(tyre);
      // Two crossed spokes make rotation visible.
      const s1 = new THREE.Mesh(rimGeo, rimMat);
      const s2 = new THREE.Mesh(rimGeo, rimMat);
      s2.rotation.x = Math.PI / 2;
      spin.add(s1, s2);
      pivot.add(spin);
      this.root.add(pivot);
      this.wheelPivots.push(pivot);
      this.wheelSpins.push(spin);
    }
  }

  /** Interpolate between the previous and current physics snapshots. */
  update(alpha: number): void {
    const { prev, curr, wheelConnections, tuning } = this.physics;
    this.root.position.set(
      prev.pos.x + (curr.pos.x - prev.pos.x) * alpha,
      prev.pos.y + (curr.pos.y - prev.pos.y) * alpha,
      prev.pos.z + (curr.pos.z - prev.pos.z) * alpha,
    );
    this.tmpQ0.set(prev.quat.x, prev.quat.y, prev.quat.z, prev.quat.w);
    this.tmpQ1.set(curr.quat.x, curr.quat.y, curr.quat.z, curr.quat.w);
    this.root.quaternion.slerpQuaternions(this.tmpQ0, this.tmpQ1, alpha);

    for (let i = 0; i < WHEEL_COUNT; i++) {
      const c = wheelConnections[i];
      const susp = prev.suspension[i] + (curr.suspension[i] - prev.suspension[i]) * alpha;
      const pivot = this.wheelPivots[i];
      pivot.position.set(c.x, c.y - Math.min(susp, tuning.suspension.restLengthM), c.z);
      pivot.rotation.y = prev.steer[i] + (curr.steer[i] - prev.steer[i]) * alpha;
      this.wheelSpins[i].rotation.x = prev.spin[i] + (curr.spin[i] - prev.spin[i]) * alpha;
    }

    this.brakeMat.emissiveIntensity = this.physics.braking > 0.05 ? 2.5 : 0.25;
    this.reverseMat.emissiveIntensity = this.physics.gear === 'R' ? 2.0 : 0;
  }
}
