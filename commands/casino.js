const eco = require('../lib/economy');
const { resolveUser, pick, randInt, shuffle, awaitReply, confirm } = require('../lib/util');
const { card, color } = require('../lib/format');

const { busy, betOrUsage, result } = require('../lib/bets');

// ---------- Blackjack ----------
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const newDeck = () => shuffle(SUITS.flatMap((s) => RANKS.map((r) => ({ r, s }))));

function handValue(hand) {
  let total = 0, aces = 0;
  for (const { r } of hand) {
    if (r === 'A') { aces++; total += 11; } else total += ['J', 'Q', 'K'].includes(r) ? 10 : Number(r);
  }
  while (total > 21 && aces--) total -= 10;
  return total;
}

// Cards rendered in color: red suits red, black suits white, hidden card gray.
const showCard = ({ r, s }) => color(`[${r}${s}]`, '♥♦'.includes(s) ? 'red' : 'white', true);
const showHand = (hand) => hand.map(showCard).join(' ');

function table(player, dealer, hideHole, name) {
  const d = hideHole ? `${showCard(dealer[0])} ${color('[ ?? ]', 'gray')}` : showHand(dealer);
  const dv = hideHole ? '?' : handValue(dealer);
  return [
    `${color('DEALER', 'pink', true)} ${color(`(${dv})`, 'gray')}`,
    d,
    '',
    `${color(name.toUpperCase(), 'cyan', true)} ${color(`(${handValue(player)})`, handValue(player) > 21 ? 'red' : 'gray')}`,
    showHand(player),
  ];
}

// ---------- Commands ----------
module.exports = [
  {
    name: 'coinflip',
    aliases: ['cf', 'flip'],
    usage: 'coinflip <heads|tails> <bet>',
    description: 'Double or nothing.',
    async run({ message, args }) {
      const side = args[0]?.toLowerCase()?.[0];
      if (!['h', 't'].includes(side)) return message.reply('Usage: `coinflip heads 100`');
      const bet = betOrUsage(message, args[1], 'coinflip heads 100');
      if (!bet) return;
      eco.take(message.author.id, bet);
      const landed = Math.random() < 0.5 ? 'h' : 't';
      const won = landed === side;
      const { balance, net } = eco.settle(message.author.id, bet, won ? bet * 2 : 0);
      await message.reply(`### 🪙 ${landed === 'h' ? 'Heads' : 'Tails'}! ${won ? 'You win 🎉' : 'You lose'}\n${result(net, balance)}`);
    },
  },
  {
    name: 'slots',
    aliases: ['slot'],
    usage: 'slots <bet>',
    description: '3 of a kind = 5x (💎 = 15x, 7️⃣ = 25x), 2 of a kind = 1.5x.',
    async run({ message, args }) {
      const bet = betOrUsage(message, args[0], 'slots 100');
      if (!bet) return;
      // Weighted reel: rare symbols show up less.
      const reel = [...Array(6).fill('🍒'), ...Array(5).fill('🍋'), ...Array(4).fill('🍇'), ...Array(3).fill('🔔'), '💎', '💎', '7️⃣'];
      const spin = [pick(reel), pick(reel), pick(reel)];
      const [a, b, c] = spin;
      let mult = 0;
      if (a === b && b === c) mult = a === '7️⃣' ? 25 : a === '💎' ? 15 : 5;
      else if (a === b || b === c || a === c) mult = 1.5;
      eco.take(message.author.id, bet);
      const { balance, net } = eco.settle(message.author.id, bet, Math.floor(bet * mult));
      const headline = mult >= 15 ? '💥 JACKPOT 💥' : net > 0 ? 'Winner!' : 'No luck';
      await message.reply([
        `### 🎰 ${headline}`,
        '> ╔════════════╗',
        `> ║  ${spin.join('  ')}  ║`,
        '> ╚════════════╝',
        result(net, balance),
      ].join('\n'));
    },
  },
  {
    name: 'dice',
    usage: 'dice <bet>',
    description: 'Roll 2d6 vs Deed. Higher wins.',
    async run({ message, args }) {
      const bet = betOrUsage(message, args[0], 'dice 100');
      if (!bet) return;
      const you = randInt(1, 6) + randInt(1, 6);
      const her = randInt(1, 6) + randInt(1, 6);
      eco.take(message.author.id, bet);
      const returned = you > her ? bet * 2 : you === her ? bet : 0;
      const { balance, net } = eco.settle(message.author.id, bet, returned);
      const verdict = you > her ? 'You win 🎉' : you < her ? 'Deed wins' : 'Tie';
      await message.reply(card({
        title: verdict, emoji: '🎲',
        block: [
          `${color('You ', 'cyan', true)} ${color(String(you).padStart(2), you >= her ? 'green' : 'red', true)}`,
          `${color('Deed', 'pink', true)} ${color(String(her).padStart(2), her >= you ? 'green' : 'red', true)}`,
        ],
      }) + `\n${result(net, balance)}`);
    },
  },
  {
    name: 'blackjack',
    aliases: ['bj', '21'],
    usage: 'blackjack <bet>',
    description: 'Play 21 vs the dealer. Reply hit / stand / double. Blackjack pays 3:2.',
    async run({ message, args }) {
      const uid = message.author.id;
      let bet = betOrUsage(message, args[0], 'blackjack 100');
      if (!bet) return;
      busy.add(uid);
      eco.take(uid, bet);
      try {
        const deck = newDeck();
        const player = [deck.pop(), deck.pop()];
        const dealer = [deck.pop(), deck.pop()];
        const name = message.author.username;
        const finish = async (returned, text) => {
          const { balance, net } = eco.settle(uid, bet, returned);
          await message.channel.send(card({ title: text, emoji: '🃏', block: table(player, dealer, false, name) }) + `\n${result(net, balance)}`);
        };

        const pBJ = handValue(player) === 21, dBJ = handValue(dealer) === 21;
        if (pBJ || dBJ) {
          if (pBJ && dBJ) return finish(bet, 'Double blackjack, push');
          if (pBJ) return finish(Math.floor(bet * 2.5), 'BLACKJACK! 🎉');
          return finish(0, 'Dealer has blackjack');
        }

        let first = true;
        while (handValue(player) < 21) {
          const canDouble = first && eco.balance(uid) >= bet;
          await message.channel.send(card({
            title: `Blackjack · 🪙 ${bet.toLocaleString()}`, emoji: '🃏',
            block: table(player, dealer, true, name),
            footer: `${name}: type hit · stand${canDouble ? ' · double' : ''} (60s)`,
          }));
          const reply = await awaitReply(message.channel, (m) => m.author.id === uid && /^(h|hit|s|stand|d|double)$/i.test(m.content.trim()), 60000);
          const move = reply?.content.trim()[0].toLowerCase() ?? 's'; // timeout = stand
          if (move === 's') break;
          if (move === 'd') {
            if (!canDouble) { await message.channel.send("You can't double now."); continue; }
            eco.take(uid, bet);
            bet *= 2;
            player.push(deck.pop());
            break;
          }
          player.push(deck.pop());
          first = false;
        }

        const pv = handValue(player);
        if (pv > 21) return finish(0, 'Bust! 💥');
        while (handValue(dealer) < 17) dealer.push(deck.pop());
        const dv = handValue(dealer);
        if (dv > 21) return finish(bet * 2, 'Dealer busts, you win! 🎉');
        if (pv > dv) return finish(bet * 2, 'You win! 🎉');
        if (pv < dv) return finish(0, 'Dealer wins');
        return finish(bet, 'Push 🤝');
      } finally {
        busy.delete(uid);
      }
    },
  },
  {
    name: 'duel',
    aliases: ['bet'],
    usage: 'duel <@user> <bet>',
    description: 'Challenge someone to a 50/50 coin duel. Winner takes both bets.',
    async run({ client, message, args }) {
      const a = message.author;
      const b = await resolveUser(client, message, args[0]);
      if (!b || b.id === a.id) return message.reply('Duel who?');
      const bet = betOrUsage(message, args[1], 'duel @user 100');
      if (!bet) return;
      if (busy.has(b.id)) return message.reply(`${b.username} is in another game.`);
      if (eco.balance(b.id) < bet) return message.reply(`${b.username} only has ${eco.fmt(eco.balance(b.id))}.`);

      busy.add(a.id); busy.add(b.id);
      try {
        await message.channel.send(card({
          title: 'Duel challenge', emoji: '⚔️',
          body: [`**${a.username}** vs **${b.username}**`, `Stakes: **🪙 ${bet.toLocaleString()}** each`],
          footer: `${b.username}: type accept or decline (30s)`,
        }));
        if (!(await confirm(message.channel, b))) return message.channel.send(`${b.username} chickened out. 🐔`);
        if (eco.balance(a.id) < bet || eco.balance(b.id) < bet) return message.channel.send('Someone no longer has enough coins. Duel off.');

        eco.take(a.id, bet); eco.take(b.id, bet);
        const [winner, loser] = Math.random() < 0.5 ? [a, b] : [b, a];
        eco.settle(winner.id, bet, bet * 2);
        eco.settle(loser.id, bet, 0);
        await message.channel.send(`### ⚔️ ${winner.username} wins the duel!\n> Swords clash… ${loser.username} falls.\n> **+🪙 ${bet.toLocaleString()}** to ${winner.username}`);
      } finally {
        busy.delete(a.id); busy.delete(b.id);
      }
    },
  },
];
