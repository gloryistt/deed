const eco = require('../lib/economy');
const { resolveUser, randInt, formatDuration } = require('../lib/util');
const { card, color, bar } = require('../lib/format');
const { renderCard } = require('../lib/card');
const { marriageBonus } = require('./marriage');
const { ansiBlock } = require('../lib/format');

const LB_CATEGORIES = {
  coins: { label: 'Net worth', emoji: '💰', value: (id) => eco.netWorth(id), format: (v) => v.toLocaleString() },
  fish: { label: 'Fishdex', emoji: '🎣', value: (id) => Object.keys(eco.account(id).fishdex ?? {}).length, format: (v) => `${v}/22` },
  hunt: { label: 'Animals hunted', emoji: '🏹', value: (id) => eco.account(id).hunts ?? 0, format: (v) => v.toLocaleString() },
  work: { label: 'Shifts worked', emoji: '💼', value: (id) => eco.account(id).career?.shifts ?? 0, format: (v) => v.toLocaleString() },
  streak: { label: 'Daily streak', emoji: '🔥', value: (id) => eco.account(id).streak ?? 0, format: (v) => `${v} days` },
  crypto: { label: 'Crypto portfolio', emoji: '📈', value: (id) => Math.round(require('./crypto').internals.portfolioValue(id)), format: (v) => v.toLocaleString() },
  mystery: { label: 'Mystery wins', emoji: '🔪', value: (id) => eco.data.mmStats?.[id]?.wins ?? 0, format: (v) => v.toLocaleString() },
  gamble: { label: 'Gambling profit', emoji: '🎰', value: (id) => (eco.account(id).won ?? 0) - (eco.account(id).lost ?? 0), format: (v) => `${v >= 0 ? '+' : ''}${v.toLocaleString()}` },
};
const items = require('../lib/items');
const { save } = require('../lib/db');

function memberFor(ms) {
  const h = ms / 36e5;
  if (h < 1) return 'just started';
  if (h < 24) return `${Math.floor(h)}h`;
  const d = Math.floor(h / 24);
  if (d < 60) return `${d} day${d === 1 ? '' : 's'}`;
  return d < 730 ? `${Math.floor(d / 30)} months` : `${Math.floor(d / 365)} years`;
}

const HOUR = 36e5;
const BEG_LIMIT = 100;
const BEG_DONORS = [
  'A kind grandma', 'A guy in a Tesla', 'A confused tourist', 'Elon Musk (allegedly)', 'A pigeon with a coin',
  'Your ex, out of pity', 'A street magician', 'A mysterious man in a trench coat', 'A girl scout', 'A drunk millionaire',
  'Deed, reluctantly', 'A passing ghost', 'The mayor', 'A kid with a lemonade stand',
];


module.exports = [
  {
    name: 'balance',
    aliases: ['bal', 'card', 'profile', 'coins'], // not 'wallet': that's the real crypto wallet lookup
    usage: 'balance [@user] [static]',
    description: 'Your animated profile card: coins, rank, time using Deed, and verified badge.',
    cooldown: 5000,
    async run({ client, message, args }) {
      const user = (await resolveUser(client, message, args.find((a) => a !== 'static'))) ?? message.author;
      const acc = eco.account(user.id);
      const ranked = Object.keys(eco.data.users).sort((a, b) => eco.netWorth(b) - eco.netWorth(a));
      const net = (acc.won ?? 0) - (acc.lost ?? 0);
      const since = eco.data.firstSeen?.[user.id];
      const info = {
        displayName: user.globalName ?? user.username,
        username: user.username,
        avatarUrl: user.displayAvatarURL({ format: 'png', dynamic: false, size: 256 }),
        verified: !!eco.data.verified?.[user.id],
        coins: acc.balance,
        memberFor: since ? memberFor(Date.now() - since) : 'new',
        rank: `#${ranked.indexOf(user.id) + 1} of ${ranked.length}`,
        bank: eco.bank(user.id).bank,
        net: `${net >= 0 ? '+' : '-'}${Math.abs(net).toLocaleString()}`,
        netPositive: net >= 0,
      };
      try {
        await message.channel.sendTyping?.().catch(() => {});
        const { buffer, name } = await renderCard(info, { animated: !args.includes('static') });
        await message.channel.send({ files: [{ attachment: buffer, name }] });
      } catch (err) {
        console.error('[card]', err);
        await message.channel.send(`**${user.username}**${info.verified ? ' ☑️' : ''}: ${eco.fmt(acc.balance)} wallet · 🏦 ${info.bank.toLocaleString()} bank · rank ${info.rank} · net ${info.net}`);
      }
    },
  },
  {
    name: 'verify',
    ownerOnly: true,
    usage: 'verify <@user>',
    description: 'Give someone the blue verified check on their card (bot owners only).',
    async run({ client, message, args }) {
      const user = await resolveUser(client, message, args[0]);
      if (!user) return message.reply('Verify who?');
      eco.data.verified ??= {};
      eco.data.verified[user.id] = { by: message.author.id, at: Date.now() };
      save();
      await message.channel.send(`### ☑️ ${user.username} is now verified\n-# the blue check shows on their \`balance\` card`);
    },
  },
  {
    name: 'unverify',
    ownerOnly: true,
    usage: 'unverify <@user>',
    description: 'Remove someone\'s verified check (bot owners only).',
    async run({ client, message, args }) {
      const user = await resolveUser(client, message, args[0]);
      if (!user || !eco.data.verified?.[user.id]) return message.reply("That user isn't verified.");
      delete eco.data.verified[user.id];
      save();
      await message.channel.send(`### ${user.username} is no longer verified`);
    },
  },
  {
    name: 'daily',
    usage: 'daily',
    description: 'Claim free coins every 24h.',
    async run({ message, config }) {
      const uid = message.author.id;
      const acc = eco.account(uid);
      const last = acc.cooldowns.daily ?? 0;
      const left = eco.useCooldown(uid, 'daily', 24 * HOUR);
      if (left) return message.reply(`Already claimed. Come back in ${formatDuration(left)}.`);
      // Streak: claim again within 48h to keep it. +10% per day, up to +70%.
      acc.streak = Date.now() - last < 48 * HOUR ? (acc.streak ?? 0) + 1 : 1;
      const streakBonus = Math.round(config.dailyAmount * Math.min(acc.streak - 1, 7) * 0.1);
      const loveBonus = marriageBonus(uid);
      const total = config.dailyAmount + streakBonus + loveBonus;
      const bal = eco.add(uid, total);
      await message.reply([
        '### 🎁 Daily claimed!',
        `> **+${total.toLocaleString()}** coins`,
        streakBonus ? `> 🔥 ${acc.streak}-day streak: +${streakBonus}` : `> 🔥 streak started: come back tomorrow for a bonus`,
        loveBonus ? `> 💞 married bonus: +${loveBonus}` : null,
        `-# balance: 🪙 ${bal.toLocaleString()} · come back in 24h (miss 2 days and the streak resets)`,
      ].filter(Boolean).join('\n'));
    },
  },
  {
    name: 'beg',
    usage: 'beg',
    description: 'Broke? Beg for a few coins (only works when your wallet + bank is under 🪙 100).',
    async run({ message }) {
      const uid = message.author.id;
      const worth = eco.netWorth(uid);
      if (worth >= BEG_LIMIT) return message.reply(`🙄 You have 🪙 ${worth.toLocaleString()}. Begging is for people with under 🪙 ${BEG_LIMIT}.\n-# try \`fish\`, \`work\` or \`daily\``);
      const left = eco.useCooldown(uid, 'beg', Number(process.env.BEG_COOLDOWN_MS ?? 5 * 60 * 1000));
      if (left) return message.reply(`🥺 People are avoiding eye contact. Beg again in ${formatDuration(left)}.`);

      const donor = BEG_DONORS[Math.floor(Math.random() * BEG_DONORS.length)];
      const roll = Math.random();
      if (roll < 0.1) return message.reply(`### 🥺 Nobody stopped\n> ${donor} walked right past you.\n-# try again in 5 minutes · \`fish\` is free too`);
      const amount = roll > 0.98 ? 250 : randInt(10, 50);
      const bal = eco.add(uid, amount);
      await message.reply([
        amount === 250 ? '### 🤑 Jackpot handout!' : '### 🥺 Spare change',
        `> ${donor} ${amount === 250 ? 'felt generous and handed you' : 'tossed you'} **🪙 ${amount}**`,
        `-# balance: 🪙 ${bal.toLocaleString()} · beg again in 5 min · \`fish\` pays better`,
      ].join('\n'));
    },
  },
  {
    name: 'rob',
    usage: 'rob <@user>',
    description: 'Try to steal 10–30% of someone\'s coins (40% chance). Fail and you pay them a fine. Padlocks and guard dogs in the shop protect you. (2h cooldown)',
    async run({ client, message, args }) {
      const target = await resolveUser(client, message, args[0]);
      const me = message.author.id;
      if (!target || target.id === me) return message.reply('Rob who?');
      if (eco.balance(target.id) < 100) return message.reply(`${target.username} is too broke to rob.`);
      if (eco.balance(me) < 100) return message.reply('You need at least 🪙 100 to attempt a robbery (for the fine).');
      const left = eco.useCooldown(me, 'rob', 2 * HOUR);
      if (left) return message.reply(`Lay low for ${formatDuration(left)} first.`);
      const robber = message.author.username;
      const payFine = (min, max) => {
        const fine = Math.min(eco.balance(me), randInt(min, max));
        eco.add(me, -fine);
        eco.recordLoss(me, fine);
        eco.add(target.id, fine);
        return fine;
      };

      // Protection: a guard dog blocks everything; a padlock blocks one attempt and breaks.
      if (items.guardLeft(target.id)) {
        const fine = payFine(100, 250);
        return message.channel.send(`### 🐕 Chased off!\n> <@${target.id}>'s guard dog caught **${robber}** climbing through the window.\n> ${robber} paid **🪙 ${fine}** in vet bills.\n-# guard dog on duty for ${formatDuration(items.guardLeft(target.id))}`);
      }
      if (items.remove(target.id, 'padlock')) {
        const fine = payFine(50, 150);
        return message.channel.send(`### 🔒 Locked out!\n> **${robber}** couldn't crack <@${target.id}>'s padlock and got spotted.\n> ${robber} paid **🪙 ${fine}** in damages. The padlock broke.\n-# ${items.count(target.id, 'padlock')} padlock${items.count(target.id, 'padlock') === 1 ? '' : 's'} left`);
      }

      if (Math.random() < Number(process.env.ROB_CHANCE ?? 0.4)) {
        const stolen = Math.floor(eco.balance(target.id) * (randInt(10, 30) / 100));
        eco.add(target.id, -stolen);
        eco.recordLoss(target.id, stolen);
        eco.add(me, stolen);
        return message.channel.send(`### 🦹 Heist successful!\n> **${robber}** robbed <@${target.id}> for **🪙 ${stolen.toLocaleString()}**\n-# protect yourself: \`shop\` → padlock or guard dog`);
      }
      const fine = payFine(50, 150);
      await message.channel.send(`### 🚓 Busted!\n> **${robber}** got caught trying to rob <@${target.id}>\n> and paid them **🪙 ${fine}** in damages.`);
    },
  },
  {
    name: 'give',
    aliases: ['pay'],
    usage: 'give <@user> <amount>',
    description: 'Give coins to someone.',
    async run({ client, message, args }) {
      const target = await resolveUser(client, message, args[0]);
      const amount = eco.parseBet(message.author.id, args[1]);
      if (!target || target.id === message.author.id) return message.reply('Who are you giving to?');
      if (!amount) return message.reply("Invalid amount (or you don't have that much).");
      eco.add(message.author.id, -amount);
      eco.add(target.id, amount);
      await message.channel.send(`### 💸 Transfer\n> **${message.author.username}** → **${target.username}**\n> 🪙 **${amount.toLocaleString()}**`);
    },
  },
  {
    name: 'bank',
    aliases: ['vault'],
    usage: 'bank [@user]',
    description: 'Your wallet, bank, space and interest. Banked coins can’t be robbed.',
    async run({ client, message, config }) {
      const user = message.mentions.users.first() ?? message.author;
      const acc = eco.bank(user.id);
      const fill = acc.bank / acc.bankSpace;
      await message.channel.send(card({
        title: `${user.username}'s bank`, emoji: '🏦',
        block: [
          `${color('Wallet   ', 'gray')}${color(acc.balance.toLocaleString(), 'yellow', true)}`,
          `${color('Bank     ', 'gray')}${color(acc.bank.toLocaleString(), 'green', true)} ${color(`/ ${acc.bankSpace.toLocaleString()}`, 'gray')}`,
          `${color('Space    ', 'gray')}${color(bar(fill, 18), fill >= 1 ? 'red' : 'cyan')} ${color(`${Math.round(fill * 100)}%`, 'white')}`,
          `${color('Interest ', 'gray')}${color(`+${Math.min(500, Math.floor(acc.bank * 0.01)).toLocaleString()}/day`, 'green')}${acc.lastInterest ? color(`  (last: +${acc.lastInterest})`, 'gray') : ''}`,
        ],
        footer: `${config.prefix}deposit · ${config.prefix}withdraw · banked coins are safe from rob · ${config.prefix}buy vault for more space`,
      }));
    },
  },
  {
    name: 'deposit',
    aliases: ['dep', 'd'],
    usage: 'deposit <amount | all | half>',
    description: 'Move coins from your wallet into the bank (safe from robbers).',
    async run({ message, args }) {
      const uid = message.author.id;
      const acc = eco.bank(uid);
      const room = acc.bankSpace - acc.bank;
      if (room <= 0) return message.reply(`🏦 Your bank is full (🪙 ${acc.bankSpace.toLocaleString()}). \`buy vault\` for more space.`);
      const raw = (args[0] ?? '').toLowerCase();
      let amount = raw === 'all' || raw === 'max' ? acc.balance : raw === 'half' ? Math.floor(acc.balance / 2) : eco.parseBet(uid, raw);
      if (!amount || amount <= 0) return message.reply(`Usage: \`deposit <amount|all>\` (wallet: 🪙 ${acc.balance.toLocaleString()})`);
      amount = Math.min(amount, room, acc.balance);
      acc.balance -= amount;
      acc.bank += amount;
      save();
      await message.reply(`### 🏦 Deposited 🪙 ${amount.toLocaleString()}\n> wallet 🪙 ${acc.balance.toLocaleString()} · bank 🪙 ${acc.bank.toLocaleString()} / ${acc.bankSpace.toLocaleString()}${amount === room ? '\n-# bank is now full' : ''}`);
    },
  },
  {
    name: 'withdraw',
    aliases: ['with', 'wd'],
    usage: 'withdraw <amount | all | half>',
    description: 'Take coins out of the bank into your wallet.',
    async run({ message, args }) {
      const uid = message.author.id;
      const acc = eco.bank(uid);
      const raw = (args[0] ?? '').toLowerCase();
      let amount = raw === 'all' || raw === 'max' ? acc.bank : raw === 'half' ? Math.floor(acc.bank / 2)
        : /^\d+(\.\d+)?k$/.test(raw) ? Math.floor(parseFloat(raw) * 1000) : Math.floor(Number(raw));
      if (!Number.isFinite(amount) || amount <= 0) return message.reply(`Usage: \`withdraw <amount|all>\` (bank: 🪙 ${acc.bank.toLocaleString()})`);
      if (amount > acc.bank) return message.reply(`You only have 🪙 ${acc.bank.toLocaleString()} in the bank.`);
      acc.bank -= amount;
      acc.balance += amount;
      save();
      await message.reply(`### 🏦 Withdrew 🪙 ${amount.toLocaleString()}\n> wallet 🪙 ${acc.balance.toLocaleString()} · bank 🪙 ${acc.bank.toLocaleString()}\n-# wallet coins can be robbed`);
    },
  },
  {
    name: 'leaderboard',
    aliases: ['lb', 'top', 'rich'],
    usage: 'leaderboard [coins|fish|hunt|work|streak|gamble] [global]',
    description: 'Top players in this GC (or everyone with "global"). Shows your rank too.',
    async run({ client, message, args, config }) {
      const words = args.map((a) => a.toLowerCase());
      const global = words.includes('global') || words.includes('all');
      const cat = LB_CATEGORIES[words.find((w) => LB_CATEGORIES[w]) ?? 'coins'];

      // Default scope: people in this group chat (plus Deed's own account).
      const members = new Set([client.user.id, ...(message.channel.recipients?.keys() ?? [])]);
      const ids = Object.keys(eco.data.users).filter((id) => global || members.has(id));
      const ranked = ids.map((id) => [id, cat.value(id)]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
      if (!ranked.length) return message.reply(`Nobody here has any ${cat.label.toLowerCase()} yet.`);

      const top = ranked.slice(0, 10);
      const nameOf = async (id) => (client.users.cache.get(id) ?? (await client.users.fetch(id).catch(() => null)))?.username ?? 'unknown';
      const names = await Promise.all(top.map(([id]) => nameOf(id)));
      const width = Math.max(...names.map((n) => n.length), 6);
      const medal = ['🥇', '🥈', '🥉'];
      const lines = top.map(([id, v], i) =>
        `${color(`${String(i + 1).padStart(2)}.`, ['yellow', 'white', 'red'][i] ?? 'gray', i < 3)} ${color(names[i].padEnd(width), id === message.author.id ? 'cyan' : 'white', i < 3)}  ${color(cat.format(v).padStart(10), 'green', true)}`);

      const myIndex = ranked.findIndex(([id]) => id === message.author.id);
      const me = myIndex >= 10 ? `\n-# you're #${myIndex + 1} of ${ranked.length} with ${cat.format(ranked[myIndex][1])}` : myIndex === -1 ? '\n-# you’re not on this board yet' : '';
      await message.channel.send(`### ${medal[0]} ${cat.emoji} ${cat.label} · ${global ? 'everyone' : message.channel.name ?? 'this GC'}\n${ansiBlock(lines)}\n-# ${Object.keys(LB_CATEGORIES).join(' · ')} · add "global" for all GCs${me}`);
    },
  },

];
