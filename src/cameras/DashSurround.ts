/**
 * 360° camera on the centre infotainment screen, like the XUV 7XO AX7: a bird's-eye view of
 * the car on the left and a live camera on the right (the mirrored reverse camera in R, the
 * front camera otherwise). Rendered into two small HDR textures shown on the screen glass,
 * only while the driver's-seat view is active, at half the display rate.
 */

import * as THREE from 'three';
import { ZONE_LAYER } from './CameraRig';
import { GUIDE_LAYER } from './reverseGuidelines';
import type { ScreenArea } from '../vehicle/carInterior';

const TOP_PX = 256;
const GAP_M = 0.006;

export class DashSurround {
  visible = false;
  private readonly topCamera: THREE.PerspectiveCamera;
  private readonly frontCamera: THREE.PerspectiveCamera;
  private readonly rearCamera: THREE.PerspectiveCamera;
  private readonly topTarget: THREE.WebGLRenderTarget;
  private readonly viewTarget: THREE.WebGLRenderTarget;
  private readonly topPlane: THREE.Mesh;
  private readonly viewPlane: THREE.Mesh;
  private reversing = false;
  private frame = 0;

  /**
   * @param root car root (cameras ride with the car)
   * @param area the part of the screen glass to cover, in the glass's own frame
   * @param frontMount / rearMount camera positions in the root frame
   */
  constructor(root: THREE.Object3D, area: ScreenArea, frontMount: THREE.Vector3, rearMount: THREE.Vector3) {
    const topW = area.height;
    const viewW = area.right - area.left - topW - GAP_M;
    const viewAspect = viewW / area.height;

    // Bird's-eye: straight down from above the roof, car's nose at the top of the picture.
    this.topCamera = new THREE.PerspectiveCamera(62, 1, 0.5, 30);
    this.topCamera.position.set(0, 7, 0);
    this.topCamera.rotation.set(-Math.PI / 2, Math.PI, 0, 'YXZ');
    this.frontCamera = new THREE.PerspectiveCamera(78, viewAspect, 0.05, 300);
    this.frontCamera.position.copy(frontMount);
    this.frontCamera.rotation.set(-0.42, Math.PI, 0, 'YXZ');
    this.rearCamera = new THREE.PerspectiveCamera(78, viewAspect, 0.05, 300);
    this.rearCamera.position.copy(rearMount);
    this.rearCamera.rotation.set(-0.55, 0, 0, 'YXZ');
    this.topCamera.layers.enable(ZONE_LAYER);
    this.rearCamera.layers.enable(GUIDE_LAYER);
    root.add(this.topCamera, this.frontCamera, this.rearCamera);

    const opts = { type: THREE.HalfFloatType, samples: 2 } as const;
    this.topTarget = new THREE.WebGLRenderTarget(TOP_PX, TOP_PX, opts);
    this.viewTarget = new THREE.WebGLRenderTarget(Math.round(TOP_PX * viewAspect), TOP_PX, opts);

    const plane = (w: number, x: number, tex: THREE.Texture) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, area.height), new THREE.MeshBasicMaterial({ map: tex }));
      m.position.set(x, 0, 0.001);
      m.visible = false;
      area.glass.add(m);
      return m;
    };
    this.topPlane = plane(topW, area.left + topW / 2, this.topTarget.texture);
    this.viewPlane = plane(viewW, area.right - viewW / 2, this.viewTarget.texture);
  }

  /** Reverse camera (mirrored, with guidelines) while reversing, front camera otherwise. */
  setReversing(reversing: boolean): void {
    if (reversing === this.reversing) return;
    this.reversing = reversing;
    const tex = this.viewTarget.texture;
    tex.repeat.x = reversing ? -1 : 1;
    tex.offset.x = reversing ? 1 : 0;
    if (reversing) this.topCamera.layers.enable(GUIDE_LAYER);
    else this.topCamera.layers.disable(GUIDE_LAYER);
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    this.topPlane.visible = this.visible;
    this.viewPlane.visible = this.visible;
    if (!this.visible || this.frame++ % 2) return;
    renderer.setRenderTarget(this.topTarget);
    renderer.clear();
    renderer.render(scene, this.topCamera);
    renderer.setRenderTarget(this.viewTarget);
    renderer.clear();
    renderer.render(scene, this.reversing ? this.rearCamera : this.frontCamera);
    renderer.setRenderTarget(null);
  }
}
