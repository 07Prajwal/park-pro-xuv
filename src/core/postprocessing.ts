/**
 * Post-processing chain: HDR (half-float) MSAA render target -> GTAO ambient
 * occlusion (High) -> subtle bloom on lamps (Medium/High) -> tone mapping + sRGB.
 * Low quality skips this entirely and renders straight to the screen.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { QualityPreset } from './quality';

export class PostProcessing {
  private readonly composer: EffectComposer;
  private readonly gtao?: GTAOPass;
  private readonly bloom?: UnrealBloomPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, q: QualityPreset) {
    const size = renderer.getSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: q.msaa,
    });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));

    if (q.ao) {
      this.gtao = new GTAOPass(scene, camera, size.x, size.y);
      this.gtao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.5, thickness: 1.5, scale: 1.0, samples: 12 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      this.gtao.blendIntensity = 0.85;
      this.composer.addPass(this.gtao);
    }
    if (q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.25, 0.35, 3.5);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
  }

  render(dt: number): void {
    this.composer.render(dt);
  }
}
