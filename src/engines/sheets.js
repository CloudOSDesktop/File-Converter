/* Spreadsheets: SheetJS reads/writes XLSX, XLS, ODS (and CSV/HTML) and bridges them to the data formats. */
import { register } from '../registry.js';
import { baseName, zipStore, parseData, toCSV } from '../core.js';

const SHEET_IN = ['xlsx', 'xls', 'xlsm', 'ods'];
const DATA_IN = ['csv', 'tsv', 'json', 'xml', 'yaml'];
const BOOKS = { xlsx: 'xlsx', xls: 'biff8', ods: 'ods' };
const MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel',
  ods: 'application/vnd.oasis.opendocument.spreadsheet', csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json', html: 'text/html'
};

register({
  id: 'sheets', label: 'SheetJS',
  can(ext) {
    if (SHEET_IN.includes(ext)) return ['xlsx', 'xls', 'ods', 'csv', 'tsv', 'json', 'html'].filter(t => t !== ext);
    if (DATA_IN.includes(ext)) return ['xlsx', 'xls', 'ods', 'html'];
    return [];
  },
  async convert(file, ext, target) {
    const XLSX = await import('xlsx');
    let wb;
    if (SHEET_IN.includes(ext)) wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
    else {
      const csv = ext === 'csv' ? await file.text() : toCSV(parseData(await file.text(), ext), ',');
      wb = XLSX.read(csv, { type: 'string' });
    }
    const base = baseName(file.name), names = wb.SheetNames;
    if (!names.length) throw new Error('No sheets found in that file.');
    if (BOOKS[target]) {
      const out = XLSX.write(wb, { bookType: BOOKS[target], type: 'array' });
      return { blob: new Blob([out], { type: MIME[target] }), name: `${base}.${target}` };
    }
    const render = name => {
      const ws = wb.Sheets[name];
      if (target === 'csv') return XLSX.utils.sheet_to_csv(ws);
      if (target === 'tsv') return XLSX.utils.sheet_to_csv(ws, { FS: '\t' });
      if (target === 'json') return JSON.stringify(XLSX.utils.sheet_to_json(ws, { defval: null }), null, 2) + '\n';
      return XLSX.utils.sheet_to_html(ws);
    };
    if (names.length === 1 || target === 'html') {
      const text = target === 'html'
        ? `<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>${base}</title></head><body>\n${names.map(n => (names.length > 1 ? `<h2>${n}</h2>\n` : '') + XLSX.utils.sheet_to_html(wb.Sheets[n], { header: '', footer: '' })).join('\n')}\n</body></html>\n`
        : render(names[0]);
      return { blob: new Blob([text], { type: MIME[target] + ';charset=utf-8' }), name: `${base}.${target}` };
    }
    const enc = new TextEncoder();
    const files = names.map(n => ({ name: `${base}-${n.replace(/[\\/:*?"<>|]/g, '_')}.${target}`, data: enc.encode(render(n)) }));
    return { blob: new Blob([zipStore(files)], { type: 'application/zip' }), name: `${base}-sheets.zip`, note: `${names.length} sheets, one file each, in a ZIP.` };
  }
});
