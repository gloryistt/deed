// Spyfall: everyone but the spy gets the same secret location by DM. Ask each other questions to find the spy
// before the spy works out where you are.
const eco = require('../economy');
const dm = require('../dm');
const party = require('../party');
const { pick, shuffle, awaitReply } = require('../util');
const { card } = require('../format');
const { SPY_LOCATIONS } = require('../party-data');

const NAME = 'Spyfall';
const T = {
  round: () => party.env('SPY_ROUND_MS', 360000),
  vote: () => party.env('SPY_VOTE_MS', 30000),
  final: () => party.env('SPY_FINAL_MS', 45000),
  lastGuess: () => party.env('SPY_GUESS_MS', 30000),
  min: () => party.env('SPY_MIN_PLAYERS', 3),
};
const SPY_WIN = 300;
const TOWN_WIN = 100;

const locationList = () => SPY_LOCATIONS.map((l) => `${l[1]} ${l[0]}`).join(' · ');
function findLocation(text) {
  const t = String(text).trim().toLowerCase();
  if (t.length < 3) return null;
  return SPY_LOCATIONS.find((l) => l[0].toLowerCase() === t) ?? SPY_LOCATIONS.find((l) => l[0].toLowerCase().includes(t)) ?? null;
}
const GUESS = /^guess\s+\S/i;

async function play(client, message, track) {
  const channel = message.channel;
  const users = await party.lobby(client, message, {
    name: NAME, title: 'Spyfall', emoji: '🕵️', min: T.min(), max: 12,
    rules: ['Everyone gets the same secret location by DM, except **one spy**.', 'Ask each other questions. Find the spy before they figure out where you are.'],
  });
  if (!users) return;
  track(users);
  const players = await party.gatherDMs(channel, users, { name: NAME, emoji: '🕵️', why: 'I’ll tell you the location there (or that you’re the spy).' });
  if (players.length < T.min()) return channel.send(`### 🕵️ Spyfall cancelled\n> Only ${players.length} players DMed me. Need ${T.min()}.`);

  const [locName, locEmoji, roles] = pick(SPY_LOCATIONS);
  const spy = pick(players);
  const roleOf = new Map(shuffle(players.filter((p) => p !== spy)).map((p, i) => [p.user.id, roles[i % roles.length]]));
  for (const p of players) {
    const text = p === spy
      ? `## 🕵️ You are the SPY\n> Nobody knows. Blend in, answer vaguely, and listen for hints about the location.\n> **DM me \`guess <location>\` at any time** to win, but a wrong guess loses.\n-# possible locations: ${locationList()}`
      : `## ${locEmoji} Location: ${locName}\n> Your role: **${roleOf.get(p.user.id)}**\n> One player doesn’t know the location. Ask questions that prove you know it, without giving it away.`;
    await p.dm.send(text).catch(() => {});
  }

  const ids = new Set(players.map((p) => p.user.id));
  const numbered = players.map((p, i) => `\`${i + 1}\` ${p.user.username}`).join(' · ');
  await channel.send(card({
    title: 'Spyfall · the round begins', emoji: '🕵️',
    body: [
      `**${pick(players).user.username}** asks first: pick someone and ask them a question about the location. Whoever answers asks next.`,
      '',
      `🚨 \`accuse <name>\`: put someone to a vote (once each, must be unanimous)`,
      '📍 `locations`: show every possible location',
      '🕵️ The spy can DM me `guess <location>` anytime',
      '',
      numbered,
    ],
    footer: `${Math.round(T.round() / 60000)} min on the clock · then everyone votes`,
  }));

  let result = null; // { spyWins, why }
  let endAt = Date.now() + T.round();
  const spyName = `**${spy.user.username}**`;

  // The spy can guess at any point in the round (accusation votes pause the clock, so keep listening).
  let watching = true;
  const stopWatch = () => { watching = false; dm.cancelFor(spy.user.id); };
  const watch = (async () => {
    while (!result && watching) {
      const m = await dm.awaitDM(spy.user.id, (x) => GUESS.test(x.content.trim()), Math.max(1000, endAt - Date.now()), '🕵️ DM `guess <location>` to end the round with a guess. A wrong guess loses.');
      if (result || !watching) return;
      if (!m) continue;
      const l = findLocation(m.content.trim().replace(/^guess\s+/i, ''));
      if (!l) { await m.channel.send(`📍 Not a location. Pick one of:\n-# ${locationList()}`).catch(() => {}); continue; }
      result = l[0] === locName
        ? { spyWins: true, why: `${spyName} was the spy and guessed the location: **${locEmoji} ${locName}**!` }
        : { spyWins: false, why: `${spyName} was the spy and guessed **${l[1]} ${l[0]}**. Wrong! It was **${locEmoji} ${locName}**.` };
    }
  })();

  // Caught spies get one last guess.
  async function lastChance() {
    await channel.send(`### 🕵️ ${spyName} was the spy!\n> …but they get one last chance: **${Math.round(T.lastGuess() / 1000)}s** to DM me the location.`);
    await spy.dm.send(`### 🚨 You've been caught!\n> DM me \`guess <location>\` in the next ${Math.round(T.lastGuess() / 1000)}s. Get it right and you still win.`).catch(() => {});
    const m = await dm.awaitDM(spy.user.id, (x) => GUESS.test(x.content.trim()), T.lastGuess(), '🕵️ `guess <location>`');
    const l = m && findLocation(m.content.trim().replace(/^guess\s+/i, ''));
    if (l && l[0] === locName) return { spyWins: true, why: `${spyName} was caught, but guessed the location: **${locEmoji} ${locName}**!` };
    return { spyWins: false, why: `${spyName} was caught${l ? ` and guessed **${l[0]}** (wrong)` : ' and couldn’t name the location'}. It was **${locEmoji} ${locName}**.` };
  }

  const accusedBy = new Set();
  while (!result && Date.now() < endAt) {
    const m = await awaitReply(channel, (x) => ids.has(x.author.id) && /^(accuse\s+.+|locations?)$/i.test(x.content.trim()), Math.min(2000, endAt - Date.now()));
    if (!m || result) continue;
    const text = m.content.trim();
    if (/^locations?$/i.test(text)) { await channel.send(`### 📍 Possible locations\n> ${locationList()}`); continue; }
    if (accusedBy.has(m.author.id)) { m.reply('You already used your accusation.').catch(() => {}); continue; }
    const target = party.findPlayer(players, text.replace(/^accuse\s+/i, ''));
    if (!target || target.user.id === m.author.id) { m.reply(`Accuse who? ${numbered}`).catch(() => {}); continue; }
    accusedBy.add(m.author.id);

    const voters = players.filter((p) => p !== target);
    const votes = new Map([[m.author.id, true]]);
    const started = Date.now();
    await channel.send(`### 🚨 ${m.author.username} accuses ${target.user.username}!\n> Everyone except ${target.user.username}: type **yes** or **no**. It must be **unanimous**.\n-# ${Math.round(T.vote() / 1000)}s`);
    const voteEnd = Date.now() + T.vote();
    const voterIds = new Set(voters.map((p) => p.user.id));
    while (votes.size < voters.length && Date.now() < voteEnd && !result) {
      const v = await awaitReply(channel, (x) => voterIds.has(x.author.id) && /^(yes|no|y|n)$/i.test(x.content.trim()), Math.min(2000, voteEnd - Date.now()));
      if (!v) continue;
      votes.set(v.author.id, /^y/i.test(v.content.trim()));
      v.react?.(/^y/i.test(v.content.trim()) ? '✅' : '❌').catch(() => {});
    }
    endAt += Date.now() - started; // votes don't eat into the round
    if (result) break;
    const yes = [...votes.values()].filter(Boolean).length;
    if (yes < voters.length) {
      await channel.send(`### 🕊️ Not unanimous (${yes}/${voters.length} yes)\n> ${target.user.username} is off the hook. Keep asking.`);
      continue;
    }
    if (target === spy) { stopWatch(); result = await lastChance(); }
    else result = { spyWins: true, why: `Everyone accused **${target.user.username}**, who was innocent. The spy was ${spyName}! The location was **${locEmoji} ${locName}**.` };
  }

  if (!result) {
    stopWatch();
    await channel.send(`### ⏰ Time's up!\n> Vote for who you think the spy is: type their number.\n> ${numbered}\n-# ${Math.round(T.final() / 1000)}s · you can’t vote for yourself · a tie lets the spy escape`);
    const votes = await party.numberVote(channel, players, players.length, T.final(), {
      canVote: (id, i) => (players[i].user.id === id ? 'You can’t vote for yourself.' : true),
    });
    const [top, second] = party.tally(votes);
    if (!top || (second && second[1] === top[1])) result = { spyWins: true, why: `The vote was split, so the spy slipped away. It was ${spyName}! The location was **${locEmoji} ${locName}**.` };
    else if (players[top[0]] === spy) result = await lastChance();
    else result = { spyWins: true, why: `The group voted out **${players[top[0]].user.username}**, who was innocent. The spy was ${spyName}! The location was **${locEmoji} ${locName}**.` };
  }
  stopWatch();
  await watch;

  const winners = result.spyWins ? [spy] : players.filter((p) => p !== spy);
  for (const p of winners) eco.add(p.user.id, result.spyWins ? SPY_WIN : TOWN_WIN);
  await channel.send([
    result.spyWins ? '# 🕵️ The spy wins!' : '# 🎉 The players win!',
    `> ${result.why}`,
    '',
    '### Who was who',
    ...players.map((p) => `> ${p === spy ? '🕵️ **SPY**' : `${locEmoji} ${roleOf.get(p.user.id)}`} · ${p.user.username}`),
    `-# ${result.spyWins ? `spy +🪙 ${SPY_WIN}` : `everyone but the spy +🪙 ${TOWN_WIN}`}`,
  ].join('\n'));
}

module.exports = {
  name: 'spyfall',
  aliases: ['spy'],
  usage: 'spyfall',
  description: 'Spyfall: everyone gets a secret location by DM except the spy. Find the spy by asking questions (3–12 players).',
  async run({ client, message }) {
    return party.host(message, NAME, (track) => play(client, message, track));
  },
  internals: { findLocation },
};
