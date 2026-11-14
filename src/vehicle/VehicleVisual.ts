/**
 * Renders the XUV from interpolated physics snapshots: smooth bevelled body,
 * wheels that steer, spin and follow suspension travel, and working lamps
 * (DRL, headlamps, tail/brake, reverse, indicators/hazards).
 */

import * as THREE from 'three';
import type { PaintColour } from '../config';
import { buildCarBody, buildWheel, type CarLampMaterials } from './carGeometry';
import type { VehicleLights } from './VehicleLights';
import { WHEEL_COUNT, type VehiclePhysics } from './VehiclePhysics';

export class VehicleVisual {
  readonly root = new THREE.Group();

  private readonly wheelPivots: THREE.Group[] = [];
  private readonly wheelSpins: THREE.Group[] = [];
  private readonly lamps: CarLampMaterials;
  private readonly paint: THREE.MeshPhysicalMaterial;
  private readonly tmpQ0 = new THREE.Quaternion();
  private readonly tmpQ1 = new THREE.Quaternion();

  constructor(
    private readonly physics: VehiclePhysics,
    private readonly lights: VehicleLights,
    paint: PaintColour,
  ) {
    const d = physics.dim;
    const rearOverhang = d.lengthM - d.wheelbaseM - d.frontOverhangM;
    const body = buildCarBody(d, paint);
    body.group.position.z = (d.frontOverhangM - rearOverhang) / 2;
    this.root.add(body.group);
    this.lamps = body.lamps;
    this.paint = body.paint;

    for (let i = 0; i < WHEEL_COUNT; i++) {
      const isLeft = physics.wheelConnections[i].x > 0;
      const { pivot, spin } = buildWheel(d, isLeft ? 1 : -1);
      this.root.add(pivot);
      this.wheelPivots.push(pivot);
      this.wheelSpins.push(spin);
    }
  }

  setPaint(p: PaintColour): void {
    this.paint.color.setHex(p.hex);
    this.paint.metalness = p.metalness;
    this.paint.roughness = p.roughness;
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

    this.updateLamps();
  }

  private updateLamps(): void {
    const p = this.physics;
    const l = this.lights;
    const running = p.drivetrain.engineRunning;
    const m = this.lamps;
    m.drl.emissiveIntensity = running ? (l.headlights ? 2 : 5) : 0;
    m.headlamp.emissiveIntensity = l.headlights ? 9 : 0;
    m.tail.emissiveIntensity = l.headlights || running ? 1.6 : 0;
    m.brake.emissiveIntensity = p.brakeLamps ? 9 : l.headlights ? 1.6 : 0;
    m.reverse.emissiveIntensity = p.drivetrain.selector === 'R' ? 7 : 0;
    m.indicatorLeft.emissiveIntensity = l.leftLit ? 9 : 0;
    m.indicatorRight.emissiveIntensity = l.rightLit ? 9 : 0;
  }
}
