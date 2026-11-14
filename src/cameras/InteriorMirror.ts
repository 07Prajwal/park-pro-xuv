/**
 * Interior rear-view mirror: a backward-looking camera at the mirror rendered
 * into a small HDR texture, shown (mirrored) on the mirror glass. Only drawn
 * when the driver's-seat view is active, at half the display rate.
 */

import * as THREE from 'three';

const WIDTH_PX = 384;
const HEIGHT_PX = 88;

export class InteriorMirror {
  readonly camera: THREE.PerspectiveCamera;
  visible = false;
  private readonly target: THREE.WebGLRenderTarget;
  private frame = 0;

  constructor(parent: THREE.Object3D, mount: THREE.Vector3, glass: THREE.Mesh) {
    this.camera = new THREE.PerspectiveCamera(16, WIDTH_PX / HEIGHT_PX, 0.3, 300);
    // Looks back (-Z in the car frame) through the rear window, slightly down.
    this.camera.position.copy(mount).add(new THREE.Vector3(0, 0, -0.03));
    this.camera.rotation.set(-0.06, 0, 0, 'YXZ');
    parent.add(this.camera);
    this.target = new THREE.WebGLRenderTarget(WIDTH_PX, HEIGHT_PX, { type: THREE.HalfFloatType, samples: 2 });
    const tex = this.target.texture;
    tex.repeat.x = -1;
    tex.offset.x = 1;
    const mat = glass.material as THREE.MeshBasicMaterial;
    mat.map = tex;
    mat.color.setHex(0xd8dadc);
    mat.needsUpdate = true;
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    if (!this.visible || this.frame++ % 2) return;
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, this.camera);
    renderer.setRenderTarget(null);
  }
}
