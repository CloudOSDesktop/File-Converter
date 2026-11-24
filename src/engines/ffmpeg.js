/* Audio + video: ffmpeg.wasm (single-threaded core, so no special headers are needed). Loaded on first use. */
import { register } from '../registry.js';
import { baseName } from '../core.js';
import { FFMPEG_BASE } from '../config.js';

const AUDIO_IN = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus', 'wma', 'aiff', 'aif', 'amr', 'ac3', 'mka'];
const VIDEO_IN = ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv', 'avi', 'flv', 'wmv', '3gp', 'mts', 'ts', 'mpg', 'mpeg', 'gif'];

const AUDIO_OUT = {
  mp3: ['-vn', '-c:a', 'libmp3lame', '-q:a', '2'],
  ogg: ['-vn', '-c:a', 'libvorbis', '-q:a', '5'],
  opus: ['-vn', '-c:a', 'libopus', '-b:a', '128k'],
  flac: ['-vn', '-c:a', 'flac'],
  m4a: ['-vn', '-c:a', 'aac', '-b:a', '192k'],
  aac: ['-vn', '-c:a', 'aac', '-b:a', '192k'],
  wav: ['-vn', '-c:a', 'pcm_s16le'],
  aiff: ['-vn', '-c:a', 'pcm_s16be'],
  wma: ['-vn', '-c:a', 'wmav2', '-b:a', '192k']
};
const H264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2'];
const VIDEO_OUT = {
  mp4: [...H264, '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart'],
  mov: [...H264, '-c:a', 'aac', '-b:a', '128k'],
  mkv: [...H264, '-c:a', 'aac', '-b:a', '128k'],
  webm: ['-c:v', 'libvpx', '-b:v', '1M', '-c:a', 'libvorbis'],
  avi: ['-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'libmp3lame'],
  gif: ['-vf', 'fps=12,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse', '-loop', '0', '-an']
};
const FRAME_OUT = { jpg: ['-ss', '0.1', '-frames:v', '1', '-q:v', '2'], png: ['-ss', '0.1', '-frames:v', '1'] };
const MIME = {
  mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', aiff: 'audio/aiff', wma: 'audio/x-ms-wma',
  mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm', avi: 'video/x-msvideo', gif: 'image/gif', jpg: 'image/jpeg', png: 'image/png'
};

let ff = null, loading = null;
async function getFF(say) {
  if (ff) return ff;
  if (!loading) loading = (async () => {
    say('Loading FFmpeg (one-time download, ~30 MB)…');
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const { toBlobURL } = await import('@ffmpeg/util');
    const f = new FFmpeg();
    await f.load({
      coreURL: await toBlobURL(`${FFMPEG_BASE}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${FFMPEG_BASE}/ffmpeg-core.wasm`, 'application/wasm')
    });
    ff = f; return f;
  })().catch(e => { loading = null; throw e; });
  return loading;
}

register({
  id: 'ffmpeg', label: 'FFmpeg',
  can(ext) {
    if (AUDIO_IN.includes(ext)) return Object.keys(AUDIO_OUT).filter(t => t !== ext);
    if (VIDEO_IN.includes(ext)) return [...Object.keys(AUDIO_OUT), ...Object.keys(VIDEO_OUT), ...Object.keys(FRAME_OUT)].filter(t => t !== ext && !(ext === 'gif' && (t === 'gif' || t in AUDIO_OUT || t in FRAME_OUT)));
    return [];
  },
  async convert(file, ext, target, o) {
    const say = o.say || (() => {});
    const f = await getFF(say);
    const args = AUDIO_OUT[target] || VIDEO_OUT[target] || FRAME_OUT[target];
    const inName = 'input.' + ext, outName = 'output.' + target;
    const onProg = ({ progress }) => { if (progress >= 0 && progress <= 1) say(`Converting… ${Math.round(progress * 100)}%`); };
    f.on('progress', onProg);
    try {
      say('Reading file…');
      await f.writeFile(inName, new Uint8Array(await file.arrayBuffer()));
      say('Converting…');
      const code = await f.exec(['-i', inName, ...args, '-y', outName]);
      if (code !== 0) throw new Error('FFmpeg could not convert this file (unsupported codec?).');
      const data = await f.readFile(outName);
      return {
        blob: new Blob([data], { type: MIME[target] || 'application/octet-stream' }),
        name: `${baseName(file.name)}.${target}`,
        note: 'Converted in your browser with FFmpeg, so large video files can take a while.'
      };
    } finally {
      f.off('progress', onProg);
      try { await f.deleteFile(inName); } catch (e) {}
      try { await f.deleteFile(outName); } catch (e) {}
    }
  }
});
