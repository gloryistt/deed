// Stake-style originals: Mines, Crash, Limbo, Plinko, Towers, HiLo.
// Every game uses a provably fair seed (lib/fair.js) and a ~1% house edge like Stake.
const eco = require('../lib/economy');
const { awaitReply } = require('../lib/util');
const { color, ansiBlock } = require('../lib/format');
const { busy, betOrUsage, result, withBet } = require('../lib/bets');
const { createRound } = require('../lib/fair');

const EDGE = 0.99;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const x = (m) => `${m.toFixed(2)}x`;
const coins = (n) => `🪙 ${Math.floor(n).toLocaleString()}`;
const payout = (bet, mult) => Math.floor(bet * mult);

// Post a new board and delete the previous one, so only the latest board stays in chat.
async function show(state, channel, content) {
  const old = state.msg;
  state.msg = await channel.send(content);
  if (old) old.delete().catch(() => {});
}

// ansi "label  value" line
const stat = (label, value, c = 'white') => `${color(label.padEnd(11), 'gray')}${color(value, c, true)}`;

// =====================================================================
// MINES
// =====================================================================
const ROW_LABELS = ['🇦', '🇧', '🇨', '🇩', '🇪'];
const COL_LABELS = '⬛1️⃣2️⃣3️⃣4️⃣5️⃣';

function minesMultiplier(picks, mines) {
  let m = EDGE;
  for (let i = 0; i < picks; i++) m *= (25 - i) / (25 - mines - i);
  return picks === 0 ? 1 : m;
}

function renderMines({ bet, mines, bombs, revealed, hit, phase, fair, user }) {
  const done = phase !== 'playing';
  const grid = ROW_LABELS.map((label, r) => label + [0, 1, 2, 3, 4].map((c) => {
    const i = r * 5 + c;
    if (i === hit) return '💥';
    if (revealed.has(i)) return '💎';
    if (done) return bombs.has(i) ? '💣' : '🔹';
    return '🟦';
  }).join(''));

  const k = revealed.size;
  const mult = minesMultiplier(k, mines);
  const next = k < 25 - mines ? minesMultiplier(k + 1, mines) : null;
  const title = {
    playing: `### 💣 Mines · ${coins(bet)} · ${mines} mine${mines > 1 ? 's' : ''}`,
    cashed: `### 💎 Cashed out at ${x(mult)}!`,
    bust: '### 💥 BOOM! You hit a mine',
  }[phase];

  const stats = [
    stat('Multiplier', phase === 'bust' ? '0.00x' : x(mult), phase === 'bust' ? 'red' : 'green'),
    phase === 'playing' && next ? stat('Next gem', `${x(next)}  (${(((25 - mines - k) / (25 - k)) * 100).toFixed(1)}% safe)`, 'yellow') : null,
    stat('Gems', `${k} / ${25 - mines}`, 'cyan'),
    stat('Profit', phase === 'bust' ? `-${bet.toLocaleString()}` : `+${(payout(bet, mult) - bet).toLocaleString()}`, phase === 'bust' ? 'red' : 'green'),
  ].filter(Boolean);

  return [
    title,
    COL_LABELS,
    ...grid,
    ansiBlock(stats),
    done ? `-# ${fair.footer(true)}` : `-# ${user}: type a tile (b3, or several: a1 c4) · r = random · cash · 90s\n-# ${fair.footer()}`,
  ].join('\n');
}

// =====================================================================
// CRASH (multiplayer)
// =====================================================================
const crashRounds = new Map(); // channelId -> round
const LOBBY_MS = Number(process.env.CRASH_LOBBY_MS || 10000);
const TICK_MS = Number(process.env.CRASH_TICK_MS || 1500);
const CRASH_SPEED = Number(process.env.CRASH_SPEED || 1); // tests speed rounds up
// ~e^(0.09t): 2x at ~8s, 5x at ~18s, 10x at ~26s, 100x at ~51s.
const crashMultAt = (ms) => Math.max(1, Math.floor(Math.exp(0.00009 * CRASH_SPEED * ms) * 100) / 100);
const COUNTDOWN_STEP_MS = Number(process.env.CRASH_COUNTDOWN_MS || 1000);

function crashPoint(fair) {
  const r = fair.float();
  return Math.min(1000, Math.max(1, Math.floor((EDGE / (1 - r)) * 100) / 100));
}

const SPARK = '▁▂▃▄▅▆▇█';
function crashGraph(history, busted) {
  const width = 24;
  const pts = history.slice(-width);
  const max = Math.log(Math.max(...pts, 2));
  const spark = pts.map((m) => SPARK[Math.min(7, Math.floor((Math.log(m) / max) * 7.99))]).join('');
  const rocketPos = Math.min(width - 1, pts.length);
  return [
    color(spark.padEnd(width, ' '), busted ? 'red' : 'green'),
    color(`${'─'.repeat(rocketPos)}${busted ? '💥' : '🚀'}`, 'gray'),
  ];
}

function renderCrash(round, { mult, busted, lobbyLeft }) {
  const players = [...round.players.values()].map((p) => {
    if (p.cashedAt) return `> 🟢 **${p.name}** · ${coins(p.bet)} · cashed **${x(p.cashedAt)}** · +${coins(payout(p.bet, p.cashedAt) - p.bet)}`;
    if (busted) return `> 🔴 **${p.name}** · ${coins(p.bet)} · busted`;
    return `> 🟡 **${p.name}** · ${coins(p.bet)} · riding${p.auto ? ` (auto ${x(p.auto)})` : ''}`;
  });

  if (lobbyLeft != null) {
    return [
      '### 🚀 Crash · taking bets',
      ansiBlock([color(`  launching in ${Math.ceil(lobbyLeft / 1000)}s`, 'yellow', true), '', color('  join with: crash <bet> [auto e.g. 2x]', 'gray')]),
      ...players,
      `-# ${round.fair.footer()}`,
    ].join('\n');
  }

  const bigColor = busted ? 'red' : mult >= 10 ? 'pink' : mult >= 2 ? 'yellow' : 'green';
  return [
    busted ? `### 💥 Crashed @ ${x(round.point)}` : '### 🚀 Crash · to the moon',
    ansiBlock([
      color(`   ${x(busted ? round.point : mult)}`, bigColor, true),
      '',
      ...crashGraph(round.history, busted),
    ]),
    busted ? null : '> 💸 Type **cash** to cash out now!',
    ...players,
    busted ? `-# ${round.fair.footer(true)}` : `-# type cash to cash out · ${round.fair.footer()}`,
  ].filter(Boolean).join('\n');
}

async function runCrash(channel) {
  const round = crashRounds.get(channel.id);

  // Lobby: one update halfway so people see the countdown.
  await round.msg.edit(renderCrash(round, { lobbyLeft: LOBBY_MS })).catch(() => {});
  await sleep(LOBBY_MS / 2);
  await round.msg.edit(renderCrash(round, { lobbyLeft: LOBBY_MS / 2 })).catch(() => {});
  await sleep(LOBBY_MS / 2);

  // Bets close. Reply to the original crash command with a 3-2-1 countdown; that reply becomes the live round
  // (so it shows up at the bottom of the chat, not up where the lobby was).
  round.phase = 'launching';
  const riders = [...round.players.values()].map((p) => p.name).join(', ');
  await round.msg.edit(`### 🚀 Crash · bets closed\n> ${round.players.size} rider${round.players.size === 1 ? '' : 's'}: ${riders}\n-# launching below ↓`).catch(() => {});
  const countdown = (n) => `### 🚀 Launching in ${n}…\n> Riders: ${riders}\n> 💸 Type **cash** to cash out before it crashes!`;
  const launch = await round.origin.reply(countdown(3)).catch(() => channel.send(countdown(3)));
  for (const n of [2, 1]) {
    await sleep(COUNTDOWN_STEP_MS);
    await launch.edit(countdown(n)).catch(() => {});
  }
  await sleep(COUNTDOWN_STEP_MS);
  round.msg = launch;

  round.phase = 'running';
  round.point = crashPoint(round.fair);
  round.history = [1];
  const t0 = Date.now();
  let over = false;

  const cashOut = (p, at) => {
    if (p.cashedAt || at >= round.point) return;
    p.cashedAt = at;
    eco.settle(p.id, p.bet, payout(p.bet, at));
  };

  // Listen for "cash" from players while the rocket flies.
  const listen = (async () => {
    while (!over) {
      const m = await awaitReply(channel, (msg) => {
        const p = round.players.get(msg.author.id);
        return p && !p.cashedAt && /^(c|cash|cashout|out)$/i.test(msg.content.trim());
      }, 1000);
      if (m && !over) cashOut(round.players.get(m.author.id), crashMultAt(Date.now() - t0));
    }
  })();

  for (;;) {
    await sleep(TICK_MS);
    const mult = crashMultAt(Date.now() - t0);
    for (const p of round.players.values()) if (p.auto && mult >= p.auto) cashOut(p, p.auto);
    if (mult >= round.point) break;
    round.history.push(mult);
    await round.msg.edit(renderCrash(round, { mult })).catch(() => {});
  }

  over = true;
  await listen;
  round.history.push(round.point);
  for (const p of round.players.values()) {
    if (!p.cashedAt) eco.settle(p.id, p.bet, 0);
    busy.delete(p.id);
  }
  crashRounds.delete(channel.id);
  await round.msg.edit(renderCrash(round, { busted: true })).catch(() => {});
}

// =====================================================================
// PLINKO
// =====================================================================
const PLINKO = {
  low: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
  medium: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
  high: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
};
const PLINKO_ROWS = 8;
const multColor = (m) => (m >= 10 ? 'red' : m >= 3 ? 'pink' : m >= 1.5 ? 'yellow' : m >= 1 ? 'green' : 'gray');

function renderPlinko(path, shownRows, risk, landed) {
  const W = 37, C = 18, S = 4; // 4-char spacing keeps the ball exactly between pegs and fits phone screens
  const lines = [];
  let pos = 0;
  for (let i = 0; i < PLINKO_ROWS; i++) {
    const row = Array(W).fill(' ');
    for (let k = 0; k <= i + 1; k++) row[Math.round(C + (k - (i + 1) / 2) * S)] = color('·', 'gray');
    if (i < shownRows) {
      const bx = Math.round(C + (pos - i / 2) * S);
      row[bx] = i === shownRows - 1 && !landed ? color('●', 'yellow', true) : color('•', 'cyan');
      pos += path[i];
    }
    lines.push(row.join(''));
  }
  const buckets = Array(W).fill(' ');
  const marker = Array(W).fill(' ');
  PLINKO[risk].forEach((m, k) => {
    const label = String(m);
    const start = C + (k - 4) * S - Math.floor(label.length / 2);
    const hit = landed && k === pos;
    [...label].forEach((ch, j) => { buckets[start + j] = j === 0 ? color(label, hit ? 'white' : multColor(m), true) : ''; });
    if (hit) marker[C + (k - 4) * S] = color('▲', 'yellow', true);
  });
  lines.push('', buckets.join(''));
  if (landed) lines.push(marker.join(''));
  return { lines, bucket: pos };
}

// =====================================================================
// TOWERS
// =====================================================================
const TOWER_LEVELS = 8;
const TOWER_MODES = {
  easy: { tiles: 4, safe: 3 },
  medium: { tiles: 3, safe: 2 },
  hard: { tiles: 2, safe: 1 },
  expert: { tiles: 3, safe: 1 },
};
const KEYCAPS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];
const towerMult = (level, mode) => (level === 0 ? 1 : EDGE * (mode.tiles / mode.safe) ** level);

function renderTowers({ bet, modeName, mode, traps, picks, phase, fair, user }) {
  const level = picks.length; // floors cleared
  const done = phase !== 'playing';
  const rows = [];
  for (let f = TOWER_LEVELS - 1; f >= 0; f--) {
    const tiles = [...Array(mode.tiles).keys()].map((t) => {
      const trap = traps[f].includes(t);
      if (f < level) return t === picks[f] ? '🥚' : done ? (trap ? '🐉' : '▫️') : '⬛';
      if (f === level && phase === 'bust') return t === picks.bust ? '💀' : trap ? '🐉' : '▫️';
      if (f === level && phase === 'playing') return KEYCAPS[t];
      return done ? (trap ? '🐉' : '▫️') : '⬛';
    }).join('');
    const current = f === level && phase === 'playing';
    rows.push(`${tiles}  \`${x(towerMult(f + 1, mode)).padStart(8)}\`${current ? ' ◀' : ''}`);
  }
  const mult = towerMult(level, mode);
  const title = {
    playing: `### 🐉 Towers · ${coins(bet)} · ${modeName}`,
    cashed: `### 🏆 Escaped the tower at ${x(mult)}!`,
    bust: '### 💀 The dragon got you',
    top: `### 👑 Reached the top! ${x(mult)}`,
  }[phase];
  return [
    title,
    ...rows,
    ansiBlock([
      stat('Multiplier', phase === 'bust' ? '0.00x' : x(mult), phase === 'bust' ? 'red' : 'green'),
      stat('Floor', `${level} / ${TOWER_LEVELS}`, 'cyan'),
      phase === 'playing' ? stat('Next floor', x(towerMult(level + 1, mode)), 'yellow') : null,
    ].filter(Boolean)),
    done ? `-# ${fair.footer(true)}` : `-# ${user}: pick 1–${mode.tiles} · cash to cash out · 90s\n-# ${fair.footer()}`,
  ].join('\n');
}

// =====================================================================
// HILO
// =====================================================================
const RANK = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];

function cardArt({ r, s }, highlight) {
  const red = s === 1 || s === 2;
  const c = (t) => color(t, red ? 'red' : 'white', true);
  const edge = (t) => color(t, highlight ? 'yellow' : 'gray');
  const rk = RANK[r];
  return [
    edge('┌───────┐'),
    `${edge('│')}${c(rk.padEnd(7))}${edge('│')}`,
    `${edge('│')}   ${c(SUITS[s])}   ${edge('│')}`,
    `${edge('│')}${c(rk.padStart(7))}${edge('│')}`,
    edge('└───────┘'),
  ];
}
const miniCard = ({ r, s }) => `${RANK[r]}${SUITS[s]}`;

// Chance of winning each guess for current rank r (cards drawn from an infinite deck).
function hiloOdds(r) {
  if (r === 1) return { hi: { p: 12 / 13, label: 'higher' }, lo: { p: 1 / 13, label: 'same' } };
  if (r === 13) return { hi: { p: 1 / 13, label: 'same' }, lo: { p: 12 / 13, label: 'lower' } };
  return { hi: { p: (14 - r) / 13, label: 'higher or same' }, lo: { p: r / 13, label: 'lower or same' } };
}
function hiloWins(guess, from, to) {
  if (from === 1) return guess === 'hi' ? to > 1 : to === 1;
  if (from === 13) return guess === 'lo' ? to < 13 : to === 13;
  return guess === 'hi' ? to >= from : to <= from;
}

function renderHilo({ bet, cardNow, history, mult, phase, fair, user, next }) {
  const done = phase !== 'playing';
  const odds = hiloOdds(cardNow.r);
  const title = {
    playing: `### 🃏 HiLo · ${coins(bet)}`,
    cashed: `### 💰 Cashed out at ${x(mult)}!`,
    bust: '### ❌ Wrong call',
  }[phase];
  const art = cardArt(cardNow, !done);
  const side = done ? [] : [
    `${color('⬆ hi', 'green', true)}  ${color(x(mult * EDGE / odds.hi.p), 'white', true)} ${color(`${odds.hi.label} ${(odds.hi.p * 100).toFixed(1)}%`, 'gray')}`,
    `${color('⬇ lo', 'red', true)}  ${color(x(mult * EDGE / odds.lo.p), 'white', true)} ${color(`${odds.lo.label} ${(odds.lo.p * 100).toFixed(1)}%`, 'gray')}`,
    '',
    stat('Current', x(mult), 'cyan'),
  ];
  const lines = art.map((l, i) => `${l}   ${side[i] ?? ''}`);
  if (done) lines.push('', stat('Payout', phase === 'bust' ? '0.00x' : x(mult), phase === 'bust' ? 'red' : 'green'));
  const trail = history.length ? `-# ${history.slice(-10).map(miniCard).join(' → ')}${next ? ` → **${miniCard(next)}**` : ''}` : null;
  return [
    title,
    ansiBlock(lines),
    trail,
    done ? `-# ${fair.footer(true)}` : `-# ${user}: hi · lo · skip · cash · 90s\n-# ${fair.footer()}`,
  ].filter(Boolean).join('\n');
}

// =====================================================================
// COMMANDS
// =====================================================================
module.exports = [
  {
    name: 'mines', // no 'mine' alias: ,mine is the mining command
    usage: 'mines <bet> [mines 1-24]',
    description: 'Find gems on a 5×5 grid, avoid the mines, cash out whenever.',
    async run({ message, args }) {
      const uid = message.author.id;
      const bet = betOrUsage(message, args[0], 'mines 100 3');
      if (!bet) return;
      const mines = Math.min(24, Math.max(1, parseInt(args[1], 10) || 3));

      await withBet(uid, bet, async () => {
        const fair = createRound(uid);
        const bombs = new Set(fair.sample(25, mines));
        const s = { bet, mines, bombs, revealed: new Set(), hit: null, phase: 'playing', fair, user: message.author.username, msg: null };
        const safeLeft = () => [...Array(25).keys()].filter((i) => !bombs.has(i) && !s.revealed.has(i));
        const hiddenLeft = () => [...Array(25).keys()].filter((i) => !s.revealed.has(i));

        while (s.phase === 'playing') {
          await show(s, message.channel, renderMines(s));
          const reply = await awaitReply(message.channel, (m) => m.author.id === uid
            && /^(([a-e][1-5])(\s+[a-e][1-5])*|c|cash|cashout|r|rand|random)$/i.test(m.content.trim()), 90000);
          const input = reply?.content.trim().toLowerCase() ?? 'cash';

          if (/^(c|cash|cashout)$/.test(input)) { s.phase = 'cashed'; break; } // not /^c/: row C tiles start with c
          const picks = /^r/.test(input)
            ? [hiddenLeft()[Math.floor(Math.random() * hiddenLeft().length)]]
            : input.split(/\s+/).map((t) => (t.charCodeAt(0) - 97) * 5 + Number(t[1]) - 1);
          for (const i of picks) {
            if (s.revealed.has(i)) continue;
            if (bombs.has(i)) { s.hit = i; s.phase = 'bust'; break; }
            s.revealed.add(i);
          }
          if (s.phase === 'playing' && safeLeft().length === 0) s.phase = 'cashed';
        }

        const returned = s.phase === 'bust' ? 0 : payout(bet, minesMultiplier(s.revealed.size, mines));
        const { balance, net } = eco.settle(uid, bet, returned);
        await show(s, message.channel, `${renderMines(s)}\n${result(net, balance)}`);
      });
    },
  },
  {
    name: 'crash',
    aliases: ['rocket'],
    usage: 'crash <bet> [auto cashout, e.g. 2x]',
    description: 'Multiplayer: ride the rocket, type cash before it crashes. Others can join during the countdown.',
    async run({ message, args }) {
      const uid = message.author.id;
      let round = crashRounds.get(message.channel.id);
      if (round && round.phase !== 'lobby') return message.reply('🚀 Bets are closed for this round. Join the next one!');
      if (round?.players.has(uid)) return message.reply("You're already in this round.");

      const bet = betOrUsage(message, args[0], 'crash 100 2x');
      if (!bet) return;
      const auto = args[1] ? parseFloat(args[1]) : null;
      if (auto !== null && !(auto >= 1.01 && auto <= 1000)) return message.reply('Auto cashout must be between 1.01x and 1000x.');

      busy.add(uid);
      eco.take(uid, bet);
      const player = { id: uid, name: message.author.username, bet, auto, cashedAt: null };

      if (round) {
        round.players.set(uid, player);
        await round.msg.edit(renderCrash(round, { lobbyLeft: LOBBY_MS / 2 })).catch(() => {});
        return message.reply(`🎟️ You're in for ${coins(bet)}${auto ? ` (auto ${x(auto)})` : ''}!`);
      }

      round = { phase: 'lobby', players: new Map([[uid, player]]), fair: createRound(message.channel.id), history: [1], msg: null, origin: message };
      crashRounds.set(message.channel.id, round);
      round.msg = await message.channel.send(renderCrash(round, { lobbyLeft: LOBBY_MS }));
      await runCrash(message.channel);
    },
  },
  {
    name: 'limbo',
    usage: 'limbo <bet> <target multiplier>',
    description: 'Pick a target multiplier. If the roll lands at or above it, you win bet × target.',
    async run({ message, args }) {
      const uid = message.author.id;
      const target = parseFloat(args[1]);
      if (!(target >= 1.01 && target <= 1000)) return message.reply('Usage: `limbo 100 2.5` (target 1.01x–1000x)');
      const bet = betOrUsage(message, args[0], 'limbo 100 2.5');
      if (!bet) return;

      await withBet(uid, bet, async () => {
        const fair = createRound(uid);
        const roll = Math.min(1e6, Math.max(1, Math.floor((EDGE / (1 - fair.float())) * 100) / 100));
        const chance = (EDGE / target) * 100;
        const head = [
          stat('Target', x(target), 'cyan'),
          stat('Win chance', `${chance.toFixed(2)}%`, 'gray'),
          stat('Payout', coins(payout(bet, target)), 'yellow'),
        ];
        const msg = await message.channel.send(`### 🎯 Limbo · ${coins(bet)}\n${ansiBlock([color('   ?.??x', 'gray', true), '', ...head])}\n-# ${fair.footer()}`);
        await sleep(1200);

        const won = roll >= target;
        const { balance, net } = eco.settle(uid, bet, won ? payout(bet, target) : 0);
        await msg.edit([
          won ? `### 🎯 ${x(roll)} · You win!` : `### 🎯 ${x(roll)} · Missed`,
          ansiBlock([color(`   ${x(roll)}`, won ? 'green' : 'red', true), '', ...head]),
          result(net, balance),
          `-# ${fair.footer(true)}`,
        ].join('\n'));
      });
    },
  },
  {
    name: 'plinko',
    usage: 'plinko <bet> [low|medium|high]',
    description: 'Drop a ball through the pegs. Edges pay big, the middle pays small.',
    async run({ message, args }) {
      const uid = message.author.id;
      const risk = { l: 'low', m: 'medium', h: 'high' }[args[1]?.[0]?.toLowerCase()] ?? 'medium';
      const bet = betOrUsage(message, args[0], 'plinko 100 high');
      if (!bet) return;

      await withBet(uid, bet, async () => {
        const fair = createRound(uid);
        const path = [...Array(PLINKO_ROWS)].map(() => (fair.float() < 0.5 ? 0 : 1));
        const head = `### 🟡 Plinko · ${coins(bet)} · ${risk} risk`;
        const msg = await message.channel.send(`${head}\n${ansiBlock(renderPlinko(path, 3, risk, false).lines)}\n-# ${fair.footer()}`);
        await sleep(900);
        await msg.edit(`${head}\n${ansiBlock(renderPlinko(path, 6, risk, false).lines)}\n-# ${fair.footer()}`).catch(() => {});
        await sleep(900);

        const { lines, bucket } = renderPlinko(path, PLINKO_ROWS, risk, true);
        const mult = PLINKO[risk][bucket];
        const { balance, net } = eco.settle(uid, bet, payout(bet, mult));
        await msg.edit([
          `### 🟡 Plinko · ${mult}x${mult >= 10 ? ' 🔥' : ''}`,
          ansiBlock(lines),
          result(net, balance),
          `-# ${fair.footer(true)}`,
        ].join('\n'));
      });
    },
  },
  {
    name: 'towers',
    aliases: ['tower', 'dragon'],
    usage: 'towers <bet> [easy|medium|hard|expert]',
    description: 'Climb 8 floors picking safe eggs. Each floor multiplies your bet; cash out any time.',
    async run({ message, args }) {
      const uid = message.author.id;
      const modeName = TOWER_MODES[args[1]?.toLowerCase()] ? args[1].toLowerCase() : 'medium';
      const mode = TOWER_MODES[modeName];
      const bet = betOrUsage(message, args[0], 'towers 100 medium');
      if (!bet) return;

      await withBet(uid, bet, async () => {
        const fair = createRound(uid);
        const traps = [...Array(TOWER_LEVELS)].map(() => fair.sample(mode.tiles, mode.tiles - mode.safe));
        const s = { bet, modeName, mode, traps, picks: [], phase: 'playing', fair, user: message.author.username, msg: null };
        const pattern = new RegExp(`^([1-${mode.tiles}]|c|cash|cashout)$`, 'i');

        while (s.phase === 'playing') {
          await show(s, message.channel, renderTowers(s));
          const reply = await awaitReply(message.channel, (m) => m.author.id === uid && pattern.test(m.content.trim()), 90000);
          const input = reply?.content.trim().toLowerCase() ?? 'cash';
          if (input.startsWith('c')) { s.phase = 'cashed'; break; }
          const tile = Number(input) - 1;
          if (traps[s.picks.length].includes(tile)) { s.picks.bust = tile; s.phase = 'bust'; break; }
          s.picks.push(tile);
          if (s.picks.length === TOWER_LEVELS) s.phase = 'top';
        }

        const returned = s.phase === 'bust' ? 0 : payout(bet, towerMult(s.picks.length, mode));
        const { balance, net } = eco.settle(uid, bet, returned);
        await show(s, message.channel, `${renderTowers(s)}\n${result(net, balance)}`);
      });
    },
  },
  {
    name: 'hilo',
    aliases: ['hl', 'higherlower'],
    usage: 'hilo <bet>',
    description: 'Guess if the next card is higher or lower. Multipliers stack; cash out any time.',
    async run({ message, args }) {
      const uid = message.author.id;
      const bet = betOrUsage(message, args[0], 'hilo 100');
      if (!bet) return;

      await withBet(uid, bet, async () => {
        const fair = createRound(uid);
        const draw = () => ({ r: fair.int(1, 13), s: fair.int(0, 3) });
        const s = { bet, cardNow: draw(), history: [], mult: 1, phase: 'playing', fair, user: message.author.username, msg: null, next: null };
        let skips = 0;

        while (s.phase === 'playing') {
          await show(s, message.channel, renderHilo(s));
          const reply = await awaitReply(message.channel, (m) => m.author.id === uid
            && /^(h|hi|high|higher|l|lo|low|lower|s|skip|c|cash|cashout)$/i.test(m.content.trim()), 90000);
          const input = reply?.content.trim().toLowerCase() ?? 'cash';

          if (input.startsWith('c')) {
            if (s.history.length === 0 && s.mult === 1) { s.phase = 'cashed'; break; }
            s.phase = 'cashed';
            break;
          }
          const next = draw();
          if (input.startsWith('s')) {
            if (++skips > 10) { await message.channel.send('-# skip limit reached (10)'); continue; }
            s.history.push(s.cardNow);
            s.cardNow = next;
            continue;
          }
          const guess = input.startsWith('h') ? 'hi' : 'lo';
          const odds = hiloOdds(s.cardNow.r)[guess];
          s.history.push(s.cardNow);
          if (!hiloWins(guess, s.cardNow.r, next.r)) {
            s.cardNow = next;
            s.phase = 'bust';
            break;
          }
          s.mult *= EDGE / odds.p;
          s.cardNow = next;
        }

        const returned = s.phase === 'bust' ? 0 : payout(bet, s.mult);
        const { balance, net } = eco.settle(uid, bet, returned);
        await show(s, message.channel, `${renderHilo(s)}\n${result(net, balance)}`);
      });
    },
  },
];

// Exposed for tests.
module.exports.internals = { minesMultiplier, towerMult, crashMultAt, hiloOdds, hiloWins, PLINKO };
