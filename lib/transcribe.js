// Speech-to-text for voice messages.
//   TRANSCRIBE_BACKEND=local  -> whisper.cpp on this machine (free, audio never leaves your Mac)
//   TRANSCRIBE_BACKEND=openai -> OpenAI API (needs OPENAI_API_KEY, costs a fraction of a cent per message)
//   TRANSCRIBE_BACKEND=deepgram -> Deepgram API (needs DEEPGRAM_API_KEY): fast, takes Discord's Ogg/Opus as-is
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const run = (bin, args, timeout = 120000) => new Promise((resolve, reject) => {
  execFile(bin, args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) {
      if (err.code === 'ENOENT') return reject(new Error(`\`${bin}\` is not installed`));
      return reject(new Error(stderr?.split('\n').filter(Boolean).pop() || err.message));
    }
    resolve(stdout);
  });
});

async function download(url, dest) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Couldn't download the audio (${res.status})`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function local(wavPath) {
  const bin = process.env.WHISPER_BIN || 'whisper-cli';
  const model = process.env.WHISPER_MODEL;
  if (!model || !fs.existsSync(model)) throw new Error('WHISPER_MODEL is not set to a downloaded model file (see README)');
  const out = await run(bin, ['-m', model, '-f', wavPath, '-l', 'auto', '-nt', '-np']);
  return out.replace(/\[.*?\]/g, '').replace(/\s+/g, ' ').trim();
}

async function openai(audioPath) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  const form = new FormData();
  form.append('model', process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1');
  form.append('file', new Blob([fs.readFileSync(audioPath)]), path.basename(audioPath));
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error?.message || `OpenAI error ${res.status}`);
  return body.text.trim();
}

async function deepgram(audioPath, contentType) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error('DEEPGRAM_API_KEY is not set');
  const params = new URLSearchParams({ model: process.env.DEEPGRAM_MODEL || 'nova-3', smart_format: 'true', detect_language: 'true' });
  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: 'POST',
    headers: { Authorization: `Token ${key}`, 'Content-Type': contentType || 'audio/ogg' },
    body: fs.readFileSync(audioPath),
    signal: AbortSignal.timeout(60000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.err_msg || body.reason || `Deepgram error ${res.status}`);
  const channel = body.results?.channels?.[0];
  return { text: channel?.alternatives?.[0]?.transcript?.trim() ?? '', language: channel?.detected_language ?? null };
}

// Downloads the attachment and transcribes it with the configured backend. Returns { text, language }.
async function transcribe(attachment) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deed-'));
  try {
    const input = path.join(dir, `in${path.extname(attachment.name || '') || '.ogg'}`);
    await download(attachment.url, input);
    const backend = (process.env.TRANSCRIBE_BACKEND || 'local').toLowerCase();
    if (backend === 'deepgram') return await deepgram(input, attachment.contentType);
    // whisper / OpenAI: convert to 16kHz mono WAV first
    const wav = path.join(dir, 'audio.wav');
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
    return { text: backend === 'openai' ? await openai(wav) : await local(wav), language: null };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const isAudio = (a) => a.contentType?.startsWith('audio/') || /\.(ogg|mp3|m4a|wav|webm|opus|flac)$/i.test(a.name ?? '');

module.exports = { transcribe, isAudio };
