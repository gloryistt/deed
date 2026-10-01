// Daily Wordle, played by DM so nobody spoils it: `wordle crane` in a DM to Deed. Everyone gets the same word
// each day (UTC). Finishing posts a spoiler-free grid to the GC where you last ran `wordle`.
const fs = require('fs');
const path = require('path');
const eco = require('../economy');
const dm = require('../dm');
const party = require('../party');
const { data, save } = require('../db');
const { card } = require('../format');
const { formatDuration } = require('../util');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'wordlists', f), 'utf8').split(/\s+/).filter((w) => /^[a-z]{5}$/.test(w));
const VALID = new Set(read('wordle-words.txt'));
const ANSWERS = read('wordle-answers.txt');
for (const w of ANSWERS) VALID.add(w);

const DAY = 864e5;
const EPOCH = Date.UTC(2026, 0, 1);
const today = () => (process.env.WORDLE_DAY ? Number(process.env.WORDLE_DAY) : Math.floor((Date.now() - EPOCH) / DAY));
// Spread the answers out so consecutive days aren't alphabetical neighbours.
const answerFor = (day) => ANSWERS[((day * 7919) % ANSWERS.length + ANSWERS.length) % ANSWERS.length];
const REWARDS = [500, 350, 250, 150, 100, 60];
const TILE = { g: '🟩', y: '🟨', b: '⬛' };

// Standard Wordle scoring, including repeated letters: greens first, then yellows from what's left.
function grade(guess, answer) {
  const out = Array(5).fill('b');
  const left = {};
  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) out[i] = 'g';
    else left[answer[i]] = (left[answer[i]] ?? 0) + 1;
  }
  for (let i = 0; i < 5; i++) {
    if (out[i] === 'b' && left[guess[i]]) { out[i] = 'y'; left[guess[i]]--; }
  }
  return out;
}

function state(userId) {
  data.wordle ??= {};
  const st = (data.wordle[userId] ??= { day: null, guesses: [], done: false, won: false, streak: 0, maxStreak: 0, played: 0, wins: 0, dist: [0, 0, 0, 0, 0, 0], lastWin: null, gc: null });
  if (st.day !== today()) Object.assign(st, { day: today(), guesses: [], done: false, won: false });
  return st;
}
const inProgress = (userId) => { const st = data.wordle?.[userId]; return !!st && st.day === today() && st.guesses.length > 0 && !st.done; };

const row = (guess) => `${grade(guess, answerFor(today())).map((t) => TILE[t]).join('')}  \`${guess.toUpperCase()}\``;
const grid = (st) => st.guesses.map((g) => grade(g, answerFor(today())).map((t) => TILE[t]).join('')).join('\n');
function keyboard(st) {
  const best = {};
  const rank = { g: 3, y: 2, b: 1 };
  for (const g of st.guesses) grade(g, answerFor(today())).forEach((t, i) => { if ((rank[t] ?? 0) > (rank[best[g[i]]] ?? 0)) best[g[i]] = t; });
  const group = (t) => Object.keys(best).filter((k) => best[k] === t).sort().join(' ').toUpperCase();
  return [`🟩 ${group('g') || '–'}`, `🟨 ${group('y') || '–'}`, `⬛ ${group('b') || '–'}`].join('  ·  ');
}
const nextIn = () => formatDuration(EPOCH + (today() + 1) * DAY - Date.now());

async function finish(client, userId, st, username) {
  st.done = true;
  st.name = username;
  st.played++;
  const n = st.guesses.length;
  let reward = 0;
  if (st.won) {
    st.wins++;
    st.dist[n - 1]++;
    st.streak = st.lastWin === today() - 1 ? st.streak + 1 : 1;
    st.maxStreak = Math.max(st.maxStreak, st.streak);
    st.lastWin = today();
    reward = REWARDS[n - 1];
    eco.add(userId, reward);
  } else st.streak = 0;
  save();
  if (!st.gc) return reward;
  const channel = client.channels?.cache?.get(st.gc) ?? await client.channels?.fetch?.(st.gc).catch(() => null);
  await channel?.send([
    `### ${st.won ? '🟩' : '⬛'} ${username} ${st.won ? 'solved' : 'missed'} Wordle #${today() + 1} · ${st.won ? n : 'X'}/6`,
    grid(st),
    `-# ${st.won ? `🔥 streak ${st.streak} · +🪙 ${reward}` : 'streak reset'} · DM me \`wordle <word>\` to play`,
  ].join('\n')).catch(() => {});
  return reward;
}

dm.onDM(async (client, message) => {
  const id = message.author.id;
  if (party.playingIn(id)) return false; // don't eat moves meant for a game (e.g. a murderer's "clean")
  const t = message.content.trim().toLowerCase();
  const reply = (text) => message.channel.send(text).catch(() => {});
  if (t === 'wordle') {
    const st = state(id);
    await reply(st.done ? `### 🟩 Wordle #${today() + 1}: done\n${grid(st)}\n-# next word in ${nextIn()}` : `### 🟩 Wordle #${today() + 1}\n> Guess the 5-letter word in 6 tries: DM me \`wordle <word>\`${st.guesses.length ? `\n${st.guesses.map(row).join('\n')}` : ''}`);
    return true;
  }
  const m = /^(?:wordle|w)\s+([a-z]+)$/.exec(t) ?? (/^[a-z]{5}$/.test(t) && inProgress(id) ? [t, t] : null);
  if (!m) return false;
  const guess = m[1];
  const st = state(id);
  if (st.done) { await reply(`### 🟩 You already finished today's Wordle\n${grid(st)}\n-# next word in ${nextIn()}`); return true; }
  if (guess.length !== 5) { await reply('🟩 Guesses are 5 letters.'); return true; }
  if (!VALID.has(guess)) { await reply(`🟩 **${guess.toUpperCase()}** isn’t in my word list.`); return true; }
  st.guesses.push(guess);
  st.won = guess === answerFor(today());
  const over = st.won || st.guesses.length >= 6;
  save();
  const lines = [`### 🟩 Wordle #${today() + 1} · ${st.guesses.length}/6`, ...st.guesses.map(row)];
  if (over) {
    const reward = await finish(client, id, st, message.author.username);
    lines.push(st.won ? `> 🎉 **Got it!** +🪙 ${reward} · 🔥 streak ${st.streak}` : `> The word was **${answerFor(today()).toUpperCase()}**. Streak reset.`, `-# next word in ${nextIn()}${st.gc ? ' · your grid was posted to your GC' : ' · run `wordle` in a GC to post your results there'}`);
  } else {
    lines.push(`-# ${keyboard(st)}`, '-# next guess: just send the word');
  }
  await reply(lines.join('\n'));
  return true;
});

module.exports = {
  name: 'wordle',
  usage: 'wordle [stats]',
  description: 'Daily Wordle: DM me `wordle <word>` to guess (no spoilers in the GC). Same word for everyone each day.',
  async run({ message, args }) {
    const ch = message.channel;
    const me = message.author;
    if (args[0] && args[0] !== 'stats' && /^[a-z]{5}$/i.test(args[0])) return message.reply('🤫 DM me your guesses so you don’t spoil it for everyone: `wordle ' + args[0].toLowerCase() + '`');
    const st = state(me.id);
    if (args[0] === 'stats') {
      const max = Math.max(1, ...st.dist);
      return ch.send(card({
        title: `${me.username}'s Wordle stats`, emoji: '🟩',
        body: [`🎮 **${st.played}** played · 🏆 **${st.played ? Math.round((st.wins / st.played) * 100) : 0}%** wins · 🔥 streak **${st.streak}** (best ${st.maxStreak})`],
        block: st.dist.map((n, i) => `${i + 1} ${'█'.repeat(Math.round((n / max) * 16)) || '·'} ${n}`),
      }));
    }
    st.gc = ch.id; // finished grids get posted here
    save();
    const solved = Object.entries(data.wordle ?? {}).filter(([, s]) => s.gc === ch.id && s.day === today() && s.done);
    return ch.send(card({
      title: `Wordle #${today() + 1}`, emoji: '🟩',
      body: [
        'Guess the 5-letter word in 6 tries. **DM me `wordle <word>`** so nobody gets spoiled.',
        '🟩 right letter, right spot · 🟨 right letter, wrong spot · ⬛ not in the word',
        '',
        solved.length ? `Today in this GC: ${solved.map(([id, s]) => `${s.name ?? 'someone'} ${s.won ? s.guesses.length : 'X'}/6`).join(' · ')}` : 'Nobody here has finished today’s word yet.',
      ],
      footer: `your result will be posted here · new word in ${nextIn()} · wordle stats`,
    }));
  },
  internals: { grade, answerFor, today, VALID, ANSWERS },
};
