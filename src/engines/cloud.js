/*
 * Server-side conversions (Office documents, ebooks, vector/CAD...) through the /api/cloudconvert route.
 * The API key stays on the server. Files go browser -> CloudConvert directly (so Vercel's 4.5 MB body limit doesn't apply).
 * These targets are labelled "· server" in the UI and only appear when the server says it is configured.
 */
import { register, onStartup } from '../registry.js';
import { baseName } from '../core.js';
import { API_URL } from '../config.js';

let cfg = { enabled: false, needsCode: false };
onStartup(async () => {
  try {
    const r = await fetch(`${API_URL}?action=config`, { cache: 'no-store' });
    if (r.ok && (r.headers.get('content-type') || '').includes('json')) cfg = await r.json();
  } catch (e) { /* static preview or offline: server features stay hidden */ }
});

const WORD = ['pdf', 'docx', 'doc', 'odt', 'rtf', 'txt', 'html', 'epub'];
const MAP = {
  doc: WORD, docx: WORD, odt: WORD, rtf: WORD, wps: WORD, pages: ['pdf', 'docx', 'doc'],
  html: ['pdf', 'docx'], svg: ['pdf', 'eps'],
  ppt: ['pdf', 'pptx', 'odp'], pptx: ['pdf', 'ppt', 'odp'], odp: ['pdf', 'pptx', 'ppt'], key: ['pdf', 'pptx'],
  xls: ['pdf', 'xlsx', 'ods', 'csv'], xlsx: ['pdf', 'xls', 'ods', 'csv'], xlsm: ['pdf', 'xlsx'], ods: ['pdf', 'xlsx', 'xls', 'csv'], numbers: ['pdf', 'xlsx'],
  epub: ['mobi', 'azw3', 'pdf', 'txt'], mobi: ['epub', 'azw3', 'pdf', 'txt'], azw3: ['epub', 'mobi', 'pdf'], fb2: ['epub', 'mobi', 'pdf'],
  pdf: ['docx', 'doc', 'xlsx', 'pptx', 'odt', 'rtf', 'epub', 'mobi'],
  ai: ['pdf', 'png', 'jpg', 'svg'], eps: ['pdf', 'png', 'jpg', 'svg'], ps: ['pdf', 'png', 'jpg'], cdr: ['pdf', 'png', 'svg'],
  dwg: ['pdf', 'png', 'svg'], dxf: ['pdf', 'png', 'svg']
};

function accessCode() {
  let c = ''; try { c = sessionStorage.getItem('fc-code') || ''; } catch (e) {}
  if (!c && cfg.needsCode) { c = window.prompt('This server needs an access code for server-side conversions:') || ''; try { sessionStorage.setItem('fc-code', c); } catch (e) {} }
  return c;
}
async function api(path, init) {
  const headers = Object.assign({ 'x-access-code': accessCode() }, (init && init.headers) || {});
  const r = await fetch(API_URL + path, Object.assign({}, init, { headers }));
  let j = {}; try { j = await r.json(); } catch (e) {}
  if (r.status === 401) { try { sessionStorage.removeItem('fc-code'); } catch (e) {} }
  if (!r.ok) throw new Error(j.error || `Server error (${r.status}).`);
  return j;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

register({
  id: 'cloud', label: 'Server',
  enabled: () => cfg.enabled,
  can(ext) { return (MAP[ext] || []).filter(t => t !== ext).map(t => t + '~cloud'); },
  async convert(file, ext, target, o) {
    const say = o.say || (() => {});
    const out = target.replace('~cloud', '');
    say('Starting server conversion…');
    const job = await api('?action=create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inputFormat: ext, outputFormat: out }) });
    say('Uploading…');
    const fd = new FormData();
    Object.entries(job.form.parameters || {}).forEach(([k, v]) => fd.append(k, v));
    fd.append('file', file, file.name);
    const up = await fetch(job.form.url, { method: 'POST', body: fd });
    if (!up.ok) throw new Error(`Upload failed (${up.status}).`);
    say('Converting on the server…');
    for (let i = 0; i < 200; i++) {
      await sleep(i < 5 ? 1000 : 2000);
      const st = await api(`?action=status&id=${encodeURIComponent(job.id)}`);
      if (st.status === 'error') throw new Error(st.message || 'The server could not convert this file.');
      if (st.status === 'finished') {
        const f = (st.files || [])[0];
        if (!f) throw new Error('The server returned no file.');
        say('Downloading result…');
        const name = f.filename || `${baseName(file.name)}.${out}`;
        try {
          const r = await fetch(f.url);
          if (!r.ok) throw new Error('download failed');
          return { blob: await r.blob(), name, note: 'Converted on the server (CloudConvert); the file was deleted from there after processing.' };
        } catch (e) {
          return { blob: new Blob([]), name, externalUrl: f.url, note: 'The browser could not fetch the result directly, so use the download link (it expires after about 24 hours).' };
        }
      }
    }
    throw new Error('The server took too long to convert this file.');
  }
});
