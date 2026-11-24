/* Images: ImageMagick compiled to WebAssembly. Adds HEIC, TIFF, PSD, JPEG XL, TGA, DDS... and more output formats. */
import { register } from '../registry.js';
import { baseName, jpegToPdf } from '../core.js';
import { MAGICK_WASM } from '../config.js';

const IN = ['heic', 'heif', 'tif', 'tiff', 'psd', 'jxl', 'jp2', 'tga', 'ppm', 'pgm', 'pbm', 'dds', 'xpm',
  /* browser-native formats too, as a fallback when the canvas path fails */ 'png', 'jpg', 'webp', 'gif', 'bmp', 'ico', 'avif'];
const OUT = { png: 'Png', jpg: 'Jpeg', webp: 'WebP', gif: 'Gif', bmp: 'Bmp', ico: 'Ico', tiff: 'Tiff', tga: 'Tga', avif: 'Avif', jxl: 'Jxl' };
const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', ico: 'image/x-icon', tiff: 'image/tiff', tga: 'image/x-tga', avif: 'image/avif', jxl: 'image/jxl' };

let lib = null, loading = null;
async function init(say) {
  if (lib) return lib;
  if (!loading) loading = (async () => {
    say('Loading ImageMagick (one-time download)…');
    const m = await import('@imagemagick/magick-wasm');
    const res = await fetch(MAGICK_WASM);
    if (!res.ok) throw new Error('Could not load the ImageMagick engine.');
    await m.initializeImageMagick(new Uint8Array(await res.arrayBuffer()));
    lib = m; return m;
  })().catch(e => { loading = null; throw e; });
  return loading;
}

register({
  id: 'magick', label: 'ImageMagick',
  can(ext) {
    if (!IN.includes(ext)) return [];
    return [...Object.keys(OUT), 'pdf'].filter(t => t !== ext && !(ext === 'jpg' && t === 'jpeg'));
  },
  async convert(file, ext, target, o) {
    const say = o.say || (() => {});
    const m = await init(say);
    say('Converting…');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const fmtKey = target === 'pdf' ? 'jpg' : target;
    const format = m.MagickFormat[OUT[fmtKey]];
    if (!format) throw new Error(`This ImageMagick build can't write ${target.toUpperCase()}.`);
    let out = null, w = 0, h = 0;
    m.ImageMagick.read(bytes, img => {
      w = img.width; h = img.height;
      if (fmtKey === 'ico' && (w > 256 || h > 256)) img.resize(256, 256);
      if (fmtKey === 'jpg' || fmtKey === 'webp') img.quality = Math.round((o.quality || 0.92) * 100);
      img.write(format, data => { out = new Uint8Array(data); });
    });
    if (!out) throw new Error('ImageMagick produced no output.');
    if (target === 'pdf') return { blob: jpegToPdf(out, w, h), name: baseName(file.name) + '.pdf' };
    return { blob: new Blob([out], { type: MIME[target] }), name: `${baseName(file.name)}.${target}` };
  }
});
