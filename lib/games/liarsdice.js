// Liar's Dice: everyone rolls 5 secret dice (sent by DM). Take turns raising a bid on how many of a face are
// on the whole table (1s are wild), or call "liar". Whoever's wrong loses a die. Last player with dice wins.
const eco = require('../economy');
const party = require('../party');
const { randInt, awaitReply, pick } = require('../util');
const { card } = require('../format');
const { busy } = require('../bets');

const NAME = "Liar's Dice";
const T = {
  turn: () => party.env('LD_TURN_MS', 60000),
  min: () => party.env('LD_MIN_PLAYERS', 2),
  dice: () => party.env('LD_DICE', 5),
};
const FREE_PRIZE = 150;
const FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const showDice = (dice) => dice.map((d) => FACES[d]).join(' ');
const BID = /^(?:bid\s+)?(\d{1,2})\s*(?:x|×|\s)\s*([1-6])s?$/i;

// How many dice on the table show `face` (1s are wild).
const countFace = (players, face) => players.reduce((n, p) => n + p.roll.filter((d) => d === face || d === 1).length, 0);
const isHigher = (bid, prev) => !prev || bid.count > prev.count || (bid.count === prev.count && bid.face > prev.face);

async function play(client, message, args, track) {
  const channel = message.channel;
  const bet = args[0] ? eco.parseBet(message.author.id, args[0]) : 0;
  if (args[0] && !bet) return message.reply(`Usage: \`liarsdice [buy-in]\` (you have ${eco.fmt(eco.balance(message.author.id))})`);
  const users = await party.lobby(client, message, {
    name: NAME, title: "Liar's Dice", emoji: '🎲', min: T.min(), max: 6, bet,
    rules: ['Everyone gets 5 secret dice by DM. Bid on how many of a face are on the **whole table**. **1s are wild.**', 'Raise the bid or call `liar`. Whoever is wrong loses a die. Last one with dice wins.'],
  });
  if (!users) return;
  track(users);
  const ready = await party.gatherDMs(channel, users, { name: NAME, emoji: '🎲', why: 'Your dice are sent there each round.' });
  // Take buy-ins now (someone may have spent their coins since joining).
  const players = [];
  for (const p of ready) {
    if (bet && (eco.balance(p.user.id) < bet || busy.has(p.user.id))) { await channel.send(`-# ${p.user.username} can’t cover the buy-in anymore and sits out.`); continue; }
    if (bet) { eco.take(p.user.id, bet); busy.add(p.user.id); }
    players.push({ ...p, dice: T.dice(), roll: [] });
  }
  const settled = new Set();
  try {
    if (players.length < T.min()) {
      await channel.send(`### 🎲 Liar's Dice cancelled\n> Need ${T.min()} players who DMed me.${bet ? '\n-# buy-ins refunded' : ''}`);
      return;
    }
    const pot = bet * players.length;
    await channel.send(card({
      title: "Liar's Dice", emoji: '🎲',
      body: [players.map((p) => `**${p.user.username}**`).join(' · '), bet ? `Pot: **${eco.fmt(pot)}**, winner takes all` : `Winner gets **${eco.fmt(FREE_PRIZE)}**`],
      footer: 'on your turn: type <count> <face> (e.g. 3 5 = three fives) or liar · 1s are wild',
    }));

    let starter = pick(players);
    for (let round = 1; players.filter((p) => p.dice > 0).length > 1; round++) {
      const table = players.filter((p) => p.dice > 0);
      const total = table.reduce((n, p) => n + p.dice, 0);
      for (const p of table) {
        p.roll = Array.from({ length: p.dice }, () => randInt(1, 6));
        await p.dm.send(`### 🎲 Round ${round} · your dice\n> ${showDice(p.roll)}  (${p.roll.join(' ')})\n-# ${total} dice on the table · 1s are wild`).catch(() => {});
      }
      let i = Math.max(0, table.indexOf(starter));
      let bid = null, bidder = null, loser = null, reveal = '';
      while (!loser) {
        const cur = table[i % table.length];
        await channel.send(`### 🎲 ${cur.user.username}'s turn\n> ${bid ? `Current bid: **${bid.count} × ${FACES[bid.face]}** (${bid.count} ${bid.face}s) by ${bidder.user.username}` : 'Open the bidding.'} · **${total}** dice on the table\n-# <@${cur.user.id}>: \`<count> <face>\`${bid ? ' or `liar`' : ''} · ${Math.round(T.turn() / 1000)}s`);
        let acted = false;
        const end = Date.now() + T.turn();
        while (!acted && Date.now() < end) {
          const m = await awaitReply(channel, (x) => x.author.id === cur.user.id && (BID.test(x.content.trim()) || /^(liar|call)$/i.test(x.content.trim())), end - Date.now());
          if (!m) break;
          if (/^(liar|call)$/i.test(m.content.trim())) {
            if (!bid) { m.reply('There’s no bid to call yet. Open with `<count> <face>`.').catch(() => {}); continue; }
            const actual = countFace(table, bid.face);
            loser = actual >= bid.count ? cur : bidder;
            reveal = `### 🚨 ${cur.user.username} calls ${bidder.user.username} a liar!\n${table.map((p) => `> ${showDice(p.roll)} · ${p.user.username}`).join('\n')}\n> There ${actual === 1 ? 'is' : 'are'} **${actual}** × ${FACES[bid.face]} (counting 1s). The bid was ${bid.count}. **${actual >= bid.count ? `${bidder.user.username} told the truth` : `${bidder.user.username} was lying`}!**`;
            acted = true;
          } else {
            const [, c, f] = BID.exec(m.content.trim());
            const next = { count: Number(c), face: Number(f) };
            if (next.face === 1) { m.reply('1s are wild, so bid on 2–6.').catch(() => {}); continue; }
            if (next.count < 1 || next.count > total) { m.reply(`Bid between 1 and ${total} dice.`).catch(() => {}); continue; }
            if (!isHigher(next, bid)) { m.reply(`Too low. Raise the count, or keep ${bid.count} and pick a higher face.`).catch(() => {}); continue; }
            bid = next; bidder = cur; acted = true;
            m.react?.('🎲').catch(() => {});
          }
        }
        if (!acted) { loser = cur; reveal = `### ⌛ ${cur.user.username} ran out of time`; }
        i++;
      }
      loser.dice--;
      await channel.send(`${reveal}\n> 💀 **${loser.user.username}** loses a die${loser.dice ? ` (${loser.dice} left)` : ' and is **out**!'}`);
      starter = loser.dice > 0 ? loser : table[(table.indexOf(loser) + 1) % table.length];
    }

    const champ = players.find((p) => p.dice > 0);
    if (bet) for (const p of players) { eco.settle(p.user.id, bet, p === champ ? pot : 0); settled.add(p.user.id); }
    else eco.add(champ.user.id, FREE_PRIZE);
    await channel.send(`# 🏆 ${champ.user.username} wins Liar's Dice!\n-# +${eco.fmt(bet ? pot - bet : FREE_PRIZE)}`);
  } finally {
    for (const p of players) {
      busy.delete(p.user.id);
      if (bet && !settled.has(p.user.id)) eco.settle(p.user.id, bet, bet); // cancelled or crashed: refund
    }
  }
}

module.exports = {
  name: 'liarsdice',
  aliases: ['ld', 'liars'],
  usage: 'liarsdice [buy-in]',
  description: "Liar's Dice: secret dice by DM, bluff about what's on the table, call liar (2–6 players, optional buy-in).",
  async run({ client, message, args }) {
    return party.host(message, NAME, (track) => play(client, message, args, track));
  },
  internals: { countFace, isHigher },
};
