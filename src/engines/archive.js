/* Archives: libarchive (WebAssembly) unpacks 7z, RAR, TAR, GZ, BZ2, XZ... so they can be bulk-converted like a zip. */
import { setArchiveHook } from '../core.js';
import { ARCHIVE_EXTS } from '../registry.js';
import { LIBARCHIVE_WORKER } from '../config.js';

let ready = null;
async function load() {
  if (!ready) ready = (async () => {
    const { Archive } = await import('libarchive.js/main.js');
    Archive.init({ workerUrl: LIBARCHIVE_WORKER });
    return Archive;
  })().catch(e => { ready = null; throw e; });
  return ready;
}
function flatten(obj, path, out) {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v instanceof Blob) out.push({ path: path + k, file: v });
    else if (v && typeof v === 'object') flatten(v, path + k + '/', out);
  }
  return out;
}

setArchiveHook(ARCHIVE_EXTS, async file => {
  const Archive = await load();
  const archive = await Archive.open(file);
  try { if (await archive.hasEncryptedData()) throw new Error('password-protected archive'); } catch (e) { if (/password/.test(e.message)) throw e; }
  const entries = flatten(await archive.extractFiles(), '', [])
    .filter(e => !/(^|\/)(__MACOSX\/|\.[^\/]*$)/.test(e.path))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }));
  const used = new Set();
  return entries.map(e => {
    let name = e.path.split('/').pop();
    if (used.has(name.toLowerCase())) name = e.path.split('/').slice(-2).join('_');
    used.add(name.toLowerCase());
    const f = new File([e.file], name); f.from = file.name; return f;
  });
});
