// Quick ways to earn coins: pray, hunt, mine, crime, search, hourly, weekly.
const eco = require('../lib/economy');
const { save } = require('../lib/db');
const { pick, randInt, formatDuration } = require('../lib/util');
const { color, ansiBlock } = require('../lib/format');

const MIN = 60 * 1000;
const cd = (name, fallback) => Number(process.env[`${name.toUpperCase()}_COOLDOWN_MS`] ?? fallback);
const coins = (n) => `🪙 ${n.toLocaleString()}`;

// Weighted pick: items are [weight, ...rest].
function weighted(table) {
  let roll = Math.random() * table.reduce((sum, [w]) => sum + w, 0);
  for (const row of table) if ((roll -= row[0]) < 0) return row;
  return table.at(-1);
}

function cooldownOr(message, key, ms, verb) {
  const left = eco.useCooldown(message.author.id, key, ms);
  if (left) message.reply(`⏳ You can ${verb} again in ${formatDuration(left)}.`);
  return left;
}

function pay(message, amount, lines) {
  const bal = eco.add(message.author.id, amount);
  return message.reply([...lines, `-# balance: ${coins(bal)}`].join('\n'));
}

const RARITY_COLOR = { common: 'white', uncommon: 'green', rare: 'blue', epic: 'pink', legendary: 'yellow' };

// [weight, name, emoji, rarity, min, max]
const ANIMALS = [
  [30, 'Rabbit', '🐇', 'common', 5, 20], [25, 'Squirrel', '🐿️', 'common', 5, 18], [20, 'Duck', '🦆', 'common', 8, 25],
  [12, 'Fox', '🦊', 'uncommon', 30, 70], [10, 'Deer', '🦌', 'uncommon', 40, 90], [8, 'Boar', '🐗', 'uncommon', 35, 80],
  [5, 'Wolf', '🐺', 'rare', 120, 220], [4, 'Bear', '🐻', 'rare', 150, 260], [1.5, 'Tiger', '🐅', 'epic', 350, 550],
  [1, 'Lion', '🦁', 'epic', 400, 600], [0.3, 'Unicorn', '🦄', 'legendary', 900, 1200], [0.2, 'Dragon', '🐉', 'legendary', 1000, 1200],
];
const HUNT_MISSES = ['You tripped over a root and scared everything away.', 'A squirrel stole your arrows.', 'You fell asleep in the bushes.'];

const ORES = [
  [40, 'Stone', '🪨', 'common', 10, 25], [25, 'Coal', '⚫', 'common', 20, 40], [15, 'Iron', '⛓️', 'uncommon', 50, 90],
  [10, 'Gold', '🟡', 'rare', 120, 200], [6, 'Emerald', '💚', 'epic', 250, 400], [3, 'Ruby', '❤️', 'epic', 300, 450],
  [1, 'Diamond', '💎', 'legendary', 700, 900],
];

const PLACES = [
  ['couch cushions', 5, 80], ['your car', 10, 120], ['a dumpster', 0, 150], ['the laundromat', 10, 100],
  ["grandma's purse", 30, 200], ['a haunted house', 0, 250], ['the park', 5, 90], ['a vending machine', 5, 60],
  ['under the fridge', 1, 50], ['an old coat pocket', 20, 140],
];

// [past tense (success), present tense (attempt)]
const CRIMES = [
  ['hacked a parking meter', 'hack a parking meter'], ['sold fake concert tickets', 'sell fake concert tickets'],
  ['robbed a lemonade stand', 'rob a lemonade stand'], ['shoplifted a rotisserie chicken', 'shoplift a rotisserie chicken'],
  ['ran an illegal poker night', 'run an illegal poker night'], ['pickpocketed a tourist', 'pickpocket a tourist'],
  ['forged a lottery ticket', 'forge a lottery ticket'], ['smuggled candy into a movie theater', 'smuggle candy into a movie theater'],
];
const CAUGHT = ['a mall cop tackled you', 'you left your ID at the scene', 'your getaway bike had a flat', 'a nosy neighbor called it in'];

const PRAYERS = ['The heavens smile on you.', 'A warm light surrounds you.', 'You feel oddly lucky.', 'Someone up there likes you.'];

module.exports = [
  {
    name: 'pray',
    aliases: ['worship'],
    usage: 'pray',
    description: '🙏 Pray for coins (20 min). Small chance of a divine blessing.',
    async run({ message }) {
      if (cooldownOr(message, 'pray', cd('pray', 20 * MIN), 'pray')) return;
      if (Math.random() < 0.05) {
        return pay(message, 750, ['### ✨ DIVINE BLESSING ✨', `> The clouds part and a golden light shines down on **${message.author.username}**.`, `> **+${coins(750)}**`]);
      }
      const amount = randInt(40, 150);
      return pay(message, amount, [`### 🙏 ${pick(PRAYERS)}`, `> Your prayers were answered: **+${coins(amount)}**`]);
    },
  },
  {
    name: 'hunt',
    usage: 'hunt',
    description: '🏹 Hunt an animal and sell it (1 min). Rarer animals pay more.',
    async run({ message }) {
      if (cooldownOr(message, 'hunt', cd('hunt', MIN), 'hunt')) return;
      if (Math.random() < 0.08) return message.reply(`### 🏹 Nothing\n> ${pick(HUNT_MISSES)}`);
      const [, name, emoji, rarity, min, max] = weighted(ANIMALS);
      const amount = randInt(min, max);
      const acc = eco.account(message.author.id);
      acc.hunts = (acc.hunts ?? 0) + 1;
      save();
      return pay(message, amount, [
        `### ${emoji} You hunted ${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}!${rarity === 'legendary' ? ' 🔥🔥' : ''}`,
        ansiBlock([`${color(rarity.toUpperCase(), RARITY_COLOR[rarity], true)}  ${color('sold for', 'gray')} ${color(amount.toLocaleString(), 'yellow', true)}`]),
      ]);
    },
  },
  {
    name: 'mine',
    aliases: ['dig'],
    usage: 'mine',
    description: '⛏️ Mine for ores (2 min). Diamonds are rare but worth a lot.',
    async run({ message }) {
      if (cooldownOr(message, 'mine', cd('mine', 2 * MIN), 'mine')) return;
      const [, name, emoji, rarity, min, max] = weighted(ORES);
      const chunks = randInt(1, 3);
      const amount = randInt(min, max) * chunks;
      return pay(message, amount, [
        `### ⛏️ You mined ${chunks}× ${emoji} ${name}`,
        ansiBlock([`${color(rarity.toUpperCase(), RARITY_COLOR[rarity], true)}  ${color('sold for', 'gray')} ${color(amount.toLocaleString(), 'yellow', true)}`]),
      ]);
    },
  },
  {
    name: 'crime',
    usage: 'crime',
    description: '🦹 Commit a crime (10 min): 60% big payout, 40% fine.',
    async run({ message }) {
      if (cooldownOr(message, 'crime', cd('crime', 10 * MIN), 'commit a crime')) return;
      if (Math.random() < 0.6) {
        const amount = randInt(150, 450);
        return pay(message, amount, [`### 🦹 Crime pays`, `> You ${pick(CRIMES)[0]} and got away with **${coins(amount)}**`]);
      }
      const fine = Math.min(eco.balance(message.author.id), randInt(50, 200));
      eco.recordLoss(message.author.id, fine);
      return pay(message, -fine, [`### 🚔 Busted`, `> You tried to ${pick(CRIMES)[1]} but ${pick(CAUGHT)}.`, `> Fine: **-${coins(fine)}**`]);
    },
  },
  {
    name: 'search',
    aliases: ['scavenge'],
    usage: 'search',
    description: '🔍 Search a random place for loose coins (3 min).',
    async run({ message }) {
      if (cooldownOr(message, 'search', cd('search', 3 * MIN), 'search')) return;
      const [place, min, max] = pick(PLACES);
      const amount = randInt(min, max);
      if (!amount) return message.reply(`### 🔍 You searched ${place}\n> …and found absolutely nothing.`);
      return pay(message, amount, [`### 🔍 You searched ${place}`, `> Found **${coins(amount)}**!`]);
    },
  },
  {
    name: 'hourly',
    usage: 'hourly',
    description: '⏰ Free coins every hour.',
    async run({ message }) {
      if (cooldownOr(message, 'hourly', cd('hourly', 60 * MIN), 'claim hourly')) return;
      return pay(message, 120, ['### ⏰ Hourly claimed', `> **+${coins(120)}**`]);
    },
  },
  {
    name: 'weekly',
    usage: 'weekly',
    description: '📅 A big payout every 7 days.',
    async run({ message }) {
      if (cooldownOr(message, 'weekly', cd('weekly', 7 * 24 * 60 * MIN), 'claim weekly')) return;
      return pay(message, 3000, ['### 📅 Weekly claimed!', `> **+${coins(3000)}**`]);
    },
  },
];
