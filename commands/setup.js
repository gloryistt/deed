const onboarding = require('../lib/onboarding');
const { card } = require('../lib/format');
const prefixes = require('../lib/prefix');
const defaults = require('../lib/config');

module.exports = [
  {
    name: 'setup',
    aliases: ['activate', 'start'],
    worksWhenInactive: true,
    usage: 'setup',
    description: 'Activate Deed in this group chat (one GC per person).',
    async run({ client, message, config }) {
      const p = config.prefix;
      const ch = message.channel;
      const existing = onboarding.activationFor(ch.id);
      if (existing || config.allowedGroups.includes(ch.id)) {
        return message.reply(`✅ I'm already active here${existing ? ` (set up by <@${existing.by}>)` : ''}. Try \`${p}help\`!`);
      }

      const otherGc = onboarding.activeGcOf(message.author.id);
      if (otherGc && !config.isAdmin(message.author.id, client)) {
        const other = client.channels.cache.get(otherGc);
        return message.reply(card({
          title: 'You already have a GC', emoji: '⛔',
          body: [
            `You activated me in **${other?.name ?? 'another group chat'}**.`,
            'Each person can only use me in **one** group chat.',
          ],
          footer: `run ${p}deactivate in that GC first to move me here`,
        }));
      }

      onboarding.activate(ch, message.author.id, client.user.id);
      const owner = ch.ownerId === client.user.id;
      await message.channel.send(card({
        title: 'Deed is live! 🎉', emoji: '🚀',
        body: [
          `Activated by **${message.author.username}** for **${ch.name ?? 'this group chat'}**.`,
          '',
          `🎮 \`${p}help\` shows every command`,
          `🪙 \`${p}daily\` grabs free coins to gamble with`,
          `🎵 \`${p}play <song>\` starts music in the GC call`,
          '',
          owner
            ? '👑 I\'m the GC owner, so every command is unlocked.'
            : `👑 **Make me GC owner** to unlock \`remove\`. ${onboarding.OWNER_HOWTO}`,
        ],
        footer: 'each person can activate Deed in one GC',
      }));
    },
  },
  {
    name: 'prefix',
    usage: 'prefix [new prefix | reset]',
    description: 'Show or change the command prefix for this GC (whoever ran setup, or an admin).',
    async run({ client, message, args, config }) {
      const current = config.prefix;
      if (!args[0]) {
        return message.reply(`My prefix here is \`${current}\`\n-# change it with \`${current}prefix <new>\` · @mentioning me always works too`);
      }
      const act = onboarding.activationFor(message.channel.id);
      if (!config.isAdmin(message.author.id, client) && act?.by !== message.author.id) {
        return message.reply(`Only ${act ? `<@${act.by}> (who set me up)` : 'an admin'} can change the prefix.`);
      }
      const next = args[0].toLowerCase() === 'reset' ? defaults.prefix : args[0];
      if (args.length > 1 || !prefixes.isValid(next)) {
        return message.reply('Prefix must be 1–5 characters with no spaces (and none of `` ` * _ ~ | < > @ # \\ ``).');
      }
      prefixes.set(message.channel.id, next);
      await message.channel.send(`### ⌨️ Prefix changed\n> \`${current}\` → **\`${next}\`**\n-# try \`${next}help\` · @mentioning me always works too`);
    },
  },
  {
    name: 'deactivate',
    aliases: ['unsetup'],
    usage: 'deactivate',
    description: 'Turn Deed off in this GC, freeing your one-GC slot.',
    async run({ client, message, config }) {
      const act = onboarding.activationFor(message.channel.id);
      if (!act) return message.reply("I'm not activated here through setup.");
      if (act.by !== message.author.id && !config.isAdmin(message.author.id, client)) {
        return message.reply(`Only <@${act.by}> (who set me up) can deactivate me here.`);
      }
      onboarding.deactivate(message.channel.id);
      await message.channel.send(`### 👋 Deed deactivated\n-# run \`${config.prefix}setup\` to turn me back on`);
    },
  },
];
