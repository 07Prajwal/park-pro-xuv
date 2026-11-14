/**
 * Graphics quality presets. Selected with `?quality=low|medium|high` for now;
 * the Settings menu and adaptive "Auto" mode (Stage 7) build on the same table.
 */

export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualityPreset {
  level: QualityLevel;
  pixelRatioCap: number;
  shadowMapSize: number;
  /** MSAA samples on the HDR render target (0 = none). */
  msaa: number;
  /** Ground-truth ambient occlusion (contact shadows under the car, kerbs). */
  ao: boolean;
  /** Bloom on emissive lights. */
  bloom: boolean;
  /** Use the post-processing chain at all (HDR target + tone-map pass). */
  post: boolean;
  anisotropy: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: { level: 'low', pixelRatioCap: 1, shadowMapSize: 1024, msaa: 0, ao: false, bloom: false, post: false, anisotropy: 4 },
  medium: { level: 'medium', pixelRatioCap: 1.5, shadowMapSize: 2048, msaa: 4, ao: false, bloom: true, post: true, anisotropy: 8 },
  high: { level: 'high', pixelRatioCap: 2, shadowMapSize: 4096, msaa: 4, ao: true, bloom: true, post: true, anisotropy: 16 },
};

export function pickQuality(): QualityPreset {
  const q = new URLSearchParams(location.search).get('quality');
  if (q === 'low' || q === 'medium' || q === 'high') return QUALITY_PRESETS[q];
  // Phones / tablets start at medium; desktops at high.
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  return QUALITY_PRESETS[coarse ? 'medium' : 'high'];
}
