import { defineConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// libarchive.js changed its package layout between versions (the documented "libarchive.js/main.js" entry
// is not importable in some releases). Find a real entry file on disk and alias to it by absolute path,
// which bypasses the package's "exports" map. If nothing is found, fall back to a stub so the build still succeeds.
function libarchiveEntry() {
  const root = path.resolve('node_modules/libarchive.js');
  try {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    const candidates = ['main.js', pkg.module, pkg.main, 'dist/libarchive.js', 'dist/libarchive.mjs'].filter(Boolean);
    for (const c of candidates) {
      const p = path.resolve(root, c);
      if (existsSync(p)) { console.log(`[libarchive] using ${path.relative(process.cwd(), p)} (v${pkg.version})`); return p; }
    }
  } catch (e) { /* not installed */ }
  console.warn('[libarchive] entry not found - 7z/RAR/TAR unpacking will be disabled in this build');
  return path.resolve('src/stubs/libarchive-missing.js');
}

export default defineConfig({
  resolve: { alias: { 'libarchive-entry': libarchiveEntry() } },
  // pandoc-wasm ships its .wasm as an asset
  assetsInclude: ['**/*.wasm'],
  // ffmpeg.wasm starts its own module worker, so Vite must not pre-bundle it
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  worker: { format: 'es' }
});
