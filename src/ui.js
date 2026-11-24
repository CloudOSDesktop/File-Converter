/* UI: file list, bulk convert, zip/archive unpacking, Combine PDFs tab. All conversion work is delegated to the registry. */
import { extOf, normExt, kindOf, expandZips, zipStore, imageToCanvas, canvasBlob, jpegToPdf, mergePdfs } from './core.js';
import * as registry from './registry.js';

export function initUI() {
  const readyP = registry.ready();
  const isArc = f => extOf(f.name) === 'zip' || registry.ARCHIVE_EXTS.includes(extOf(f.name));
  const $ = id => document.getElementById(id);
  const fmt = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  const urls = [];
  const keepURL = b => { const u = URL.createObjectURL(b); urls.push(u); return u; };
  const freeURLs = () => { while (urls.length) URL.revokeObjectURL(urls.pop()); };

  function hookDrop(zone, input, handler) {
    input.onchange = () => { handler(Array.from(input.files)); input.value = ''; };
    zone.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
    ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('over'); }));
    zone.addEventListener('drop', e => handler(Array.from(e.dataTransfer.files)));
  }
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => e.preventDefault());

  // tabs
  function showTab(t) {
    $('convertPane').classList.toggle('hidden', t !== 'convert');
    $('combinePane').classList.toggle('hidden', t !== 'combine');
    $('tabConvert').setAttribute('aria-pressed', t === 'convert');
    $('tabCombine').setAttribute('aria-pressed', t === 'combine');
  }
  $('tabConvert').onclick = () => showTab('convert');
  $('tabCombine').onclick = () => showTab('combine');

  function makeRow(name, meta) {
    const li = document.createElement('li');
    const fn = document.createElement('span'); fn.className = 'fn'; fn.textContent = name;
    const mt = document.createElement('span'); mt.className = 'mt'; mt.textContent = meta;
    li.append(fn, mt);
    return li;
  }

  /* ---------------- Convert (single + bulk) ---------------- */
  let items = [], target = null, busy = false;
  const status = $('status'), go = $('go'), say = (m, err) => { status.textContent = m; status.className = err ? 'err' : ''; };
  const valid = (it, t) => it.plan.has(t);

  function clearResult() { $('result').classList.add('hidden'); $('preview').innerHTML = ''; freeURLs(); items.forEach(it => { it.res = null; it.url = null; }); }
  function setSt(it, text, cls) { it.st.textContent = text; it.st.className = 'st ' + (cls || ''); }

  function renderList() {
    const ul = $('flist'); ul.innerHTML = '';
    items.forEach((it, i) => {
      const li = makeRow(it.file.name, (it.kind === 'other' ? 'unknown type' : it.kind) + ' · ' + fmt(it.file.size) + (it.from ? ' · from ' + it.from : ''));
      it.st = document.createElement('span'); it.st.className = 'st';
      it.dl = document.createElement('a'); it.dl.className = 'mini hidden'; it.dl.textContent = 'Download';
      const x = document.createElement('button'); x.type = 'button'; x.className = 'ib'; x.textContent = '×'; x.title = 'Remove'; x.setAttribute('aria-label', 'Remove ' + it.file.name);
      x.onclick = () => { if (busy) return; clearResult(); items.splice(i, 1); afterChange(); };
      li.append(it.st, it.dl, x); ul.appendChild(li);
      if (it.res) { setSt(it, it.res.externalUrl ? 'Done' : 'Done · ' + fmt(it.res.blob.size), 'ok'); it.dl.href = it.url; it.dl.download = it.res.name; if (it.res.externalUrl) it.dl.target = '_blank'; it.dl.classList.remove('hidden'); }
    });
  }
  function renderChips() {
    const box = $('targets'); box.innerHTML = '';
    const all = new Set(); items.forEach(it => it.plan.forEach((_, t) => all.add(t)));
    registry.sortTargets(Array.from(all)).forEach(t => {
      const ok = items.filter(it => valid(it, t)), n = ok.length; if (!n) return;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.dataset.t = t; b.setAttribute('aria-pressed', t === target);
      let label = registry.labelFor(t, { allVideo: ok.every(it => it.kind === 'video'), allPdf: ok.every(it => it.ext === 'pdf') });
      if (items.length > 1 && n < items.length) { label += ` · ${n}/${items.length}`; b.title = `Applies to ${n} of ${items.length} files; the rest will be skipped`; }
      if (t.endsWith('~cloud')) b.title = (b.title ? b.title + '. ' : '') + 'Converted on the server; the file is uploaded to a conversion service';
      b.textContent = label; b.onclick = () => { if (!busy) setTarget(t); };
      box.appendChild(b);
    });
  }
  function setTarget(t) {
    target = t; clearResult(); renderList(); say('');
    document.querySelectorAll('#targets .chip').forEach(c => c.setAttribute('aria-pressed', c.dataset.t === t));
    $('qopt').classList.toggle('hidden', !(t === 'jpg' || t === 'webp'));
    go.disabled = !t;
    const n = t ? items.filter(it => valid(it, t)).length : 0;
    go.textContent = n > 1 ? `Convert ${n} files` : 'Convert';
  }
  function afterChange(force) {
    if (!items.length && !force) { $('work').classList.add('hidden'); $('result').classList.add('hidden'); target = null; return; }
    if (target && !items.some(it => valid(it, target))) target = null;
    $('work').classList.remove('hidden');
    $('fcount').textContent = items.length === 1 ? '1 file' : items.length + ' files';
    renderChips(); renderList(); setTarget(target); $('qopt').classList.toggle('hidden', !(target === 'jpg' || target === 'webp'));
    if (items.every(it => it.ext === 'pdf') && !target) say('Tip: to merge PDFs into one file, use the “Combine PDFs” tab.');
    else if (items.some(it => it.kind === 'other') && !target) say('Unrecognised file types can only be encoded as Base64 text.');
  }
  async function addFiles(fs) {
    if (!fs.length || busy) return;
    busy = true; clearResult(); say(fs.some(isArc) ? 'Unpacking archive…' : '');
    await readyP;
    const x = await expandZips(fs);
    busy = false;
    x.files.forEach(f => { const ext = normExt(extOf(f.name)); items.push({ file: f, kind: registry.kindOfFile(f), ext, plan: registry.planFor(ext), res: null, from: f.from }); });
    afterChange(x.notes.length > 0);
    if (x.notes.length) say('Archive notes: ' + x.notes.join('; '), true);
    else if (fs.some(isArc) && x.files.length) say(`Unpacked ${x.files.length} file${x.files.length === 1 ? '' : 's'} from archive.`);
  }
  hookDrop($('drop'), $('picker'), addFiles);
  $('clear').onclick = () => { if (busy) return; clearResult(); items = []; afterChange(); say(''); };
  $('quality').oninput = e => $('qval').textContent = Math.round(e.target.value * 100) + '%';

  go.onclick = async () => {
    if (!items.length || !target || busy) return;
    busy = true; go.disabled = true; clearResult(); renderList(); say('');
    const q = +$('quality').value; let ok = 0, skipped = 0, failed = 0;
    for (const it of items) {
      if (!valid(it, target)) { skipped++; setSt(it, `Skipped — can’t make ${registry.labelFor(target)} from this`, 'skip'); continue; }
      setSt(it, 'Converting…');
      try {
        it.res = await registry.convert(it.file, it.ext, target, { quality: q, say: m => setSt(it, m) });
        it.url = it.res.externalUrl || keepURL(it.res.blob); ok++;
        setSt(it, it.res.externalUrl ? 'Done' : 'Done · ' + fmt(it.res.blob.size), 'ok'); it.dl.href = it.url; it.dl.download = it.res.name; if (it.res.externalUrl) it.dl.target = '_blank'; it.dl.classList.remove('hidden');
      } catch (e) { failed++; setSt(it, e.message || String(e), 'err'); }
    }
    const done = items.filter(it => it.res);
    if (done.length) showResult(done);
    say(items.length === 1 ? (failed ? '' : 'Done.') : `Converted ${ok} of ${items.length} files` + (skipped ? ` · ${skipped} skipped` : '') + (failed ? ` · ${failed} failed` : '') + '.', items.length === 1 && failed);
    busy = false; go.disabled = false;
  };

  async function showResult(done) {
    const single = items.length === 1, zipable = done.filter(it => !it.res.externalUrl);
    $('result').classList.remove('hidden'); $('preview').innerHTML = '';
    const notes = [...new Set(done.map(it => it.res.note).filter(Boolean))];
    $('rnote').textContent = notes.join(' ');
    const dl = $('dl'), zb = $('zipbtn');
    if (single) {
      const r = done[0].res;
      $('rname').textContent = r.externalUrl ? r.name : `${r.name} · ${fmt(r.blob.size)}`;
      dl.classList.remove('hidden'); zb.classList.add('hidden'); dl.href = done[0].url; dl.download = r.name; if (r.externalUrl) dl.target = '_blank';
      const pv = $('preview'), t = r.blob.type || '';
      if (t.startsWith('image/')) { const i = new Image(); i.src = done[0].url; i.alt = 'Preview'; pv.appendChild(i); }
      else if (t.startsWith('audio/')) { const x = document.createElement('audio'); x.controls = true; x.src = done[0].url; pv.appendChild(x); }
      else if (t.startsWith('video/')) { const x = document.createElement('video'); x.controls = true; x.src = done[0].url; pv.appendChild(x); }
      else if (/^text\/|json|xml/.test(t)) { const p = document.createElement('pre'); const s = await r.blob.text(); p.textContent = s.length > 4000 ? s.slice(0, 4000) + '\n…' : s; pv.appendChild(p); }
    } else {
      $('rname').textContent = `${done.length} file${done.length === 1 ? '' : 's'} ready`;
      dl.classList.add('hidden');
      zb.classList.toggle('hidden', zipable.length < 2);
      zb.onclick = async () => {
        zb.disabled = true; const old = zb.textContent; zb.textContent = 'Zipping…';
        try {
          const used = new Set(), files = [];
          for (const it of zipable) {
            let n = it.res.name, k = 1; const dot = n.lastIndexOf('.'), b = dot > 0 ? n.slice(0, dot) : n, e = dot > 0 ? n.slice(dot) : '';
            while (used.has(n.toLowerCase())) n = `${b} (${++k})${e}`;
            used.add(n.toLowerCase()); files.push({ name: n, data: new Uint8Array(await it.res.blob.arrayBuffer()) });
          }
          const u = keepURL(new Blob([zipStore(files)], { type: 'application/zip' }));
          const a = document.createElement('a'); a.href = u; a.download = 'converted.zip'; document.body.appendChild(a); a.click(); a.remove();
        } catch (e) { say('Could not build the ZIP: ' + e.message, true); }
        zb.textContent = old; zb.disabled = false;
      };
    }
  }

  /* ---------------- Combine PDFs ---------------- */
  let pitems = [], pbusy = false;
  const status2 = $('status2'), go2 = $('go2'), say2 = (m, err) => { status2.textContent = m; status2.className = err ? 'err' : ''; };
  const isPdf = f => extOf(f.name) === 'pdf' || f.type === 'application/pdf';
  const isImg = f => kindOf(f) === 'image';
  function clearResult2() { $('result2').classList.add('hidden'); if (pitems.url) { URL.revokeObjectURL(pitems.url); pitems.url = null; } }
  function renderList2() {
    const ul = $('flist2'); ul.innerHTML = '';
    pitems.forEach((it, i) => {
      const li = makeRow(it.name, (isPdf(it) ? 'PDF' : 'image') + ' · ' + fmt(it.size) + (it.from ? ' · from ' + it.from : ''));
      const mk = (txt, title, fn, dis) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'ib'; b.textContent = txt; b.title = title; b.setAttribute('aria-label', title + ' ' + it.name); b.disabled = !!dis || pbusy; b.onclick = fn; return b; };
      li.append(
        mk('↑', 'Move up', () => { [pitems[i - 1], pitems[i]] = [pitems[i], pitems[i - 1]]; clearResult2(); renderList2(); }, i === 0),
        mk('↓', 'Move down', () => { [pitems[i + 1], pitems[i]] = [pitems[i], pitems[i + 1]]; clearResult2(); renderList2(); }, i === pitems.length - 1),
        mk('×', 'Remove', () => { pitems.splice(i, 1); clearResult2(); afterChange2(); }));
      ul.appendChild(li);
    });
  }
  function afterChange2(force) {
    $('work2').classList.toggle('hidden', !pitems.length && !force);
    $('fcount2').textContent = pitems.length === 1 ? '1 file — add at least one more' : pitems.length + ' files, merged in this order';
    go2.disabled = pitems.length < 2 || pbusy; renderList2();
  }
  hookDrop($('drop2'), $('picker2'), async fs => {
    if (!fs.length || pbusy) return; clearResult2(); pbusy = true; say2(fs.some(isArc) ? 'Unpacking archive…' : '');
    const x = await expandZips(fs); pbusy = false;
    const good = x.files.filter(f => isPdf(f) || isImg(f)); pitems.push(...good);
    const msgs = [];
    if (x.files.length > good.length) msgs.push(`Ignored ${x.files.length - good.length} file(s) that aren’t PDFs or images.`);
    if (x.notes.length) msgs.push('Archive notes: ' + x.notes.join('; '));
    afterChange2(msgs.length > 0);
    say2(msgs.join(' '), !!x.notes.length);
  });
  $('clear2').onclick = () => { if (pbusy) return; clearResult2(); pitems = []; afterChange2(); say2(''); };
  go2.onclick = async () => {
    if (pitems.length < 2 || pbusy) return;
    pbusy = true; go2.disabled = true; clearResult2(); renderList2(); say2('Working…');
    try {
      const bufs = [], names = pitems.map(f => f.name);
      for (let i = 0; i < pitems.length; i++) {
        const f = pitems[i];
        if (isPdf(f)) bufs.push(new Uint8Array(await f.arrayBuffer()));
        else {
          say2(`Preparing image ${f.name}…`);
          const c = await imageToCanvas(f, normExt(extOf(f.name)), true);
          const jpg = new Uint8Array(await (await canvasBlob(c, 'image/jpeg', 0.92)).arrayBuffer());
          bufs.push(new Uint8Array(await jpegToPdf(jpg, c.width, c.height).arrayBuffer()));
        }
      }
      const r = await mergePdfs(bufs, names, say2);
      pitems.url = URL.createObjectURL(r.blob);
      $('r2name').textContent = `combined.pdf · ${r.pages} page${r.pages === 1 ? '' : 's'} · ${fmt(r.blob.size)}`;
      const a = $('dl2'); a.href = pitems.url; a.download = 'combined.pdf';
      $('r2note').textContent = 'Bookmarks and fillable-form data from the originals are not carried over.';
      $('result2').classList.remove('hidden'); say2('Done.');
    } catch (e) { say2('Could not combine: ' + (e.message || e), true); }
    pbusy = false; afterChange2();
  };
}
