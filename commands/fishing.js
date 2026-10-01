// Fishing, inventory, shop.
const eco = require('../lib/economy');
const items = require('../lib/items');
const { RARITIES, RARITY_ORDER, RARITY_WEIGHTS, FISH, SHOP } = items;
const { color, ansiBlock } = require('../lib/format');
const { formatDuration } = require('../lib/util');

const FISH_COOLDOWN = () => Number(process.env.FISH_COOLDOWN_MS ?? 30000);
const CAST_MS = () => Number(process.env.FISH_CAST_MS ?? 1500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function weightText(kg) {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)} t`;
  if (kg < 1) return `${Math.round(kg * 1000)} g`;
  return `${kg.toFixed(1)} kg`;
}

function rollFish(luck) {
  // Luck shrinks junk and boosts rare+ tiers, more so the rarer they are:
  // rare ×luck, epic ×luck^1.25, legendary ×luck^1.5, mythic ×luck^1.75.
  const weights = RARITY_ORDER.map((r) => {
    const tier = RARITY_ORDER.indexOf(r) - 3; // rare = 0
    if (r === 'junk') return RARITY_WEIGHTS[r] / luck;
    return RARITY_WEIGHTS[r] * (tier >= 0 ? luck ** (1 + tier * 0.25) : 1);
  });
  let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
  let rarity = RARITY_ORDER.at(-1);
  for (let i = 0; i < weights.length; i++) {
    if ((roll -= weights[i]) < 0) { rarity = RARITY_ORDER[i]; break; }
  }
  const pool = Object.keys(FISH).filter((id) => FISH[id][2] === rarity);
  const id = pool[Math.floor(Math.random() * pool.length)];
  const [, , , , min, max] = FISH[id];
  const sizeRoll = Math.random();
  const kg = min + (max - min) * sizeRoll;
  return { id, kg, sizeRoll };
}


function inventoryValue(userId) {
  const inv = items.user(userId).inv;
  return Object.entries(inv).filter(([id]) => FISH[id]).reduce((sum, [id, n]) => sum + FISH[id][3] * n, 0);
}

module.exports = [
  {
    name: 'fish',
    aliases: ['cast', 'f'],
    usage: 'fish',
    description: 'Cast your line. Better rods and bait catch rarer fish.',
    async run({ message }) {
      const uid = message.author.id;
      const left = eco.useCooldown(uid, 'fish', FISH_COOLDOWN());
      if (left) return message.reply(`🎣 Your line is still tangled. Try again in ${formatDuration(left)}.`);

      const acc = items.user(uid);
      const rod = items.rodOf(uid);
      let luck = rod.luck;
      const usingBait = items.count(uid, 'bait') > 0;
      if (usingBait) { luck *= SHOP.bait.luck; items.remove(uid, 'bait'); }

      const msg = await message.channel.send(`### 🎣 ${message.author.username} casts a line…\n> 🌊 🌊 🌊 🪝 🌊 🌊\n-# ${rod.emoji} ${rod.name}${usingBait ? ' · 🪱 glow bait' : ''}`);
      await sleep(CAST_MS());

      const { id, kg, sizeRoll } = rollFish(luck);
      const [name, emoji, rarity] = FISH[id];
      const r = RARITIES[rarity];
      const isNew = !acc.fishdex[id];
      acc.fishdex[id] = (acc.fishdex[id] ?? 0) + 1;
      items.add(uid, id);
      const value = FISH[id][3];
      const found = Object.keys(acc.fishdex).length;
      const hype = { legendary: ' 🔥🔥', mythic: ' 🌟 MYTHIC CATCH 🌟' }[rarity] ?? '';
      // Top 5% size: trophy bonus paid right away (half the sell price).
      const trophyBonus = sizeRoll > 0.95 ? Math.max(1, Math.round(value / 2)) : 0;
      if (trophyBonus) eco.add(uid, trophyBonus);
      const record = trophyBonus ? color(`  ★ trophy size! +${trophyBonus}`, 'yellow', true) : '';

      await msg.edit([
        `### ${emoji} ${message.author.username} caught ${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}!${hype}`,
        ansiBlock([
          `${color(r.label, r.color, true)}  ${color(weightText(kg), 'white')}${record}`,
          `${color('sells for', 'gray')} ${color(value.toLocaleString(), 'yellow', true)} ${color('coins', 'gray')}`,
        ]),
        `-# ${isNew ? '✨ NEW to your fishdex · ' : ''}fishdex ${found}/${Object.keys(FISH).length} · ${rod.emoji} ${rod.name}${usingBait ? ` · 🪱 ${items.count(uid, 'bait')} bait left` : ''} · \`sell all\` to cash in`,
      ].join('\n'));
    },
  },
  {
    name: 'inventory',
    aliases: ['inv', 'bag'],
    usage: 'inventory [@user]',
    description: 'Your fish, bait, rings and rod.',
    async run({ message }) {
      const user = message.mentions.users.first() ?? message.author;
      const acc = items.user(user.id);
      const fish = Object.entries(acc.inv).filter(([id]) => FISH[id])
        .sort(([a], [b]) => RARITY_ORDER.indexOf(FISH[b][2]) - RARITY_ORDER.indexOf(FISH[a][2]));
      const gear = Object.entries(acc.inv).filter(([id]) => SHOP[id]);
      const rod = items.rodOf(user.id);
      const lines = fish.map(([id, n]) => {
        const [name, emoji, rarity] = FISH[id];
        return `${RARITIES[rarity].emoji} ${emoji} **${name}** ×${n}`;
      });
      await message.channel.send([
        `### 🎒 ${user.username}'s inventory`,
        `> ${rod.emoji} **${rod.name}** equipped`,
        items.guardLeft(user.id) ? `> 🐕 Guard dog on duty for ${formatDuration(items.guardLeft(user.id))}` : null,
        ...gear.map(([id, n]) => `> ${SHOP[id].emoji} ${SHOP[id].name}${SHOP[id].type === 'bait' ? ` (${n} casts)` : ` ×${n}`}`),
        fish.length ? '' : null,
        ...(fish.length ? lines : ['> *no fish yet: try `fish`*']),
        `-# fish worth ~🪙 ${inventoryValue(user.id).toLocaleString()} · \`sell all\``,
      ].filter((l) => l !== null).join('\n'));
    },
  },
  {
    name: 'sell',
    usage: 'sell <all | junk | fish name> [amount]',
    description: 'Sell fish for coins.',
    async run({ message, args }) {
      const uid = message.author.id;
      const acc = items.user(uid);
      const what = args.join(' ').toLowerCase().replace(/\s+\d+$/, '');
      const amount = parseInt(args.at(-1), 10);
      let toSell;
      if (!what || what === 'all') toSell = Object.entries(acc.inv).filter(([id]) => FISH[id]);
      else if (RARITIES[what]) toSell = Object.entries(acc.inv).filter(([id]) => FISH[id]?.[2] === what);
      else {
        const id = items.findId(FISH, what);
        if (!id || !acc.inv[id]) return message.reply(`You don't have any **${what}**. Check \`inventory\`.`);
        toSell = [[id, Number.isInteger(amount) && amount > 0 ? Math.min(amount, acc.inv[id]) : acc.inv[id]]];
      }
      if (!toSell.length) return message.reply('Nothing to sell. Go `fish`!');
      let total = 0, n = 0;
      for (const [id, qty] of toSell) {
        items.remove(uid, id, qty);
        total += FISH[id][3] * qty;
        n += qty;
      }
      const bal = eco.add(uid, total);
      await message.reply(`### 💰 Sold ${n} catch${n === 1 ? '' : 'es'}\n> **+🪙 ${total.toLocaleString()}**\n-# balance: 🪙 ${bal.toLocaleString()}`);
    },
  },
  {
    name: 'fishdex',
    aliases: ['dex', 'collection'],
    usage: 'fishdex [@user]',
    description: 'Every fish you have discovered.',
    async run({ message }) {
      const user = message.mentions.users.first() ?? message.author;
      const dex = items.user(user.id).fishdex;
      const found = Object.keys(dex).length, total = Object.keys(FISH).length;
      const rows = RARITY_ORDER.map((rarity) => {
        const ids = Object.keys(FISH).filter((id) => FISH[id][2] === rarity);
        const cells = ids.map((id) => (dex[id] ? `${FISH[id][1]}×${dex[id]}` : '❔')).join('  ');
        return `${RARITIES[rarity].emoji} **${RARITIES[rarity].label}** ${cells}`;
      });
      const pct = Math.round((found / total) * 100);
      await message.channel.send([
        `### 📖 ${user.username}'s Fishdex · ${found}/${total}`,
        ...rows.map((r) => `> ${r}`),
        ansiBlock([`${color('█'.repeat(Math.round(pct / 5)), 'cyan')}${color('░'.repeat(20 - Math.round(pct / 5)), 'gray')} ${color(`${pct}%`, 'white', true)}`]),
      ].join('\n'));
    },
  },
  {
    name: 'shop',
    aliases: ['store'],
    usage: 'shop',
    description: 'Rods, bait and rings.',
    async run({ message, config }) {
      const section = (type, title) => [
        `**${title}**`,
        ...Object.entries(SHOP).filter(([, it]) => it.type === type)
          .map(([id, it]) => `> ${it.emoji} **${it.name}** · 🪙 ${it.price.toLocaleString()} · \`${id}\`\n> -# ${it.desc}`),
      ];
      await message.channel.send([
        '## 🏪 Deed Shop',
        ...section('rod', '🎣 Rods'),
        ...section('bait', '🪱 Bait'),
        ...section('protection', '🛡️ Robbery protection'),
        ...section('bank', '🏦 Bank'),
        ...section('ring', '💍 Rings'),
        `-# buy with \`${config.prefix}buy <id>\` · you have 🪙 ${eco.balance(message.author.id).toLocaleString()}`,
      ].join('\n'));
    },
  },
  {
    name: 'buy',
    usage: 'buy <item> [amount]',
    description: 'Buy something from the shop.',
    async run({ message, args }) {
      const uid = message.author.id;
      const qty = Math.min(50, Math.max(1, parseInt(args.at(-1), 10) || 1));
      const id = items.findId(SHOP, args.filter((a) => !/^\d+$/.test(a)).join(' '));
      if (!id) return message.reply('Not in the shop. See `shop`.');
      const it = SHOP[id];
      const n = it.type === 'rod' ? 1 : qty;
      if (it.type === 'rod' && items.user(uid).rod === id) return message.reply(`You already have the ${it.name}.`);
      if (it.type === 'rod' && items.rodOf(uid).luck >= it.luck) return message.reply(`Your ${items.rodOf(uid).name} is already better.`);
      const cost = it.price * n;
      if (eco.balance(uid) < cost) return message.reply(`That costs 🪙 ${cost.toLocaleString()}, you have 🪙 ${eco.balance(uid).toLocaleString()}.`);
      eco.add(uid, -cost);
      if (it.type === 'rod') items.user(uid).rod = id;
      else if (id === 'vault') eco.bank(uid).bankSpace += eco.BANK_EXPANSION * n;
      else if (id === 'guarddog') items.user(uid).guardUntil = Date.now() + items.guardLeft(uid) + it.hours * 36e5 * n;
      else items.add(uid, id, it.type === 'bait' ? it.uses * n : n);
      await message.reply(`### 🛍️ Bought ${it.emoji} ${it.name}${n > 1 ? ` ×${n}` : ''}\n> -🪙 ${cost.toLocaleString()}${it.type === 'rod' ? ' · equipped!' : ''}${id === 'guarddog' ? ` · guarding you for ${formatDuration(items.guardLeft(uid))}` : ''}${id === 'vault' ? ` · bank space now 🪙 ${eco.bank(uid).bankSpace.toLocaleString()}` : ''}\n-# balance: 🪙 ${eco.balance(uid).toLocaleString()}`);
    },
  },
];

module.exports.internals = { rollFish };
