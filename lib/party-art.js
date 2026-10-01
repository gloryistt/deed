// Generated images for the party games: the Codenames board (player + spymaster views) and Connect 4.
const { createCanvas } = require('@napi-rs/canvas');

const SANS = '"Avenir Next", "Helvetica Neue", Arial, sans-serif';

function fitText(ctx, text, maxWidth, start, min = 12, weight = 'bold') {
  let size = start;
  do { ctx.font = `${weight} ${size}px ${SANS}`; if (ctx.measureText(text).width <= maxWidth) break; size -= 1; } while (size > min);
  return size;
}

const CN = {
  red: { fill: '#d9443a', text: '#fff', soft: '#f6d1cd' },
  blue: { fill: '#3473d9', text: '#fff', soft: '#cfdcf6' },
  neutral: { fill: '#a8956a', text: '#fff', soft: '#efe6d2' },
  assassin: { fill: '#1d1d22', text: '#f2f2f2', soft: '#9a9aa3' },
};

/**
 * Codenames board. words: 25 strings, key: 25 of 'red'|'blue'|'neutral'|'assassin', revealed: 25 booleans.
 * spymaster: show every card's color (revealed ones are dimmed and crossed).
 */
async function codenamesBoard({ words, key, revealed, spymaster = false, left = {}, turn = null }) {
  const cols = 5, cw = 196, ch = 104, gap = 12, pad = 28, top = 86;
  const W = pad * 2 + cols * cw + (cols - 1) * gap;
  const H = top + 5 * ch + 4 * gap + pad;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#17171c';
  ctx.fillRect(0, 0, W, H);

  // header: score pills + whose turn
  ctx.textBaseline = 'middle';
  const pill = (x, team, label) => {
    ctx.fillStyle = CN[team].fill;
    ctx.beginPath(); ctx.roundRect(x, 24, 190, 40, 20); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `bold 20px ${SANS}`; ctx.textAlign = 'center';
    ctx.fillText(label, x + 95, 44);
  };
  pill(pad, 'red', `RED · ${left.red ?? '?'} left`);
  pill(pad + 205, 'blue', `BLUE · ${left.blue ?? '?'} left`);
  ctx.textAlign = 'right';
  ctx.fillStyle = spymaster ? '#f5c542' : 'rgba(255,255,255,0.6)';
  ctx.font = `bold 20px ${SANS}`;
  ctx.fillText(spymaster ? 'SPYMASTER KEY · DO NOT SHARE' : turn ? `${turn.toUpperCase()} TEAM'S TURN` : 'CODENAMES', W - pad, 44);

  words.forEach((word, i) => {
    const x = pad + (i % cols) * (cw + gap);
    const y = top + Math.floor(i / cols) * (ch + gap);
    const team = key[i];
    const open = revealed[i];
    let fill = '#efe6d2', text = '#2a2419';
    if (open) { fill = CN[team].fill; text = CN[team].text; } else if (spymaster) { fill = CN[team].soft; text = team === 'assassin' ? '#111' : '#2a2419'; }
    ctx.globalAlpha = spymaster && open ? 0.45 : 1;
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.roundRect(x, y, cw, ch, 12); ctx.fill();
    if (spymaster && !open) { ctx.strokeStyle = CN[team].fill; ctx.lineWidth = 6; ctx.stroke(); }
    ctx.fillStyle = text;
    ctx.textAlign = 'center';
    const size = fitText(ctx, word.toUpperCase(), cw - 24, 24, 12);
    ctx.font = `bold ${size}px ${SANS}`;
    ctx.fillText(word.toUpperCase(), x + cw / 2, y + ch / 2);
    if (spymaster && open) {
      ctx.strokeStyle = text; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x + 18, y + ch / 2); ctx.lineTo(x + cw - 18, y + ch / 2); ctx.stroke();
    }
    if (team === 'assassin' && (open || spymaster)) {
      ctx.font = `bold 13px ${SANS}`; ctx.fillStyle = open ? '#f2f2f2' : '#1d1d22';
      ctx.fillText('ASSASSIN', x + cw / 2, y + ch - 16);
    }
    ctx.globalAlpha = 1;
  });
  return canvas.encode('png');
}

/**
 * Connect 4 board. grid: rows (top to bottom) of 7 cells, each null | 0 | 1. win: [[r, c], ...] to highlight.
 */
async function connect4Board({ grid, win = [], last = null, names = ['', ''] }) {
  const cell = 86, pad = 26, top = 70;
  const W = pad * 2 + 7 * cell, H = top + 6 * cell + pad + 10;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#121218';
  ctx.fillRect(0, 0, W, H);
  const colors = ['#ef4444', '#facc15'];

  ctx.textBaseline = 'middle';
  ctx.font = `bold 20px ${SANS}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = colors[0]; ctx.fillText(`● ${names[0]}`, pad, 34);
  ctx.textAlign = 'right';
  ctx.fillStyle = colors[1]; ctx.fillText(`${names[1]} ●`, W - pad, 34);

  ctx.fillStyle = '#2350c9';
  ctx.beginPath(); ctx.roundRect(pad - 8, top - 8, 7 * cell + 16, 6 * cell + 16, 18); ctx.fill();
  const isWin = (r, c) => win.some(([wr, wc]) => wr === r && wc === c);
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 7; c++) {
      const cx = pad + c * cell + cell / 2, cy = top + r * cell + cell / 2;
      const v = grid[r][c];
      ctx.fillStyle = v === null ? '#121218' : colors[v];
      ctx.beginPath(); ctx.arc(cx, cy, cell * 0.38, 0, Math.PI * 2); ctx.fill();
      if (isWin(r, c)) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 5; ctx.stroke(); }
      else if (last && last[0] === r && last[1] === c) { ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 3; ctx.stroke(); }
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = `bold 18px ${SANS}`;
  ctx.textAlign = 'center';
  for (let c = 0; c < 7; c++) ctx.fillText(String(c + 1), pad + c * cell + cell / 2, H - 14);
  return canvas.encode('png');
}

module.exports = { codenamesBoard, connect4Board };
