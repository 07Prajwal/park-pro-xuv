/**
 * Camera system: chase, driver's seat (RHD), bonnet, top-down parking, orbit,
 * full-screen rear camera and a close 360° overhead view.
 *
 * Mouse drag looks around (driver/bonnet, springs back to the road after a
 * moment) or orbits; the wheel zooms the overhead and orbit views. All updates
 * are allocation-free.
 */

import * as THREE from 'three';
import type { InputState } from '../input/InputState';
import { ChaseCamera } from './ChaseCamera';
import { GUIDE_LAYER } from './reverseGuidelines';

/** Layer for the 360° distance zones (kept here to avoid a cameras -> levels dependency). */
export const ZONE_LAYER = 2;

export const CAMERA_MODES = [
  { id: 'chase', label: 'Chase' },
  { id: 'driver', label: "Driver's seat" },
  { id: 'bonnet', label: 'Bonnet' },
  { id: 'topdown', label: 'Top-down' },
  { id: 'orbit', label: 'Orbit' },
  { id: 'rear', label: 'Rear camera' },
  { id: 'surround', label: '360° view' },
] as const;
export type CameraMode = (typeof CAMERA_MODES)[number]['id'];

export interface CarMounts {
  root: THREE.Object3D;
  driverEye: THREE.Vector3;
  bonnetEye: THREE.Vector3;
}

const FOV: Record<CameraMode, number> = {
  chase: 55,
  driver: 72,
  bonnet: 65,
  topdown: 45,
  orbit: 50,
  rear: 55,
  surround: 80,
};
/**
 * Driver's seat: the eye sits right of the centre line, so a normal field of view loses the
 * passenger half of the windscreen. The horizontal field of view is fixed (the vertical one
 * follows the window's aspect ratio) and the look is turned a little towards the passenger side,
 * so both A-pillars and the whole windscreen are visible.
 */
const DRIVER_HFOV_DEG = 112;
const DRIVER_YAW_BIAS = 0.17;
const DRIVER_VFOV_MIN = 62;
const DRIVER_VFOV_MAX = 96;
const LOOK_RAD_PER_PX = 0.005;
const LOOK_RETURN_DELAY_S = 1.2;

export class CameraRig {
  mode: CameraMode = 'chase';
  /** Show the guideline layer in the main view (360° view while reversing). */
  showGuides = false;

  private readonly chase: ChaseCamera;
  private lookYaw = 0;
  private lookPitch = 0;
  private lookIdle = 0;
  private orbitYaw = Math.PI * 0.8;
  private orbitPitch = 0.35;
  private orbitDist = 8;
  private topHeight = 16;
  private surroundHeight = 7.5;

  private readonly v = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly q = new THREE.Quaternion();
  private readonly smoothPos = new THREE.Vector3();
  private smoothInit = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly car: CarMounts,
  ) {
    this.chase = new ChaseCamera(camera);
    this.apply();
  }

  get label(): string {
    return CAMERA_MODES.find((m) => m.id === this.mode)!.label;
  }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) {
      this.lookYaw = 0;
      this.lookPitch = 0;
      return;
    }
    this.mode = mode;
    this.apply();
  }

  next(): void {
    const i = CAMERA_MODES.findIndex((m) => m.id === this.mode);
    this.setMode(CAMERA_MODES[(i + 1) % CAMERA_MODES.length].id);
  }

  snap(): void {
    this.chase.snap();
    this.smoothInit = false;
  }

  private apply(): void {
    const cam = this.camera;
    cam.fov = FOV[this.mode];
    cam.near = this.mode === 'driver' ? 0.05 : 0.15;
    cam.up.set(0, 1, 0);
    cam.updateProjectionMatrix();
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.smoothInit = false;
    if (this.mode === 'chase') this.chase.snap();
  }

  update(input: InputState, dt: number): void {
    const dx = input.lookX;
    const dy = input.lookY;
    const zoom = input.zoom;
    input.lookX = 0;
    input.lookY = 0;
    input.zoom = 0;

    const root = this.car.root;
    const cam = this.camera;
    const want = this.showGuides && this.mode === 'surround';
    if (want) cam.layers.enable(GUIDE_LAYER);
    else cam.layers.disable(GUIDE_LAYER);
    if (this.mode === 'surround') cam.layers.enable(ZONE_LAYER);
    else cam.layers.disable(ZONE_LAYER);

    switch (this.mode) {
      case 'chase':
      case 'rear': // the full-screen rear view is drawn by the PiP pass; keep a sensible main camera
        this.chase.update(root, dt);
        break;
      case 'driver':
      case 'bonnet': {
        if (this.mode === 'driver') this.fitDriverFov();
        if (dx !== 0 || dy !== 0) {
          this.lookYaw = clamp(this.lookYaw - dx * LOOK_RAD_PER_PX, -2.4, 2.4);
          this.lookPitch = clamp(this.lookPitch - dy * LOOK_RAD_PER_PX, -0.9, 0.7);
          this.lookIdle = 0;
        } else {
          this.lookIdle += dt;
          if (this.lookIdle > LOOK_RETURN_DELAY_S) {
            const k = 1 - Math.exp(-3 * dt);
            this.lookYaw -= this.lookYaw * k;
            this.lookPitch -= this.lookPitch * k;
          }
        }
        const eye = this.mode === 'driver' ? this.car.driverEye : this.car.bonnetEye;
        cam.position.copy(eye).applyMatrix4(root.matrixWorld);
        const yawBias = this.mode === 'driver' ? DRIVER_YAW_BIAS : 0;
        this.euler.set(this.lookPitch - (this.mode === 'driver' ? 0.06 : 0.1), Math.PI + this.lookYaw + yawBias, 0);
        this.q.setFromEuler(this.euler);
        cam.quaternion.copy(root.quaternion).multiply(this.q);
        break;
      }
      case 'topdown':
      case 'surround': {
        const isTop = this.mode === 'topdown';
        if (zoom !== 0) {
          if (isTop) this.topHeight = clamp(this.topHeight * (1 + zoom * 0.1), 6, 45);
          else this.surroundHeight = clamp(this.surroundHeight * (1 + zoom * 0.1), 4, 14);
        }
        const h = isTop ? this.topHeight : this.surroundHeight;
        this.headingForward();
        const p = root.position;
        // Overhead views stay level (ignore body roll/pitch) and turn with the car.
        this.v.set(p.x, h, p.z);
        this.follow(this.v, isTop ? 8 : 20, dt);
        cam.up.copy(this.fwd);
        cam.lookAt(this.smoothPos.x, 0, this.smoothPos.z);
        break;
      }
      case 'orbit': {
        this.orbitYaw -= dx * LOOK_RAD_PER_PX;
        this.orbitPitch = clamp(this.orbitPitch + dy * LOOK_RAD_PER_PX, 0.05, 1.45);
        if (zoom !== 0) this.orbitDist = clamp(this.orbitDist * (1 + zoom * 0.1), 3.5, 30);
        const p = root.position;
        const cp = Math.cos(this.orbitPitch);
        this.v.set(
          p.x + Math.sin(this.orbitYaw) * cp * this.orbitDist,
          p.y + 0.8 + Math.sin(this.orbitPitch) * this.orbitDist,
          p.z + Math.cos(this.orbitYaw) * cp * this.orbitDist,
        );
        cam.position.copy(this.v);
        cam.lookAt(p.x, p.y + 0.8, p.z);
        break;
      }
    }
  }

  /** Keep the driver's horizontal field of view constant when the window's aspect ratio changes. */
  private fitDriverFov(): void {
    const cam = this.camera;
    const half = (DRIVER_HFOV_DEG * Math.PI) / 360;
    const v = ((2 * Math.atan(Math.tan(half) / Math.max(cam.aspect, 0.5))) * 180) / Math.PI;
    const fov = clamp(v, DRIVER_VFOV_MIN, DRIVER_VFOV_MAX);
    if (Math.abs(fov - cam.fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  private headingForward(): void {
    this.fwd.set(0, 0, 1).applyQuaternion(this.car.root.quaternion);
    this.fwd.y = 0;
    if (this.fwd.lengthSq() < 1e-6) this.fwd.set(0, 0, 1);
    this.fwd.normalize();
  }

  private follow(target: THREE.Vector3, stiffness: number, dt: number): void {
    if (!this.smoothInit) {
      this.smoothPos.copy(target);
      this.smoothInit = true;
    } else {
      this.smoothPos.lerp(target, 1 - Math.exp(-stiffness * dt));
    }
    this.camera.position.copy(this.smoothPos);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
