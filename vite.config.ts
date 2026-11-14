import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works from any GitHub Pages sub-path (/<repo>/).
  base: './',
  build: {
    target: 'es2022',
    // rapier3d-compat inlines its WASM as base64 (~4.3 MB, ~1.6 MB gzip) in the lazily loaded game chunk.
    chunkSizeWarningLimit: 5000,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
