/**
 * Three.js renderer, scene, image-based lighting, sun and post-processing.
 *
 * Lighting: a real sky HDRI provides both the visible sky and the ambient /
 * reflection lighting (PMREM), and a shadow-casting directional light is placed
 * exactly where the sun is in that HDRI so shadows match the sky.
 */

import * as THREE from 'three';
import { RENDER } from '../config';
import type { GameAssets } from './assets';
import { PostProcessing } from './postprocessing';
import type { QualityPreset } from './quality';

export interface RenderContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  quality: QualityPreset;
  resize(): void;
  render(dt: number): void;
  /** Keep the shadow frustum centred on a point (the car) so it stays sharp. */
  followShadow(x: number, z: number): void;
}

export function createRenderer(canvas: HTMLCanvasElement, quality: QualityPreset): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !quality.post, // MSAA happens on the HDR target when post-processing is on
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatioCap));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // The game flags one shadow update per frame so extra views (mirrors, reverse camera) reuse it.
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  return renderer;
}

export function createRenderContext(
  renderer: THREE.WebGLRenderer,
  assets: GameAssets,
  quality: QualityPreset,
): RenderContext {
  const scene = new THREE.Scene();

  // Sky + image-based lighting.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(assets.skyHdr).texture;
  pmrem.dispose();
  scene.environmentIntensity = 0.85;
  scene.background = assets.skyBackground;
  scene.backgroundIntensity = 1.05;
  scene.fog = new THREE.Fog(RENDER.fogColour, RENDER.fogNear, RENDER.fogFar);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.15, RENDER.cameraFar);

  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  const sunOffset = assets.sunDirection.clone().multiplyScalar(120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  const sc = sun.shadow.camera;
  sc.left = -RENDER.shadowRadiusM;
  sc.right = RENDER.shadowRadiusM;
  sc.top = RENDER.shadowRadiusM;
  sc.bottom = -RENDER.shadowRadiusM;
  sc.near = 10;
  sc.far = 260;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 2.5;
  scene.add(sun, sun.target);
  // The HDRI's diffuse light ignores shadows and has no bounce from the sunlit ground, so faces
  // turned away from the sun go near-black; a soft sky / ground fill stands in for the bounce.
  scene.add(new THREE.HemisphereLight(0xc4d6f0, 0x8f8a82, 0.7));

  const post = quality.post ? new PostProcessing(renderer, scene, camera, quality) : null;

  // Snap the shadow frustum to texel-sized steps to prevent shimmering as it moves.
  const texel = (RENDER.shadowRadiusM * 2) / quality.shadowMapSize;
  function followShadow(x: number, z: number): void {
    const sx = Math.round(x / texel) * texel;
    const sz = Math.round(z / texel) * texel;
    sun.target.position.set(sx, 0, sz);
    sun.position.set(sx + sunOffset.x, sunOffset.y, sz + sunOffset.z);
  }

  function resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio, quality.pixelRatioCap);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    post?.setSize(w, h, pr);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();

  function render(dt: number): void {
    renderer.shadowMap.needsUpdate = true;
    if (post) post.render(dt);
    else renderer.render(scene, camera);
  }

  return { renderer, scene, camera, sun, quality, resize, render, followShadow };
}
