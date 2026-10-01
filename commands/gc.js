const { resolveUser } = require('../lib/util');
const { gcMaxMembers } = require('../lib/config');
const { card } = require('../lib/format');
const { OWNER_HOWTO } = require('../lib/onboarding');

module.exports = [
  {
    name: 'add',
    adminOnly: true,
    usage: 'add <@user | id | username>',
    description: 'Add someone to the GC (they must have friended the bot).',
    async run({ client, message, args }) {
      const user = await resolveUser(client, message, args[0]);
      if (!user) return message.reply("Couldn't find that user. They need to send me a friend request first.");
      if (!client.relationships.friendCache.has(user.id)) return message.reply(`**${user.username}** has to send me a friend request before I can add them.`);
      if (message.channel.recipients.has(user.id)) return message.reply(`${user.username} is already here.`);
      if (message.channel.recipients.size + 1 >= gcMaxMembers) return message.reply(`GC is full (${gcMaxMembers} max).`);
      try {
        await message.channel.addUser(user);
      } catch (err) {
        // 30004: Discord's per-account group size cap (10 for Deed's account, even if others' GCs can go higher).
        if (err.code === 30004) return message.reply(`🚫 Discord won't let me add anyone else here: my account can only add people to GCs with fewer than 10 members. Someone else in the GC can add ${user.username} from Discord instead.`);
        if (err.code === 50007 || err.code === 50001) return message.reply(`🚫 Discord won't let me add ${user.username}. Make sure they're on my friends list.`);
        throw err;
      }
      await message.channel.send(`### 👋 Welcome, ${user.username}!\n-# added by ${message.author.username}`);
    },
  },
  {
    name: 'remove',
    aliases: ['kick'],
    adminOnly: true,
    usage: 'remove <@user | id | username>',
    description: 'Remove someone from the GC (the bot must be GC owner).',
    async run({ client, message, args }) {
      if (message.channel.ownerId !== client.user.id) {
        return message.reply(card({
          title: 'I need to be GC owner for that', emoji: '👑',
          body: ['Discord only lets the group owner remove people.', OWNER_HOWTO],
          footer: 'the current owner has to do this',
        }));
      }
      const user = await resolveUser(client, message, args[0]);
      if (!user || !message.channel.recipients.has(user.id)) return message.reply("That user isn't in this GC.");
      await message.channel.removeUser(user);
      await message.channel.send(`### 🚪 ${user.username} was removed\n-# by ${message.author.username}`);
    },
  },
  {
    name: 'rename',
    adminOnly: true,
    usage: 'rename <new name>',
    description: 'Rename the GC.',
    async run({ message, args }) {
      const name = args.join(' ').slice(0, 100);
      if (!name) return message.reply('Give me a name.');
      await message.channel.setName(name);
      await message.channel.send(`### ✏️ GC renamed\n> **${name}**`);
    },
  },
  {
    name: 'members',
    usage: 'members',
    description: 'List everyone in the GC.',
    async run({ client, message }) {
      const ch = message.channel;
      const people = [client.user, ...ch.recipients.values()]
        .map((u) => `${u.id === ch.ownerId ? '👑' : '•'} **${u.globalName ?? u.username}** · @${u.username}`);
      await message.channel.send(card({ title: `${ch.name ?? 'This GC'} · ${people.length}/${gcMaxMembers}`, emoji: '👥', body: people }));
    },
  },
];
