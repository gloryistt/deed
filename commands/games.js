const eco = require('../lib/economy');
const { resolveUser, pick, randInt, shuffle, awaitReply, confirm } = require('../lib/util');
const { card, color, ansiBlock } = require('../lib/format');
const dm = require('../lib/dm');
const { busy, betOrUsage } = require('../lib/bets');
const partyArt = require('../lib/party-art');

// One channel-wide game at a time per GC (trivia, hangman, ttt, guess, connect 4, and the party games).
const party = require('../lib/party');
const claimChannel = (message, game) => party.claimChannel(message, game);
const releaseChannel = (message) => party.releaseChannel(message.channel);

const HANGMAN_WORDS = [
  'pizza', 'discord', 'javascript', 'deed', 'banana', 'keyboard', 'penguin', 'volcano', 'galaxy', 'pancake',
  'wizard', 'skateboard', 'dinosaur', 'rainbow', 'cactus', 'hamburger', 'saxophone', 'blizzard', 'kangaroo',
  'avocado', 'labyrinth', 'jellyfish', 'trampoline', 'moonlight', 'popcorn', 'waterfall', 'zombie', 'octopus',
  'chocolate', 'thunderstorm', 'marshmallow', 'pineapple', 'headphones', 'spaceship', 'butterfly', 'quicksand',
];
const GALLOWS = ['😀', '😐', '😟', '😨', '😰', '😵', '💀'];

const TTT_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const TTT_CELLS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
const tttBoard = (b) => [0, 3, 6].map((i) => b.slice(i, i + 3).map((c, j) => c ?? TTT_CELLS[i + j]).join('')).join('\n');
const tttWinner = (b) => TTT_LINES.find(([x, y, z]) => b[x] && b[x] === b[y] && b[x] === b[z]);

// ---------- Connect 4 ----------
const C4_ROWS = 6, C4_COLS = 7;
const C4_DISCS = ['🔴', '🟡'];
const C4_MOVE_MS = Number(process.env.C4_MOVE_MS || 60000);
// Drop a disc in column c (0-based). Returns the row it landed in, or -1 if the column is full.
function c4Drop(grid, c, who) {
  for (let r = C4_ROWS - 1; r >= 0; r--) if (grid[r][c] === null) { grid[r][c] = who; return r; }
  return -1;
}
// Four in a row through (r, c)? Returns the winning cells or null.
function c4Win(grid, r, c) {
  const who = grid[r][c];
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const cells = [[r, c]];
    for (const s of [1, -1]) {
      for (let k = 1; k < 4; k++) {
        const rr = r + dr * k * s, cc = c + dc * k * s;
        if (rr < 0 || rr >= C4_ROWS || cc < 0 || cc >= C4_COLS || grid[rr][cc] !== who) break;
        cells.push([rr, cc]);
      }
    }
    if (cells.length >= 4) return cells;
  }
  return null;
}
const c4Text = (grid) => `${grid.map((row) => row.map((v) => (v === null ? '⚫' : C4_DISCS[v])).join('')).join('\n')}\n1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣`;
async function c4Send(channel, grid, content, opts) {
  let buffer = null;
  try { buffer = await partyArt.connect4Board({ grid, ...opts }); } catch (err) { console.error('[connect4 art]', err.message); }
  return channel.send(buffer ? { content, files: [{ attachment: buffer, name: 'connect4.png' }] } : `${content}\n${c4Text(grid)}`);
}


// ---------- Rock paper scissors (PvP over DMs) ----------
const RPS = { rock: '🪨', paper: '📄', scissors: '✂️' };
const RPS_BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
const RPS_ALIASES = {
  r: 'rock', rock: 'rock', '🪨': 'rock', p: 'paper', paper: 'paper', '📄': 'paper',
  s: 'scissors', scissor: 'scissors', scissors: 'scissors', '✂️': 'scissors', '✂': 'scissors',
};
const parseMove = (text) => RPS_ALIASES[text.trim().toLowerCase()] ?? null;
const RPS_MOVE_MS = Number(process.env.RPS_MOVE_MS || 60000);

function rpsScore(a, b, score) {
  return ansiBlock([`${color(a.username, 'cyan', true)}  ${color(`${score[a.id]}  —  ${score[b.id]}`, 'white', true)}  ${color(b.username, 'pink', true)}`]);
}

function rpsStatus(round, a, b, score, locked, firstTo) {
  const line = (u) => (locked[u.id] ? `> ✅ **${u.username}** locked in` : `> ⏳ **${u.username}** thinking…`);
  return [
    `### 🤫 Round ${round} · DM me your move`,
    line(a),
    line(b),
    rpsScore(a, b, score),
    `-# DM me: rock · paper · scissors (or r / p / s) · 60s${firstTo > 1 ? ` · first to ${firstTo}` : ''}`,
  ].join('\n');
}

async function rpsChallenge(client, message, opponent, rest) {
  const a = message.author, b = opponent;
  const channel = message.channel;
  if (b.id === a.id) return message.reply("You can't play yourself.");
  if (b.id === client.user.id) return message.reply('To play me, use `rps rock` (or paper / scissors).');
  if (!channel.recipients?.has(b.id)) return message.reply(`${b.username} isn't in this GC.`);

  const bo = Number(rest.find((x) => /^bo\d$/i.test(x))?.slice(2) ?? 1);
  if (![1, 3, 5, 7].includes(bo)) return message.reply('Match length must be bo1, bo3, bo5 or bo7.');
  const firstTo = Math.ceil(bo / 2);
  const rawBet = rest.find((x) => !/^bo\d$/i.test(x));
  let bet = 0;
  if (rawBet) {
    bet = betOrUsage(message, rawBet, 'rps @user 100 bo3');
    if (!bet) return;
    if (eco.balance(b.id) < bet) return message.reply(`${b.username} only has ${eco.fmt(eco.balance(b.id))}.`);
  } else if (busy.has(a.id)) return message.reply('Finish your current game first.');
  if (busy.has(b.id)) return message.reply(`${b.username} is in another game.`);

  busy.add(a.id); busy.add(b.id);
  dm.expect(a.id); dm.expect(b.id);
  const log = (msg) => console.log(`[rps] ${a.username} vs ${b.username}: ${msg}`);
  try {
    await channel.send(card({
      title: 'Rock Paper Scissors', emoji: '✂️',
      body: [
        `**${a.username}** challenges <@${b.id}>!`,
        `${bo > 1 ? `Best of ${bo}` : 'One round'}${bet ? ` · **🪙 ${bet.toLocaleString()}** each` : ''}`,
        '',
        '🤫 Moves are sent to me **by DM**, so nobody sees them coming.',
      ],
      footer: `${b.username}: type accept or decline (30s)`,
    }));
    if (!(await confirm(channel, b))) return channel.send(`${b.username} declined. 🐔`);
    if (bet && (eco.balance(a.id) < bet || eco.balance(b.id) < bet)) return channel.send('Someone no longer has enough coins. Match off.');
    if (bet) { eco.take(a.id, bet); eco.take(b.id, bet); }

    const score = { [a.id]: 0, [b.id]: 0 };
    let round = 1;
    for (;;) {
      const locked = {};
      const status = await channel.send(rpsStatus(round, a, b, score, locked, firstTo));

      // Moves typed in the GC by accident don't count; nudge them to DM instead.
      let open = true;
      const guard = (async () => {
        while (open) {
          const m = await awaitReply(channel, (x) => [a.id, b.id].includes(x.author.id) && parseMove(x.content), 1000);
          if (m && open) m.reply("🤫 DM me that instead! Moves in the GC don't count.").catch(() => {});
        }
      })();

      const ask = (u, other) => dm.awaitDM(u.id, (m) => parseMove(m.content), RPS_MOVE_MS,
        '✂️ Send **rock**, **paper** or **scissors** (or r / p / s).')
        .then(async (m) => {
          if (!m) return null;
          const move = parseMove(m.content);
          locked[u.id] = move;
          log(`round ${round}: ${u.username} locked in`);
          await m.channel.send(`### 🔒 Locked in: ${RPS[move]} ${move}\n-# round ${round} vs ${other.username} · results in the GC`).catch(() => {});
          await status.edit(rpsStatus(round, a, b, score, locked, firstTo)).catch(() => {});
          return move;
        });
      // Ping anyone who still hasn't moved with 15s left.
      const reminder = RPS_MOVE_MS >= 30000 && setTimeout(() => {
        const late = [a, b].filter((u) => !locked[u.id]);
        if (late.length) channel.send(`⏰ ${late.map((u) => `<@${u.id}>`).join(' ')} 15 seconds left! DM me your move for round ${round}.`).catch(() => {});
      }, RPS_MOVE_MS - 15000);
      const [ma, mb] = await Promise.all([ask(a, b), ask(b, a)]);
      clearTimeout(reminder);
      if (!ma || !mb) log(`round ${round}: timed out (${a.username}: ${ma ? 'moved' : 'no move'}, ${b.username}: ${mb ? 'moved' : 'no move'})`);
      open = false; // the guard loop exits on its own; don't wait for it (that delayed the next round)
      guard.catch(() => {});

      if (!ma && !mb) {
        if (bet) { eco.settle(a.id, bet, bet); eco.settle(b.id, bet, bet); }
        return channel.send(`### ⌛ Match cancelled\n> Neither player sent a move.${bet ? '\n-# bets refunded' : ''}`);
      }
      if (!ma || !mb) {
        const [winner, loser] = ma ? [a, b] : [b, a];
        if (bet) { eco.settle(winner.id, bet, bet * 2); eco.settle(loser.id, bet, 0); }
        return channel.send(`### 🏆 ${winner.username} wins by forfeit\n> ${loser.username} didn't send a move for round ${round} in time.${bet ? `\n-# +🪙 ${bet.toLocaleString()} to ${winner.username}` : ''}`);
      }

      let verdict;
      if (ma === mb) verdict = `> Tie! Both picked ${ma}. ${firstTo > 1 ? 'Replaying the round.' : 'Go again!'}`;
      else {
        const roundWinner = RPS_BEATS[ma] === mb ? a : b;
        score[roundWinner.id]++;
        verdict = `> **${roundWinner.username}** takes ${firstTo > 1 ? `round ${round}` : 'it'}! ${RPS[RPS_BEATS[ma] === mb ? ma : mb]} beats ${RPS[RPS_BEATS[ma] === mb ? mb : ma]}`;
        round++;
      }
      const champion = [a, b].find((u) => score[u.id] >= firstTo);
      await channel.send([`### ${RPS[ma]}  vs  ${RPS[mb]}`, `-# ${a.username} · ${b.username}`, verdict, rpsScore(a, b, score)].join('\n'));

      if (champion) {
        const loser = champion === a ? b : a;
        if (bet) { eco.settle(champion.id, bet, bet * 2); eco.settle(loser.id, bet, 0); }
        return channel.send(`## 🏆 ${champion.username} wins${firstTo > 1 ? ` ${score[champion.id]}–${score[loser.id]}` : ''}!${bet ? `\n-# +🪙 ${bet.toLocaleString()} from ${loser.username}` : ''}`);
      }
    }
  } finally {
    busy.delete(a.id); busy.delete(b.id);
    dm.cancelFor(a.id); dm.cancelFor(b.id);
    dm.unexpect(a.id); dm.unexpect(b.id);
  }
}

module.exports = [
  {
    name: '8ball',
    usage: '8ball <question>',
    description: 'Ask the magic 8-ball.',
    async run({ message, args }) {
      if (!args.length) return message.reply('Ask a question.');
      const answers = [
        'Yes.', 'No.', 'Definitely.', 'Absolutely not.', 'Ask again later.', 'Without a doubt.', "Don't count on it.",
        'Signs point to yes.', 'Very doubtful.', 'Maybe 👀', 'My sources say no.', 'It is certain.', 'Deed says... sure.',
      ];
      await message.reply(`### 🎱 ${pick(answers)}\n-# ${args.join(' ').slice(0, 200)}`);
    },
  },
  {
    name: 'rps',
    aliases: ['rockpaperscissors'],
    usage: 'rps <rock|paper|scissors>  ·  rps @user [bet] [bo3|bo5]',
    description: 'Play Deed, or challenge someone: both DM Deed your move secretly, then it is revealed in the GC.',
    async run({ client, message, args }) {
      const opponent = message.mentions.users.first() ?? (args[0] && !parseMove(args[0]) ? await resolveUser(client, message, args[0]) : null);
      if (opponent) return rpsChallenge(client, message, opponent, args.slice(1));

      const you = parseMove(args[0] ?? '');
      if (!you) return message.reply('Pick rock, paper, or scissors, or challenge someone: `rps @user`.');
      const her = pick(Object.keys(RPS));
      const verdict = you === her ? "It's a tie!" : RPS_BEATS[you] === her ? 'You win! 🎉' : 'I win 😌';
      await message.reply(`### ${RPS[you]}  vs  ${RPS[her]}\n> ${verdict}\n-# you: ${you} · Deed: ${her}`);
    },
  },
  {
    name: 'roll',
    usage: 'roll [NdS]  e.g. roll, roll 20, roll 3d6',
    description: 'Roll dice.',
    async run({ message, args }) {
      const m = /^(\d{1,2})?d?(\d{1,4})?$/i.exec(args[0] ?? '');
      const count = Math.min(Number(m?.[1]) || 1, 20);
      const sides = Math.min(Math.max(Number(m?.[2]) || 6, 2), 1000);
      const rolls = Array.from({ length: count }, () => randInt(1, sides));
      const total = rolls.reduce((a, b) => a + b, 0);
      await message.reply(`🎲 ${count}d${sides}: ${count > 1 ? `[${rolls.join(', ')}] = **${total}**` : `**${total}**`}`);
    },
  },
  {
    name: 'choose',
    aliases: ['pick'],
    usage: 'choose <a> | <b> | ...',
    description: 'Pick between options.',
    async run({ message, args }) {
      const options = args.join(' ').split('|').map((s) => s.trim()).filter(Boolean);
      if (options.length < 2) return message.reply('Give me at least 2 options separated by `|`.');
      await message.reply(`🤔 I choose **${pick(options)}**`);
    },
  },
  {
    name: 'guess',
    usage: 'guess',
    description: 'Number guessing game (1–100). Everyone can play; winner gets coins.',
    async run({ message }) {
      if (!claimChannel(message, 'guess')) return;
      try {
        const target = randInt(1, 100);
        let tries = 0;
        await message.channel.send('### 🔢 Guess the number\n> I\'m thinking of a number between **1** and **100**.\n-# just type numbers in chat · fewer tries = more coins');
        for (;;) {
          const m = await awaitReply(message.channel, (x) => /^\d{1,3}$/.test(x.content.trim()), 60000);
          if (!m) return message.channel.send(`⌛ Nobody guessed. It was **${target}**.`);
          tries++;
          const n = Number(m.content.trim());
          if (n === target) {
            const prize = Math.max(25, 200 - tries * 20);
            eco.add(m.author.id, prize);
            return message.channel.send(`### 🎉 ${m.author.username} got it!\n> It was **${target}** · ${tries} ${tries === 1 ? 'try' : 'tries'}\n-# +🪙 ${prize}`);
          }
          await m.reply(n < target ? 'Higher ⬆️' : 'Lower ⬇️');
        }
      } finally {
        releaseChannel(message);
      }
    },
  },
  {
    name: 'trivia',
    aliases: ['quiz'],
    usage: 'trivia [easy|medium|hard]',
    description: 'Trivia question; first correct answer wins coins (one guess each).',
    cooldown: 10000,
    async run({ message, args }) {
      const diff = ['easy', 'medium', 'hard'].includes(args[0]) ? args[0] : null;
      const url = `https://opentdb.com/api.php?amount=1&type=multiple&encode=url3986${diff ? `&difficulty=${diff}` : ''}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) }).then((r) => r.json()).catch(() => null);
      const q = res?.results?.[0];
      if (!q) return message.reply("Couldn't reach the trivia server, try again in a sec.");
      if (!claimChannel(message, 'trivia')) return;

      try {
        const d = decodeURIComponent;
        const correct = d(q.correct_answer);
        const choices = shuffle([correct, ...q.incorrect_answers.map(d)]);
        const letters = ['A', 'B', 'C', 'D'];
        const answerLetter = letters[choices.indexOf(correct)];
        const prize = { easy: 50, medium: 100, hard: 200 }[q.difficulty] ?? 75;

        const diffColor = { easy: 'green', medium: 'yellow', hard: 'red' }[q.difficulty] ?? 'white';
        await message.channel.send(card({
          title: d(q.question), emoji: '🧠',
          block: [
            `${color(q.difficulty.toUpperCase(), diffColor, true)} ${color(`· ${d(q.category)} · 🪙 ${prize}`, 'gray')}`,
            '',
            ...choices.map((c, i) => `${color(` ${letters[i]} `, 'cyan', true)} ${c}`),
          ],
          footer: 'type A, B, C or D · 20 seconds · one guess each',
        }));

        const guessed = new Set();
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
          const m = await awaitReply(message.channel,
            (x) => /^[a-d]$/i.test(x.content.trim()) && !guessed.has(x.author.id), deadline - Date.now());
          if (!m) break;
          guessed.add(m.author.id);
          if (m.content.trim().toUpperCase() === answerLetter) {
            eco.add(m.author.id, prize);
            return message.channel.send(`### ✅ ${m.author.username} got it!\n> **${answerLetter}. ${correct}**\n-# +🪙 ${prize}`);
          }
        }
        await message.channel.send(`### ⌛ Time's up!\n> The answer was **${answerLetter}. ${correct}**`);
      } finally {
        releaseChannel(message);
      }
    },
  },
  {
    name: 'hangman',
    aliases: ['hm'],
    usage: 'hangman',
    description: 'Group hangman. Type letters (or the whole word) in chat.',
    async run({ message }) {
      if (!claimChannel(message, 'hangman')) return;
      try {
        const word = pick(HANGMAN_WORDS);
        const found = new Set();
        const wrong = [];
        const lives = GALLOWS.length - 1;
        const render = () => card({
          title: `Hangman ${GALLOWS[wrong.length]}`, emoji: '🪢',
          block: [
            color([...word].map((c) => (found.has(c) ? c.toUpperCase() : '_')).join(' '), 'white', true),
            '',
            `${color('lives', 'gray')} ${color('♥'.repeat(lives - wrong.length), 'red', true)}${color('♡'.repeat(wrong.length), 'gray')}`,
            wrong.length ? `${color('wrong', 'gray')} ${color(wrong.join(' ').toUpperCase(), 'red')}` : '',
          ],
          footer: 'type a letter, or guess the whole word',
        });

        await message.channel.send(render());
        for (;;) {
          const m = await awaitReply(message.channel, (x) => {
            const t = x.content.trim().toLowerCase();
            return /^[a-z]$/.test(t) || (t.length === word.length && /^[a-z]+$/.test(t));
          }, 90000);
          if (!m) return message.channel.send(`⌛ Game abandoned. The word was **${word}**.`);

          const g = m.content.trim().toLowerCase();
          const hit = g.length === 1 && word.includes(g);
          if (hit) found.add(g);
          if (g === word || [...word].every((c) => found.has(c))) {
            eco.add(m.author.id, 100);
            return message.channel.send(`### 🎉 ${m.author.username} solved it!\n> The word was **${word.toUpperCase()}**\n-# +🪙 100`);
          }
          if (!hit && !wrong.includes(g)) {
            wrong.push(g);
            if (wrong.length >= lives) return message.channel.send(`### ${GALLOWS.at(-1)} Game over\n> The word was **${word.toUpperCase()}**`);
          }
          await message.channel.send(render());
        }
      } finally {
        releaseChannel(message);
      }
    },
  },
  {
    name: 'tictactoe',
    aliases: ['ttt'],
    usage: 'tictactoe <@user> [bet]',
    description: 'Tic-tac-toe against someone in the GC. Type 1–9 to place.',
    async run({ client, message, args }) {
      const p1 = message.author;
      const p2 = await resolveUser(client, message, args[0]);
      if (!p2 || p2.id === p1.id) return message.reply('Challenge who?');
      const bet = args[1] ? eco.parseBet(p1.id, args[1]) : 0;
      if (args[1] && !bet) return message.reply("Invalid bet (or you don't have that much).");
      if (bet && eco.balance(p2.id) < bet) return message.reply(`${p2.username} can't cover that bet.`);
      if (!claimChannel(message, 'tic-tac-toe')) return;

      try {
        await message.channel.send(card({
          title: 'Tic-tac-toe challenge', emoji: '❌',
          body: [`**${p1.username}** vs **${p2.username}**`, bet ? `Stakes: **🪙 ${bet.toLocaleString()}** each` : null],
          footer: `${p2.username}: type accept or decline (30s)`,
        }));
        if (!(await confirm(message.channel, p2))) return message.channel.send(`${p2.username} declined.`);
        if (bet && (eco.balance(p1.id) < bet || eco.balance(p2.id) < bet)) return message.channel.send('Someone no longer has enough coins.');
        if (bet) { eco.take(p1.id, bet); eco.take(p2.id, bet); }

        const board = Array(9).fill(null);
        const players = shuffle([{ user: p1, mark: '❌' }, { user: p2, mark: '⭕' }]);
        const payout = (winner, loser) => {
          if (!bet) return '';
          eco.settle(winner.id, bet, bet * 2); eco.settle(loser.id, bet, 0);
          return ` +${eco.fmt(bet)}`;
        };

        for (let turn = 0; ; turn++) {
          const cur = players[turn % 2], other = players[(turn + 1) % 2];
          await message.channel.send(`### ${cur.mark} ${cur.user.username}'s turn\n${tttBoard(board)}\n-# type 1–9 · 60s`);
          const m = await awaitReply(message.channel, (x) => x.author.id === cur.user.id && /^[1-9]$/.test(x.content.trim()) && !board[Number(x.content) - 1], 60000);
          if (!m) return message.channel.send(`⌛ ${cur.user.username} took too long. **${other.user.username}** wins!${payout(other.user, cur.user)}`);
          board[Number(m.content) - 1] = cur.mark;
          if (tttWinner(board)) return message.channel.send(`${tttBoard(board)}\n🏆 **${cur.user.username}** wins!${payout(cur.user, other.user)}`);
          if (board.every(Boolean)) {
            if (bet) { eco.settle(p1.id, bet, bet); eco.settle(p2.id, bet, bet); }
            return message.channel.send(`${tttBoard(board)}\n🤝 It's a draw!`);
          }
        }
      } finally {
        releaseChannel(message);
      }
    },
  },
  {
    name: 'connect4',
    aliases: ['c4', 'connectfour'],
    usage: 'connect4 <@user> [bet]',
    description: 'Connect 4 against someone in the GC. Type 1–7 to drop a disc. Four in a row wins.',
    async run({ client, message, args }) {
      const p1 = message.author;
      const p2 = await resolveUser(client, message, args[0]);
      if (!p2 || p2.id === p1.id) return message.reply('Challenge who? `connect4 @user [bet]`');
      if (p2.id === client.user.id) return message.reply("I'd win every time. Challenge a friend. 😌");
      const bet = args[1] ? eco.parseBet(p1.id, args[1]) : 0;
      if (args[1] && !bet) return message.reply("Invalid bet (or you don't have that much).");
      if (bet && eco.balance(p2.id) < bet) return message.reply(`${p2.username} can't cover that bet.`);
      if (!claimChannel(message, 'Connect 4')) return;

      try {
        await message.channel.send(card({
          title: 'Connect 4 challenge', emoji: '🔴',
          body: [`**${p1.username}** vs **${p2.username}**`, bet ? `Stakes: **🪙 ${bet.toLocaleString()}** each` : null],
          footer: `${p2.username}: type accept or decline (30s)`,
        }));
        if (!(await confirm(message.channel, p2))) return message.channel.send(`${p2.username} declined.`);
        if (bet && (eco.balance(p1.id) < bet || eco.balance(p2.id) < bet)) return message.channel.send('Someone no longer has enough coins.');
        if (bet) { eco.take(p1.id, bet); eco.take(p2.id, bet); }

        const grid = Array.from({ length: C4_ROWS }, () => Array(C4_COLS).fill(null));
        const players = shuffle([p1, p2]);
        const names = players.map((u) => u.username);
        const payout = (winner, loser) => {
          if (!bet) return '';
          eco.settle(winner.id, bet, bet * 2); eco.settle(loser.id, bet, 0);
          return ` +${eco.fmt(bet)}`;
        };
        let last = null;
        for (let turn = 0; ; turn++) {
          const who = turn % 2;
          const cur = players[who], other = players[1 - who];
          await c4Send(message.channel, grid, `### ${C4_DISCS[who]} ${cur.username}'s turn\n-# type 1–7 · ${Math.round(C4_MOVE_MS / 1000)}s`, { last, names });
          const m = await awaitReply(message.channel, (x) => x.author.id === cur.id && /^[1-7]$/.test(x.content.trim()) && grid[0][Number(x.content) - 1] === null, C4_MOVE_MS);
          if (!m) return message.channel.send(`⌛ ${cur.username} took too long. **${other.username}** wins!${payout(other, cur)}`);
          const c = Number(m.content) - 1;
          const r = c4Drop(grid, c, who);
          last = [r, c];
          const win = c4Win(grid, r, c);
          if (win) return c4Send(message.channel, grid, `### 🏆 ${C4_DISCS[who]} ${cur.username} connects four!${payout(cur, other)}`, { win, names });
          if (grid[0].every((v) => v !== null)) {
            if (bet) { eco.settle(p1.id, bet, bet); eco.settle(p2.id, bet, bet); }
            return c4Send(message.channel, grid, "### 🤝 The board is full. It's a draw!", { names });
          }
        }
      } finally {
        releaseChannel(message);
      }
    },
  },
];

module.exports.push(require('../lib/games/wordle'));
module.exports.connect4 = { c4Drop, c4Win };
