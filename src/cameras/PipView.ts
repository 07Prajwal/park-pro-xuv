/**
 * Secondary camera views (reverse camera, door mirrors) rendered to an HDR
 * texture and drawn as screen-space quads after the main frame.
 *
 * Rendering through a texture lets the image be mirrored horizontally, as real
 * reversing cameras and mirrors are, without flipping triangle winding. The
 * overlay quads are tone-mapped when drawn to the screen, like the main view.
 */

import * as THREE from 'three';

export interface ScreenRect {
  /** CSS pixels from the left / top of the viewport. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export class PipOverlay {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  private viewH = 1;

  resize(w: number, h: number): void {
    this.camera.right = w;
    this.camera.top = h;
    this.camera.updateProjectionMatrix();
    this.viewH = h;
  }

  /** Convert a top-left-origin rect into overlay coordinates (bottom-left origin). */
  place(obj: THREE.Object3D, r: ScreenRect, pad = 0): void {
    obj.position.set(r.x + r.w / 2, this.viewH - (r.y + r.h / 2), 0);
    obj.scale.set(r.w + pad * 2, r.h + pad * 2, 1);
  }

  render(renderer: THREE.WebGLRenderer): void {
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
  }
}

const QUAD = new THREE.PlaneGeometry(1, 1);

export class PipView {
  readonly camera: THREE.PerspectiveCamera;
  visible = false;
  rect: ScreenRect = { x: 0, y: 0, w: 1, h: 1 };

  private readonly target: THREE.WebGLRenderTarget;
  private readonly image: THREE.Mesh;
  private readonly frame: THREE.Mesh;

  constructor(
    fovDeg: number,
    mirrored: boolean,
    private readonly overlay: PipOverlay,
  ) {
    this.camera = new THREE.PerspectiveCamera(fovDeg, 16 / 9, 0.05, 600);
    this.target = new THREE.WebGLRenderTarget(16, 9, { type: THREE.HalfFloatType, samples: 4 });
    const tex = this.target.texture;
    if (mirrored) {
      tex.repeat.x = -1;
      tex.offset.x = 1;
    }
    this.image = new THREE.Mesh(QUAD, new THREE.MeshBasicMaterial({ map: tex, depthTest: false, depthWrite: false }));
    this.frame = new THREE.Mesh(QUAD, new THREE.MeshBasicMaterial({ color: 0x0a0d12, depthTest: false, depthWrite: false }));
    this.image.renderOrder = 2;
    this.frame.renderOrder = 1;
    this.image.visible = false;
    this.frame.visible = false;
    overlay.scene.add(this.frame, this.image);
  }

  /** Position on screen and size the render target for the device pixel ratio. */
  setRect(r: ScreenRect, pixelRatio: number, frame = 3): void {
    this.rect = r;
    const w = Math.max(16, Math.round(r.w * pixelRatio));
    const h = Math.max(9, Math.round(r.h * pixelRatio));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    if (this.camera.aspect !== r.w / r.h) {
      this.camera.aspect = r.w / r.h;
      this.camera.updateProjectionMatrix();
    }
    this.overlay.place(this.image, r);
    this.overlay.place(this.frame, r, frame);
  }

  /** Render this view into its texture (call before the overlay pass). */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    this.image.visible = this.visible;
    this.frame.visible = this.visible;
    if (!this.visible) return;
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, this.camera);
  }
}
