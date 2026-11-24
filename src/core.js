/* Core: native (no-dependency) converters. Everything here runs in the browser with built-in APIs only. */

/* ============================ helpers ============================ */
const EXT = {
  image: ['png','jpg','jpeg','jpe','webp','gif','bmp','ico','svg','avif'],
  audio: ['mp3','wav','ogg','oga','m4a','aac','flac','weba','opus'],
  video: ['mp4','webm','mov','m4v','ogv','mkv'],
  data:  ['json','csv','tsv','xml','yaml','yml'],
  doc:   ['txt','md','markdown','html','htm','docx']
};
const TARGETS = {
  image: ['png','jpg','webp','gif','bmp','ico','svg','pdf','base64'],
  audio: ['wav','base64'],
  video: ['wav','png','base64'],
  data:  ['json','csv','tsv','xml','yaml','base64'],
  doc:   ['txt','md','html','docx','pdf','base64'],
  other: ['base64']
};
const LABEL = {png:'PNG',jpg:'JPG',webp:'WebP',gif:'GIF',bmp:'BMP',ico:'ICO',svg:'SVG',pdf:'PDF',base64:'Base64 text',wav:'WAV',
  json:'JSON',csv:'CSV',tsv:'TSV',xml:'XML',yaml:'YAML',txt:'TXT',md:'Markdown',html:'HTML',docx:'DOCX'};
const MIME = {json:'application/json',csv:'text/csv',tsv:'text/tab-separated-values',xml:'application/xml',yaml:'text/yaml',
  txt:'text/plain',md:'text/markdown',html:'text/html',
  docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};

const extOf = n => { const m = /\.([^.\/\\]+)$/.exec(n); return m ? m[1].toLowerCase() : ''; };
const normExt = e => ({jpeg:'jpg',jpe:'jpg',yml:'yaml',htm:'html',markdown:'md',oga:'ogg',weba:'webm'}[e] || e);
const baseName = n => n.replace(/\.[^.\/\\]*$/, '') || 'file';
function kindOf(file) {
  const e = extOf(file.name);
  for (const k in EXT) if (EXT[k].includes(e)) return k;
  const t = file.type || '';
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('video/')) return 'video';
  return 'other';
}
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const xesc = s => esc(s).replace(/"/g,'&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'');
const bytesOf = s => { const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 255; return a; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function concat(parts) {
  const arr = parts.map(p => typeof p === 'string' ? bytesOf(p) : p);
  const out = new Uint8Array(arr.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of arr) { out.set(p, o); o += p.length; }
  return out;
}
const le16 = n => [n & 255, (n >> 8) & 255];
const le32 = n => [n & 255, (n >> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

let CRC_T = null;
function crc32(u8) {
  if (!CRC_T) { CRC_T = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c >>> 0; } }
  let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* ============================ ZIP (store) + read ============================ */
function zipStore(files) {
  const parts = [], central = []; let off = 0;
  for (const f of files) {
    const name = new TextEncoder().encode(f.name), crc = crc32(f.data), sz = f.data.length;
    const lh = Uint8Array.from([0x50,0x4B,3,4, ...le16(20), ...le16(0x0800), ...le16(0), ...le16(0), ...le16(33), ...le32(crc), ...le32(sz), ...le32(sz), ...le16(name.length), ...le16(0)]);
    central.push(Uint8Array.from([0x50,0x4B,1,2, ...le16(20), ...le16(20), ...le16(0x0800), ...le16(0), ...le16(0), ...le16(33), ...le32(crc), ...le32(sz), ...le32(sz), ...le16(name.length), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(off)]), name);
    parts.push(lh, name, f.data); off += lh.length + name.length + sz;
  }
  const cd = concat(central);
  const end = Uint8Array.from([0x50,0x4B,5,6, 0,0, 0,0, ...le16(files.length), ...le16(files.length), ...le32(cd.length), ...le32(off), 0,0]);
  return concat([...parts, cd, end]);
}
async function inflateRaw(u8) {
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function zipEntries(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let e = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('not a valid zip file');
  const count = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
  if (count === 0xFFFF || p === 0xFFFFFFFF) throw new Error('zip64 archives are not supported');
  const list = [];
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl));
    list.push({ name, flags, method, csize, usize, lho, u8, dv });
    p += 46 + nl + el + cl;
  }
  return list;
}
async function zipExtract(en) {
  if (en.flags & 1) throw new Error('password-protected entry');
  if (en.method !== 0 && en.method !== 8) throw new Error('unsupported compression');
  const start = en.lho + 30 + en.dv.getUint16(en.lho + 26, true) + en.dv.getUint16(en.lho + 28, true);
  const data = en.u8.subarray(start, start + en.csize);
  return en.method === 0 ? data : inflateRaw(data);
}
async function zipRead(buf, wanted) {
  const en = zipEntries(buf).find(x => x.name === wanted);
  return en ? zipExtract(en) : null;
}
/* other archive formats (7z, rar, tar...) are unpacked by an engine registered at runtime */
const ARCHIVE_HOOK = { exts: new Set(), extract: null };
function setArchiveHook(exts, extract) { ARCHIVE_HOOK.exts = new Set(exts); ARCHIVE_HOOK.extract = extract; }
/* expand .zip files (also nested) into their contents */
async function expandZips(fs, depth) {
  const files = [], notes = []; depth = depth || 0;
  for (const f of fs) {
    if (depth <= 2 && ARCHIVE_HOOK.extract && ARCHIVE_HOOK.exts.has(extOf(f.name))) {
      try {
        const out = await ARCHIVE_HOOK.extract(f);
        out.forEach(x => { if (!x.from) x.from = f.name; });
        const inner = await expandZips(out, depth + 1);
        files.push(...inner.files); notes.push(...inner.notes);
        if (!out.length) notes.push(`${f.name} had no usable files inside.`);
      } catch (err) { notes.push(`${f.name}: ${err.message}`); }
      continue;
    }
    if (!(extOf(f.name) === 'zip' || /zip/.test(f.type || '')) || depth > 2) { files.push(f); continue; }
    try {
      const list = zipEntries(await f.arrayBuffer()).filter(en => !/\/$/.test(en.name) && !/(^|\/)(__MACOSX\/|\.[^\/]*$)/.test(en.name));
      if (list.length > 2000) throw new Error('too many files in the archive');
      if (list.reduce((n, en) => n + en.usize, 0) > 800 * 1048576) throw new Error('archive is too large to unpack in the browser');
      list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      const used = new Set(), out = [];
      for (const en of list) {
        let name = en.name.split('/').pop();
        if (used.has(name.toLowerCase())) name = en.name.split('/').slice(-2).join('_');
        used.add(name.toLowerCase());
        try { const nf = new File([await zipExtract(en)], name); nf.from = f.name; out.push(nf); }
        catch (err) { notes.push(`${en.name}: ${err.message}`); }
      }
      const inner = await expandZips(out, depth + 1);
      inner.files.forEach(x => { if (!x.from) x.from = f.name; files.push(x); });
      notes.push(...inner.notes);
      if (!out.length && !notes.length) notes.push(`${f.name} had no usable files inside.`);
    } catch (err) { notes.push(`${f.name}: ${err.message}`); }
  }
  return { files, notes };
}

/* ============================ PDF ============================ */
function buildPdf(objs) {
  const head = bytesOf('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n'); const parts = [head]; const offs = []; let pos = head.length;
  objs.forEach((o, i) => {
    offs.push(pos);
    const seg = [bytesOf(`${i + 1} 0 obj\n`), ...o.map(p => typeof p === 'string' ? bytesOf(p) : p), bytesOf('\nendobj\n')];
    seg.forEach(s => { parts.push(s); pos += s.length; });
  });
  let x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  x += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF`;
  parts.push(bytesOf(x));
  return new Blob(parts, { type: 'application/pdf' });
}
function pdfEsc(s) {
  let o = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c === 40 || c === 41 || c === 92) o += '\\' + ch;
    else if (c < 32) continue;
    else if (c < 127) o += ch;
    else o += '\\' + (c > 255 ? 63 : c).toString(8).padStart(3, '0');
  }
  return o;
}
function wrapLine(line, w) {
  if (line.length <= w) return [line];
  const out = [];
  while (line.length > w) {
    let b = line.lastIndexOf(' ', w);
    if (b < w * 0.5) b = w;
    out.push(line.slice(0, b).replace(/\s+$/, ''));
    line = line.slice(b).replace(/^ +/, '');
  }
  out.push(line);
  return out;
}
function textToPdf(text) {
  const W = 84, H = 56, lines = [];
  text.replace(/\r\n?/g, '\n').split('\n').forEach(l => wrapLine(l.replace(/\t/g, '    '), W).forEach(x => lines.push(x)));
  const pages = [];
  for (let i = 0; i < lines.length; i += H) pages.push(lines.slice(i, i + H));
  if (!pages.length) pages.push([]);
  const objs = [
    ['<< /Type /Catalog /Pages 2 0 R >>'],
    [`<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`],
    ['<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>']
  ];
  pages.forEach((pg, i) => {
    const content = 'BT /F1 10 Tf 12 TL 54 738 Td\n' + pg.map(l => `(${pdfEsc(l)}) Tj T*`).join('\n') + '\nET';
    objs.push([`<< /Length ${content.length} >>\nstream\n`, content, '\nendstream']);
    objs.push([`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${4 + i * 2} 0 R >>`]);
  });
  return buildPdf(objs);
}
function jpegToPdf(jpg, w, h) {
  const pw = Math.max(3, Math.round(w * 0.75 * 100) / 100), ph = Math.max(3, Math.round(h * 0.75 * 100) / 100);
  const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
  return buildPdf([
    ['<< /Type /Catalog /Pages 2 0 R >>'],
    ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`],
    [`<< /Length ${content.length} >>\nstream\n`, content, '\nendstream'],
    [`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`, jpg, '\nendstream']
  ]);
}

/* ============================ image encoders ============================ */
function encodeBMP(px, w, h) {
  const row = Math.ceil(w * 3 / 4) * 4, size = 54 + row * h, b = new Uint8Array(size), v = new DataView(b.buffer);
  b[0] = 0x42; b[1] = 0x4D; v.setUint32(2, size, true); v.setUint32(10, 54, true); v.setUint32(14, 40, true);
  v.setInt32(18, w, true); v.setInt32(22, h, true); v.setUint16(26, 1, true); v.setUint16(28, 24, true);
  v.setUint32(34, row * h, true); v.setInt32(38, 2835, true); v.setInt32(42, 2835, true);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = ((h - 1 - y) * w + x) * 4, d = 54 + y * row + x * 3;
    b[d] = px[s + 2]; b[d + 1] = px[s + 1]; b[d + 2] = px[s];
  }
  return b;
}
function encodeICOfromPng(png, size) {
  const s = size >= 256 ? 0 : size;
  return concat([Uint8Array.from([0,0,1,0,1,0, s,s,0,0, ...le16(1), ...le16(32), ...le32(png.length), ...le32(22)]), png]);
}
function lzwGif(idx) {
  const min = 8, clear = 256, eoi = 257, bytes = [];
  let buf = 0, cnt = 0, size = min + 1, next = eoi + 1, table = new Map();
  const emit = c => { buf |= c << cnt; cnt += size; while (cnt >= 8) { bytes.push(buf & 255); buf >>>= 8; cnt -= 8; } };
  emit(clear);
  let cur = idx[0];
  for (let i = 1; i < idx.length; i++) {
    const k = idx[i], key = (cur << 8) | k, hit = table.get(key);
    if (hit !== undefined) { cur = hit; continue; }
    emit(cur);
    if (next === 4096) { emit(clear); table = new Map(); next = eoi + 1; size = min + 1; }
    else { if (next >= (1 << size)) size++; table.set(key, next++); }
    cur = k;
  }
  emit(cur); emit(eoi);
  if (cnt > 0) bytes.push(buf & 255);
  return bytes;
}
function encodeGIF(px, w, h) {
  const idx = new Uint8Array(w * h);
  for (let i = 0; i < idx.length; i++) idx[i] = ((px[i*4] >> 5) << 5) | ((px[i*4+1] >> 5) << 2) | (px[i*4+2] >> 6);
  const pal = new Uint8Array(768);
  for (let i = 0; i < 256; i++) { pal[i*3] = Math.round((i >> 5) * 255 / 7); pal[i*3+1] = Math.round(((i >> 2) & 7) * 255 / 7); pal[i*3+2] = Math.round((i & 3) * 255 / 3); }
  const data = lzwGif(idx), sub = [];
  for (let i = 0; i < data.length; i += 255) { const ch = data.slice(i, i + 255); sub.push(Uint8Array.from([ch.length]), Uint8Array.from(ch)); }
  return concat(['GIF89a', Uint8Array.from([...le16(w), ...le16(h), 0xF7, 0, 0]), pal,
    Uint8Array.from([0x2C, 0,0,0,0, ...le16(w), ...le16(h), 0, 8]), ...sub, Uint8Array.from([0, 0x3B])]);
}
function encodeWAV(buf) {
  const ch = buf.numberOfChannels, len = buf.length, rate = buf.sampleRate, size = 44 + len * ch * 2;
  const out = new ArrayBuffer(size), v = new DataView(out);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, size - 8, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, ch, true); v.setUint32(24, rate, true); v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, len * ch * 2, true);
  const chans = []; for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, chans[c][i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true); o += 2; }
  return new Blob([out], { type: 'audio/wav' });
}

/* ============================ data formats ============================ */
function infer(s) {
  if (s === '') return '';
  if (s === 'true') return true; if (s === 'false') return false;
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(s)) { const n = Number(s); if (isFinite(n) && String(n) === s) return n; }
  return s;
}
function parseCSV(text, d) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"' && f === '') q = true;
    else if (c === d) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; rows.push(row); row = []; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const data = rows.filter(r => !(r.length === 1 && r[0] === ''));
  if (!data.length) return [];
  const seen = {};
  const head = data[0].map((h, i) => { let k = h.trim() || ('column' + (i + 1)); if (seen[k]) k += '_' + (++seen[k]); else seen[k] = 1; return k; });
  return data.slice(1).map(r => { const o = {}; head.forEach((h, i) => o[h] = infer(r[i] === undefined ? '' : r[i])); return o; });
}
const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
function unwrapTable(v) {
  while (isObj(v) && Object.keys(v).length === 1) {
    const x = v[Object.keys(v)[0]];
    if (Array.isArray(x)) return x;
    if (isObj(x)) v = x; else break;
  }
  return v;
}
function toCSV(v, d) {
  if (!Array.isArray(v)) { v = unwrapTable(v); if (!Array.isArray(v)) v = isObj(v) ? [v] : [{ value: v }]; }
  let rows;
  if (v.length && v.every(Array.isArray)) rows = v;
  else {
    const items = v.map(x => isObj(x) ? x : { value: x }), keys = new Set();
    items.forEach(o => Object.keys(o).forEach(k => keys.add(k)));
    const ks = [...keys]; rows = [ks, ...items.map(o => ks.map(k => o[k]))];
  }
  const cell = x => {
    let s = x === null || x === undefined ? '' : typeof x === 'object' ? JSON.stringify(x) : String(x);
    return /["\n\r]/.test(s) || s.includes(d) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return rows.map(r => r.map(cell).join(d)).join('\n') + '\n';
}
function xmlToJs(el) {
  const attrs = Array.from(el.attributes || []), kids = Array.from(el.childNodes).filter(n => n.nodeType === 1);
  const text = Array.from(el.childNodes).filter(n => n.nodeType === 3 || n.nodeType === 4).map(n => n.nodeValue).join('').trim();
  if (!attrs.length && !kids.length) return infer(text);
  const o = {};
  attrs.forEach(a => o['@' + a.name] = a.value);
  kids.forEach(k => {
    const v = xmlToJs(k), key = k.nodeName;
    if (key in o) { if (!Array.isArray(o[key])) o[key] = [o[key]]; o[key].push(v); } else o[key] = v;
  });
  if (text) o['#text'] = text;
  return o;
}
function parseXML(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new Error('Invalid XML: ' + err.textContent.trim().split('\n')[0].slice(0, 160));
  const root = doc.documentElement;
  return { [root.nodeName]: xmlToJs(root) };
}
const xmlName = k => { k = String(k).replace(/[^\w.\-:]/g, '_'); return /^[A-Za-z_]/.test(k) ? k : '_' + k; };
function xmlNode(name, v, ind) {
  const pad = '  '.repeat(ind), n = xmlName(name);
  if (Array.isArray(v)) return v.map(x => xmlNode(name, x, ind)).join('\n');
  if (v === null || v === undefined) return `${pad}<${n}/>`;
  if (typeof v !== 'object') return `${pad}<${n}>${xesc(v)}</${n}>`;
  const keys = Object.keys(v);
  const attrs = keys.filter(k => k[0] === '@').map(k => ` ${xmlName(k.slice(1))}="${xesc(v[k])}"`).join('');
  const text = v['#text'] !== undefined ? xesc(v['#text']) : '';
  const kids = keys.filter(k => k[0] !== '@' && k !== '#text');
  if (!kids.length) return text === '' ? `${pad}<${n}${attrs}/>` : `${pad}<${n}${attrs}>${text}</${n}>`;
  const inner = kids.map(k => xmlNode(k, v[k], ind + 1)).join('\n');
  return `${pad}<${n}${attrs}>${text ? '\n' + pad + '  ' + text : ''}\n${inner}\n${pad}</${n}>`;
}
function toXML(v) {
  let body;
  if (Array.isArray(v)) body = `<root>\n${v.map(x => xmlNode('item', x, 1)).join('\n')}\n</root>`;
  else if (isObj(v) && Object.keys(v).length === 1 && Object.keys(v)[0][0] !== '@' && Object.keys(v)[0] !== '#text' && !Array.isArray(v[Object.keys(v)[0]])) body = xmlNode(Object.keys(v)[0], v[Object.keys(v)[0]], 0);
  else body = xmlNode('root', v, 0);
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + body + '\n';
}
function yamlStr(s) {
  if (s === '' || /^\s|\s$/.test(s) || /[:#\n\r\t"'\\]/.test(s) || /^[-?\[\]{},&*!|>%@`]/.test(s) ||
      /^(true|false|null|yes|no|on|off|~)$/i.test(s) || /^[-+.]?\d/.test(s)) return JSON.stringify(s);
  return s;
}
function yamlScalar(x) {
  if (x === null || x === undefined) return 'null';
  if (typeof x === 'number' || typeof x === 'boolean') return String(x);
  return yamlStr(String(x));
}
const yamlComplex = x => (Array.isArray(x) && x.length) || (isObj(x) && Object.keys(x).length);
function yamlEmit(v, ind) {
  const pad = '  '.repeat(ind);
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    return v.map(x => yamlComplex(x) ? pad + '- ' + yamlEmit(x, ind + 1).trimStart()
      : pad + '- ' + (Array.isArray(x) ? '[]' : isObj(x) ? '{}' : yamlScalar(x))).join('\n');
  }
  if (isObj(v)) {
    const ks = Object.keys(v);
    if (!ks.length) return '{}';
    return ks.map(k => {
      const x = v[k], key = yamlStr(k);
      if (yamlComplex(x)) return `${pad}${key}:\n${yamlEmit(x, ind + 1)}`;
      return `${pad}${key}: ${Array.isArray(x) ? '[]' : isObj(x) ? '{}' : yamlScalar(x)}`;
    }).join('\n');
  }
  return yamlScalar(v);
}
function parseYAML(src) {
  const L = src.replace(/^\uFEFF/, '').split(/\r?\n/); let i = 0;
  const strip = s => {
    let q = null;
    for (let k = 0; k < s.length; k++) {
      const c = s[k];
      if (q) { if (c === '\\' && q === '"') k++; else if (c === q) q = null; }
      else if ((c === '"' || c === "'") && (k === 0 || /[\s:\[{,\-]/.test(s[k - 1]))) q = c;
      else if (c === '#' && (k === 0 || /\s/.test(s[k - 1]))) return s.slice(0, k);
    }
    return s;
  };
  const ind = s => s.length - s.trimStart().length;
  const T = k => strip(L[k]).trim();
  const skip = () => { while (i < L.length) { const t = T(i); if (t === '' || t === '---' || t === '...') i++; else break; } };
  const KEY = /^("(?:[^"\\]|\\.)*"|'[^']*'|[^\s"'\[{#:\-][^:#]*?)\s*:(?:\s+(.*))?$/;
  const isSeq = t => t === '-' || t.startsWith('- ');
  const unq = k => k[0] === '"' ? JSON.parse(k) : k[0] === "'" ? k.slice(1, -1).replace(/''/g, "'") : k.trim();
  function splitTop(s) {
    const out = []; let d = 0, q = null, cur = '';
    for (const c of s) {
      if (q) { cur += c; if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { q = c; cur += c; continue; }
      if (c === '[' || c === '{') d++; if (c === ']' || c === '}') d--;
      if (c === ',' && d === 0) { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur); return out;
  }
  function flow(s) {
    try { return JSON.parse(s); } catch (e) {}
    const inner = s.slice(1, -1).trim();
    if (s[0] === '[') return inner === '' ? [] : splitTop(inner).map(scalar);
    const o = {};
    if (inner !== '') splitTop(inner).forEach(p => { const m = p.match(/^\s*("[^"]*"|'[^']*'|[^:]+?)\s*:\s*(.*)$/); if (m) o[unq(m[1])] = scalar(m[2]); });
    return o;
  }
  function scalar(s) {
    s = s.trim();
    if (s === '' || s === '~' || s === 'null') return null;
    if (s === 'true') return true; if (s === 'false') return false;
    if (/^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) return Number(s);
    if (s[0] === '"') { try { return JSON.parse(s); } catch (e) { return s.slice(1, -1); } }
    if (s[0] === "'") return s.slice(1, -1).replace(/''/g, "'");
    if (s[0] === '[' || s[0] === '{') return flow(s);
    return s;
  }
  function blockScalar(v, n) {
    const buf = [];
    while (i < L.length && (L[i].trim() === '' || ind(L[i]) > n)) { buf.push(L[i]); i++; }
    const nb = buf.filter(x => x.trim() !== ''), base = nb.length ? Math.min(...nb.map(ind)) : 0;
    let s = buf.map(x => x.slice(base)).join('\n').replace(/\n+$/, '');
    if (v[0] === '>') s = s.replace(/([^\n])\n(?=[^\n])/g, '$1 ');
    return v.endsWith('-') ? s : s + '\n';
  }
  function block(min) {
    skip(); if (i >= L.length) return null;
    const n = ind(L[i]); if (n < min) return null;
    const t = T(i);
    if (isSeq(t)) return seq(n);
    if (KEY.test(t)) return map(n);
    i++; return scalar(t);
  }
  function seq(n) {
    const a = [];
    for (;;) {
      skip(); if (i >= L.length || ind(L[i]) !== n) break;
      const t = T(i); if (!isSeq(t)) break;
      const rest = t === '-' ? '' : t.slice(2).trim();
      if (rest === '') { i++; skip(); a.push(i < L.length && ind(L[i]) > n ? block(n + 1) : null); }
      else if (isSeq(rest) || KEY.test(rest)) { L[i] = ' '.repeat(n + 2) + rest; a.push(block(n + 2)); }
      else { i++; a.push(scalar(rest)); }
    }
    return a;
  }
  function map(n) {
    const o = {};
    for (;;) {
      skip(); if (i >= L.length || ind(L[i]) !== n) break;
      const t = T(i), m = KEY.exec(t); if (!m || isSeq(t)) break;
      const key = unq(m[1]), v = (m[2] || '').trim(); i++;
      if (v === '') {
        skip();
        if (i < L.length) { const nn = ind(L[i]), nt = T(i); if (nn > n) o[key] = block(n + 1); else if (nn === n && isSeq(nt)) o[key] = seq(n); else o[key] = null; }
        else o[key] = null;
      }
      else if (/^[|>][+-]?$/.test(v)) o[key] = blockScalar(v, n);
      else o[key] = scalar(v);
    }
    return o;
  }
  const r = block(0);
  return r === undefined ? null : r;
}
function parseData(text, ext) {
  if (ext === 'json') return JSON.parse(text);
  if (ext === 'csv') return parseCSV(text, ',');
  if (ext === 'tsv') return parseCSV(text, '\t');
  if (ext === 'xml') return parseXML(text);
  return parseYAML(text);
}
function emitData(v, ext) {
  if (ext === 'json') return JSON.stringify(v, null, 2) + '\n';
  if (ext === 'csv') return toCSV(v, ',');
  if (ext === 'tsv') return toCSV(v, '\t');
  if (ext === 'xml') return toXML(v);
  return yamlEmit(v, 0) + '\n';
}

/* ============================ documents ============================ */
function mdInline(s) {
  const stash = [];
  s = esc(s).replace(/`([^`]+)`/g, (m, c) => { stash.push('<code>' + c + '</code>'); return '\u0000' + (stash.length - 1) + '\u0000'; });
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2">')
       .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
       .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (m, a, b) => '<strong>' + (a || b) + '</strong>')
       .replace(/\*([^*\s][^*]*)\*/g, '<em>$1</em>')
       .replace(/(^|[^\w])_([^_]+)_(?!\w)/g, '$1<em>$2</em>')
       .replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => stash[i]);
}
function mdToHtml(src) {
  const L = src.replace(/\r\n?/g, '\n').split('\n'), out = [];
  let para = [], list = null, quote = [], code = null;
  const fP = () => { if (para.length) { out.push('<p>' + mdInline(para.join(' ')) + '</p>'); para = []; } };
  const fL = () => { if (list) { out.push('<' + list.t + '>' + list.items.map(x => '<li>' + mdInline(x) + '</li>').join('') + '</' + list.t + '>'); list = null; } };
  const fQ = () => { if (quote.length) { out.push('<blockquote><p>' + mdInline(quote.join(' ')) + '</p></blockquote>'); quote = []; } };
  const all = () => { fP(); fL(); fQ(); };
  for (const line of L) {
    let m;
    if (code) { if (/^```/.test(line)) { out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>'); code = null; } else code.push(line); continue; }
    if (/^```/.test(line)) { all(); code = []; continue; }
    if (/^\s*$/.test(line)) { all(); continue; }
    if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) { all(); out.push(`<h${m[1].length}>${mdInline(m[2])}</h${m[1].length}>`); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { all(); out.push('<hr>'); continue; }
    if ((m = /^>\s?(.*)$/.exec(line))) { fP(); fL(); quote.push(m[1]); continue; }
    if ((m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line))) {
      fP(); fQ(); const t = /\d/.test(m[1]) ? 'ol' : 'ul';
      if (list && list.t !== t) fL(); if (!list) list = { t, items: [] }; list.items.push(m[2]); continue;
    }
    fL(); fQ(); para.push(line.trim());
  }
  if (code) out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>');
  all();
  return out.join('\n');
}
function textToHtml(text) {
  return text.replace(/\r\n?/g, '\n').split(/\n{2,}/).filter(p => p.trim()).map(p => '<p>' + esc(p).replace(/\n/g, '<br>\n') + '</p>').join('\n');
}
function wrapHtml(body, title) {
  return `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>${esc(title || '')}</title>\n<style>body{font:16px/1.6 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem}pre{background:#8881;padding:.8em;overflow:auto}code{font-family:ui-monospace,monospace}blockquote{margin-left:0;padding-left:1em;border-left:3px solid #8886}</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}
function htmlWalk(node, md, st) {
  if (node.nodeType === 3) return node.nodeValue.replace(/\s+/g, ' ');
  if (node.nodeType !== 1) return '';
  const tag = node.tagName.toLowerCase();
  if (['script', 'style', 'noscript', 'head', 'title'].includes(tag)) return '';
  const kids = () => Array.from(node.childNodes).map(n => htmlWalk(n, md, st)).join('');
  let k;
  switch (tag) {
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
      return '\n\n' + (md ? '#'.repeat(+tag[1]) + ' ' : '') + kids().trim() + '\n\n';
    case 'p': return '\n\n' + kids().trim() + '\n\n';
    case 'div': case 'section': case 'article': case 'header': case 'footer': case 'main': case 'nav': case 'aside': case 'figure': return '\n' + kids() + '\n';
    case 'br': return '\n';
    case 'hr': return md ? '\n\n---\n\n' : '\n\n';
    case 'strong': case 'b': k = kids(); return md && k.trim() ? '**' + k.trim() + '**' : k;
    case 'em': case 'i': k = kids(); return md && k.trim() ? '*' + k.trim() + '*' : k;
    case 'del': case 's': k = kids(); return md && k.trim() ? '~~' + k.trim() + '~~' : k;
    case 'code': k = kids(); return md ? '`' + k + '`' : k;
    case 'pre': return '\n\n' + (md ? '```\n' + node.textContent.replace(/\n$/, '') + '\n```' : node.textContent) + '\n\n';
    case 'a': k = kids(); return md && node.getAttribute('href') ? '[' + k + '](' + node.getAttribute('href') + ')' : k;
    case 'img': return md ? '![' + (node.getAttribute('alt') || '') + '](' + (node.getAttribute('src') || '') + ')' : (node.getAttribute('alt') || '');
    case 'ul': case 'ol': st.list.push({ t: tag, n: 0 }); k = kids(); st.list.pop(); return '\n' + k + '\n';
    case 'li': {
      const l = st.list[st.list.length - 1] || { t: 'ul', n: 0 }; l.n++;
      return '\n' + '  '.repeat(Math.max(0, st.list.length - 1)) + (l.t === 'ol' ? l.n + '. ' : '- ') + kids().trim();
    }
    case 'blockquote': k = kids().trim(); return '\n\n' + (md ? k.split('\n').map(x => '> ' + x).join('\n') : k) + '\n\n';
    case 'tr': return '\n' + Array.from(node.children).map(c => htmlWalk(c, md, st).replace(/\s+/g, ' ').trim()).join(' | ');
    default: return kids();
  }
}
function htmlToText(html, md) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return htmlWalk(doc.body, md, { list: [] }).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
function htmlToBlocks(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html'), blocks = [];
  doc.body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,pre,tr').forEach(el => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'p' && el.closest('li')) return;
    let text, level = 0;
    if (tag === 'li') { const c = el.cloneNode(true); c.querySelectorAll('ul,ol').forEach(x => x.remove()); text = '\u2022 ' + c.textContent.replace(/\s+/g, ' ').trim(); }
    else if (tag === 'pre') text = el.textContent.replace(/\n$/, '');
    else if (tag === 'tr') text = Array.from(el.children).map(c => c.textContent.replace(/\s+/g, ' ').trim()).join('\t');
    else { text = el.textContent.replace(/\s+/g, ' ').trim(); if (tag[0] === 'h') level = +tag[1]; }
    if (text.trim()) blocks.push({ level, text });
  });
  if (!blocks.length) doc.body.textContent.split(/\n+/).forEach(t => { if (t.trim()) blocks.push({ level: 0, text: t.trim() }); });
  return blocks;
}
function blocksToHtml(blocks) {
  return blocks.map(b => b.level ? `<h${b.level}>${esc(b.text)}</h${b.level}>` : `<p>${esc(b.text).replace(/\n/g, '<br>')}</p>`).join('\n');
}
function buildDocx(blocks) {
  const sizes = [0, 40, 34, 30, 26, 24, 22];
  const paras = blocks.map(b => {
    const runs = b.text.split('\n').map((ln, i) => (i ? '<w:br/>' : '') + ln.split('\t').map(t => `<w:t xml:space="preserve">${xesc(t)}</w:t>`).join('<w:tab/>')).join('');
    const rpr = b.level ? `<w:rPr><w:b/><w:sz w:val="${sizes[b.level]}"/></w:rPr>` : '';
    return `<w:p><w:r>${rpr}${runs}</w:r></w:p>`;
  }).join('');
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const enc = s => new TextEncoder().encode(s), hdr = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  return zipStore([
    { name: '[Content_Types].xml', data: enc(hdr + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>') },
    { name: '_rels/.rels', data: enc(hdr + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>') },
    { name: 'word/document.xml', data: enc(hdr + `<w:document ${W}><w:body>${paras}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`) }
  ]);
}
async function readDocx(file) {
  const xml = await zipRead(await file.arrayBuffer(), 'word/document.xml');
  if (!xml) throw new Error('No document text found in that DOCX.');
  const d = new DOMParser().parseFromString(new TextDecoder().decode(xml), 'application/xml');
  const blocks = [];
  for (const p of Array.from(d.getElementsByTagName('w:p'))) {
    let text = '';
    for (const el of Array.from(p.getElementsByTagName('*'))) {
      const n = el.nodeName;
      if (n === 'w:t') text += el.textContent; else if (n === 'w:tab') text += '\t'; else if (n === 'w:br' || n === 'w:cr') text += '\n';
    }
    if (!text.trim()) continue;
    const st = p.getElementsByTagName('w:pStyle')[0]; let level = 0;
    if (st) { const v = st.getAttribute('w:val') || '', m = /^heading\s*(\d)/i.exec(v); if (m) level = Math.min(6, +m[1]); else if (/^title$/i.test(v)) level = 1; }
    if (!level && p.getElementsByTagName('w:numPr').length) text = '\u2022 ' + text;
    blocks.push({ level, text });
  }
  return blocks;
}

/* ============================ PDF merge ============================ */
const latin1 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return s; };
async function inflateZlib(u8) {
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function parsePdf(u8) {
  const s = latin1(u8), hd = s.indexOf('%PDF-');
  if (hd < 0 || hd > 1024) throw new Error("this doesn't look like a PDF");
  if (/\/Encrypt\b/.test(s.slice(-8192)) || /\/Encrypt\b/.test(s.slice(0, 2048))) throw new Error('it is password-protected/encrypted');
  const ints = new Map(); let m;
  const ri = /(\d+)\s+\d+\s+obj\s+(-?\d+)\s+endobj/g;
  while ((m = ri.exec(s))) ints.set(+m[1], +m[2]);
  const objs = new Map(), re = /(\d+)\s+(\d+)\s+obj\b/g; let order = 0;
  while ((m = re.exec(s))) {
    const num = +m[1], p = re.lastIndex, eo = s.indexOf('endobj', p);
    if (eo < 0) break;
    const body = s.slice(p, eo), si = body.indexOf('stream');
    if (si >= 0 && /(>>|\])\s*$/.test(body.slice(0, si))) {
      const dict = body.slice(0, si).trim(); let ds = p + si + 6;
      if (s[ds] === '\r' && s[ds + 1] === '\n') ds += 2; else if (s[ds] === '\n' || s[ds] === '\r') ds += 1;
      const lm = /\/Length\b\s+(\d+)(?:\s+(\d+)\s+R)?/.exec(dict);
      const len = lm ? (lm[2] === undefined ? +lm[1] : ints.get(+lm[1])) : undefined;
      let end = -1;
      if (len !== undefined && ds + len <= s.length && /^\s*endstream/.test(s.slice(ds + len, ds + len + 24))) end = ds + len;
      if (end < 0) {
        const e2 = s.indexOf('endstream', ds); if (e2 < 0) break;
        end = e2; if (s[end - 1] === '\n') { end--; if (s[end - 1] === '\r') end--; } else if (s[end - 1] === '\r') end--;
      }
      const data = u8.subarray(ds, end);
      re.lastIndex = end;
      if (/\/Type\s*\/XRef/.test(dict)) { if (/\/Encrypt\b/.test(dict)) throw new Error('it is password-protected/encrypted'); continue; }
      if (/\/Type\s*\/ObjStm/.test(dict)) {
        const pred = /\/Predictor\s+(\d+)/.exec(dict);
        if (pred && +pred[1] > 1) throw new Error('it uses an unsupported compression layout');
        let raw = data;
        if (/\/FlateDecode|\/Fl\b/.test(dict)) raw = await inflateZlib(data);
        else if (/\/Filter/.test(dict)) throw new Error('it uses an unsupported compression layout');
        const dec = latin1(raw), N = +(/\/N\s+(\d+)/.exec(dict) || [0, 0])[1], First = +(/\/First\s+(\d+)/.exec(dict) || [0, 0])[1];
        const hdr = dec.slice(0, First).trim().split(/\s+/).map(Number);
        for (let i = 0; i < N; i++) {
          const off = hdr[2 * i + 1], nxt = i + 1 < N ? hdr[2 * i + 3] : dec.length - First;
          objs.set(hdr[2 * i], { text: dec.slice(First + off, First + nxt).trim(), order: order++ });
        }
        continue;
      }
      objs.set(num, { text: dict, data, order: order++ });
    } else {
      objs.set(num, { text: body.trim(), order: order++ });
      re.lastIndex = eo + 6;
    }
  }
  const roots = [...s.matchAll(/\/Root\s+(\d+)\s+\d+\s+R/g)];
  let rootNum = roots.length ? +roots[roots.length - 1][1] : null;
  if (rootNum === null || !objs.has(rootNum)) {
    let best = null; objs.forEach((o, n) => { if (/\/Type\s*\/Catalog/.test(o.text) && (!best || o.order > best.order)) best = { n, order: o.order }; });
    rootNum = best && best.n;
  }
  if (rootNum === null || !objs.has(rootNum)) throw new Error('its page structure is damaged or unsupported');
  return { objs, rootNum };
}
function pdfValue(text, key) {
  const m = new RegExp('/' + key + '(?![A-Za-z0-9_])\\s*').exec(text);
  if (!m) return null;
  const i = m.index + m[0].length, c = text[i];
  if (c === '[' || (c === '<' && text[i + 1] === '<')) {
    const open = c === '[' ? '[' : '<<', close = c === '[' ? ']' : '>>'; let d = 0, j = i;
    while (j < text.length) {
      if (text.startsWith(open, j)) { d++; j += open.length; }
      else if (text.startsWith(close, j)) { d--; j += close.length; if (d === 0) break; }
      else j++;
    }
    return text.slice(i, j);
  }
  const r = /^\d+\s+\d+\s+R/.exec(text.slice(i, i + 40)); if (r) return r[0];
  const t = /^\/?[^\s\/\[\]<>()]+/.exec(text.slice(i, i + 200)); return t ? t[0] : null;
}
function collectPages(objs, rootNum) {
  const pr = /(\d+)\s+\d+\s+R/.exec(pdfValue(objs.get(rootNum).text, 'Pages') || '');
  if (!pr) throw new Error('its page structure is damaged or unsupported');
  const pages = [], seen = new Set(), INH = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];
  const walk = (num, inh) => {
    if (seen.has(num)) return; seen.add(num);
    const o = objs.get(num); if (!o) return;
    const t = o.text, cur = Object.assign({}, inh);
    INH.forEach(k => { const v = pdfValue(t, k); if (v !== null) cur[k] = v; });
    const isPage = /\/Type\s*\/Page(?![A-Za-z])/.test(t);
    const kids = !isPage && /\/Kids\b/.test(t) ? pdfValue(t, 'Kids') : null;
    if (kids !== null) {
      let kt = kids; const ind = /^(\d+)\s+\d+\s+R$/.exec(kt);
      if (ind) { const ko = objs.get(+ind[1]); kt = ko ? ko.text : ''; }
      for (const m of kt.matchAll(/(\d+)\s+\d+\s+R/g)) walk(+m[1], cur);
    } else pages.push({ num, inh: cur, text: t });
  };
  walk(+pr[1], {});
  return pages;
}
async function mergePdfs(list, names, say) {
  let next = 3; const kids = [], bodies = [], INH = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];
  for (let di = 0; di < list.length; di++) {
    say && say(`Reading PDF ${di + 1} of ${list.length}…`);
    try {
      const { objs, rootNum } = await parsePdf(list[di]);
      const pages = collectPages(objs, rootNum);
      if (!pages.length) throw new Error('no pages found');
      const map = new Map(), order = [], pageText = new Map(), stack = [];
      const need = n => { if (!map.has(n) && objs.has(n)) { map.set(n, next++); order.push(n); stack.push(n); } };
      pages.forEach(pg => {
        let t = pg.text.replace(/\/Parent\s+\d+\s+\d+\s+R/, '');
        let add = '';
        INH.forEach(k => { if (pg.inh[k] !== undefined && !new RegExp('/' + k + '(?![A-Za-z0-9_])').test(t)) add += ` /${k} ${pg.inh[k]}`; });
        if (add) { const idx = t.lastIndexOf('>>'); t = t.slice(0, idx) + add + ' ' + t.slice(idx); }
        pageText.set(pg.num, t); need(pg.num);
      });
      while (stack.length) {
        const n = stack.pop(), t = (pageText.has(n) ? pageText.get(n) : objs.get(n).text).replace(/\/(Parent|P)\s+\d+\s+\d+\s+R/g, '');
        for (const m of t.matchAll(/(\d+)\s+\d+\s+R(?![\w])/g)) need(+m[1]);
      }
      const fix = t => t.replace(/(^|[^\w.])(\d+)\s+\d+\s+R(?![\w])/g, (m, pre, n) => { const v = map.get(+n); return pre + (v ? v + ' 0 R' : 'null'); });
      const pageSet = new Set(pages.map(p => p.num));
      for (const n of order) {
        const o = objs.get(n); let t = pageText.has(n) ? pageText.get(n) : o.text, parts;
        if (o.data) {
          t = fix(t.replace(/\/Length\b\s+\d+(?:\s+\d+\s+R)?/, '/Length ' + o.data.length));
          parts = [t + '\nstream\n', o.data, '\nendstream'];
        } else {
          t = fix(t);
          if (pageSet.has(n)) { const idx = t.lastIndexOf('>>'); t = t.slice(0, idx) + ' /Parent 2 0 R ' + t.slice(idx); }
          parts = [t];
        }
        bodies[map.get(n)] = parts;
      }
      pages.forEach(pg => kids.push(map.get(pg.num) + ' 0 R'));
    } catch (e) { throw new Error(`${names[di]}: ${e.message}`); }
  }
  const objsOut = [['<< /Type /Catalog /Pages 2 0 R >>'], [`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`]];
  for (let n = 3; n < next; n++) objsOut.push(bodies[n]);
  return { blob: buildPdf(objsOut), pages: kids.length };
}

/* ============================ browser-only: media + convert ============================ */
function canvasBlob(c, type, q) { return new Promise(r => c.toBlob(r, type, q)); }
async function imageToCanvas(file, ext, flatten) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("Your browser couldn't read that image.")); im.src = url; });
    let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (ext === 'svg') { w = w || 800; h = h || 600; const s = Math.max(1, 1024 / Math.max(w, h)); w = Math.round(w * s); h = Math.round(h * s); }
    if (!w || !h) throw new Error('That image has no size.');
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    if (flatten) { x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); }
    x.drawImage(img, 0, 0, w, h);
    return c;
  } finally { URL.revokeObjectURL(url); }
}
async function decodeAudio(file) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw new Error("This browser can't decode audio.");
  const ctx = new AC();
  try { return await ctx.decodeAudioData(await file.arrayBuffer()); }
  catch (e) { throw new Error("Your browser couldn't decode the audio in that file."); }
  finally { if (ctx.close) ctx.close(); }
}
const once = (el, ev) => new Promise((res, rej) => {
  el.addEventListener(ev, res, { once: true });
  el.addEventListener('error', () => rej(new Error("Your browser couldn't read that media file.")), { once: true });
});
function pickMime(list) { return typeof MediaRecorder === 'undefined' ? null : list.find(m => MediaRecorder.isTypeSupported(m)) || null; }
async function recordBuffer(buf, say) {
  const mime = pickMime(['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4']);
  if (!mime) throw new Error("This browser can't record audio to a compressed format. Try WAV instead.");
  const ctx = new (window.AudioContext || window.webkitAudioContext)(), dest = ctx.createMediaStreamDestination(), src = ctx.createBufferSource();
  src.buffer = buf; src.connect(dest);
  const rec = new MediaRecorder(dest.stream, { mimeType: mime }), chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const stopped = new Promise(r => rec.onstop = r);
  rec.start(); src.start();
  const t0 = performance.now(), tick = setInterval(() => say(`Converting in real time\u2026 ${Math.min(99, Math.round((performance.now() - t0) / 10 / buf.duration))}%`), 300);
  await new Promise(r => src.onended = r); await sleep(200);
  clearInterval(tick); rec.stop(); await stopped; ctx.close();
  return new Blob(chunks, { type: rec.mimeType || mime.split(';')[0] });
}
async function recordVideo(file, say) {
  const mime = pickMime(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']);
  if (!mime) throw new Error("This browser can't record video to WebM (try Chrome, Edge or Firefox).");
  const url = URL.createObjectURL(file), v = document.createElement('video');
  v.src = url; v.playsInline = true; v.preload = 'auto';
  try {
    await once(v, 'loadedmetadata');
    const cap = v.captureStream || v.mozCaptureStream;
    if (!cap) throw new Error("This browser can't capture video playback.");
    const rec = new MediaRecorder(cap.call(v), { mimeType: mime }), chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    const stopped = new Promise(r => rec.onstop = r);
    v.ontimeupdate = () => say(`Converting in real time\u2026 ${Math.round(v.currentTime / v.duration * 100) || 0}%`);
    rec.start(500);
    try { await v.play(); } catch (e) { v.muted = true; await v.play(); }
    await once(v, 'ended'); rec.stop(); await stopped;
    return new Blob(chunks, { type: 'video/webm' });
  } finally { URL.revokeObjectURL(url); }
}
async function videoFrame(file) {
  const url = URL.createObjectURL(file), v = document.createElement('video');
  v.muted = true; v.preload = 'auto'; v.src = url;
  try {
    await once(v, 'loadeddata');
    v.currentTime = Math.min(0.1, (v.duration || 1) / 2); await once(v, 'seeked');
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    return c;
  } finally { URL.revokeObjectURL(url); }
}
async function fileToBase64(file) {
  const u8 = new Uint8Array(await file.arrayBuffer()); let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
const textBlob = (s, type) => new Blob([s], { type: type + ';charset=utf-8' });

async function convertFile(file, kind, ext, target, o) {
  const base = baseName(file.name), say = o.say || (() => {});
  if (target === 'base64') return { blob: textBlob(await fileToBase64(file), 'text/plain'), name: file.name + '.base64.txt' };

  if (kind === 'image' || (kind === 'video' && target === 'png')) {
    say('Reading image\u2026');
    const flatten = ['jpg', 'bmp', 'gif', 'pdf'].includes(target);
    const canvas = kind === 'video' ? await videoFrame(file) : await imageToCanvas(file, ext, flatten);
    const w = canvas.width, h = canvas.height, ctx = canvas.getContext('2d');
    if (target === 'png' || target === 'jpg' || target === 'webp') {
      const mime = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[target];
      const blob = await canvasBlob(canvas, mime, o.quality);
      if (!blob) throw new Error("Couldn't encode that image.");
      if (blob.type !== mime) return { blob, name: `${base}.png`, note: `Your browser can't encode ${LABEL[target]}, so a PNG was made instead.` };
      return { blob, name: `${base}.${target}` };
    }
    if (target === 'bmp') return { blob: new Blob([encodeBMP(ctx.getImageData(0, 0, w, h).data, w, h)], { type: 'image/bmp' }), name: base + '.bmp' };
    if (target === 'gif') return { blob: new Blob([encodeGIF(ctx.getImageData(0, 0, w, h).data, w, h)], { type: 'image/gif' }), name: base + '.gif', note: 'GIFs are limited to 256 colours, so gradients may look banded.' };
    if (target === 'ico') {
      const S = Math.min(256, Math.max(w, h)), c = document.createElement('canvas'); c.width = c.height = S;
      const sc = Math.min(S / w, S / h), dw = w * sc, dh = h * sc;
      c.getContext('2d').drawImage(canvas, (S - dw) / 2, (S - dh) / 2, dw, dh);
      const png = new Uint8Array(await (await canvasBlob(c, 'image/png')).arrayBuffer());
      return { blob: new Blob([encodeICOfromPng(png, S)], { type: 'image/x-icon' }), name: base + '.ico' };
    }
    if (target === 'svg') {
      const b64 = await fileToBase64(await canvasBlob(canvas, 'image/png'));
      return { blob: textBlob(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n<image width="${w}" height="${h}" xlink:href="data:image/png;base64,${b64}"/>\n</svg>\n`, 'image/svg+xml'), name: base + '.svg', note: 'The picture is embedded inside the SVG (it is not traced into vector shapes).' };
    }
    if (target === 'pdf') {
      const jpg = new Uint8Array(await (await canvasBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer());
      return { blob: jpegToPdf(jpg, w, h), name: base + '.pdf' };
    }
  }

  if (kind === 'audio' || kind === 'video') {
    if (target === 'wav') { say('Decoding audio\u2026'); return { blob: encodeWAV(await decodeAudio(file)), name: base + '.wav' }; }
    if (target === 'webm') {
      if (kind === 'audio') {
        say('Decoding audio\u2026'); const blob = await recordBuffer(await decodeAudio(file), say);
        const e = /webm/.test(blob.type) ? 'webm' : /ogg/.test(blob.type) ? 'ogg' : 'm4a';
        return { blob, name: `${base}.${e}`, note: 'Re-recorded in real time, so it takes as long as the clip.' };
      }
      const blob = await recordVideo(file, say);
      return { blob, name: base + '.webm', note: 'Re-recorded in real time while the video played.' };
    }
  }

  if (kind === 'data') {
    const out = emitData(parseData(await file.text(), ext), target);
    return { blob: textBlob(out, MIME[target]), name: `${base}.${target}` };
  }

  if (kind === 'doc') {
    let text = null, html;
    if (ext === 'docx') html = blocksToHtml(await readDocx(file));
    else { text = await file.text(); html = ext === 'md' ? mdToHtml(text) : ext === 'html' ? text : textToHtml(text); }
    const plain = () => ext === 'txt' ? text : htmlToText(html, false);
    if (target === 'txt') return { blob: textBlob(plain(), MIME.txt), name: base + '.txt' };
    if (target === 'md') return { blob: textBlob(ext === 'txt' ? text : htmlToText(html, true), MIME.md), name: base + '.md' };
    if (target === 'html') return { blob: textBlob(wrapHtml(html, base), MIME.html), name: base + '.html' };
    if (target === 'pdf') return { blob: textToPdf(plain()), name: base + '.pdf', note: 'Plain-text PDF in a monospaced font; headings and formatting are not kept.' };
    if (target === 'docx') return { blob: new Blob([buildDocx(htmlToBlocks(html))], { type: MIME.docx }), name: base + '.docx' };
  }
  throw new Error("That conversion isn't supported.");
}

export {
  ARCHIVE_HOOK,
  CRC_T,
  EXT,
  LABEL,
  MIME,
  TARGETS,
  baseName,
  blocksToHtml,
  buildDocx,
  buildPdf,
  bytesOf,
  canvasBlob,
  collectPages,
  concat,
  convertFile,
  crc32,
  decodeAudio,
  emitData,
  encodeBMP,
  encodeGIF,
  encodeICOfromPng,
  encodeWAV,
  esc,
  expandZips,
  extOf,
  fileToBase64,
  htmlToBlocks,
  htmlToText,
  htmlWalk,
  imageToCanvas,
  infer,
  inflateRaw,
  inflateZlib,
  isObj,
  jpegToPdf,
  kindOf,
  latin1,
  le16,
  le32,
  lzwGif,
  mdInline,
  mdToHtml,
  mergePdfs,
  normExt,
  once,
  parseCSV,
  parseData,
  parsePdf,
  parseXML,
  parseYAML,
  pdfEsc,
  pdfValue,
  pickMime,
  readDocx,
  recordBuffer,
  recordVideo,
  setArchiveHook,
  sleep,
  textBlob,
  textToHtml,
  textToPdf,
  toCSV,
  toXML,
  unwrapTable,
  videoFrame,
  wrapHtml,
  wrapLine,
  xesc,
  xmlName,
  xmlNode,
  xmlToJs,
  yamlComplex,
  yamlEmit,
  yamlScalar,
  yamlStr,
  zipEntries,
  zipExtract,
  zipRead,
  zipStore
};
