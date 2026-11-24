import { defineConfig } from 'vite';

export default defineConfig({
  // pandoc-wasm ships its .wasm as an asset
  assetsInclude: ['**/*.wasm'],
  // ffmpeg.wasm starts its own module worker, so Vite must not pre-bundle it
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  worker: { format: 'es' }
});
