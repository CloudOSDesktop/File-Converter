/* Documents: Pandoc compiled to WebAssembly (official pandoc-wasm). Lazy-loaded on first use. */
import { register } from '../registry.js';
import { baseName, textToPdf } from '../core.js';

const FROM = { txt: 'markdown', md: 'markdown', docx: 'docx', odt: 'odt', epub: 'epub', html: 'html', tex: 'latex', rst: 'rst', textile: 'textile',
  org: 'org', mediawiki: 'mediawiki', fb2: 'fb2', ipynb: 'ipynb', rtf: 'rtf' };
const BINARY_IN = new Set(['docx', 'odt', 'epub', 'fb2']);
const TO = { md: ['gfm', false], docx: ['docx', true], odt: ['odt', true], epub: ['epub3', true], pptx: ['pptx', true], html: ['html5', false], rtf: ['rtf', false],
  tex: ['latex', false], rst: ['rst', false], textile: ['textile', false], org: ['org', false], adoc: ['asciidoc', false], mediawiki: ['mediawiki', false], txt: ['plain', false] };
const STANDALONE = new Set(['html', 'tex', 'rtf']);
const MIME = {
  md: 'text/markdown', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', odt: 'application/vnd.oasis.opendocument.text',
  epub: 'application/epub+zip', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', html: 'text/html', rtf: 'application/rtf', txt: 'text/plain'
};

register({
  id: 'pandoc', label: 'Pandoc',
  can(ext) {
    if (!(ext in FROM)) return [];
    return [...Object.keys(TO), 'pdf'].filter(t => t !== ext && !(ext === 'txt' && t === 'md'));
  },
  async convert(file, ext, target, o) {
    const say = o.say || (() => {});
    say('Loading Pandoc (one-time download)…');
    const { convert } = await import('pandoc-wasm');
    say('Converting…');
    const pdf = target === 'pdf', key = pdf ? 'txt' : target;
    const [to, binary] = TO[key];
    const options = { from: FROM[ext], to };
    if (STANDALONE.has(key)) options.standalone = true;
    if (binary) options['output-file'] = 'output.' + key;
    let stdin = null, files = {};
    if (BINARY_IN.has(ext)) { files['input.' + ext] = file; options['input-files'] = ['input.' + ext]; }
    else stdin = await file.text();
    const r = await convert(options, stdin, files);
    const base = baseName(file.name);
    if (pdf) return { blob: textToPdf(String(r.stdout || '')), name: base + '.pdf', note: 'Plain-text PDF in a monospaced font; formatting is not kept.' };
    if (binary) {
      const out = r.files && r.files['output.' + key];
      if (!out) throw new Error('Pandoc produced no output' + (r.stderr ? ': ' + String(r.stderr).slice(0, 160) : '.'));
      return { blob: new Blob([out], { type: MIME[key] }), name: `${base}.${key}` };
    }
    return { blob: new Blob([String(r.stdout || '')], { type: (MIME[key] || 'text/plain') + ';charset=utf-8' }), name: `${base}.${key}` };
  }
});
