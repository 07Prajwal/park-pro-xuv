/**
 * PBR surface materials with world-space texture coordinates.
 *
 * Textures are projected from world position instead of mesh UVs, so tiles stay
 * the same real-world size on every object (no stretching on long kerbs or scaled
 * instances). Optional macro variation re-samples the albedo at two much larger
 * scales to break up visible tiling on big surfaces like the ground.
 */

import * as THREE from 'three';
import type { PbrSet } from '../core/assets';

export interface SurfaceOptions {
  /** Real-world size of one texture tile, metres. */
  tileM: number;
  /** 0..1 strength of large-scale albedo variation. */
  macro?: number;
  /** Project vertical faces from the side (kerbs, pillars) instead of from above. */
  triplanar?: boolean;
  color?: THREE.ColorRepresentation;
  roughnessScale?: number;
  normalScale?: number;
}

export function createSurfaceMaterial(set: PbrSet, opts: SurfaceOptions): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map: set.map,
    normalMap: set.normalMap,
    roughnessMap: set.orm,
    aoMap: set.orm,
    aoMapIntensity: 1,
    roughness: opts.roughnessScale ?? 1,
    metalness: 0,
    color: opts.color ?? 0xffffff,
  });
  const ns = opts.normalScale ?? 1;
  mat.normalScale.set(ns, ns);
  applyWorldUv(mat, opts.tileM, opts.macro ?? 0, opts.triplanar ?? false);
  return mat;
}

export function applyWorldUv(mat: THREE.Material, tileM: number, macro: number, triplanar: boolean): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWorldUvScale = { value: 1 / tileM };
    shader.uniforms.uMacro = { value: macro };
    shader.vertexShader =
      'uniform float uWorldUvScale;\n' +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
        {
          vec4 wp = vec4(transformed, 1.0);
          vec3 wn = objectNormal;
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
            wn = mat3(instanceMatrix) * wn;
          #endif
          wp = modelMatrix * wp;
          wn = normalize(mat3(modelMatrix) * wn);
          vec2 wuv = wp.xz;
          ${
            triplanar
              ? `if (abs(wn.y) < 0.7) { wuv = abs(wn.x) > abs(wn.z) ? wp.zy : wp.xy; }`
              : ''
          }
          wuv *= uWorldUvScale;
          #ifdef USE_MAP
            vMapUv = wuv;
          #endif
          #ifdef USE_NORMALMAP
            vNormalMapUv = wuv;
          #endif
          #ifdef USE_ROUGHNESSMAP
            vRoughnessMapUv = wuv;
          #endif
          #ifdef USE_AOMAP
            vAoMapUv = wuv;
          #endif
          #ifdef USE_ALPHAMAP
            vAlphaMapUv = wuv;
          #endif
        }`,
      );
    if (macro > 0) {
      shader.fragmentShader =
        'uniform float uMacro;\n' +
        shader.fragmentShader.replace(
          '#include <map_fragment>',
          /* glsl */ `#include <map_fragment>
          #ifdef USE_MAP
          {
            // Blurred (mip-biased) large-scale samples, normalised by the texture's average (top mip).
            float m1 = texture(map, vMapUv * 0.083 + vec2(0.31, 0.17), 3.0).g;
            float m2 = texture(map, vMapUv * 0.0137 + vec2(0.71, 0.53), 3.0).g;
            float m = (m1 * 0.55 + m2 * 0.45) / max(0.001, textureLod(map, vec2(0.5), 12.0).g);
            diffuseColor.rgb *= mix(1.0, clamp(m, 0.6, 1.4), uMacro);
          }
          #endif`,
        );
    }
  };
  mat.customProgramCacheKey = () => `worldUv:${tileM}:${macro}:${triplanar}`;
}
