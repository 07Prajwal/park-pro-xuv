/**
 * Renders the XUV from interpolated physics snapshots: lofted body and cabin,
 * wheels that steer, spin and follow suspension travel, a steering wheel that
 * turns with the steering, working lamps with real headlight beams, the live
 * digital cluster, and the reverse-camera guidelines.
 *
 * `root` is in the physics body frame (origin midway between the axles); the
 * body meshes are offset so the footprint lines up with the physics collider.
 */

import * as THREE from 'three';
import type { PaintColour } from '../config';
import { ReverseGuidelines } from '../cameras/reverseGuidelines';
import { buildCarBody, buildWheel, type CarLampMaterials } from './carGeometry';
import { buildInterior, DRIVER_EYE, INTERIOR_MIRROR, type CarInterior } from './carInterior';
import type { VehicleLights } from './VehicleLights';
import { WHEEL_COUNT, type VehiclePhysics } from './VehiclePhysics';

/** Steering-wheel rotation at full lock (about 1.5 turns; ~3 turns lock to lock). */
export const STEERING_WHEEL_LOCK_RAD = Math.PI * 3;
const HEADLIGHT_INTENSITY = 25;
const CLUSTER_INTERVAL_S = 0.1;

export class VehicleVisual {
  readonly root = new THREE.Group();
  /** Fixed straight guidelines (never move). */
  readonly guidelines: ReverseGuidelines;
  /** Predicted-path line that follows the steering. */
  readonly pathGuide: ReverseGuidelines;
  /** Camera mount points in the root frame. */
  readonly driverEye: THREE.Vector3;
  readonly bonnetEye: THREE.Vector3;
  readonly rearCameraMount: THREE.Vector3;
  readonly mirrorMounts: THREE.Vector3[];
  readonly interiorMirrorMount: THREE.Vector3;
  readonly interiorMirrorGlass: THREE.Mesh;

  private readonly wheelPivots: THREE.Group[] = [];
  private readonly wheelSpins: THREE.Group[] = [];
  private readonly lamps: CarLampMaterials;
  private readonly paint: THREE.MeshPhysicalMaterial;
  private readonly interior: CarInterior;
  private readonly headlights: THREE.SpotLight[] = [];
  private readonly tmpQ0 = new THREE.Quaternion();
  private readonly tmpQ1 = new THREE.Quaternion();
  private clusterTimer = 0;

  constructor(
    private readonly physics: VehiclePhysics,
    private readonly lights: VehicleLights,
    paint: PaintColour,
    headlightShadows = false,
  ) {
    const d = physics.dim;
    const rearOverhang = d.lengthM - d.wheelbaseM - d.frontOverhangM;
    const offZ = (d.frontOverhangM - rearOverhang) / 2;
    const body = buildCarBody(d, paint);
    body.group.position.z = offZ;
    this.root.add(body.group);
    this.lamps = body.lamps;
    this.paint = body.paint;

    this.interior = buildInterior(body.cabinHalfWidth, body.roofY);
    body.group.add(this.interior.group);

    for (let i = 0; i < WHEEL_COUNT; i++) {
      const isLeft = physics.wheelConnections[i].x > 0;
      const { pivot, spin } = buildWheel(d, isLeft ? 1 : -1);
      this.root.add(pivot);
      this.wheelPivots.push(pivot);
      this.wheelSpins.push(spin);
    }

    // Low-beam headlights: always present (intensity 0 when off) so toggling never recompiles shaders.
    for (const p of body.headlampPositions) {
      const spot = new THREE.SpotLight(0xfff4e5, 0, 70, 0.42, 0.55, 2);
      spot.position.set(p.x, p.y, p.z + offZ);
      spot.target.position.set(p.x * 1.6, 0, p.z + offZ + 18);
      spot.castShadow = headlightShadows;
      this.root.add(spot, spot.target);
      this.headlights.push(spot);
    }

    this.guidelines = new ReverseGuidelines(d, 'fixed');
    this.pathGuide = new ReverseGuidelines(d, 'path');
    this.root.add(this.guidelines.mesh, this.pathGuide.mesh);

    const shift = new THREE.Vector3(0, 0, offZ);
    this.driverEye = DRIVER_EYE.clone().add(shift);
    this.bonnetEye = new THREE.Vector3(0, 1.3, 0.78).add(shift);
    this.rearCameraMount = new THREE.Vector3(0, 1.0, -d.lengthM / 2 - 0.02).add(shift);
    this.mirrorMounts = body.mirrorPositions.map((p) => p.clone().add(shift));
    this.interiorMirrorMount = INTERIOR_MIRROR.clone().add(shift);
    this.interiorMirrorGlass = this.interior.mirrorGlass;
  }

  setPaint(p: PaintColour): void {
    this.paint.color.setHex(p.hex);
    this.paint.metalness = p.metalness;
    this.paint.roughness = p.roughness;
  }

  /** Interpolate between the previous and current physics snapshots. */
  update(alpha: number, dt: number): void {
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

    // Seen from the driver, a left turn is anticlockwise: negative about the column's Z.
    this.interior.steeringWheel.rotation.z = -this.physics.steerPosition * STEERING_WHEEL_LOCK_RAD;

    this.updateLamps();

    this.clusterTimer -= dt;
    if (this.clusterTimer <= 0) {
      this.clusterTimer = CLUSTER_INTERVAL_S;
      const dr = this.physics.drivetrain;
      this.interior.drawCluster({
        speedKmh: this.physics.speedKmh,
        rpm: dr.engineRpm,
        selector: dr.selector,
        gear: dr.gear,
        epb: this.physics.parkingBrake,
      });
    }
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
    const beam = l.headlights ? HEADLIGHT_INTENSITY : 0;
    for (let i = 0; i < this.headlights.length; i++) this.headlights[i].intensity = beam;
  }
}
