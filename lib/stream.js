// Go Live screen-share streaming into group chat calls, via @dank074/discord-video-stream
// (which supports Discord's DAVE call encryption and DM/group calls).
// Sources: YouTube links (yt-dlp), direct video links / Discord attachments, and local files.
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { Streamer, prepareStream, playStream, Utils, Encoders } = require('@dank074/discord-video-stream');

const VIDEO_DIR = path.join(__dirname, '..', 'videos');
const HEIGHT = () => Number(process.env.STREAM_HEIGHT || 720);
const FPS = () => Number(process.env.STREAM_FPS || 30);

let streamer = null;
const active = new Map(); // channelId -> { controller, title, requester, startedAt, duration, cleanup }

const getStreamer = (client) => (streamer ??= new Streamer(client));
const isStreaming = (channelId) => active.has(channelId);
const current = (channelId) => active.get(channelId) ?? null;

const YOUTUBE = /^https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i;
const VIDEO_EXT = /\.(mp4|webm|mkv|mov|m4v|avi|flv|ts|m3u8)(\?|$)/i;

function ytdlp(args) {
  return new Promise((resolve, reject) => {
    execFile('yt-dlp', args, { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(err.code === 'ENOENT' ? 'yt-dlp is not installed' : (stderr.split('\n').find((l) => l.startsWith('ERROR')) ?? 'could not read that YouTube link').replace(/^ERROR:\s*/, '')));
      resolve(stdout.trim().split('\n'));
    });
  });
}

// Turn a request into something ffmpeg can read: { input: string | Readable, title, duration, cleanup }.
async function resolveSource(src) {
  if (src.kind === 'file') {
    const file = path.join(VIDEO_DIR, path.basename(src.name)); // basename: no escaping the videos folder
    if (!fs.existsSync(file)) throw new Error(`no file called ${path.basename(src.name)} in the videos folder`);
    return { input: file, title: path.basename(file), duration: 0, cleanup: () => {} };
  }

  if (YOUTUBE.test(src.url)) {
    const [title, duration, ...urls] = await ytdlp(['--no-playlist', '-f', `bv*[height<=${HEIGHT()}]+ba/b[height<=${HEIGHT()}]/b`, '--print', 'title', '--print', 'duration', '--print', 'urls', src.url]);
    const [video, audio] = urls.join('\n').split('\n').filter(Boolean);
    if (!video) throw new Error('could not find a playable format for that video');
    if (!audio) return { input: video, title, duration: Number(duration) || 0, cleanup: () => {} };
    // YouTube serves video and audio separately: mux them (no re-encode) into one stream for the streamer.
    const mux = spawn('ffmpeg', ['-loglevel', 'error', '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
      '-i', video, '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5', '-i', audio,
      '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-f', 'matroska', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
    return { input: mux.stdout, title, duration: Number(duration) || 0, cleanup: () => mux.kill('SIGKILL') };
  }

  // Direct link (or Discord attachment): make sure it's actually a video before handing it to ffmpeg.
  if (!VIDEO_EXT.test(src.url) && !src.isVideo) {
    const type = await fetch(src.url, { method: 'HEAD', signal: AbortSignal.timeout(8000) })
      .then((r) => r.headers.get('content-type') ?? '').catch(() => '');
    if (!/^video\/|mpegurl|octet-stream/i.test(type)) throw new Error("that link isn't a direct video (try a YouTube link or a link ending in .mp4)");
  }
  const name = decodeURIComponent(new URL(src.url).pathname.split('/').pop() || 'video');
  return { input: src.url, title: src.title ?? name, duration: 0, cleanup: () => {} };
}

// Start streaming into the GC call. Resolves when the stream ends (finished, stopped, or failed).
async function start(client, channel, src, requester, hooks = {}) {
  if (active.has(channel.id)) throw new Error('already streaming here');
  const controller = new AbortController();
  const entry = { controller, title: 'loading…', requester, startedAt: Date.now(), duration: 0, cleanup: () => {} };
  active.set(channel.id, entry);
  const s = getStreamer(client);
  try {
    const source = await resolveSource(src);
    Object.assign(entry, { title: source.title, duration: source.duration, cleanup: source.cleanup });
    source.input.on?.('error', () => {}); // a closed pipe here is handled by the stream ending
    await s.joinVoice(null, channel.id); // null guild = DM / group call

    const { command, output } = prepareStream(source.input, {
      height: HEIGHT(),
      frameRate: FPS(),
      bitrateVideo: 2500,
      bitrateVideoMax: 4000,
      videoCodec: Utils.normalizeVideoCodec('H264'),
      encoder: Encoders.software({ x264: { preset: 'veryfast' } }),
      logLevel: 'error',
    }, controller.signal);
    command.on('error', (err) => { if (!controller.signal.aborted) console.error('[stream] ffmpeg:', err.message); });

    entry.startedAt = Date.now();
    hooks.onLive?.(entry);
    await playStream(output, s, { type: 'go-live' }, controller.signal).catch((err) => {
      if (!controller.signal.aborted) throw err;
    });
    return { stopped: controller.signal.aborted, entry };
  } finally {
    entry.cleanup();
    active.delete(channel.id);
    try { s.leaveVoice(); } catch { /* already gone */ }
  }
}

function stop(channelId) {
  const entry = active.get(channelId);
  if (!entry) return false;
  entry.controller.abort();
  return true;
}

function listFiles() {
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  return fs.readdirSync(VIDEO_DIR).filter((f) => VIDEO_EXT.test(f));
}

module.exports = { start, stop, isStreaming, current, listFiles, resolveSource, VIDEO_DIR, YOUTUBE };
