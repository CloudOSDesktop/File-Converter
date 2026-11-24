/*
 * Vercel serverless function: thin, safe proxy to the CloudConvert API v2.
 *   GET  /api/cloudconvert?action=config           -> { enabled, needsCode }
 *   POST /api/cloudconvert?action=create           -> { id, form }   (browser then uploads straight to form.url)
 *   GET  /api/cloudconvert?action=status&id=JOBID  -> { status, files?, message? }
 *
 * Environment variables (Vercel -> Project -> Settings -> Environment Variables):
 *   CLOUDCONVERT_API_KEY   required. Needs the task.read and task.write scopes.
 *   APP_ACCESS_CODE        optional but recommended: visitors must enter this code to use server conversions.
 *   CLOUDCONVERT_SANDBOX   optional: set to "true" to use the free sandbox (only whitelisted test files convert).
 */
const API = () => (process.env.CLOUDCONVERT_SANDBOX === 'true' ? 'https://sandbox.api.cloudconvert.com/v2' : 'https://api.cloudconvert.com/v2');
const FORMAT = /^[a-z0-9]{1,10}$/;
const JOB_ID = /^[A-Za-z0-9-]{8,64}$/;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const key = process.env.CLOUDCONVERT_API_KEY, code = process.env.APP_ACCESS_CODE;
  const action = (req.query && req.query.action) || '';

  if (action === 'config') return res.status(200).json({ enabled: !!key, needsCode: !!code });
  if (!key) return res.status(503).json({ error: 'Server-side conversion is not configured on this deployment.' });
  if (code && req.headers['x-access-code'] !== code) return res.status(401).json({ error: 'Wrong or missing access code.' });

  const cc = (path, init) => fetch(API() + path, Object.assign({}, init, {
    headers: Object.assign({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, (init && init.headers) || {})
  }));

  try {
    if (action === 'create' && req.method === 'POST') {
      const { inputFormat, outputFormat } = req.body || {};
      if (!FORMAT.test(inputFormat || '') || !FORMAT.test(outputFormat || '')) return res.status(400).json({ error: 'Invalid format.' });
      const r = await cc('/jobs', {
        method: 'POST',
        body: JSON.stringify({
          tag: 'file-converter',
          tasks: {
            'import-file': { operation: 'import/upload' },
            'convert-file': { operation: 'convert', input: 'import-file', input_format: inputFormat, output_format: outputFormat },
            'export-file': { operation: 'export/url', input: 'convert-file' }
          }
        })
      });
      const j = await r.json();
      if (!r.ok) return res.status(r.status === 401 || r.status === 403 ? 502 : r.status).json({ error: j.message || 'CloudConvert rejected the request.' });
      const up = (j.data.tasks || []).find(t => t.name === 'import-file');
      if (!up || !up.result || !up.result.form) return res.status(502).json({ error: 'CloudConvert returned no upload form.' });
      return res.status(200).json({ id: j.data.id, form: up.result.form });
    }

    if (action === 'status' && req.method === 'GET') {
      const id = (req.query && req.query.id) || '';
      if (!JOB_ID.test(id)) return res.status(400).json({ error: 'Invalid job id.' });
      const r = await cc('/jobs/' + id);
      const j = await r.json();
      if (!r.ok) return res.status(r.status === 401 || r.status === 403 ? 502 : r.status).json({ error: j.message || 'Could not read job status.' });
      const job = j.data, tasks = job.tasks || [];
      if (job.status === 'error') {
        const bad = tasks.find(t => t.status === 'error');
        return res.status(200).json({ status: 'error', message: (bad && bad.message) || 'Conversion failed.' });
      }
      if (job.status === 'finished') {
        const exp = tasks.find(t => t.name === 'export-file');
        const files = ((exp && exp.result && exp.result.files) || []).map(f => ({ filename: f.filename, url: f.url }));
        return res.status(200).json({ status: 'finished', files });
      }
      return res.status(200).json({ status: job.status });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach the conversion service.' });
  }
}
