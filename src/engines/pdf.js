/* PDF in: render pages to images (pdf.js), extract text (pdf.js), split into pages (pdf-lib). */
import { register } from '../registry.js';
import { baseName, zipStore } from '../core.js';
import { PDF_WORKER } from '../config.js';

let pdfjs = null;
async function getPdfjs() {
  if (pdfjs) return pdfjs;
  const lib = await import('pdfjs-dist');
  lib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
  pdfjs = lib; return lib;
}
const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
const pad = (n, w) => String(n).padStart(w, '0');
const toBlob = (c, type, q) => new Promise(r => c.toBlob(r, type, q));

register({
  id: 'pdf', label: 'PDF tools',
  can(ext) { return ext === 'pdf' ? ['png', 'jpg', 'webp', 'txt', 'pdf-split'] : []; },
  async convert(file, ext, target, o) {
    const say = o.say || (() => {});
    const base = baseName(file.name), buf = new Uint8Array(await file.arrayBuffer());

    if (target === 'pdf-split') {
      say('Splitting…');
      const { PDFDocument } = await import('pdf-lib');
      const src = await PDFDocument.load(buf, { ignoreEncryption: true });
      const n = src.getPageCount(), files = [];
      for (let i = 0; i < n; i++) {
        say(`Splitting page ${i + 1} of ${n}…`);
        const d = await PDFDocument.create();
        const [p] = await d.copyPages(src, [i]); d.addPage(p);
        files.push({ name: `${base}-page-${pad(i + 1, String(n).length)}.pdf`, data: await d.save() });
      }
      if (files.length === 1) return { blob: new Blob([files[0].data], { type: 'application/pdf' }), name: files[0].name };
      return { blob: new Blob([zipStore(files)], { type: 'application/zip' }), name: `${base}-pages.zip`, note: `${n} pages, one PDF each, in a ZIP.` };
    }

    const lib = await getPdfjs();
    say('Opening PDF…');
    let doc;
    try { doc = await lib.getDocument({ data: buf }).promise; }
    catch (e) { throw new Error(/password/i.test(e.message || '') ? 'This PDF is password-protected.' : "Couldn't read this PDF."); }
    const n = doc.numPages;

    if (target === 'txt') {
      const out = [];
      for (let i = 1; i <= n; i++) {
        say(`Reading page ${i} of ${n}…`);
        const tc = await (await doc.getPage(i)).getTextContent();
        let line = '', lastY = null;
        for (const it of tc.items) {
          if (!('str' in it)) continue;
          const y = it.transform ? Math.round(it.transform[5]) : null;
          if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) { out.push(line); line = ''; }
          line += it.str; if (y !== null) lastY = y;
          if (it.hasEOL) { out.push(line); line = ''; }
        }
        out.push(line, '');
      }
      const text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
      return { blob: new Blob([text], { type: 'text/plain;charset=utf-8' }), name: base + '.txt',
        note: text.trim().length < 5 ? 'No text found — this PDF may be scanned images (it would need OCR).' : undefined };
    }

    const files = [];
    for (let i = 1; i <= n; i++) {
      say(`Rendering page ${i} of ${n}…`);
      const page = await doc.getPage(i), vp = page.getViewport({ scale: 2 });
      const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const blob = await toBlob(c, MIME[target], o.quality || 0.92);
      files.push({ name: `${base}-page-${pad(i, String(n).length)}.${target}`, data: new Uint8Array(await blob.arrayBuffer()), blob });
      c.width = c.height = 0;
    }
    if (files.length === 1) return { blob: files[0].blob, name: files[0].name };
    return { blob: new Blob([zipStore(files)], { type: 'application/zip' }), name: `${base}-${target}-pages.zip`, note: `${n} pages, one image each, in a ZIP.` };
  }
});
