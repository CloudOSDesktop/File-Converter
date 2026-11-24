/*
 * Where the big WebAssembly files come from.
 * By default they are copied from node_modules into /public at install time (scripts/copy-assets.mjs)
 * and served from your own domain. If you hit a deployment-size limit, point FFMPEG_BASE at a CDN instead:
 *   export const FFMPEG_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';
 */
export const FFMPEG_BASE = '/ffmpeg';
export const MAGICK_WASM = '/magick.wasm';
export const PDF_WORKER = '/pdf.worker.min.mjs';
export const LIBARCHIVE_WORKER = '/libarchive/worker-bundle.js';
export const API_URL = '/api/cloudconvert';
