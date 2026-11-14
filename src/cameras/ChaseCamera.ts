/**
 * Chase camera: sits behind and above the car and follows with a critically
 * damped (frame-rate independent) spring. Allocation-free per frame.
 */

import * as THREE from 'three';

export class ChaseCamera {
  distance = 7.2;
  height = 2.6;
  lookAhead = 2.5;
  lookHeight = 1.1;
  /** Higher = stiffer follow. */
  stiffness = 6;

  private readonly desired = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly lookSmoothed = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private initialised = false;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  update(target: THREE.Object3D, dt: number): void {
    // Horizontal forward vector of the car (ignore pitch so bumps don't shake the view).
    this.fwd.set(0, 0, 1).applyQuaternion(target.quaternion);
    this.fwd.y = 0;
    if (this.fwd.lengthSq() < 1e-6) this.fwd.set(0, 0, 1);
    this.fwd.normalize();

    const p = target.position;
    this.desired.set(p.x - this.fwd.x * this.distance, p.y + this.height, p.z - this.fwd.z * this.distance);
    this.look.set(p.x + this.fwd.x * this.lookAhead, p.y + this.lookHeight, p.z + this.fwd.z * this.lookAhead);

    if (!this.initialised) {
      this.camera.position.copy(this.desired);
      this.lookSmoothed.copy(this.look);
      this.initialised = true;
    } else {
      const k = 1 - Math.exp(-this.stiffness * dt);
      this.camera.position.lerp(this.desired, k);
      this.lookSmoothed.lerp(this.look, 1 - Math.exp(-this.stiffness * 2 * dt));
    }
    this.camera.lookAt(this.lookSmoothed);
  }

  snap(): void {
    this.initialised = false;
  }
}
