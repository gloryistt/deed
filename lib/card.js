// Animated profile / wallet card: spinning coin, light sweep, sparkles, avatar ring, verified badge.
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');

const W = 640, H = 280;
const FRAMES = 24, FRAME_MS = 60;
const FONT = '"Avenir Next", "Helvetica Neue", Arial, sans-serif';

const lerp = (a, b, t) => a + (b - a) * t;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Deterministic sparkle positions so the loop is seamless.
const SPARKLES = Array.from({ length: 22 }, (_, i) => {
  const r = (n) => ((Math.sin(i * 928.37 + n * 51.1) + 1) / 2);
  return { x: r(1) * W, y: r(2) * H, size: 0.8 + r(3) * 1.8, phase: r(4) };
});

function drawBackground(ctx, t) {
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0f1026');
  bg.addColorStop(0.55, '#1c1442');
  bg.addColorStop(1, '#2a0f3d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // soft glow orbs
  for (const [x, y, r, c] of [[W * 0.15, H * 0.1, 220, 'rgba(88, 101, 242, 0.35)'], [W * 0.95, H * 1.0, 260, 'rgba(235, 69, 158, 0.25)']]) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, c);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // twinkling sparkles
  for (const s of SPARKLES) {
    const a = 0.25 + 0.75 * Math.max(0, Math.sin((t + s.phase) * Math.PI * 2));
    ctx.fillStyle = `rgba(255, 255, 255, ${(a * 0.7).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawShine(ctx, t) {
  // A diagonal band of light sweeping across once per loop.
  const x = lerp(-W * 0.6, W * 1.6, t);
  const g = ctx.createLinearGradient(x - 120, 0, x + 120, H);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.10)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function drawAvatar(ctx, img, t, cx, cy, r) {
  // rotating gradient ring
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(t * Math.PI * 2);
  const ring = ctx.createLinearGradient(-r, -r, r, r);
  ring.addColorStop(0, '#5865f2');
  ring.addColorStop(0.5, '#eb459e');
  ring.addColorStop(1, '#fee75c');
  ctx.strokeStyle = ring;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(0, 0, r + 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  if (img) ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  else { ctx.fillStyle = '#5865f2'; ctx.fillRect(cx - r, cy - r, r * 2, r * 2); }
  ctx.restore();
}

function drawVerified(ctx, x, y, size) {
  // Blue scalloped badge with a white check.
  const r = size / 2, cx = x + r, cy = y + r;
  ctx.fillStyle = '#1d9bf0';
  ctx.beginPath();
  const points = 16;
  for (let i = 0; i <= points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * 0.86;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = size * 0.13;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.42, cy + r * 0.02);
  ctx.lineTo(cx - r * 0.1, cy + r * 0.34);
  ctx.lineTo(cx + r * 0.45, cy - r * 0.3);
  ctx.stroke();
}

function drawCoin(ctx, t, cx, cy, r) {
  // Spin: squash horizontally with cos, darker when seen edge-on.
  const spin = Math.cos(t * Math.PI * 2);
  const sx = Math.max(0.08, Math.abs(spin));
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(sx, 1);
  const g = ctx.createLinearGradient(-r, -r, r, r);
  g.addColorStop(0, '#fff3a3');
  g.addColorStop(0.45, '#f5c542');
  g.addColorStop(1, '#b7791f');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#8a5a12';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.74, 0, Math.PI * 2);
  ctx.stroke();
  if (sx > 0.35) {
    ctx.fillStyle = '#8a5a12';
    ctx.font = `bold ${Math.round(r * 1.05)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('D', 0, r * 0.06);
  }
  ctx.restore();
}

function fitText(ctx, text, maxWidth, weight, startSize, minSize = 14) {
  let size = startSize;
  do {
    ctx.font = `${weight} ${size}px ${FONT}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 1;
  } while (size > minSize);
  return size;
}

function pill(ctx, x, y, label, value, accent) {
  ctx.font = `600 13px ${FONT}`;
  const lw = ctx.measureText(label).width;
  ctx.font = `bold 15px ${FONT}`;
  const vw = ctx.measureText(value).width;
  const w = lw + vw + 30;
  roundRect(ctx, x, y, w, 30, 15);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `600 13px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText(label, x + 12, y + 15.5);
  ctx.font = `bold 15px ${FONT}`;
  ctx.fillStyle = accent;
  ctx.fillText(value, x + 18 + lw, y + 15.5);
  return w;
}

function drawFrame(ctx, info, avatar, t) {
  drawBackground(ctx, t);

  // glass panel
  roundRect(ctx, 18, 18, W - 36, H - 36, 22);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  drawAvatar(ctx, avatar, t, 100, 112, 52);

  // name + verified
  const nameX = 180, nameMax = W - nameX - 60 - (info.verified ? 34 : 0);
  const size = fitText(ctx, info.displayName, nameMax, 'bold', 30);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${size}px ${FONT}`;
  ctx.fillText(info.displayName, nameX, 96);
  if (info.verified) drawVerified(ctx, nameX + ctx.measureText(info.displayName).width + 10, 96 - size * 0.82, size * 0.9);
  ctx.font = `500 16px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText(`@${info.username}${info.verified ? '  ·  verified' : ''}`, nameX, 122);

  // coins
  drawCoin(ctx, t, nameX + 22, 164, 20);
  const coinText = info.coins.toLocaleString();
  const coinSize = fitText(ctx, coinText, W - nameX - 110, 'bold', 40, 20);
  const gold = ctx.createLinearGradient(0, 140, 0, 185);
  gold.addColorStop(0, '#fff6c2');
  gold.addColorStop(1, '#f5b82e');
  ctx.fillStyle = gold;
  ctx.font = `bold ${coinSize}px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(coinText, nameX + 52, 166);
  const coinWidth = ctx.measureText(coinText).width;
  ctx.font = `600 14px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText('coins', nameX + 62 + coinWidth, 170);
  if (info.bank) {
    ctx.font = `600 13px ${FONT}`;
    ctx.fillStyle = 'rgba(134, 239, 172, 0.8)';
    ctx.fillText(`+ ${info.bank.toLocaleString()} safe in the bank`, nameX + 52, 196);
  }

  // stat pills
  let px = 40;
  const py = H - 70;
  px += pill(ctx, px, py, 'using Deed', info.memberFor, '#a5b4fc') + 10;
  px += pill(ctx, px, py, 'rank', info.rank, '#fde68a') + 10;
  pill(ctx, px, py, 'net', info.net, info.netPositive ? '#86efac' : '#fca5a5');

  // brand
  ctx.font = `bold 12px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillText('D E E D', W - 40, 48);

  drawShine(ctx, t);
}

async function loadAvatar(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return res.ok ? await loadImage(Buffer.from(await res.arrayBuffer())) : null;
  } catch {
    return null;
  }
}

// info: { displayName, username, avatarUrl, verified, coins, memberFor, rank, net, netPositive }
async function renderCard(info, { animated = true } = {}) {
  const avatar = await loadAvatar(info.avatarUrl);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  if (!animated) {
    drawFrame(ctx, info, avatar, 0); // coin face-on
    return { buffer: await canvas.encode('png'), name: 'deed-card.png' };
  }

  // One shared palette (built from a few frames) keeps colors stable between frames: no flicker.
  const frames = [];
  for (let i = 0; i < FRAMES; i++) {
    drawFrame(ctx, info, avatar, i / FRAMES);
    frames.push(ctx.getImageData(0, 0, W, H).data);
  }
  const sample = new Uint8ClampedArray(W * H * 4 * 3);
  [0, Math.floor(FRAMES / 3), Math.floor((2 * FRAMES) / 3)].forEach((f, k) => sample.set(frames[f], k * W * H * 4));
  const palette = quantize(sample, 256);

  const gif = GIFEncoder();
  frames.forEach((rgba, i) => gif.writeFrame(applyPalette(rgba, palette), W, H, { palette: i === 0 ? palette : undefined, delay: FRAME_MS, repeat: 0 }));
  gif.finish();
  return { buffer: Buffer.from(gif.bytes()), name: 'deed-card.gif' };
}

module.exports = { renderCard };
