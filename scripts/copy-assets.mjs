// Copies the big WebAssembly/worker files out of node_modules into /public so they are served from your own domain.
import { cpSync, mkdirSync, existsSync } from 'node:fs';

const jobs = [
  ['node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js', 'public/ffmpeg/ffmpeg-core.js'],
  ['node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm', 'public/ffmpeg/ffmpeg-core.wasm'],
  ['node_modules/@imagemagick/magick-wasm/dist/magick.wasm', 'public/magick.wasm'],
  ['node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'public/pdf.worker.min.mjs'],
  ['node_modules/libarchive.js/dist', 'public/libarchive']
];
for (const [from, to] of jobs) {
  if (!existsSync(from)) { console.warn(`[copy-assets] missing ${from} (skipped) - that engine will not load until it is available`); continue; }
  mkdirSync(to.replace(/\/[^/]*$/, ''), { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log(`[copy-assets] ${from} -> ${to}`);
}
