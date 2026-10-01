// Texas Hold'em at the group chat table. Everyone buys in with coins, hole cards go out by DM, betting happens
// in the GC. Hands keep going until one player has all the chips, everyone else cashes out, or the host ends it.
const eco = require('../economy');
const party = require('../party');
const poker = require('../poker');
const { awaitReply } = require('../util');
const { card } = require('../format');
const { busy } = require('../bets');

const NAME = "Texas Hold'em";
const T = {
  turn: () => party.env('POKER_TURN_MS', 60000),
  break: () => party.env('POKER_BREAK_MS', 10000),
  maxHands: () => party.env('POKER_MAX_HANDS', 100),
  min: () => party.env('POKER_MIN_PLAYERS', 2),
};
const MIN_BUYIN = 100;
const ACTION = /^(check|call|fold|allin|all-in|all in|(?:raise|bet)\s+\d[\d,]*k?)$/i;
const chipsText = (n) => `🪙 ${n.toLocaleString()}`;
const amount = (s) => { const t = s.replace(/,/g, '').toLowerCase(); return /k$/.test(t) ? Math.floor(parseFloat(t) * 1000) : Number(t); };

async function play(client, message, args, track) {
  const channel = message.channel;
  const buyin = eco.parseBet(message.author.id, args[0]);
  if (!buyin || buyin < MIN_BUYIN) return message.reply(`Usage: \`poker <buy-in>\` (at least ${eco.fmt(MIN_BUYIN)}, you have ${eco.fmt(eco.balance(message.author.id))})`);
  const sb = Math.max(1, Math.floor(buyin / 100));
  const bb = sb * 2;
  const users = await party.lobby(client, message, {
    name: NAME, title: "Texas Hold'em", emoji: '🃏', min: T.min(), max: 8, bet: buyin,
    rules: [`Blinds ${chipsText(sb)} / ${chipsText(bb)}. Your hole cards come by DM, betting happens here.`, 'Cash out between hands and keep whatever chips you have.'],
  });
  if (!users) return;
  track(users);
  const ready = await party.gatherDMs(channel, users, { name: NAME, emoji: '🃏', why: 'Your hole cards are sent there every hand.' });

  const seats = [];
  for (const p of ready) {
    if (eco.balance(p.user.id) < buyin || busy.has(p.user.id)) { await channel.send(`-# ${p.user.username} can’t cover the buy-in anymore and sits out.`); continue; }
    eco.take(p.user.id, buyin);
    busy.add(p.user.id);
    seats.push({ ...p, id: p.user.id, name: p.user.username, chips: buyin, cards: [], timeouts: 0, gone: false });
  }
  const results = []; // finished players: [name, net]
  const cashOut = (s, why) => {
    if (s.gone) return;
    s.gone = true;
    const { net } = eco.settle(s.id, buyin, s.chips);
    busy.delete(s.id);
    party.unlockPlayer(s.id, NAME);
    results.push([s.name, net, why]);
  };

  try {
    if (seats.length < T.min()) {
      await channel.send(`### 🃏 Table closed\n> Need ${T.min()} players who DMed me and can cover ${eco.fmt(buyin)}.\n-# buy-ins refunded`);
      return;
    }
    await channel.send(card({
      title: "Texas Hold'em · the table", emoji: '🃏',
      body: [seats.map((s) => `**${s.name}** ${chipsText(s.chips)}`).join(' · '), `Blinds ${chipsText(sb)} / ${chipsText(bb)}`],
      footer: 'on your turn: check · call · raise <total> · fold · allin',
    }));

    let dealer = 0;
    let stop = false;
    for (let hand = 1; !stop && hand <= T.maxHands(); hand++) {
      const live = seats.filter((s) => !s.gone && s.chips > 0);
      if (live.length < 2) break;
      dealer %= live.length;
      const order = [...live.slice(dealer + 1), ...live.slice(0, dealer + 1)]; // left of the dealer first; dealer last
      for (const s of live) Object.assign(s, { cards: [], folded: false, allIn: false, bet: 0, total: 0, acted: false });
      const deck = poker.newDeck();
      const board = [];
      const pot = () => live.reduce((n, s) => n + s.total, 0);
      const put = (s, n) => {
        const x = Math.min(n, s.chips);
        s.chips -= x; s.bet += x; s.total += x;
        if (!s.chips) s.allIn = true;
        return x;
      };

      // Blinds: heads-up the dealer posts the small blind.
      const [sbSeat, bbSeat] = live.length === 2 ? [order[1], order[0]] : [order[0], order[1]];
      put(sbSeat, sb); put(bbSeat, bb);
      for (const s of live) s.cards = [deck.pop(), deck.pop()];
      for (const s of live) await s.dm.send(`### 🃏 Hand #${hand} · your cards\n> **${poker.cardsText(s.cards)}**\n-# stack ${chipsText(s.chips)}${s === sbSeat ? ' · you posted the small blind' : s === bbSeat ? ' · you posted the big blind' : ''}`).catch(() => {});
      await channel.send(`### 🃏 Hand #${hand}\n> 🔘 Dealer: **${live[dealer].name}** · blinds ${sbSeat.name} ${chipsText(sb)}, ${bbSeat.name} ${chipsText(bb)}\n-# ${live.map((s) => `${s.name} ${chipsText(s.chips + s.total)}`).join(' · ')}`);

      const inHand = () => live.filter((s) => !s.folded);
      const canAct = () => inHand().filter((s) => !s.allIn);

      // One street of betting. `first` = seat that acts first.
      async function street(name, first, preflop) {
        let current = preflop ? bb : 0;
        let minRaise = bb;
        for (const s of live) { s.acted = false; if (!preflop) s.bet = 0; }
        let i = order.indexOf(first);
        for (let guard = 0; guard < 200; guard++) {
          if (inHand().length < 2) return;
          const actors = canAct();
          if (!actors.length) return;
          if (actors.every((s) => s.acted && s.bet === current)) return;
          const s = order[i % order.length];
          i++;
          if (s.folded || s.allIn) continue;
          if (actors.length === 1 && s.bet >= current) return; // everyone else is all-in and they've matched

          const toCall = current - s.bet;
          const minTo = Math.min(current + minRaise, s.bet + s.chips);
          await channel.send([
            `### 🃏 ${s.name} to act · pot ${chipsText(pot())}`,
            `> ${name}${board.length ? `: **${poker.cardsText(board)}**` : ''} · ${toCall ? `to call **${chipsText(Math.min(toCall, s.chips))}**` : 'nothing to call'} · stack ${chipsText(s.chips)}`,
            `-# <@${s.id}>: ${toCall ? '`call` · `fold`' : '`check`'}${s.chips > toCall ? ` · \`raise <total>\` (min ${minTo.toLocaleString()})` : ''} · \`allin\` · ${Math.round(T.turn() / 1000)}s`,
          ].join('\n'));

          let done = false;
          const end = Date.now() + T.turn();
          while (!done && Date.now() < end) {
            const m = await awaitReply(channel, (x) => x.author.id === s.id && ACTION.test(x.content.trim()), end - Date.now());
            if (!m) break;
            const t = m.content.trim().toLowerCase();
            if (t === 'fold') { s.folded = true; done = true; }
            else if (t === 'check') {
              if (toCall) { m.reply(`You can’t check, it’s ${chipsText(toCall)} to call.`).catch(() => {}); continue; }
              done = true;
            } else if (t === 'call') {
              if (!toCall) { done = true; continue; } // calling nothing = checking
              put(s, toCall); done = true;
            } else {
              const allIn = /^all/.test(t);
              const target = allIn ? s.bet + s.chips : amount(t.split(/\s+/)[1]);
              if (!allIn && target > s.bet + s.chips) { m.reply(`You only have ${chipsText(s.chips)} (max raise to ${(s.bet + s.chips).toLocaleString()}).`).catch(() => {}); continue; }
              if (!allIn && target < current + minRaise && target < s.bet + s.chips) { m.reply(`Minimum raise is to ${(current + minRaise).toLocaleString()}.`).catch(() => {}); continue; }
              put(s, target - s.bet);
              if (s.bet > current) {
                minRaise = Math.max(minRaise, s.bet - current);
                current = s.bet;
                for (const o of live) if (o !== s) o.acted = false; // a raise reopens the action
              }
              done = true;
            }
            if (done) m.react?.('✅').catch(() => {});
          }
          if (!done) {
            s.timeouts++;
            if (toCall) s.folded = true;
            await channel.send(`⌛ ${s.name} took too long: **${toCall ? 'fold' : 'check'}**.`);
          } else s.timeouts = 0;
          s.acted = true;
        }
      }

      const firstPost = () => order.find((s) => !s.folded && !s.allIn) ?? order[0];
      const preflopFirst = live.length === 2 ? sbSeat : order[(order.indexOf(bbSeat) + 1) % order.length];
      await street('Preflop', preflopFirst, true);
      for (const [label, n] of [['Flop', 3], ['Turn', 1], ['River', 1]]) {
        if (inHand().length < 2) break;
        for (let k = 0; k < n; k++) board.push(deck.pop());
        if (canAct().length >= 2) {
          await channel.send(`### 🃏 ${label}: **${poker.cardsText(board)}**\n-# pot ${chipsText(pot())}`);
          await street(label, firstPost(), false);
        }
      }
      while (inHand().length > 1 && board.length < 5) board.push(deck.pop()); // everyone's all-in: run it out

      // Pay out.
      const lines = [];
      const players = inHand();
      if (players.length === 1) {
        const w = players[0];
        const won = pot();
        w.chips += won;
        lines.push(`### 🏆 ${w.name} wins ${chipsText(won)}\n> Everyone else folded.`);
      } else {
        const hands = new Map(players.map((s) => [s.id, poker.best([...s.cards, ...board])]));
        lines.push(`### 🃏 Showdown · **${poker.cardsText(board)}**`, ...players.map((s) => `> ${poker.cardsText(s.cards)} · **${s.name}** · ${hands.get(s.id).name}`));
        for (const [k, p] of poker.pots(live).entries()) {
          const eligible = live.filter((s) => p.eligible.includes(s.id));
          const top = eligible.reduce((b, s) => (!b || poker.compare(hands.get(s.id).score, hands.get(b.id).score) > 0 ? s : b), null);
          const winners = eligible.filter((s) => poker.compare(hands.get(s.id).score, hands.get(top.id).score) === 0);
          const share = Math.floor(p.amount / winners.length);
          winners.forEach((w, j) => { w.chips += share + (j === 0 ? p.amount - share * winners.length : 0); });
          const label = k === 0 ? 'Pot' : `Side pot ${k}`;
          lines.push(`> 🏆 ${label} ${chipsText(p.amount)} → **${winners.map((w) => w.name).join(' & ')}**${winners.length > 1 ? ' (split)' : ` · ${hands.get(top.id).name}`}`);
        }
      }
      for (const s of live) if (!s.chips) lines.push(`> 💸 **${s.name}** is out of chips.`);
      await channel.send(lines.join('\n'));
      for (const s of live) if (!s.chips) cashOut(s, 'busted');
      for (const s of live) if (!s.gone && s.timeouts >= 3) { cashOut(s, 'idle'); await channel.send(`-# ${s.name} timed out 3 times and was cashed out.`); }

      // Break: cash out or end the table.
      const remaining = seats.filter((s) => !s.gone && s.chips > 0);
      if (remaining.length < 2) break;
      await channel.send(`-# next hand in ${Math.round(T.break() / 1000)}s · type \`cashout\` to leave with your chips · host: \`endgame\` · ${remaining.map((s) => `${s.name} ${chipsText(s.chips)}`).join(' · ')}`);
      const breakEnd = Date.now() + T.break();
      while (Date.now() < breakEnd) {
        const m = await awaitReply(channel, (x) => /^(cashout|cash out|endgame)$/i.test(x.content.trim()) && seats.some((s) => s.id === x.author.id && !s.gone), breakEnd - Date.now());
        if (!m) break;
        if (/^endgame$/i.test(m.content.trim())) {
          if (m.author.id !== message.author.id) { m.reply('Only the host can end the table.').catch(() => {}); continue; }
          stop = true; break;
        }
        const s = seats.find((x) => x.id === m.author.id);
        cashOut(s, 'cashed out');
        await channel.send(`💰 **${s.name}** cashes out with ${chipsText(s.chips)}.`);
        if (seats.filter((x) => !x.gone).length < 2) break;
      }
      // Button moves to the next player still at the table.
      const next = seats.filter((s) => !s.gone && s.chips > 0);
      const dealerSeat = live[dealer];
      const after = seats.slice(seats.indexOf(dealerSeat) + 1).concat(seats.slice(0, seats.indexOf(dealerSeat) + 1)).find((s) => next.includes(s));
      dealer = Math.max(0, next.indexOf(after));
    }
    for (const s of seats) cashOut(s, 'table closed');
    results.sort((a, b) => b[1] - a[1]);
    await channel.send([
      '### 🃏 Table closed',
      ...results.map(([name, net]) => `> ${net > 0 ? '📈' : net < 0 ? '📉' : '➖'} **${name}** ${net > 0 ? '+' : net < 0 ? '-' : '±'}${chipsText(Math.abs(net))}`),
    ].join('\n'));
  } finally {
    for (const s of seats) if (!s.gone) { eco.settle(s.id, buyin, s.chips); s.gone = true; } // crash: give back whatever they had
    for (const s of seats) busy.delete(s.id);
  }
}

module.exports = {
  name: 'poker',
  aliases: ['holdem', 'texasholdem'],
  usage: 'poker <buy-in>',
  description: "Texas Hold'em: buy in with coins, hole cards by DM, bet in the GC, cash out anytime between hands (2–8 players).",
  async run({ client, message, args }) {
    return party.host(message, NAME, (track) => play(client, message, args, track));
  },
};
