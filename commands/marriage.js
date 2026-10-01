// Marriage: propose with a ring, see your marriage, divorce.
const eco = require('../lib/economy');
const items = require('../lib/items');
const { data, save } = require('../lib/db');
const { resolveUser, confirm } = require('../lib/util');
const { card } = require('../lib/format');

data.marriages ??= {}; // userId -> { partner, since, ring }

const spouseOf = (userId) => data.marriages[userId] ?? null;
const ringsOwned = (userId) => Object.entries(items.SHOP).filter(([id, it]) => it.type === 'ring' && items.count(userId, id) > 0)
  .sort(([, a], [, b]) => b.tier - a.tier);

function days(ms) {
  const d = Math.floor(ms / 864e5);
  return d === 0 ? 'today' : `${d} day${d === 1 ? '' : 's'}`;
}

module.exports = [
  {
    name: 'marry',
    aliases: ['propose'],
    usage: 'marry <@user> [ring]',
    description: 'Propose with a ring from the shop. They type accept or decline.',
    async run({ client, message, args, config }) {
      const a = message.author;
      const b = await resolveUser(client, message, args[0]);
      if (!b || b.id === a.id) return message.reply('Marry who? `marry @user`');
      if (spouseOf(a.id)) return message.reply(`You're already married to <@${spouseOf(a.id).partner}>. 👀`);
      if (spouseOf(b.id)) return message.reply(`${b.username} is already married.`);

      const owned = ringsOwned(a.id);
      const wanted = args[1] ? items.findId(items.SHOP, args.slice(1).join(' ')) : owned[0]?.[0];
      if (!owned.length) return message.reply(`💍 You need a ring first. Check \`${config.prefix}shop\`.`);
      if (!wanted || !items.count(a.id, wanted)) return message.reply("You don't own that ring.");
      const ring = items.SHOP[wanted];

      await message.channel.send(card({
        title: `${a.username} is proposing!`, emoji: ring.emoji,
        body: [`💞 **${a.username}** gets down on one knee in front of <@${b.id}>…`, `with a **${ring.name}**`],
        footer: `${b.username}: type accept or decline (60s)`,
      }));
      if (!(await confirm(message.channel, b, 60000))) return message.channel.send(`### 💔 ${b.username} said no\n-# the ring is still yours`);
      if (spouseOf(a.id) || spouseOf(b.id) || !items.remove(a.id, wanted)) return message.channel.send('Something changed. The proposal is off.');

      const since = Date.now();
      data.marriages[a.id] = { partner: b.id, since, ring: wanted };
      data.marriages[b.id] = { partner: a.id, since, ring: wanted };
      save();
      await message.channel.send([
        `## 💒 ${a.username} & ${b.username} are married!`,
        `> ${ring.emoji} ${ring.name} · 💐 congratulations!`,
        '-# married couples get a daily bonus · see `marriage`',
      ].join('\n'));
    },
  },
  {
    name: 'marriage',
    aliases: ['spouse', 'partner', 'married'],
    usage: 'marriage [@user]',
    description: 'Who someone is married to and for how long.',
    async run({ client, message, args }) {
      const user = (await resolveUser(client, message, args[0])) ?? message.author;
      const m = spouseOf(user.id);
      if (!m) return message.reply(`💔 ${user.username} isn't married.`);
      const partner = await client.users.fetch(m.partner).catch(() => null);
      const ring = items.SHOP[m.ring];
      await message.channel.send(card({
        title: `${user.username} 💞 ${partner?.username ?? 'someone'}`, emoji: '💍',
        body: [
          `📅 Married <t:${Math.floor(m.since / 1000)}:D> · **${days(Date.now() - m.since)}**`,
          `${ring?.emoji ?? '💍'} ${ring?.name ?? 'Ring'}`,
        ],
        footer: `daily bonus +${ring ? ring.tier * 100 : 100} coins for both`,
      }));
    },
  },
  {
    name: 'divorce',
    usage: 'divorce',
    description: 'End your marriage. Asks you to confirm.',
    async run({ client, message }) {
      const m = spouseOf(message.author.id);
      if (!m) return message.reply("You're not married.");
      const partner = await client.users.fetch(m.partner).catch(() => null);
      await message.reply(`### 💔 Divorce ${partner?.username ?? 'your partner'}?\n-# type yes to confirm (30s)`);
      if (!(await confirm(message.channel, message.author, 30000))) return message.channel.send('Divorce cancelled. 💞');
      delete data.marriages[message.author.id];
      delete data.marriages[m.partner];
      save();
      await message.channel.send(`### 💔 ${message.author.username} and ${partner?.username ?? 'their partner'} are divorced\n-# married for ${days(Date.now() - m.since)}`);
    },
  },
];

// Daily bonus for married users (used by the daily command).
module.exports.marriageBonus = (userId) => {
  const m = spouseOf(userId);
  return m ? (items.SHOP[m.ring]?.tier ?? 1) * 100 : 0;
};
