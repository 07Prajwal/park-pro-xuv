/**
 * Three.js renderer, scene, lights and resize handling.
 */

import * as THREE from 'three';
import { RENDER } from '../config';

export interface RenderContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  resize(): void;
  /** Keep the shadow frustum centred on a point (the car) so it stays sharp. */
  followShadow(x: number, z: number): void;
}

export function createRenderContext(canvas: HTMLCanvasElement): RenderContext {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const skyColour = new THREE.Color(0xa9c8e8);
  scene.background = skyColour;
  scene.fog = new THREE.Fog(skyColour, RENDER.fogNear, RENDER.fogFar);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 600);

  scene.add(new THREE.HemisphereLight(0xdfefff, 0x5a5048, 1.1));

  const sun = new THREE.DirectionalLight(0xfff3e0, 2.4);
  const sunOffset = new THREE.Vector3(-35, 60, -25);
  sun.position.copy(sunOffset);
  sun.castShadow = true;
  sun.shadow.mapSize.set(RENDER.shadowMapSize, RENDER.shadowMapSize);
  const sc = sun.shadow.camera;
  sc.left = -RENDER.shadowRadiusM;
  sc.right = RENDER.shadowRadiusM;
  sc.top = RENDER.shadowRadiusM;
  sc.bottom = -RENDER.shadowRadiusM;
  sc.near = 1;
  sc.far = 200;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);

  // Snap the shadow frustum to texel-sized steps to prevent shimmering as it moves.
  const texel = (RENDER.shadowRadiusM * 2) / RENDER.shadowMapSize;
  function followShadow(x: number, z: number): void {
    const sx = Math.round(x / texel) * texel;
    const sz = Math.round(z / texel) * texel;
    sun.target.position.set(sx, 0, sz);
    sun.position.set(sx + sunOffset.x, sunOffset.y, sz + sunOffset.z);
  }

  function resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();

  return { renderer, scene, camera, sun, resize, followShadow };
}
