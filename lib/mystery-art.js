// Generated images for the murder mystery: death notices, saves, trial verdicts, and the game-over poster.
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = '"Avenir Next", "Helvetica Neue", Arial, sans-serif';

const avatarCache = new Map();
async function avatar(url) {
  if (!url) return null;
  if (avatarCache.has(url)) return avatarCache.get(url);
  const img = await fetch(url, { signal: AbortSignal.timeout(6000) })
    .then(async (r) => (r.ok ? loadImage(Buffer.from(await r.arrayBuffer())) : null))
    .catch(() => null);
  avatarCache.set(url, img);
  return img;
}

// Deterministic "dust" so every render of the same scene looks the same.
function grain(ctx, w, h, alpha = 0.05, seed = 7) {
  let x = seed;
  const rand = () => ((x = (x * 16807) % 2147483647) / 2147483647);
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  for (let i = 0; i < (w * h) / 900; i++) ctx.fillRect(rand() * w, rand() * h, 1.2, 1.2);
}

function vignette(ctx, w, h, strength = 0.75) {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function fit(ctx, text, maxWidth, font, start, min = 14) {
  let size = start;
  do { ctx.font = font(size); if (ctx.measureText(text).width <= maxWidth) break; size -= 2; } while (size > min);
  return size;
}

function drawAvatar(ctx, img, cx, cy, r, { gray = false, ring = null, cross = false, fallback = '?' } = {}) {
  if (ring) {
    ctx.save();
    ctx.shadowColor = ring;
    ctx.shadowBlur = 28;
    ctx.strokeStyle = ring;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  if (img) {
    if (gray) ctx.filter = 'grayscale(1) brightness(0.7) contrast(1.1)';
    ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
    ctx.filter = 'none';
  } else {
    ctx.fillStyle = gray ? '#2a2a2e' : '#3b2f5c';
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = `bold ${Math.round(r)}px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fallback[0]?.toUpperCase() ?? '?', cx, cy + 2);
  }
  ctx.restore();
  if (cross) {
    ctx.save();
    ctx.strokeStyle = 'rgba(200, 16, 32, 0.92)';
    ctx.lineWidth = Math.max(4, r * 0.14);
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 8;
    const d = r * 0.62;
    ctx.beginPath();
    ctx.moveTo(cx - d, cy - d); ctx.lineTo(cx + d, cy + d);
    ctx.moveTo(cx + d, cy - d); ctx.lineTo(cx - d, cy + d);
    ctx.stroke();
    ctx.restore();
  }
}

// A rubber-stamp style label, slightly rotated.
function stamp(ctx, text, x, y, color, size = 44, angle = -0.08) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.font = `bold ${size}px ${SERIF}`;
  const w = ctx.measureText(text).width + size;
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.strokeRect(-w / 2, -size * 0.8, w, size * 1.6);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 2);
  ctx.restore();
}

const THEMES = {
  dead: { bg: ['#0a0708', '#3d0a0e'], accent: '#e0253a', stamp: 'DEAD' },
  saved: { bg: ['#06100c', '#0c3a2a'], accent: '#34d399', stamp: 'SURVIVED' },
  hero: { bg: ['#0a0c14', '#1c2a55'], accent: '#60a5fa', stamp: 'FELL A HERO' },
  guilty: { bg: ['#0b0a07', '#3a2a08'], accent: '#f5b82e', stamp: 'GUILTY' },
  acquitted: { bg: ['#08090c', '#1d2330'], accent: '#cbd5e1', stamp: 'ACQUITTED' },
  quiet: { bg: ['#08090f', '#1a1633'], accent: '#a78bfa', stamp: 'NO BODIES' },
};

/**
 * One scene card (1000×500).
 * kind: dead | saved | hero | guilty | acquitted | quiet
 * { kind, headline, name, subtitle, lines[], role, roleColor, avatarUrl, footer }
 */
async function sceneCard({ kind, headline, name, subtitle, lines = [], role, roleColor, avatarUrl, footer }) {
  const W = 1000, H = 500;
  const t = THEMES[kind] ?? THEMES.dead;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, t.bg[0]);
  bg.addColorStop(1, t.bg[1]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // light shaft from the top left
  const shaft = ctx.createRadialGradient(W * 0.2, -40, 10, W * 0.2, -40, W * 0.9);
  shaft.addColorStop(0, `${t.accent}33`);
  shaft.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = shaft;
  ctx.fillRect(0, 0, W, H);
  grain(ctx, W, H, 0.05, name?.length ?? 7);
  vignette(ctx, W, H);

  // accent bars
  ctx.fillStyle = t.accent;
  ctx.fillRect(0, 0, W, 6);
  ctx.fillRect(0, H - 6, W, 6);

  // headline
  ctx.fillStyle = t.accent;
  ctx.font = `bold 20px ${SANS}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText((headline ?? '').toUpperCase().split('').join(' '), 60, 62);

  // avatar
  const img = await avatar(avatarUrl);
  const gray = kind === 'dead' || kind === 'hero' || kind === 'guilty';
  if (kind !== 'quiet') drawAvatar(ctx, img, 190, 270, 120, { gray, ring: t.accent, cross: kind === 'dead' || kind === 'hero', fallback: name });

  // name + details
  const x = kind === 'quiet' ? 60 : 360;
  const maxW = W - x - 50;
  ctx.fillStyle = '#f8f5ef';
  const nameSize = fit(ctx, name ?? '', maxW, (s) => `bold ${s}px ${SERIF}`, 64, 28);
  ctx.font = `bold ${nameSize}px ${SERIF}`;
  ctx.fillText(name ?? '', x, 190);
  if (subtitle) {
    ctx.fillStyle = 'rgba(248,245,239,0.6)';
    ctx.font = `italic 24px ${SERIF}`;
    ctx.fillText(subtitle, x, 228);
  }
  if (role) {
    ctx.font = `bold 22px ${SANS}`;
    const text = role.toUpperCase();
    const w = ctx.measureText(text).width + 28;
    ctx.fillStyle = `${roleColor ?? t.accent}26`;
    ctx.strokeStyle = roleColor ?? t.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, 250, w, 38, 19);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = roleColor ?? t.accent;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 14, 270);
    ctx.textBaseline = 'alphabetic';
  }
  ctx.fillStyle = 'rgba(248,245,239,0.85)';
  lines.slice(0, 3).forEach((line, i) => {
    const size = fit(ctx, line, maxW, (s) => `${s}px ${SANS}`, 24, 16);
    ctx.font = `${size}px ${SANS}`;
    ctx.fillText(line, x, (role ? 335 : 290) + i * 36);
  });

  stamp(ctx, t.stamp, W - 190, 90, t.accent, kind === 'hero' ? 30 : 38);

  if (footer) {
    ctx.fillStyle = 'rgba(248,245,239,0.4)';
    ctx.font = `600 16px ${SANS}`;
    ctx.fillText(footer, 60, H - 30);
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(248,245,239,0.3)';
  ctx.font = `bold 14px ${SANS}`;
  ctx.fillText('D E E D   ·   M U R D E R   M Y S T E R Y', W - 40, H - 30);
  return canvas.encode('png');
}

/**
 * Game-over poster (1200×~630). players: [{ name, char, role, roleColor, alive, avatarUrl, mvp, winner }]
 */
async function gameOverCard({ side, setting, players, days }) {
  const W = 1200;
  const cols = Math.min(5, players.length <= 4 ? players.length : players.length <= 6 ? 3 : players.length <= 12 ? 4 : 5);
  const rowsN = Math.ceil(players.length / cols);
  const cellW = (W - 120) / cols;
  const cellH = players.length > 12 ? 150 : 190;
  const H = 250 + rowsN * cellH + 60;
  const r = players.length > 12 ? 40 : 54;
  const town = side === 'town';
  const accent = town ? '#f5c542' : '#e0253a';

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, town ? '#0f0c1c' : '#140507');
  bg.addColorStop(1, town ? '#2a1f06' : '#3d0a0e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 80, 10, W / 2, 80, W * 0.7);
  glow.addColorStop(0, `${accent}40`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  grain(ctx, W, H, 0.045, players.length);
  vignette(ctx, W, H, 0.7);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, 8);
  ctx.fillRect(0, H - 8, W, 8);

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(248,245,239,0.55)';
  ctx.font = `bold 20px ${SANS}`;
  ctx.fillText(`G A M E   O V E R   ·   ${setting.toUpperCase().split('').join(' ')}`, W / 2, 62);
  ctx.save();
  ctx.shadowColor = accent;
  ctx.shadowBlur = 30;
  ctx.fillStyle = accent;
  const title = town ? 'THE GUESTS WIN' : 'THE MURDERERS WIN';
  const ts = fit(ctx, title, W - 120, (s) => `bold ${s}px ${SERIF}`, 88, 40);
  ctx.font = `bold ${ts}px ${SERIF}`;
  ctx.fillText(title, W / 2, 150);
  ctx.restore();
  ctx.fillStyle = 'rgba(248,245,239,0.6)';
  ctx.font = `italic 24px ${SERIF}`;
  ctx.fillText(town ? 'Every murderer has been caught.' : 'By dawn, there was nobody left to stop them.', W / 2, 192);

  const imgs = await Promise.all(players.map((p) => avatar(p.avatarUrl)));
  players.forEach((p, i) => {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, players.length - row * cols);
    const offset = ((cols - inRow) * cellW) / 2;
    const cx = 60 + offset + (i % cols) * cellW + cellW / 2;
    const cy = 250 + row * cellH + r;
    drawAvatar(ctx, imgs[i], cx, cy, r, { gray: !p.alive, ring: p.winner ? accent : 'rgba(255,255,255,0.25)', cross: !p.alive, fallback: p.name });
    if (p.mvp) {
      ctx.save();
      ctx.fillStyle = '#f5c542';
      ctx.font = `bold 13px ${SANS}`;
      const w = ctx.measureText('MVP').width + 16;
      ctx.beginPath();
      ctx.roundRect(cx + r * 0.35, cy - r - 6, w, 22, 11);
      ctx.fill();
      ctx.fillStyle = '#1a1300';
      ctx.textAlign = 'center';
      ctx.fillText('MVP', cx + r * 0.35 + w / 2, cy - r + 10);
      ctx.restore();
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = p.alive ? '#f8f5ef' : 'rgba(248,245,239,0.5)';
    const ns = fit(ctx, p.char, cellW - 16, (s) => `bold ${s}px ${SERIF}`, 20, 12);
    ctx.font = `bold ${ns}px ${SERIF}`;
    ctx.fillText(p.char, cx, cy + r + 30);
    ctx.fillStyle = p.roleColor ?? '#cbd5e1';
    ctx.font = `bold 13px ${SANS}`;
    ctx.fillText(p.role.toUpperCase(), cx, cy + r + 50);
    ctx.fillStyle = 'rgba(248,245,239,0.45)';
    ctx.font = `13px ${SANS}`;
    ctx.fillText(`@${p.name}`.slice(0, 24), cx, cy + r + 68);
  });

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(248,245,239,0.4)';
  ctx.font = `600 16px ${SANS}`;
  ctx.fillText(`${days} night${days === 1 ? '' : 's'} · ${players.filter((p) => !p.alive).length} dead`, 60, H - 30);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(248,245,239,0.3)';
  ctx.font = `bold 14px ${SANS}`;
  ctx.fillText('D E E D   ·   M U R D E R   M Y S T E R Y', W - 40, H - 30);
  return canvas.encode('png');
}

module.exports = { sceneCard, gameOverCard };
