// Image generation: meme captions (static + animated via ffmpeg) and quote cards.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const FONT = '"Helvetica Neue", Arial, "Apple Color Emoji", sans-serif';
const MAX_UPLOAD = 9.5 * 1024 * 1024; // Discord's 10 MB limit for normal accounts

const run = (bin, args) => new Promise((resolve, reject) => {
  execFile(bin, args, { timeout: 60000, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) reject(new Error(err.code === 'ENOENT' ? `${bin} is not installed` : stderr.split('\n').filter(Boolean).pop() || err.message));
    else resolve(stdout);
  });
});

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`couldn't download the image (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 25 * 1024 * 1024) throw new Error('that file is too big (25 MB max)');
  return { buf, type: res.headers.get('content-type') ?? '' };
}

// ---------- finding the image to caption ----------
function mediaIn(m) {
  if (!m) return null;
  const att = m.attachments?.find((a) => /^(image|video)\//.test(a.contentType ?? '') || /\.(png|jpe?g|gif|webp|mp4|mov|webm)(\?|$)/i.test(a.name ?? a.url ?? ''));
  if (att) return { url: att.url, animated: /gif|video/.test(att.contentType ?? '') || /\.(gif|mp4|mov|webm)(\?|$)/i.test(att.name ?? att.url) };
  for (const e of m.embeds ?? []) {
    if (e.video?.url) return { url: e.video.url, animated: true };
    const img = e.image?.url ?? e.thumbnail?.url;
    if (img) return { url: img, animated: /\.gif(\?|$)/i.test(img) };
  }
  return null;
}

async function findMedia(message) {
  const own = mediaIn(message);
  if (own) return own;
  if (message.reference?.messageId) {
    const ref = await message.fetchReference().catch(() => null);
    const found = mediaIn(ref);
    if (found) return found;
  }
  const recent = await message.channel.messages?.fetch({ limit: 15, before: message.id }).catch(() => null);
  for (const m of recent?.values() ?? []) {
    const found = mediaIn(m);
    if (found) return found;
  }
  return null;
}

// ---------- text layout ----------
function wrap(ctx, text, maxWidth) {
  const lines = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width <= maxWidth || !line) line = test;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}

// Largest font size (≤ max) whose wrapped text fits inside maxWidth × maxHeight.
function fit(ctx, text, maxWidth, maxHeight, max, min, weight = '500', style = '') {
  for (let size = max; size >= min; size -= 2) {
    ctx.font = `${style} ${weight} ${size}px ${FONT}`;
    const lines = wrap(ctx, text, maxWidth);
    if (lines.length * size * 1.18 <= maxHeight) return { size, lines };
  }
  ctx.font = `${style} ${weight} ${min}px ${FONT}`;
  return { size: min, lines: wrap(ctx, text, maxWidth) };
}

// White caption bar image of the given width.
function captionBar(text, width) {
  const probe = createCanvas(width, 10).getContext('2d');
  const size = Math.max(22, Math.round(width / 13));
  probe.font = `500 ${size}px ${FONT}`;
  const lines = wrap(probe, text, width * 0.9);
  const lineH = size * 1.2;
  const height = Math.round(lines.length * lineH + size * 1.1);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000000';
  ctx.font = `500 ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const top = (height - lines.length * lineH) / 2 + lineH / 2;
  lines.forEach((l, i) => ctx.fillText(l, width / 2, top + i * lineH));
  return canvas;
}

async function captionStatic(buf, text) {
  const img = await loadImage(buf);
  const width = Math.min(1200, Math.max(400, img.width));
  const height = Math.round(img.height * (width / img.width));
  const bar = captionBar(text, width);
  const canvas = createCanvas(width, bar.height + height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bar, 0, 0);
  ctx.drawImage(img, 0, bar.height, width, height);
  return { buffer: await canvas.encode('png'), name: 'caption.png' };
}

async function captionAnimated(buf, text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deed-cap-'));
  try {
    const input = path.join(dir, 'in');
    fs.writeFileSync(input, buf);
    const [w] = (await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', input])).trim().split(',').map(Number);
    // Try progressively smaller/slower versions until it fits Discord's upload limit.
    for (const [width, fps] of [[Math.min(w || 480, 480), 20], [360, 15], [280, 12]]) {
      const bar = captionBar(text, width);
      const barPath = path.join(dir, 'bar.png');
      fs.writeFileSync(barPath, await bar.encode('png'));
      const out = path.join(dir, 'out.gif');
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-t', '15', '-i', input, '-i', barPath, '-filter_complex',
        `[0:v]fps=${fps},scale=${width}:-2:flags=lanczos,pad=iw:ih+${bar.height}:0:${bar.height}:white[v];[v][1:v]overlay=0:0,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
        '-loop', '0', out]);
      const result = fs.readFileSync(out);
      if (result.length <= MAX_UPLOAD) return { buffer: result, name: 'caption.gif' };
    }
    throw new Error('that GIF is too long to caption under 10 MB');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- quote card ----------
async function renderQuote({ text, displayName, username, avatarUrl }) {
  const W = 1200, H = 630;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);

  const avatar = await download(avatarUrl).then(({ buf }) => loadImage(buf)).catch(() => null);
  const aw = H; // square avatar filling the left side
  if (avatar) ctx.drawImage(avatar, 0, 0, aw, H);
  else {
    const g = ctx.createLinearGradient(0, 0, aw, H);
    g.addColorStop(0, '#5865f2');
    g.addColorStop(1, '#eb459e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, aw, H);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = `bold 260px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((displayName[0] ?? '?').toUpperCase(), aw / 2, H / 2);
  }
  // Fade the avatar into black.
  const fade = ctx.createLinearGradient(aw * 0.35, 0, aw, 0);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, aw, H);

  const textX = aw + (W - aw) / 2 - 30;
  const maxW = W - aw - 40;
  const quote = text.length > 400 ? `${text.slice(0, 399)}…` : text;
  const { size, lines } = fit(ctx, quote, maxW, H * 0.55, 64, 24, '500');
  const lineH = size * 1.18;
  const blockH = lines.length * lineH + 90;
  let y = (H - blockH) / 2 + lineH / 2;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `500 ${size}px ${FONT}`;
  for (const l of lines) { ctx.fillText(l, textX, y); y += lineH; }
  ctx.font = `italic 400 ${Math.round(size * 0.62)}px ${FONT}`;
  ctx.fillText(`- ${displayName}`, textX, y + 14);
  ctx.font = `400 ${Math.round(size * 0.4)}px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText(`@${username}`, textX, y + 14 + size * 0.62);

  return { buffer: await canvas.encode('png'), name: 'quote.png' };
}

module.exports = [
  {
    name: 'caption',
    aliases: ['cap', 'meme'],
    usage: 'caption <text> (reply to an image/GIF, attach one, or send right after one)',
    description: 'Add a meme caption bar to an image or GIF (GIFs stay animated).',
    cooldown: 5000,
    async run({ message, args }) {
      const text = args.join(' ').replace(/<@!?\d+>/g, '').trim();
      if (!text) return message.reply('What should the caption say? `caption <text>` (reply to an image)');
      const media = await findMedia(message);
      if (!media) return message.reply('Reply to an image or GIF (or attach one) with `caption <text>`.');
      await message.channel.sendTyping?.().catch(() => {});
      try {
        const { buf, type } = await download(media.url);
        const animated = media.animated || /gif|video/.test(type);
        const file = animated ? await captionAnimated(buf, text.slice(0, 200)) : await captionStatic(buf, text.slice(0, 200));
        await message.channel.send({ files: [{ attachment: file.buffer, name: file.name }] });
      } catch (err) {
        console.error('[caption]', err.message);
        await message.reply(`🖼️ Couldn't caption that: ${err.message}`);
      }
    },
  },
  {
    name: 'quote',
    aliases: ['qt'], // not 'q': that's the music queue
    usage: 'quote <text>  ·  or reply to a message with quote',
    description: 'Turn a message into a quote card with the author’s avatar.',
    cooldown: 5000,
    async run({ message, args }) {
      let author = message.author;
      let text = args.join(' ').trim();
      if (message.reference?.messageId) {
        const ref = await message.fetchReference().catch(() => null);
        if (ref) { author = ref.author; if (!text) text = ref.content; }
      }
      text = text.replace(/<a?:(\w+):\d+>/g, ':$1:').trim();
      if (!text) return message.reply('Quote what? `quote <text>`, or reply to a message with `quote`.');
      await message.channel.sendTyping?.().catch(() => {});
      const file = await renderQuote({
        text,
        displayName: author.globalName ?? author.username,
        username: author.username,
        avatarUrl: author.displayAvatarURL({ format: 'png', dynamic: false, size: 1024 }),
      });
      await message.channel.send({ files: [{ attachment: file.buffer, name: file.name }] });
    },
  },
];

module.exports.internals = { renderQuote, captionStatic, captionAnimated };
