// Fill in the blank: everyone DMs an answer to a prompt, Deed posts them anonymously, the group votes for
// the funniest. Three rounds, the last one counts double.
const eco = require('../economy');
const dm = require('../dm');
const party = require('../party');
const { pick, shuffle } = require('../util');
const { card } = require('../format');
const { BLANK_PROMPTS } = require('../party-data');

const NAME = 'Fill in the Blank';
const T = {
  answer: () => party.env('BLANKS_ANSWER_MS', 75000),
  vote: () => party.env('BLANKS_VOTE_MS', 40000),
  rounds: () => party.env('BLANKS_ROUNDS', 3),
  min: () => party.env('BLANKS_MIN_PLAYERS', 3),
};
const POINTS_PER_VOTE = 100;
const SWEEP_BONUS = 250;
const WIN_BONUS = 200;

const show = (prompt) => prompt.replace('____', '\\_\\_\\_\\_\\_');

async function play(client, message, track) {
  const channel = message.channel;
  const users = await party.lobby(client, message, {
    name: NAME, title: 'Fill in the Blank', emoji: '✍️', min: T.min(), max: 12,
    rules: ['I post a prompt, you DM me the funniest answer you can think of.', 'Answers are revealed anonymously and everyone votes. Last round counts double.'],
  });
  if (!users) return;
  track(users);
  const players = await party.gatherDMs(channel, users, { name: NAME, emoji: '✍️', why: 'You’ll send me your answers there, so nobody knows who wrote what.' });
  if (players.length < T.min()) return channel.send(`### ✍️ Cancelled\n> Only ${players.length} players DMed me. Need ${T.min()}.`);

  const score = new Map(players.map((p) => [p.user.id, 0]));
  const prompts = shuffle([...BLANK_PROMPTS]);
  const rounds = T.rounds();

  for (let round = 1; round <= rounds; round++) {
    const prompt = prompts[round - 1];
    const mult = round === rounds && rounds > 1 ? 2 : 1;
    const locked = new Set();
    const status = () => [
      `### ✍️ Round ${round}/${rounds}${mult > 1 ? ' · double points!' : ''}`,
      `> **${show(prompt)}**`,
      '> DM me your answer!',
      `-# ${players.map((p) => `${locked.has(p.user.id) ? '✅' : '⏳'} ${p.user.username}`).join(' · ')} · ${Math.round(T.answer() / 1000)}s`,
    ].join('\n');
    const statusMsg = await channel.send(status());
    for (const p of players) {
      dm.unexpect(p.user.id); dm.expect(p.user.id); // drop anything typed before this round
      await p.dm.send(`### ✍️ Round ${round} · DM me your answer\n> **${show(prompt)}**\n-# keep it short · ${Math.round(T.answer() / 1000)}s`).catch(() => {});
    }
    const got = await party.collectDMs(players, (m) => m.content.trim().length > 0 && !/^ready$/i.test(m.content.trim()), T.answer(),
      '✍️ Send your answer as a message.', async (p, m) => {
        locked.add(p.user.id);
        await m.channel.send('🔒 Locked in! Voting happens in the GC.').catch(() => {});
        statusMsg.edit(status()).catch(() => {});
      });
    const answers = shuffle(players.filter((p) => got.has(p.user.id)).map((p) => ({ p, text: party.clean(got.get(p.user.id).content, 150) })));
    if (answers.length < 2) { await channel.send('### 🦗 Not enough answers\n> Skipping this round.'); continue; }

    await channel.send(card({
      title: 'Vote for the funniest', emoji: '🗳️',
      body: [`**${show(prompt)}**`, '', ...answers.map((a, i) => `\`${i + 1}\` ${a.text}`)],
      footer: `type a number · you can’t vote for your own · ${Math.round(T.vote() / 1000)}s`,
    }));
    const votes = await party.numberVote(channel, players, answers.length, T.vote(), {
      canVote: (id, i) => (answers[i].p.user.id === id ? 'You can’t vote for your own answer. 👀' : true),
    });
    const counts = answers.map((_, i) => [...votes.values()].filter((v) => v === i).length);
    const lines = answers
      .map((a, i) => ({ a, n: counts[i] }))
      .sort((x, y) => y.n - x.n)
      .map(({ a, n }) => {
        const sweep = n >= 2 && n === votes.size;
        const pts = n * POINTS_PER_VOTE * mult + (sweep ? SWEEP_BONUS : 0);
        score.set(a.p.user.id, score.get(a.p.user.id) + pts);
        return `> ${n ? '🔥'.repeat(Math.min(n, 5)) : '💤'} **${a.text}** · ${a.p.user.username} · ${n} vote${n === 1 ? '' : 's'}${pts ? ` (+${pts})` : ''}${sweep ? ' · **CLEAN SWEEP!**' : ''}`;
      });
    await channel.send([`### 📊 Round ${round} results`, `-# ${show(prompt)}`, ...lines].join('\n'));
  }

  const board = [...score.entries()].sort((a, b) => b[1] - a[1]);
  const top = board[0][1];
  const winners = board.filter(([, s]) => s === top && s > 0).map(([id]) => id);
  for (const [id, s] of board) eco.add(id, Math.floor(s / 5) + (winners.includes(id) ? WIN_BONUS : 0));
  const name = (id) => players.find((p) => p.user.id === id).user.username;
  await channel.send([
    winners.length ? `# 🏆 ${winners.map(name).join(' & ')} win${winners.length === 1 ? 's' : ''}!` : '# 🤷 Nobody scored',
    ...board.map(([id, s], i) => `> ${['🥇', '🥈', '🥉'][i] ?? '▫️'} **${name(id)}** · ${s} pts`),
    `-# everyone gets points ÷ 5 in coins · winner +🪙 ${WIN_BONUS}`,
  ].join('\n'));
}

module.exports = {
  name: 'blanks',
  aliases: ['fill', 'fillblank', 'quip'],
  usage: 'blanks',
  description: 'Fill in the blank: DM me your funniest answer, then everyone votes on the anonymous answers (3–12 players).',
  async run({ client, message }) {
    return party.host(message, NAME, (track) => play(client, message, track));
  },
};
