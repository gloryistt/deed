// Heist: the crew pools their stakes and pulls a three-stage job, voting on how to handle each obstacle.
// With 3+ crew, one of them is secretly a rat who can sabotage stages by DM and runs off with half the loot
// unless the crew works out who it was.
const eco = require('../economy');
const dm = require('../dm');
const party = require('../party');
const { pick, shuffle } = require('../util');
const { card } = require('../format');
const { busy } = require('../bets');
const { HEIST_TARGETS, HEIST_STAGES } = require('../party-data');

const NAME = 'Heist';
const T = {
  vote: () => party.env('HEIST_VOTE_MS', 30000),
  min: () => party.env('HEIST_MIN_PLAYERS', 2),
};
const MIN_STAKE = 50;
const BASE_LOOT = 1.2; // the vault pays out 1.2× the pot, plus each stage's bonus
const SABOTAGE = 0.3; // how much a sabotage lowers the odds
const RAT_CUT = 0.5;

async function play(client, message, args, track) {
  const channel = message.channel;
  const stake = eco.parseBet(message.author.id, args[0]);
  if (!stake || stake < MIN_STAKE) return message.reply(`Usage: \`heist <stake>\` (at least ${eco.fmt(MIN_STAKE)}, you have ${eco.fmt(eco.balance(message.author.id))})`);
  const target = pick(HEIST_TARGETS);
  const users = await party.lobby(client, message, {
    name: NAME, title: `Heist on ${target.name}`, emoji: target.emoji, min: T.min(), max: 8, bet: stake,
    rules: ['Three obstacles stand between you and the vault. The crew votes on how to handle each one.', 'Fail a stage and someone gets caught. **With 3+ crew, one of you is a rat.**'],
  });
  if (!users) return;
  track(users);
  // The rat needs a DM to sabotage, so with 3+ crew everyone DMs (nobody can tell who the rat is from that).
  const withRat = users.length >= 3;
  const ready = withRat
    ? await party.gatherDMs(channel, users, { name: NAME, emoji: target.emoji, why: 'I’ll tell you there whether you’re crew… or the rat.' })
    : users.map((u) => ({ user: u, dm: null }));

  const crew = [];
  for (const p of ready) {
    if (eco.balance(p.user.id) < stake || busy.has(p.user.id)) { await channel.send(`-# ${p.user.username} can’t cover the stake anymore and stays home.`); continue; }
    eco.take(p.user.id, stake);
    busy.add(p.user.id);
    crew.push({ ...p, id: p.user.id, name: p.user.username, caught: false });
  }
  const paid = new Set();
  try {
    if (crew.length < T.min()) { await channel.send(`### ${target.emoji} Heist called off\n> Not enough crew showed up.\n-# stakes refunded`); return; }
    const pot = stake * crew.length;
    const rat = withRat && crew.length >= 3 ? pick(crew) : null;
    for (const c of crew) {
      if (!c.dm) continue;
      await c.dm.send(c === rat
        ? `## 🐀 You are the RAT\n> Each stage, **DM me \`sabotage\`** while the crew votes to secretly cut their odds.\n> If they don’t finger you at the end, you run off with **half the loot**. Act natural.`
        : '## 🧑‍🎤 You are crew\n> One of the others might be a rat. Watch how they vote, and who keeps getting unlucky.').catch(() => {});
    }
    for (const c of crew) if (c !== rat) dm.unexpect(c.id);

    await channel.send(card({
      title: `The heist on ${target.name}`, emoji: target.emoji,
      body: [`Crew: ${crew.map((c) => `**${c.name}**`).join(', ')}`, `Pot: **${eco.fmt(pot)}** · the vault pays at least **${eco.fmt(Math.floor(pot * BASE_LOOT))}**`, rat ? '🐀 **One of you is a rat.**' : null],
      footer: 'each stage: type the number of the plan you want',
    }));

    let loot = BASE_LOOT;
    const stages = shuffle([...HEIST_STAGES]).slice(0, 3);
    const free = () => crew.filter((c) => !c.caught);
    for (const [n, stage] of stages.entries()) {
      if (!free().length) break;
      await channel.send([
        `### ${target.emoji} Stage ${n + 1}/3`,
        `> ${stage.text}`,
        ...stage.options.map(([label, chance, bonus], i) => `> \`${i + 1}\` ${label} · ${Math.round(chance * 100)}% · +${Math.round(bonus * 100)}% loot`),
        `-# ${free().map((c) => c.name).join(', ')}: type 1, 2 or 3 · ${Math.round(T.vote() / 1000)}s`,
      ].join('\n'));
      const ratFree = rat && !rat.caught;
      // The rat has until the vote closes to sabotage.
      const sabotage = ratFree ? dm.awaitDM(rat.id, (m) => /^sabotage$/i.test(m.content.trim()), T.vote(), '🐀 DM `sabotage` to cut the crew’s odds this stage.')
        .then((m) => { m?.channel.send('🐀 Done. Their odds just got worse.').catch(() => {}); return m; }) : null;
      const votes = await party.numberVote(channel, free().map((c) => c.user), 3, T.vote());
      if (ratFree) dm.cancelFor(rat.id);
      const sab = await sabotage;
      const ranked = party.tally(votes);
      const tied = ranked.filter(([, k]) => k === ranked[0]?.[1]).map(([i]) => i);
      const choice = tied.length ? pick(tied) : pick([0, 1, 2]);
      const [label, chance, bonus] = stage.options[choice];
      const odds = Math.max(0.05, chance - (sab ? SABOTAGE : 0));
      if (Math.random() < odds) {
        loot += bonus;
        await channel.send(`### ✅ ${label}: it worked!\n> The loot just went up **${Math.round(bonus * 100)}%**.`);
      } else {
        const caught = pick(free());
        caught.caught = true;
        await channel.send(`### 🚔 ${label}: it went wrong!\n> **${caught.name}** got caught and loses their stake.${free().length ? '' : '\n> That was the last of the crew…'}`);
      }
    }

    const escaped = free();
    if (!escaped.length) {
      for (const c of crew) { eco.settle(c.id, stake, 0); paid.add(c.id); }
      await channel.send(`# 🚔 Busted!\n> The whole crew got caught.${rat ? ` The rat was **${rat.name}**.` : ''}`);
      return;
    }
    const total = Math.floor(pot * loot);
    const shares = new Map();
    const lines = [];
    if (rat && !rat.caught && escaped.length >= 2) {
      await channel.send(`### 🐀 Who's the rat?\n> You made it out with **${eco.fmt(total)}**. Before you split it: vote for the rat.\n> ${escaped.map((c, i) => `\`${i + 1}\` ${c.name}`).join(' · ')}\n-# type a number · ${Math.round(T.vote() / 1000)}s · can’t vote for yourself`);
      const votes = await party.numberVote(channel, escaped.map((c) => c.user), escaped.length, T.vote(), {
        canVote: (id, i) => (escaped[i].id === id ? 'You can’t vote for yourself.' : true),
      });
      const [top, second] = party.tally(votes);
      const accused = top && (!second || second[1] < top[1]) ? escaped[top[0]] : null;
      if (accused === rat) {
        lines.push(`> 🎯 You caught the rat: **${rat.name}** gets nothing.`);
        const honest = escaped.filter((c) => c !== rat);
        for (const c of honest) shares.set(c.id, Math.floor(total / honest.length));
      } else {
        lines.push(`> ${accused ? `❌ You accused **${accused.name}**, but` : '🤷 Nobody agreed, and'} the rat was **${rat.name}**! They run off with half the loot.`);
        shares.set(rat.id, Math.floor(total * RAT_CUT));
        const honest = escaped.filter((c) => c !== rat);
        for (const c of honest) shares.set(c.id, Math.floor((total - shares.get(rat.id)) / honest.length));
      }
    } else {
      if (rat) lines.push(rat.caught ? `> 🐀 The rat was **${rat.name}**, who got caught themselves. Karma.` : `> 🐀 The rat, **${rat.name}**, was the only one left and keeps it all.`);
      for (const c of escaped) shares.set(c.id, Math.floor(total / escaped.length));
    }
    for (const c of crew) { eco.settle(c.id, stake, shares.get(c.id) ?? 0); paid.add(c.id); }
    await channel.send([
      `# 💰 The crew got away with ${eco.fmt(total)}`,
      ...lines,
      ...crew.map((c) => `> ${c.caught ? '🚔' : c === rat ? '🐀' : '💼'} **${c.name}** ${shares.get(c.id) ? `+${eco.fmt(shares.get(c.id))}` : 'nothing'}`),
      `-# everyone staked ${eco.fmt(stake)}`,
    ].join('\n'));
  } finally {
    for (const c of crew) {
      busy.delete(c.id);
      if (!paid.has(c.id)) eco.settle(c.id, stake, stake); // called off or crashed: refund
    }
  }
}

module.exports = {
  name: 'heist',
  usage: 'heist <stake>',
  description: 'Heist: pool your stakes, vote through three obstacles, and watch out for the rat (2–8 players).',
  async run({ client, message, args }) {
    return party.host(message, NAME, (track) => play(client, message, args, track));
  },
};
