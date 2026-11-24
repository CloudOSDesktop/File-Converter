# File Converter

Convert almost any file to any other, in bulk, in the browser. Combine PDFs. Unpack zip/7z/rar/tar and convert everything inside.
Most conversions run on the visitor's own computer (WebAssembly), so files are never uploaded. A few formats (Word/PowerPoint/Excel
with full formatting, PDF → DOCX, ebooks, CAD) go through an optional server route.

## What runs where

| Engine | Handles | Runs |
|---|---|---|
| Built-in (`src/core.js`) | PNG/JPG/WebP/GIF/BMP/ICO/SVG, WAV, JSON/CSV/TSV/XML/YAML, TXT/MD/HTML/DOCX, PDF merge, zip | browser, no download |
| FFmpeg (`engines/ffmpeg.js`) | MP3, OGG, Opus, FLAC, M4A, AAC, AIFF, WMA, MP4, MOV, MKV, WebM, AVI, GIF, frames | browser, ~30 MB on first use |
| ImageMagick (`engines/magick.js`) | HEIC, TIFF, PSD, JPEG XL, TGA, DDS, AVIF... | browser, on first use |
| Pandoc (`engines/pandoc.js`) | DOCX, ODT, EPUB, RTF, LaTeX, reST, Org, AsciiDoc, MediaWiki, PPTX... | browser, on first use |
| PDF (`engines/pdf.js`) | PDF → PNG/JPG/WebP, text, split pages | browser |
| SheetJS (`engines/sheets.js`) | XLSX, XLS, ODS ↔ CSV/TSV/JSON/HTML | browser |
| libarchive (`engines/archive.js`) | unpack 7z, RAR, TAR, GZ, BZ2, XZ | browser |
| CloudConvert (`engines/cloud.js` + `api/cloudconvert.js`) | Office ↔ PDF, PDF → DOCX/XLSX/PPTX, MOBI/AZW3, AI/EPS/CAD | server (optional) |

Server targets are labelled "· server" in the UI and only appear when the API route is configured.

## Run it locally

```bash
npm install        # also copies the WASM files into /public (scripts/copy-assets.mjs)
npm run dev        # http://localhost:5173
```

## Deploy to Vercel

1. Put this folder in a Git repo (GitHub/GitLab/Bitbucket) and push. `public/ffmpeg`, `public/libarchive`, `public/magick.wasm` and
   `public/pdf.worker.min.mjs` are git-ignored on purpose: `npm install` recreates them during the Vercel build.
2. In Vercel: **Add New → Project → import the repo**. Vercel detects Vite; `vercel.json` already sets the build.
   (Or from this folder: `npm i -g vercel && vercel --prod`.)
3. *(Optional, for the "· server" formats)* In **Settings → Environment Variables** add:
   - `CLOUDCONVERT_API_KEY` – from cloudconvert.com → Dashboard → API Keys → create a v2 key with scopes `task.read` and `task.write`.
   - `APP_ACCESS_CODE` – **strongly recommended**. Without it, anyone who finds your site can spend your CloudConvert credits. Visitors are asked for the code once per browser session.
   - `CLOUDCONVERT_SANDBOX=true` – optional, to test against the free sandbox first (only whitelisted test files convert there).
   Then redeploy.

### Size limits to watch
The WASM engines are large (FFmpeg core ~30 MB, ImageMagick ~15–25 MB, Pandoc ~40 MB+). If a deployment hits a size limit, serve FFmpeg from a CDN
instead: edit `FFMPEG_BASE` in `src/config.js` (the line to use is in the comment there).

## Adding another converter
Create `src/engines/yours.js`, then `register({ id, label, can(ext) → [targets], convert(file, ext, target, opts) → {blob, name, note?} })`
and import it in `src/main.js`. Engines imported earlier take priority; later ones act as fallbacks if the first fails.

## Known limits
- Browser conversions use the visitor's CPU and memory. Very large videos (multi-GB) will fail or be slow; FFmpeg runs single-threaded.
- The PDF combiner can't open password-protected PDFs and drops bookmarks and fillable-form data.
- Pandoc output is excellent for text documents; it will not reproduce complex Word layouts. Use the "· server" PDF option for that.
- PDF → image/text uses the PDF's own text layer; scanned PDFs have no text (OCR is not included).
