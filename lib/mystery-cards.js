// More murder mystery images: the morning newspaper, role dossiers, floor plans, the accusation board,
// detective/witness reports, wills, wanted posters, profile cards, the end-of-game timeline and a how-to guide.
const { createCanvas } = require('@napi-rs/canvas');
const { SERIF, SANS, avatar, grain, vignette, fit, drawAvatar, stamp, wrap } = require('./mystery-art').helpers;

const MONO = '"Courier New", Courier, "Liberation Mono", monospace';

// Square photo (avatar or initial) with an optional CSS filter (grayscale, sepia…).
async function photo(ctx, url, x, y, size, { filter = 'grayscale(1) contrast(1.15)', fallback = '?', bg = '#d8d0bd', fg = '#3a3226' } = {}) {
  const img = await avatar(url);
  ctx.save();
  if (img) {
    ctx.filter = filter;
    ctx.drawImage(img, x, y, size, size);
    ctx.filter = 'none';
  } else {
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = fg;
    ctx.font = `bold ${Math.round(size * 0.5)}px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fallback[0]?.toUpperCase() ?? '?', x + size / 2, y + size / 2 + 4);
  }
  ctx.restore();
}

// Draw wrapped text; returns the y after the last line.
function para(ctx, text, x, y, width, lineHeight, maxLines = Infinity) {
  const lines = wrap(ctx, text, width);
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines) shown[maxLines - 1] = `${shown[maxLines - 1].replace(/\s+\S*$/, '')}…`;
  shown.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
  return y + shown.length * lineHeight;
}

function paperBg(ctx, W, H, tone = ['#f3ecd9', '#e6dbc0'], seed = 5) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, tone[0]); g.addColorStop(1, tone[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  let x = seed;
  const rand = () => ((x = (x * 16807) % 2147483647) / 2147483647);
  ctx.fillStyle = 'rgba(80,60,30,0.06)';
  for (let i = 0; i < (W * H) / 400; i++) ctx.fillRect(rand() * W, rand() * H, 1.5, 1.5);
}

function rule(ctx, x1, x2, y, width = 2, color = '#2a2318') {
  ctx.strokeStyle = color; ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
}

/**
 * Morning newspaper front page (1000×760).
 * { paper, dateline, headline, photo: { url, name, caption, gray }, lead: [paragraphs], sidebars: [{ title, text }], stamp: { text, color } }
 */
async function newspaper({ paper, dateline, headline, photo: pic, lead = [], sidebars = [], stamp: mark = null }) {
  const W = 1000, pad = 40;
  // Size the page so the side stories fit (up to 6 lines each).
  const m = createCanvas(10, 10).getContext('2d');
  m.font = `15px ${SERIF}`;
  const sbCols = Math.max(1, Math.min(3, sidebars.length));
  const sbW = (W - pad * 2 - (sbCols - 1) * 24) / sbCols;
  const sbLines = Math.max(0, ...sidebars.slice(0, 3).map((sb) => Math.min(6, wrap(m, sb.text, sbW).length)));
  const H = 690 + (sidebars.length ? 30 + sbLines * 20 : 30);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  paperBg(ctx, W, H);
  ctx.fillStyle = '#1c1710';
  ctx.textBaseline = 'alphabetic';

  // masthead
  rule(ctx, pad, W - pad, 34, 1);
  ctx.textAlign = 'center';
  const mast = fit(ctx, paper, W - pad * 2, (s) => `bold ${s}px ${SERIF}`, 64, 30);
  ctx.font = `bold ${mast}px ${SERIF}`;
  ctx.fillText(paper, W / 2, 98);
  rule(ctx, pad, W - pad, 116, 3);
  ctx.font = `600 14px ${SANS}`;
  ctx.textAlign = 'left';
  ctx.fillText(dateline.toUpperCase(), pad, 136);
  ctx.textAlign = 'right';
  ctx.fillText('PRICE: ONE ALIBI', W - pad, 136);
  rule(ctx, pad, W - pad, 146, 1);

  // headline
  ctx.textAlign = 'left';
  ctx.font = `bold 52px ${SERIF}`;
  let lines = wrap(ctx, headline.toUpperCase(), W - pad * 2);
  let size = 52;
  while (lines.length > 2 && size > 30) { size -= 4; ctx.font = `bold ${size}px ${SERIF}`; lines = wrap(ctx, headline.toUpperCase(), W - pad * 2); }
  lines.slice(0, 2).forEach((l, i) => ctx.fillText(l, pad, 200 + i * (size + 6)));
  const top = 200 + Math.min(2, lines.length) * (size + 6) + 4;

  // photo
  const ph = 250;
  if (pic) {
    ctx.fillStyle = '#1c1710';
    ctx.fillRect(pad - 4, top - 4, ph + 8, ph + 8);
    await photo(ctx, pic.url, pad, top, ph, { filter: pic.gray === false ? 'sepia(0.6) contrast(1.1)' : 'grayscale(1) contrast(1.2) brightness(0.95)', fallback: pic.name });
    ctx.fillStyle = '#3a3226';
    ctx.font = `italic 15px ${SERIF}`;
    para(ctx, pic.caption ?? pic.name, pad, top + ph + 24, ph, 18, 2);
  }

  // lead story
  const lx = pic ? pad + ph + 30 : pad;
  const lw = W - pad - lx;
  ctx.fillStyle = '#1c1710';
  ctx.font = `19px ${SERIF}`;
  let y = top + 18;
  for (const p of lead) { y = para(ctx, p, lx, y, lw, 26, 5) + 12; if (y > top + ph + 20) break; }

  // sidebars
  const sy = Math.max(top + ph + 76, y + 10);
  rule(ctx, pad, W - pad, sy - 24, 2);
  const shown = sidebars.slice(0, 3);
  const colW = (W - pad * 2 - (shown.length - 1) * 24) / Math.max(1, shown.length);
  shown.forEach((sb, i) => {
    const x = pad + i * (colW + 24);
    if (i) { ctx.strokeStyle = 'rgba(28,23,16,0.4)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 12, sy - 12); ctx.lineTo(x - 12, H - 30); ctx.stroke(); }
    ctx.fillStyle = '#1c1710';
    ctx.font = `bold 19px ${SERIF}`;
    const ty = para(ctx, sb.title.toUpperCase(), x, sy, colW, 22, 2);
    ctx.font = `15px ${SERIF}`;
    para(ctx, sb.text, x, ty + 6, colW, 20, 6);
  });
  if (!shown.length) {
    ctx.font = `italic 18px ${SERIF}`;
    ctx.fillStyle = 'rgba(28,23,16,0.7)';
    ctx.fillText('In other news: nobody is allowed to leave.', pad, sy + 6);
  }
  if (mark) stamp(ctx, mark.text, W - 190, top + 60, mark.color, 34, 0.12);
  return canvas.encode('png');
}

/**
 * Secret role dossier (900×560), DMed with the role card.
 * { setting, name, title, user, url, role, roleColor, goal, traits: [3], notes: [lines] }
 */
async function dossier({ setting, name, title, user, url, role, roleColor, goal, traits, notes = [] }) {
  const W = 900, H = 560;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2b1d14';
  ctx.fillRect(0, 0, W, H);
  grain(ctx, W, H, 0.04, 3);
  // folder
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#d9b979';
  ctx.beginPath(); ctx.roundRect(40, 60, 230, 50, 10); ctx.fill();
  ctx.beginPath(); ctx.roundRect(30, 90, W - 60, H - 120, 12); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#5a4520';
  ctx.font = `bold 16px ${MONO}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`FILE: ${setting.toUpperCase()}`.slice(0, 26), 56, 88);

  // photo, paper-clipped
  const px = 64, py = 132, ps = 210;
  ctx.save(); ctx.translate(px + ps / 2, py + ps / 2); ctx.rotate(-0.04); ctx.translate(-(px + ps / 2), -(py + ps / 2));
  ctx.fillStyle = '#f7f3ea'; ctx.fillRect(px - 10, py - 10, ps + 20, ps + 56);
  await photo(ctx, url, px, py, ps, { filter: 'grayscale(0.4) contrast(1.1)', fallback: name });
  ctx.fillStyle = '#2b2b2b'; ctx.font = `15px ${MONO}`; ctx.textAlign = 'center';
  ctx.fillText(`@${user}`.slice(0, 22), px + ps / 2, py + ps + 32);
  ctx.restore();
  ctx.strokeStyle = '#9aa0a6'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.roundRect(px + 30, py - 28, 22, 70, 11); ctx.stroke();

  // typed sheet
  const tx = 330;
  ctx.fillStyle = '#f5efe0';
  ctx.fillRect(tx - 16, 110, W - tx - 34, H - 150);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#1f1f1f';
  const field = (label, value, y, bold = false) => {
    ctx.font = `bold 14px ${MONO}`; ctx.fillStyle = '#6b6252'; ctx.fillText(label, tx, y);
    ctx.font = `${bold ? 'bold ' : ''}20px ${MONO}`; ctx.fillStyle = '#1f1f1f';
    const size = fit(ctx, value, W - tx - 70, (s) => `${bold ? 'bold ' : ''}${s}px ${MONO}`, 20, 12);
    ctx.font = `${bold ? 'bold ' : ''}${size}px ${MONO}`;
    ctx.fillText(value, tx, y + 24);
  };
  field('SUBJECT', name, 146, true);
  field('COVER', title, 200);
  ctx.font = `bold 14px ${MONO}`; ctx.fillStyle = '#6b6252'; ctx.fillText('ASSIGNMENT', tx, 254);
  ctx.font = `bold 24px ${MONO}`;
  const rw = ctx.measureText(role.toUpperCase()).width + 24;
  ctx.fillStyle = roleColor ?? '#444'; ctx.beginPath(); ctx.roundRect(tx, 262, rw, 34, 6); ctx.fill();
  ctx.fillStyle = '#111'; ctx.fillText(role.toUpperCase(), tx + 12, 288);
  ctx.font = `15px ${MONO}`; ctx.fillStyle = '#1f1f1f';
  let y = para(ctx, goal, tx, 324, W - tx - 70, 19, 4);
  ctx.font = `bold 14px ${MONO}`; ctx.fillStyle = '#6b6252'; ctx.fillText('IDENTIFYING MARKS', tx, y + 14);
  ctx.font = `14px ${MONO}`; ctx.fillStyle = '#1f1f1f';
  traits.forEach((t, i) => ctx.fillText(`- ${t}`, tx, y + 34 + i * 18));
  y += 34 + traits.length * 18;
  ctx.font = `bold 14px ${MONO}`; ctx.fillStyle = '#8a1c1c';
  notes.slice(0, 2).forEach((n, i) => { const s = fit(ctx, n, W - tx - 70, (z) => `bold ${z}px ${MONO}`, 14, 10); ctx.font = `bold ${s}px ${MONO}`; ctx.fillText(n, tx, y + 8 + i * 18); });

  stamp(ctx, 'TOP SECRET', 175, 470, '#b3202a', 30, -0.12);
  stamp(ctx, 'EYES ONLY', W - 150, 150, '#b3202a', 18, 0.1);
  return canvas.encode('png');
}

// Deterministic room layout for a setting: two rows of rooms around a hallway, widths vary per setting.
function layout(rooms, seedText, W, top, H) {
  let seed = [...seedText].reduce((n, c) => n + c.charCodeAt(0), 7);
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pad = 40, hall = 70;
  const rows = [rooms.slice(0, Math.ceil(rooms.length / 2)), rooms.slice(Math.ceil(rooms.length / 2))];
  const rowH = (H - top - pad - hall) / 2;
  const out = [];
  rows.forEach((row, r) => {
    const weights = row.map(() => 0.7 + rand() * 0.8);
    const total = weights.reduce((a, b) => a + b, 0);
    let x = pad;
    row.forEach((name, i) => {
      const w = ((W - pad * 2) * weights[i]) / total;
      out.push({ name, x, y: top + r * (rowH + hall), w, h: rowH });
      x += w;
    });
  });
  return { rooms: out, hallY: top + rowH, hall };
}

/**
 * Blueprint floor plan (1000×600). { setting, day, rooms, scene, scenes: [{ room, night }], searched: { room: name } }
 */
async function floorPlan({ setting, day, rooms, scene, scenes = [], searched = {} }) {
  const W = 1000, H = 600;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0f3360';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 25) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 25) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  ctx.fillStyle = '#e8f1ff';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `bold 28px ${SANS}`;
  ctx.textAlign = 'left';
  ctx.fillText(setting.toUpperCase(), 40, 52);
  ctx.font = `600 15px ${SANS}`;
  ctx.fillStyle = 'rgba(232,241,255,0.7)';
  ctx.fillText(`FLOOR PLAN · DAY ${day}`, 40, 76);

  const { rooms: boxes, hallY, hall } = layout(rooms, setting, W, 100, H - 30);
  ctx.fillStyle = 'rgba(232,241,255,0.35)';
  ctx.font = `bold 14px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.fillText('H  A  L  L  W  A  Y', W / 2, hallY + hall / 2 + 5);
  for (const b of boxes) {
    const isScene = b.name === scene;
    ctx.fillStyle = isScene ? 'rgba(239,68,68,0.18)' : 'rgba(255,255,255,0.04)';
    ctx.fillRect(b.x + 3, b.y + 3, b.w - 6, b.h - 6);
    ctx.strokeStyle = '#e8f1ff'; ctx.lineWidth = 3;
    ctx.strokeRect(b.x + 3, b.y + 3, b.w - 6, b.h - 6);
    // door gap toward the hallway
    const doorY = b.y + 3 + (b.y < hallY ? b.h - 6 : 0);
    ctx.strokeStyle = '#0f3360'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(b.x + b.w / 2 - 14, doorY); ctx.lineTo(b.x + b.w / 2 + 14, doorY); ctx.stroke();

    ctx.fillStyle = '#e8f1ff';
    const size = fit(ctx, b.name.toUpperCase(), b.w - 24, (s) => `bold ${s}px ${SANS}`, 17, 10);
    ctx.font = `bold ${size}px ${SANS}`;
    ctx.fillText(b.name.toUpperCase(), b.x + b.w / 2, b.y + 30);
    const past = scenes.filter((s) => s.room === b.name && s.room !== scene).map((s) => `N${s.night}`);
    if (past.length) { ctx.font = `bold 13px ${SANS}`; ctx.fillStyle = '#fca5a5'; ctx.fillText(`† ${past.join(' · ')}`, b.x + b.w / 2, b.y + 50); }
    if (isScene) {
      ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 8; ctx.lineCap = 'round';
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2 + 10, d = Math.min(30, b.h / 4);
      ctx.beginPath(); ctx.moveTo(cx - d, cy - d); ctx.lineTo(cx + d, cy + d); ctx.moveTo(cx + d, cy - d); ctx.lineTo(cx - d, cy + d); ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = '#fca5a5'; ctx.font = `bold 12px ${SANS}`;
      ctx.fillText(`CRIME SCENE · NIGHT ${day}`, cx, b.y + b.h - 18);
    }
    if (searched[b.name]) {
      const text = `searched by ${searched[b.name]}`;
      ctx.fillStyle = '#86efac';
      const s = fit(ctx, text, b.w - 20, (z) => `bold ${z}px ${SANS}`, 13, 9);
      ctx.font = `bold ${s}px ${SANS}`;
      ctx.fillText(text, b.x + b.w / 2, b.y + b.h - (isScene ? 36 : 18));
    }
  }
  ctx.textAlign = 'right';
  ctx.font = `600 13px ${SANS}`;
  ctx.fillStyle = 'rgba(232,241,255,0.6)';
  ctx.fillText('red X = last night’s scene · † = earlier bodies · green = searched today', W - 40, H - 14);
  return canvas.encode('png');
}

/**
 * Accusation board (1000×~640): every living guest in a ring, red strings from voter to accused.
 * { day, players: [{ id, name, url }], votes: [[voterId, targetId | 'skip']], result }
 */
async function accusationBoard({ day, players, votes, result }) {
  const W = 1000, H = 700, cx = W / 2, cy = 365;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const bg = ctx.createRadialGradient(cx, cy, 50, cx, cy, 600);
  bg.addColorStop(0, '#2a1218'); bg.addColorStop(1, '#09070a');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  grain(ctx, W, H, 0.04, day + 3);

  ctx.fillStyle = '#f3e7e9'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = `bold 30px ${SERIF}`;
  ctx.fillText(`Day ${day} · The accusations`, cx, 50);

  const n = players.length;
  const R = Math.min(300, 170 + n * 10);
  const r = n > 14 ? 28 : n > 9 ? 34 : 40;
  const pos = new Map(players.map((p, i) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [p.id, { x: cx + Math.cos(a) * R * 1.3, y: cy + Math.sin(a) * R * 0.85 }];
  }));
  const counts = new Map();
  for (const [, t] of votes) counts.set(t, (counts.get(t) ?? 0) + 1);

  // strings
  for (const [from, to] of votes) {
    if (to === 'skip' || !pos.has(from) || !pos.has(to)) continue;
    const a = pos.get(from), b = pos.get(to);
    const mx = (a.x + b.x) / 2 + (cy - (a.y + b.y) / 2) * 0.15, my = (a.y + b.y) / 2 + ((a.x + b.x) / 2 - cx) * 0.15;
    const ang = Math.atan2(b.y - my, b.x - mx);
    const ex = b.x - Math.cos(ang) * (r + 8), ey = b.y - Math.sin(ang) * (r + 8);
    ctx.strokeStyle = 'rgba(225,29,72,0.85)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(mx, my, ex, ey); ctx.stroke();
    ctx.fillStyle = 'rgba(225,29,72,0.95)';
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - Math.cos(ang - 0.4) * 14, ey - Math.sin(ang - 0.4) * 14);
    ctx.lineTo(ex - Math.cos(ang + 0.4) * 14, ey - Math.sin(ang + 0.4) * 14);
    ctx.fill();
  }
  // people
  const skipped = new Set(votes.filter(([, t]) => t === 'skip').map(([f]) => f));
  for (const p of players) {
    const { x, y } = pos.get(p.id);
    const k = counts.get(p.id) ?? 0;
    drawAvatar(ctx, await avatar(p.url), x, y, r, { ring: k ? '#e11d48' : 'rgba(255,255,255,0.25)', fallback: p.name });
    const size = fit(ctx, p.name, 150, (s) => `bold ${s}px ${SANS}`, 15, 10);
    ctx.font = `bold ${size}px ${SANS}`;
    const lw = ctx.measureText(p.name).width + 14;
    ctx.fillStyle = 'rgba(9,7,10,0.85)';
    ctx.beginPath(); ctx.roundRect(x - lw / 2, y + r + 6, lw, size + 10, 8); ctx.fill();
    ctx.fillStyle = '#f3e7e9';
    ctx.fillText(p.name, x, y + r + size + 10);
    if (k) {
      ctx.fillStyle = '#e11d48';
      ctx.beginPath(); ctx.arc(x + r * 0.75, y - r * 0.75, 15, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `bold 16px ${SANS}`; ctx.fillText(String(k), x + r * 0.75, y - r * 0.75 + 6);
    }
    if (skipped.has(p.id)) { ctx.fillStyle = 'rgba(203,213,225,0.8)'; ctx.font = `bold 11px ${SANS}`; ctx.fillText('SKIP', x, y + r + 38); }
  }
  ctx.fillStyle = '#fda4af';
  ctx.font = `italic 22px ${SERIF}`;
  ctx.fillText(result, cx, H - 26);
  return canvas.encode('png');
}

/** Detective dawn report (820×460). { night, subject, user, url, suspicious } */
async function caseFile({ night, subject, user, url, suspicious }) {
  const W = 820, H = 460;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1c2230'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#e9dcc0';
  ctx.beginPath(); ctx.roundRect(30, 30, W - 60, H - 60, 10); ctx.fill();
  ctx.fillStyle = '#2b2518'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.font = `bold 26px ${MONO}`;
  ctx.fillText(`CASE FILE · NIGHT ${night}`, 60, 80);
  rule(ctx, 60, W - 60, 94, 2, '#2b2518');
  await photo(ctx, url, 60, 120, 200, { filter: 'grayscale(1) contrast(1.2)', fallback: subject });
  ctx.strokeStyle = '#2b2518'; ctx.lineWidth = 3; ctx.strokeRect(60, 120, 200, 200);
  ctx.font = `bold 14px ${MONO}`; ctx.fillStyle = '#6b6252';
  ctx.fillText('SUBJECT', 290, 140);
  ctx.font = `bold 26px ${MONO}`; ctx.fillStyle = '#2b2518';
  const s = fit(ctx, subject, W - 350, (z) => `bold ${z}px ${MONO}`, 26, 14);
  ctx.font = `bold ${s}px ${MONO}`;
  ctx.fillText(subject, 290, 172);
  ctx.font = `16px ${MONO}`; ctx.fillText(`@${user}`, 290, 198);
  ctx.font = `bold 14px ${MONO}`; ctx.fillStyle = '#6b6252';
  ctx.fillText('FINDING', 290, 236);
  stamp(ctx, suspicious ? 'SUSPICIOUS' : 'INNOCENT', 470, 290, suspicious ? '#b3202a' : '#1f7a46', 40, -0.08);
  ctx.font = `italic 14px ${SERIF}`; ctx.fillStyle = '#6b6252';
  ctx.fillText('Framed guests read as suspicious. The accomplice reads as innocent.', 60, H - 56);
  return canvas.encode('png');
}

/** Witness dawn report: a CCTV still (820×460). { night, subject, user, url, went } */
async function cctv({ night, subject, url, went }) {
  const W = 820, H = 460;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#05140c'; ctx.fillRect(0, 0, W, H);
  const img = await avatar(url);
  if (img) {
    ctx.save(); ctx.globalAlpha = 0.55; ctx.filter = 'grayscale(1) contrast(1.4) brightness(0.8)';
    ctx.drawImage(img, W / 2 - 160, 70, 320, 320);
    ctx.restore();
  } else {
    // a grainy silhouette in the doorway
    ctx.fillStyle = 'rgba(187,247,208,0.18)';
    ctx.beginPath(); ctx.arc(W / 2, 160, 52, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.roundRect(W / 2 - 90, 220, 180, 170, [70, 70, 0, 0]); ctx.fill();
  }
  ctx.fillStyle = 'rgba(34,197,94,0.22)'; ctx.fillRect(0, 0, W, H); // green tint
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 2); // scanlines
  vignette(ctx, W, H, 0.8);
  ctx.fillStyle = '#bbf7d0'; ctx.font = `bold 20px ${MONO}`; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.fillText(`CAM 0${(night % 9) + 1} · HALLWAY`, 24, 38);
  ctx.textAlign = 'right';
  ctx.fillText(`NIGHT ${night}  03:${String(10 + ((night * 17) % 49)).padStart(2, '0')}:${String((night * 31) % 60).padStart(2, '0')}`, W - 24, 38);
  ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(30, 64, 8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fecaca'; ctx.textAlign = 'left'; ctx.font = `bold 16px ${MONO}`; ctx.fillText('REC', 46, 70);
  // brackets around the subject
  ctx.strokeStyle = '#bbf7d0'; ctx.lineWidth = 3;
  const bx = W / 2 - 170, by = 64, bw = 340, bh = 332, k = 26;
  for (const [x, y, dx, dy] of [[bx, by, 1, 1], [bx + bw, by, -1, 1], [bx, by + bh, 1, -1], [bx + bw, by + bh, -1, -1]]) {
    ctx.beginPath(); ctx.moveTo(x, y + dy * k); ctx.lineTo(x, y); ctx.lineTo(x + dx * k, y); ctx.stroke();
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = '#dcfce7';
  ctx.font = `bold 22px ${MONO}`;
  ctx.fillText(`SUBJECT: ${subject.toUpperCase()}`.slice(0, 44), W / 2, H - 52);
  ctx.font = `bold 20px ${MONO}`;
  ctx.fillStyle = went ? '#fde047' : '#bbf7d0';
  const msg = went ? `LEFT ROOM → ENTERED ${went.toUpperCase()}'S ROOM` : 'NO MOVEMENT DETECTED';
  const s = fit(ctx, msg, W - 60, (z) => `bold ${z}px ${MONO}`, 20, 12);
  ctx.font = `bold ${s}px ${MONO}`;
  ctx.fillText(msg, W / 2, H - 22);
  return canvas.encode('png');
}

/** A dead guest's will on parchment. { name, text, burned } */
async function will({ name, text }) {
  const W = 760;
  const measure = createCanvas(10, 10).getContext('2d');
  measure.font = `italic 24px ${SERIF}`;
  const lines = wrap(measure, `“${text}”`, W - 160);
  const H = Math.max(420, 230 + lines.length * 34);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1a120c'; ctx.fillRect(0, 0, W, H);
  // parchment with burnt edges
  const g = ctx.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, Math.max(W, H) * 0.7);
  g.addColorStop(0, '#f4e4b8'); g.addColorStop(0.7, '#e3c78c'); g.addColorStop(1, '#6b4420');
  ctx.fillStyle = g;
  ctx.beginPath();
  let seed = name.length + 3;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const edge = (x, y) => [x + (rand() - 0.5) * 14, y + (rand() - 0.5) * 14];
  const pts = [];
  for (let x = 24; x <= W - 24; x += 30) pts.push(edge(x, 24));
  for (let y = 24; y <= H - 24; y += 30) pts.push(edge(W - 24, y));
  for (let x = W - 24; x >= 24; x -= 30) pts.push(edge(x, H - 24));
  for (let y = H - 24; y >= 24; y -= 30) pts.push(edge(24, y));
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(60,30,10,0.6)'; ctx.lineWidth = 3; ctx.stroke();

  ctx.fillStyle = '#3b2410'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = `bold 34px ${SERIF}`;
  ctx.fillText('Last Will & Testament', W / 2, 92);
  ctx.font = `italic 20px ${SERIF}`;
  ctx.fillText(`of ${name}`, W / 2, 124);
  rule(ctx, 160, W - 160, 142, 1, 'rgba(59,36,16,0.6)');
  ctx.font = `italic 24px ${SERIF}`;
  lines.forEach((l, i) => ctx.fillText(l, W / 2, 190 + i * 34));
  ctx.textAlign = 'right';
  ctx.font = `italic 26px ${SERIF}`;
  ctx.fillText(`— ${name}`, W - 90, H - 58);
  return canvas.encode('png');
}

/** WANTED poster for a convicted killer (720×960). { name, user, url, role, crimes: [names], reward } */
async function wanted({ name, user, url, role, crimes = [], reward }) {
  const W = 720, H = 960;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  paperBg(ctx, W, H, ['#ecd9a8', '#c9a86a'], 9);
  vignette(ctx, W, H, 0.55);
  ctx.strokeStyle = '#4a3214'; ctx.lineWidth = 6; ctx.strokeRect(24, 24, W - 48, H - 48);
  ctx.lineWidth = 2; ctx.strokeRect(36, 36, W - 72, H - 72);
  ctx.fillStyle = '#3a2410'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = `bold 120px ${SERIF}`;
  ctx.fillText('WANTED', W / 2, 160);
  ctx.font = `bold 24px ${SERIF}`;
  ctx.fillText(`FOR ${crimes.length ? 'MURDER' : 'CONSPIRACY'}`, W / 2, 200);
  ctx.fillStyle = '#3a2410'; ctx.fillRect(W / 2 - 186, 226, 372, 372);
  await photo(ctx, url, W / 2 - 180, 232, 360, { filter: 'sepia(1) contrast(1.2) brightness(0.9)', fallback: name, bg: '#b89a62', fg: '#3a2410' });
  ctx.fillStyle = '#3a2410';
  const s = fit(ctx, name.toUpperCase(), W - 120, (z) => `bold ${z}px ${SERIF}`, 52, 26);
  ctx.font = `bold ${s}px ${SERIF}`;
  ctx.fillText(name.toUpperCase(), W / 2, 668);
  ctx.font = `italic 22px ${SERIF}`;
  ctx.fillText(`alias @${user} · the ${role}`, W / 2, 702);
  ctx.font = `20px ${SERIF}`;
  const crimeText = crimes.length ? `Wanted for the deaths of ${crimes.join(', ')}.` : 'Wanted for aiding and abetting a killer.';
  para(ctx, crimeText, W / 2, 744, W - 140, 26, 3);
  ctx.font = `bold 34px ${SERIF}`;
  ctx.fillText(`REWARD: ${reward}`, W / 2, H - 80);
  stamp(ctx, 'CAPTURED', W / 2 + 120, 470, '#a3121c', 48, -0.22);
  return canvas.encode('png');
}

/**
 * Profile card for `mm stats` (860×520). { user, url, s: stats, favorite: { name, color }, achievements: [[id, emoji, name, unlocked]] }
 */
async function profileCard({ user, url, s, favorite, achievements }) {
  const W = 860, H = 540;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const accent = favorite?.color ?? '#a78bfa';
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#120d1c'); bg.addColorStop(1, '#2a1630');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  grain(ctx, W, H, 0.04, user.length);
  ctx.strokeStyle = accent; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.roundRect(14, 14, W - 28, H - 28, 22); ctx.stroke();

  drawAvatar(ctx, await avatar(url), 120, 130, 74, { ring: accent, fallback: user });
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#f5f0ff';
  const ns = fit(ctx, user, 560, (z) => `bold ${z}px ${SERIF}`, 46, 24);
  ctx.font = `bold ${ns}px ${SERIF}`;
  ctx.fillText(user, 230, 116);
  ctx.font = `italic 20px ${SERIF}`;
  ctx.fillStyle = 'rgba(245,240,255,0.7)';
  ctx.fillText(favorite ? `favorite role: ${favorite.name}` : 'mystery record', 230, 150);

  const rate = s.games ? Math.round((s.wins / s.games) * 100) : 0;
  const tiles = [['GAMES', s.games], ['WINS', s.wins], ['WIN %', `${rate}%`], ['KILLS', s.kills], ['CONVICTIONS', s.convictions], ['AS MURDERER', s.murderer]];
  tiles.forEach(([label, value], i) => {
    const x = 40 + (i % 6) * 131, y = 228;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath(); ctx.roundRect(x, y, 121, 86, 12); ctx.fill();
    ctx.fillStyle = '#f5f0ff'; ctx.textAlign = 'center';
    ctx.font = `bold 32px ${SANS}`; ctx.fillText(String(value), x + 60, y + 46);
    ctx.font = `bold 11px ${SANS}`; ctx.fillStyle = 'rgba(245,240,255,0.6)'; ctx.fillText(label, x + 60, y + 72);
  });

  ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(245,240,255,0.75)'; ctx.font = `bold 15px ${SANS}`;
  ctx.fillText(`ACHIEVEMENTS · ${achievements.filter((a) => a[3]).length}/${achievements.length}`, 40, 352);
  achievements.forEach(([, , name, unlocked], i) => {
    const x = 40 + (i % 4) * 196, y = 366 + Math.floor(i / 4) * 46;
    ctx.fillStyle = unlocked ? `${accent}33` : 'rgba(255,255,255,0.04)';
    ctx.beginPath(); ctx.roundRect(x, y, 186, 36, 18); ctx.fill();
    ctx.strokeStyle = unlocked ? accent : 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = unlocked ? '#f5f0ff' : 'rgba(245,240,255,0.3)';
    const fs = fit(ctx, name, 160, (z) => `bold ${z}px ${SANS}`, 15, 10);
    ctx.font = `bold ${fs}px ${SANS}`; ctx.textAlign = 'center';
    ctx.fillText(name, x + 93, y + 24);
  });
  return canvas.encode('png');
}

const KIND_COLORS = {
  kill: '#ef4444', save: '#34d399', shot: '#a3a3a3', guilt: '#a3a3a3', heartbreak: '#f472b6', hero: '#60a5fa',
  convict: '#f5b82e', acquit: '#cbd5e1', notrial: '#64748b', event: '#a78bfa', exe: '#94a3b8', jester: '#f472b6', reveal: '#c4b5fd', clean: '#e5e7eb',
};

/** End-of-game timeline (1200×?). rounds: [{ label, night, items: [{ kind, text }] }] */
async function timeline({ setting, side, rounds }) {
  const pad = 36, colW = 260, gap = 18;
  const perRow = Math.max(1, Math.min(4, rounds.length));
  const W = Math.max(640, pad * 2 + perRow * (colW + gap) - gap);
  const measure = createCanvas(10, 10).getContext('2d');
  measure.font = `14px ${SANS}`;
  const heights = rounds.map((r) => 46 + r.items.reduce((h, it) => h + 14 + wrap(measure, it.text, colW - 34).length * 18, 0) + 12);
  const rowsN = Math.ceil(rounds.length / perRow);
  const rowH = [];
  for (let r = 0; r < rowsN; r++) rowH.push(Math.max(110, ...heights.slice(r * perRow, (r + 1) * perRow)));
  const H = 110 + rowH.reduce((a, b) => a + b + gap, 0) + pad;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0d0b10'; ctx.fillRect(0, 0, W, H);
  grain(ctx, W, H, 0.03, 4);
  ctx.fillStyle = '#f3eef7'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = `bold 32px ${SERIF}`;
  ctx.fillText('How it happened', pad, 58);
  ctx.font = `italic 18px ${SERIF}`; ctx.fillStyle = side === 'town' ? '#fcd34d' : '#f87171';
  ctx.fillText(`${setting} · ${side === 'town' ? 'the guests won' : 'the murderers won'}`, pad, 86);

  let y = 110;
  for (let r = 0; r < rowsN; r++) {
    rounds.slice(r * perRow, (r + 1) * perRow).forEach((round, i) => {
      const x = pad + i * (colW + gap);
      ctx.fillStyle = round.night ? '#151a2e' : '#2a2214';
      ctx.beginPath(); ctx.roundRect(x, y, colW, rowH[r], 12); ctx.fill();
      ctx.fillStyle = round.night ? '#93c5fd' : '#fcd34d';
      ctx.font = `bold 16px ${SANS}`;
      ctx.fillText(round.label.toUpperCase(), x + 14, y + 28);
      let iy = y + 50;
      ctx.font = `14px ${SANS}`;
      if (!round.items.length) { ctx.fillStyle = 'rgba(243,238,247,0.4)'; ctx.fillText('quiet…', x + 14, iy + 10); }
      for (const it of round.items) {
        const lines = wrap(ctx, it.text, colW - 34);
        ctx.fillStyle = KIND_COLORS[it.kind] ?? '#e5e7eb';
        ctx.fillRect(x + 14, iy - 2, 4, lines.length * 18);
        ctx.fillStyle = '#f3eef7';
        lines.forEach((l, k) => ctx.fillText(l, x + 26, iy + 12 + k * 18));
        iy += lines.length * 18 + 14;
      }
    });
    y += rowH[r] + gap;
  }
  return canvas.encode('png');
}

/** How-to-play guide (1000×720). { prefix } */
async function howto({ prefix = '!' }) {
  const W = 1000, H = 720;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#120a0c'); bg.addColorStop(1, '#2b0d14');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  grain(ctx, W, H, 0.04, 8);
  ctx.fillStyle = '#f8ecee'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = `bold 40px ${SERIF}`;
  ctx.fillText('How to play Murder Mystery', W / 2, 64);
  ctx.font = `italic 18px ${SERIF}`; ctx.fillStyle = 'rgba(248,236,238,0.7)';
  ctx.fillText('Secret roles by DM. Someone at this table is a killer.', W / 2, 94);

  const steps = [
    ['NIGHT', 'Roles act in secret by DM. The killer picks a victim.', '#3b82f6'],
    ['MORNING', 'A body (maybe), clues, and the morning paper.', '#f59e0b'],
    ['DAY', 'Discuss, search rooms, interrogate, read the board.', '#eab308'],
    ['VOTE', 'Accuse someone. Enough votes sends them to trial.', '#e11d48'],
    ['TRIAL', 'They defend themselves. Guilty or innocent?', '#a855f7'],
  ];
  const bw = 170, bh = 150, gap = 22, x0 = (W - (steps.length * bw + (steps.length - 1) * gap)) / 2, y0 = 130;
  steps.forEach(([t, d, c], i) => {
    const x = x0 + i * (bw + gap);
    ctx.fillStyle = `${c}22`; ctx.strokeStyle = c; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(x, y0, bw, bh, 14); ctx.fill(); ctx.stroke();
    ctx.fillStyle = c; ctx.font = `bold 20px ${SANS}`; ctx.textAlign = 'center';
    ctx.fillText(`${i + 1}. ${t}`, x + bw / 2, y0 + 34);
    ctx.fillStyle = '#f8ecee'; ctx.font = `15px ${SANS}`;
    wrap(ctx, d, bw - 24).forEach((l, k) => ctx.fillText(l, x + bw / 2, y0 + 64 + k * 20));
    if (i < steps.length - 1) {
      ctx.fillStyle = 'rgba(248,236,238,0.6)';
      ctx.beginPath(); ctx.moveTo(x + bw + 4, y0 + bh / 2 - 8); ctx.lineTo(x + bw + gap - 4, y0 + bh / 2); ctx.lineTo(x + bw + 4, y0 + bh / 2 + 8); ctx.fill();
    }
  });
  ctx.strokeStyle = 'rgba(248,236,238,0.4)'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
  ctx.beginPath(); ctx.moveTo(x0 + steps.length * (bw + gap) - gap - bw / 2, y0 + bh + 6); ctx.lineTo(x0 + steps.length * (bw + gap) - gap - bw / 2, y0 + bh + 30);
  ctx.lineTo(x0 + bw / 2, y0 + bh + 30); ctx.lineTo(x0 + bw / 2, y0 + bh + 6); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(248,236,238,0.6)'; ctx.font = `italic 15px ${SERIF}`;
  ctx.fillText('repeat until one side wins', W / 2, y0 + bh + 50);

  ctx.textAlign = 'left';
  const col = (x, title, rows) => {
    ctx.fillStyle = '#fda4af'; ctx.font = `bold 18px ${SANS}`; ctx.fillText(title, x, 380);
    rows.forEach(([cmd, what], i) => {
      ctx.fillStyle = '#f8ecee'; ctx.font = `bold 15px ${MONO}`; ctx.fillText(cmd, x, 412 + i * 30);
      ctx.fillStyle = 'rgba(248,236,238,0.7)'; ctx.font = `15px ${SANS}`; ctx.fillText(what, x + 210, 412 + i * 30);
    });
  };
  const p = prefix;
  col(50, 'IN THE GROUP CHAT', [
    [`${p}mm search <room>`, 'look for evidence'], [`${p}mm question <guest>`, 'interrogate someone'], [`${p}vote <guest>`, 'accuse at the vote'],
    ['guilty / innocent', 'at a trial'], [`${p}mm board · map`, 'evidence board, floor plan'], [`${p}mm clues`, 'every clue so far'], [`${p}mm roles`, 'what every role does'],
  ]);
  col(530, 'IN YOUR DMS', [
    ['ready', 'join when the game starts'], ['role', 'see your role again'], ['will <text>', 'your last will'], ['kill / inspect …', 'your night action'],
    ['haunt <guest>', 'once, after you die'], ['(any text)', 'murder team: talk at night'], ['vest', 'Survivor only'],
  ]);
  ctx.fillStyle = 'rgba(248,236,238,0.55)'; ctx.font = `italic 15px ${SERIF}`; ctx.textAlign = 'center';
  ctx.fillText('Guests win when every killer is caught. Killers win when they equal the guests.', W / 2, H - 30);
  return canvas.encode('png');
}

module.exports = { newspaper, dossier, floorPlan, accusationBoard, caseFile, cctv, will, wanted, profileCard, timeline, howto };
