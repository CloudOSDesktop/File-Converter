import './core.js';
import './registry.js';          // registers the built-in (no-download) engine first, so it has priority
import './engines/sheets.js';     // XLSX / XLS / ODS
import './engines/pandoc.js';     // documents
import './engines/magick.js';     // images
import './engines/ffmpeg.js';     // audio + video
import './engines/pdf.js';        // PDF -> images/text, split
import './engines/archive.js';    // 7z / RAR / TAR unpacking
import './engines/cloud.js';      // server-side (Office, ebooks, CAD) - only shown when the API is configured
import { initUI } from './ui.js';

initUI();
