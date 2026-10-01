// Codenames: two teams, a 5×5 word grid. Each team's spymaster gets the secret key by DM and gives
// one-word clues in the GC; their team guesses words. Find all your agents first, and avoid the assassin.
const eco = require('../economy');
const dm = require('../dm');
const party = require('../party');
const art = require('../party-art');
const { pick, shuffle, awaitReply } = require('../util');
const { card } = require('../format');
const { CODENAMES_WORDS } = require('../party-data');

const NAME = 'Codenames';
const T = {
  clue: () => party.env('CN_CLUE_MS', 150000),
  guess: () => party.env('CN_GUESS_MS', 120000),
  min: () => party.env('CN_MIN_PLAYERS', 4),
};
const WIN_REWARD = 150;
const TEAM = { red: { emoji: '🟥', dot: '🔴', name: 'Red' }, blue: { emoji: '🟦', dot: '🔵', name: 'Blue' } };
const CARD_EMOJI = { red: '🟥', blue: '🟦', neutral: '🟨', assassin: '💀' };
const boards = new Map(); // channelId -> live board (tests peek at it)
const other = (t) => (t === 'red' ? 'blue' : 'red');

function newBoard() {
  const first = pick(['red', 'blue']);
  const words = shuffle([...CODENAMES_WORDS]).slice(0, 25);
  const key = shuffle([...Array(9).fill(first), ...Array(8).fill(other(first)), ...Array(7).fill('neutral'), 'assassin']);
  return { first, words, key, revealed: Array(25).fill(false) };
}
const left = (b, team) => b.key.filter((k, i) => k === team && !b.revealed[i]).length;
const findWord = (b, text) => b.words.findIndex((w, i) => !b.revealed[i] && w.toLowerCase() === text.trim().toLowerCase());

// Text fallback for when the image can't render: unrevealed words in a list.
const boardText = (b) => b.words.map((w, i) => (b.revealed[i] ? `~~${w}~~ ${CARD_EMOJI[b.key[i]]}` : `**${w}**`)).join(' · ');

async function sendBoard(channel, b, content, turn) {
  let buffer = null;
  try { buffer = await art.codenamesBoard({ ...b, left: { red: left(b, 'red'), blue: left(b, 'blue') }, turn }); } catch (err) { console.error('[codenames art]', err.message); }
  return channel.send(buffer ? { content, files: [{ attachment: buffer, name: 'codenames.png' }] } : `${content}\n> ${boardText(b)}`).catch(() => {});
}

async function play(client, message, track) {
  const channel = message.channel;
  const users = await party.lobby(client, message, {
    name: NAME, title: 'Codenames', emoji: '🕵️‍♀️', min: T.min(), max: 16,
    rules: ['Two teams. Each spymaster sees the secret key and gives one-word clues.', 'Guess your team’s words. Hit the assassin and you lose instantly.'],
  });
  if (!users) return;
  track(users);
  const ready = await party.gatherDMs(channel, users, { name: NAME, emoji: '🕵️‍♀️', why: 'Two of you become spymasters and get the secret key there. Everyone should DM, so I can pick.' });
  if (ready.length < 2) return channel.send('### 🕵️‍♀️ Codenames cancelled\n> I need at least 2 people to DM me, for the two spymasters.');

  // Spymasters come from people who DMed; everyone in the lobby still plays.
  const [redSpy, blueSpy] = shuffle(ready);
  const rest = shuffle(users.filter((u) => u.id !== redSpy.user.id && u.id !== blueSpy.user.id));
  const teams = { red: { spy: redSpy, guessers: [] }, blue: { spy: blueSpy, guessers: [] } };
  rest.forEach((u, i) => teams[i % 2 ? 'blue' : 'red'].guessers.push(u));
  for (const p of ready) if (p !== redSpy && p !== blueSpy) dm.unexpect(p.user.id); // only spymasters need their DMs

  const b = newBoard();
  boards.set(channel.id, b);
  for (const t of ['red', 'blue']) {
    const spy = teams[t].spy;
    let buffer = null;
    try { buffer = await art.codenamesBoard({ ...b, spymaster: true, left: { red: left(b, 'red'), blue: left(b, 'blue') } }); } catch {}
    const content = `## ${TEAM[t].dot} You are the ${TEAM[t].name} spymaster\n> Give clues in the GC: \`clue <one word> <number>\`. Your team's words are **${TEAM[t].name.toLowerCase()}**. Never lead them to the 💀 assassin.\n-# ${t === b.first ? 'you go first (9 words)' : 'you go second (8 words)'}`;
    await spy.dm.send(buffer ? { content, files: [{ attachment: buffer, name: 'key.png' }] }
      : `${content}\n> ${b.words.map((w, i) => `${CARD_EMOJI[b.key[i]]} ${w}`).join(' · ')}`).catch(() => {});
  }

  const roster = (t) => `${TEAM[t].dot} **${TEAM[t].name}**: 🧠 ${teams[t].spy.user.username} (spymaster) · ${teams[t].guessers.map((u) => u.username).join(', ')}`;
  await channel.send(card({
    title: 'Codenames · teams', emoji: '🕵️‍♀️',
    body: [roster('red'), roster('blue'), '', `${TEAM[b.first].dot} **${TEAM[b.first].name}** goes first and has 9 words to find.`],
    footer: 'spymasters: clue <word> <number> · guessers: type a word from the board, or pass',
  }));

  let turn = b.first;
  let winner = null, why = '';
  for (let round = 0; !winner && round < 40; round++) {
    const team = teams[turn];
    await sendBoard(channel, b, `### ${TEAM[turn].dot} ${TEAM[turn].name}'s turn\n> <@${team.spy.user.id}>, give your team a clue: \`clue <word> <number>\`\n-# ${Math.round(T.clue() / 1000)}s`, turn);

    // Clue.
    let clue = null;
    const clueEnd = Date.now() + T.clue();
    while (!clue && Date.now() < clueEnd) {
      const m = await awaitReply(channel, (x) => x.author.id === team.spy.user.id && /^clue\s+/i.test(x.content.trim()), clueEnd - Date.now());
      if (!m) break;
      const parts = /^clue\s+(\S+)\s+(\d)$/i.exec(m.content.trim());
      if (!parts) { m.reply('Format: `clue <one word> <number 0-9>` (0 = unlimited guesses)').catch(() => {}); continue; }
      const word = parts[1].toLowerCase();
      if (b.words.some((w, i) => !b.revealed[i] && w.toLowerCase().split(' ').includes(word))) { m.reply('That word is on the board. Pick another clue.').catch(() => {}); continue; }
      clue = { word: parts[1], n: Number(parts[2]) };
    }
    if (!clue) { await channel.send(`⌛ No clue from ${team.spy.user.username}. ${TEAM[other(turn)].name}'s turn.`); turn = other(turn); continue; }

    let guesses = clue.n === 0 ? Infinity : clue.n + 1;
    const guesserIds = new Set(team.guessers.map((u) => u.id));
    await channel.send(`### 🗝️ ${TEAM[turn].dot} Clue: **${clue.word.toUpperCase()}** · ${clue.n === 0 ? '∞' : clue.n}\n> ${team.guessers.map((u) => u.username).join(', ')}: type a word from the board (up to **${clue.n === 0 ? 'unlimited' : guesses}** guesses), or \`pass\`.\n-# ${Math.round(T.guess() / 1000)}s`);

    // Guesses.
    const guessEnd = Date.now() + T.guess();
    while (guesses > 0 && !winner && Date.now() < guessEnd) {
      const m = await awaitReply(channel, (x) => guesserIds.has(x.author.id) && (/^pass$/i.test(x.content.trim()) || findWord(b, x.content) !== -1), guessEnd - Date.now());
      if (!m) { await channel.send('⌛ Out of time.'); break; }
      if (/^pass$/i.test(m.content.trim())) { await channel.send(`👋 ${TEAM[turn].name} passes.`); break; }
      const i = findWord(b, m.content);
      b.revealed[i] = true;
      const k = b.key[i];
      const w = b.words[i].toUpperCase();
      if (k === 'assassin') { winner = other(turn); why = `${TEAM[turn].name} found the 💀 **assassin** (${w})!`; break; }
      if (!left(b, 'red')) { winner = 'red'; why = 'Red found all their agents!'; }
      if (!left(b, 'blue')) { winner = 'blue'; why = 'Blue found all their agents!'; }
      if (winner) { await channel.send(`${CARD_EMOJI[k]} **${w}** · ${k}`); break; }
      if (k === turn) {
        guesses--;
        await channel.send(`${CARD_EMOJI[k]} **${w}** · correct!${guesses > 0 && guesses !== Infinity ? ` (${guesses} more)` : ''}`);
      } else {
        await channel.send(`${CARD_EMOJI[k]} **${w}** · ${k === 'neutral' ? 'a bystander' : `a ${TEAM[k].name.toLowerCase()} agent`}. Turn over.`);
        break;
      }
    }
    turn = other(turn);
  }

  if (!winner) return channel.send('### 🕵️‍♀️ Codenames ended\n> Too many turns, calling it a draw.');
  const winners = [teams[winner].spy.user, ...teams[winner].guessers];
  for (const u of winners) eco.add(u.id, WIN_REWARD);
  b.revealed.fill(true);
  await sendBoard(channel, b, `# ${TEAM[winner].dot} ${TEAM[winner].name} team wins!\n> ${why}\n-# ${winners.map((u) => u.username).join(', ')} +🪙 ${WIN_REWARD}`);
}

module.exports = {
  name: 'codenames',
  aliases: ['cn'],
  usage: 'codenames',
  description: 'Codenames: two teams, spymasters get the secret key by DM and give one-word clues (4–16 players).',
  async run({ client, message }) {
    return party.host(message, NAME, (track) => play(client, message, track)).finally(() => boards.delete(message.channel.id));
  },
  internals: { newBoard, left, boards },
};
