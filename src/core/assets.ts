/**
 * Preloads every texture the game needs before the first frame (no mid-game
 * loading hitches). Assets are CC0 from Poly Haven; see scripts/fetch-assets.py.
 */

import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

export interface PbrSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  /** R = ambient occlusion, G = roughness. */
  orm: THREE.Texture;
}

export type SurfaceName = 'asphalt' | 'grass' | 'concrete' | 'brick' | 'plaster' | 'pavers';

export interface GameAssets {
  skyBackground: THREE.Texture;
  skyHdr: THREE.DataTexture;
  /** Unit vector towards the sun, extracted from the HDRI. */
  sunDirection: THREE.Vector3;
  surfaces: Record<SurfaceName, PbrSet>;
}

const SURFACES: SurfaceName[] = ['asphalt', 'grass', 'concrete', 'brick', 'plaster', 'pavers'];

export async function loadAssets(anisotropy: number, onProgress: (fraction: number) => void): Promise<GameAssets> {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => onProgress(loaded / total);
  const base = `${import.meta.env.BASE_URL}assets/`;
  const tex = new THREE.TextureLoader(manager);
  const hdr = new HDRLoader(manager).setDataType(THREE.FloatType);

  const load = (path: string, srgb: boolean): Promise<THREE.Texture> =>
    tex.loadAsync(base + path).then((t) => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = anisotropy;
      return t;
    });

  const surfacePromises = SURFACES.map(async (name) => {
    const [map, normalMap, orm] = await Promise.all([
      load(`textures/${name}_diff.webp`, true),
      load(`textures/${name}_nor.webp`, false),
      load(`textures/${name}_orm.webp`, false),
    ]);
    return [name, { map, normalMap, orm }] as const;
  });

  const [skyBackground, skyHdr, surfaceEntries] = await Promise.all([
    load('hdri/sky_bg.webp', true),
    hdr.loadAsync(`${base}hdri/sky_1k.hdr`),
    Promise.all(surfacePromises),
  ]);
  skyBackground.mapping = THREE.EquirectangularReflectionMapping;
  skyBackground.wrapT = THREE.ClampToEdgeWrapping;
  skyHdr.mapping = THREE.EquirectangularReflectionMapping;

  return {
    skyBackground,
    skyHdr,
    sunDirection: findSunDirection(skyHdr),
    surfaces: Object.fromEntries(surfaceEntries) as Record<SurfaceName, PbrSet>,
  };
}

/**
 * Locate the brightest pixel of an equirectangular HDR and convert it to a
 * direction using Three.js' equirect convention:
 *   u = atan(z, x) / 2pi + 0.5,  v = asin(y) / pi + 0.5  (row 0 of the file is the top, v = 1).
 */
function findSunDirection(t: THREE.DataTexture): THREE.Vector3 {
  const { data, width, height } = t.image as { data: Float32Array; width: number; height: number };
  let best = -1;
  let bx = 0;
  let by = 0;
  for (let y = 0; y < height / 2; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      if (lum > best) {
        best = lum;
        bx = x;
        by = y;
      }
    }
  }
  const u = (bx + 0.5) / width;
  const v = 1 - (by + 0.5) / height;
  const phi = (u - 0.5) * 2 * Math.PI;
  const el = (v - 0.5) * Math.PI;
  return new THREE.Vector3(Math.cos(el) * Math.cos(phi), Math.sin(el), Math.cos(el) * Math.sin(phi)).normalize();
}
