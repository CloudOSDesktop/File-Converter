/*
 * Converter registry.
 * Every engine says which targets it can produce for a given input extension (can) and how to convert (convert).
 * The first engine that claims a target is preferred; the others are kept as fallbacks if it fails.
 */
import * as core from './core.js';

const engines = [];
export function register(engine) { engines.push(engine); }

/* ---------- labels, ordering, kinds ---------- */
const LABEL = Object.assign({}, core.LABEL, {
  jpg: 'JPG', mp3: 'MP3', ogg: 'OGG', flac: 'FLAC', m4a: 'M4A', aac: 'AAC', opus: 'Opus', aiff: 'AIFF', wma: 'WMA',
  mp4: 'MP4', mkv: 'MKV', avi: 'AVI', mov: 'MOV', webm: 'WebM', tiff: 'TIFF', tga: 'TGA', avif: 'AVIF', jxl: 'JPEG XL',
  xlsx: 'XLSX', xls: 'XLS', ods: 'ODS', odt: 'ODT', epub: 'EPUB', rtf: 'RTF', tex: 'LaTeX', rst: 'reST', textile: 'Textile',
  org: 'Org', adoc: 'AsciiDoc', mediawiki: 'MediaWiki', pptx: 'PPTX', ppt: 'PPT', odp: 'ODP', doc: 'DOC', mobi: 'MOBI',
  azw3: 'AZW3', 'pdf-split': 'Split into pages (ZIP)'
});
const ORDER = ['png', 'jpg', 'webp', 'gif', 'bmp', 'ico', 'tiff', 'tga', 'avif', 'jxl', 'svg',
  'pdf', 'pdf-split', 'docx', 'doc', 'odt', 'rtf', 'txt', 'md', 'html', 'epub', 'mobi', 'azw3', 'tex', 'rst', 'textile', 'org', 'adoc', 'mediawiki',
  'pptx', 'ppt', 'odp', 'xlsx', 'xls', 'ods', 'json', 'csv', 'tsv', 'xml', 'yaml',
  'mp3', 'wav', 'ogg', 'opus', 'flac', 'm4a', 'aac', 'aiff', 'wma', 'mp4', 'webm', 'mkv', 'avi', 'mov', 'base64'];
const baseId = t => t.replace('~cloud', '');
export function labelFor(t, ctx) {
  const b = baseId(t);
  let l = LABEL[b] || b.toUpperCase();
  if (b === 'png' && ctx && ctx.allVideo) l = 'PNG (still frame)';
  if (b === 'jpg' && ctx && ctx.allVideo) l = 'JPG (still frame)';
  if (b === 'png' && ctx && ctx.allPdf) l = 'PNG (each page)';
  if (b === 'jpg' && ctx && ctx.allPdf) l = 'JPG (each page)';
  if (b === 'webp' && ctx && ctx.allPdf) l = 'WebP (each page)';
  if (b === 'txt' && ctx && ctx.allPdf) l = 'TXT (extracted text)';
  return t.endsWith('~cloud') ? l + ' · server' : l;
}
export function sortTargets(list) {
  const rank = t => { const i = ORDER.indexOf(baseId(t)); return (t.endsWith('~cloud') ? 1000 : 0) + (i < 0 ? 500 : i); };
  return list.slice().sort((a, b) => rank(a) - rank(b));
}

const MORE_KIND = {
  image: ['heic', 'heif', 'tif', 'tiff', 'psd', 'jxl', 'jp2', 'tga', 'ppm', 'pgm', 'pbm', 'dds', 'xpm'],
  audio: ['wma', 'aiff', 'aif', 'amr', 'ac3', 'mka'],
  video: ['avi', 'flv', 'wmv', '3gp', 'mts', 'ts', 'mpg', 'mpeg'],
  spreadsheet: ['xlsx', 'xls', 'xlsm', 'ods', 'numbers'],
  doc: ['odt', 'epub', 'rtf', 'tex', 'rst', 'textile', 'org', 'adoc', 'mediawiki', 'fb2', 'ipynb', 'mobi', 'azw3', 'doc', 'wps', 'pages'],
  presentation: ['ppt', 'pptx', 'odp', 'key'],
  pdf: ['pdf'],
  vector: ['ai', 'eps', 'ps', 'cdr', 'dwg', 'dxf'],
  archive: ['7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'tbz2', 'xz', 'txz', 'lzma', 'cab', 'iso']
};
export const ARCHIVE_EXTS = MORE_KIND.archive;
export function kindOfFile(file) {
  const k = core.kindOf(file);
  if (k !== 'other') return k;
  const e = core.normExt(core.extOf(file.name));
  for (const kind in MORE_KIND) if (MORE_KIND[kind].includes(e)) return kind;
  return 'other';
}

/* ---------- native engine (no downloads, works offline) ---------- */
const nativeKindOfExt = ext => {
  for (const k in core.EXT) if (core.EXT[k].includes(ext)) return k;
  for (const k in core.EXT) if (core.EXT[k].map(core.normExt).includes(ext)) return k;
  return null;
};
register({
  id: 'native', label: 'Built-in',
  can(ext) {
    const k = nativeKindOfExt(ext);
    return k ? core.TARGETS[k].filter(t => t !== ext) : ['base64'];
  },
  convert(file, ext, target, opts) {
    const k = nativeKindOfExt(ext) || 'other';
    return core.convertFile(file, k, ext, target, opts);
  }
});

/* ---------- planning + converting ---------- */
export function planFor(ext) {
  ext = core.normExt(ext);
  const plan = new Map();
  for (const e of engines) {
    if (e.enabled && !e.enabled()) continue;
    for (const t of e.can(ext) || []) { if (!plan.has(t)) plan.set(t, []); plan.get(t).push(e); }
  }
  if (!plan.has('base64')) plan.set('base64', [engines[0]]);
  return plan;
}
export async function convert(file, ext, target, opts) {
  ext = core.normExt(ext);
  const list = planFor(ext).get(target) || [];
  let last = new Error("That conversion isn't supported.");
  for (let i = 0; i < list.length; i++) {
    try { return await list[i].convert(file, ext, target, opts); }
    catch (err) {
      last = err;
      if (i + 1 < list.length) opts.say && opts.say(`${list[i].label} couldn't do it — trying ${list[i + 1].label}…`);
    }
  }
  throw last;
}

/* engines can add async startup work (e.g. asking the server what is enabled) */
const startup = [];
export function onStartup(fn) { startup.push(fn); }
export const ready = () => Promise.all(startup.map(f => f().catch(() => {})));
