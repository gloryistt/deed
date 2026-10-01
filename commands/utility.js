const afk = require('../lib/afk');
const reminders = require('../lib/reminders');
const eco = require('../lib/economy');
const { data, save } = require('../lib/db');
const { resolveUser, parseDuration, formatDuration } = require('../lib/util');
const { card, color, rows, ansiBlock } = require('../lib/format');
const { WebEmbed, enabled: webEmbeds } = require('../lib/webembed');

const CATEGORY_ORDER = ['setup', 'utility', 'gc', 'economy', 'earn', 'jobs', 'fishing', 'casino', 'stake', 'crypto', 'chain', 'games', 'party',
  'mystery', 'marriage', 'roleplay', 'images', 'lookup', 'tools', 'music', 'stream'];
const clipText = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

const CATEGORY_LABELS = {
  setup: '🚀 Setup', utility: '🛠️ Utility', gc: '👥 Group chat', economy: '💰 Economy', earn: '💸 Earning',
  casino: '🎰 Casino', stake: '💎 Stake Originals', games: '🎮 Games', music: '🎵 Music', lookup: '📚 Lookup', tools: '🧰 Tools', roleplay: '🎭 Roleplay', fishing: '🎣 Fishing & shop', jobs: '💼 Jobs', marriage: '💍 Marriage', images: '🖼️ Images', stream: '📺 Streaming', crypto: '📈 Crypto', chain: '🔗 Blockchain', mystery: '🔪 Murder Mystery', party: '🎉 Party games',
};

function timeIn(tz) {
  return new Date().toLocaleString('en-US', {
    timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

const validTz = (tz) => {
  try { Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
};

const NUMBER_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];

module.exports = [
  {
    name: 'help',
    aliases: ['commands', 'h'],
    worksWhenInactive: true,
    usage: 'help [category | command] [page]',
    description: 'Show categories, a category’s commands, or details for one command.',
    async run({ client, message, args, config }) {
      const p = config.prefix;
      const all = [...new Set(client.commands.values())];
      const groups = {};
      for (const cmd of all) (groups[cmd.category] ??= []).push(cmd);
      const order = [...CATEGORY_ORDER.filter((c) => groups[c]), ...Object.keys(groups).filter((c) => !CATEGORY_ORDER.includes(c))];
      const label = (cat) => CATEGORY_LABELS[cat] ?? cat;
      const query = (args[0] ?? '').toLowerCase().replace(p, '');

      // ,help <category> [page]: that category's commands with descriptions, in one aligned block.
      const cat = query && (order.find((c) => c === query) ?? order.find((c) => label(c).toLowerCase().replace(/[^a-z& ]/g, '').split(/\s+|&/).includes(query)));
      if (cat) {
        const cmds = groups[cat];
        const perPage = 18;
        const pages = Math.ceil(cmds.length / perPage);
        const page = Math.min(Math.max(parseInt(args[1], 10) || 1, 1), pages);
        const slice = cmds.slice((page - 1) * perPage, page * perPage);
        const width = Math.max(...slice.map((c) => c.name.length)) + 2;
        const lines = slice.map((c) => `${color(c.name.padEnd(width), 'cyan', true)}${c.adminOnly || c.ownerOnly ? color('🔒 ', 'gray') : ''}${color(clipText(c.description.replace(/^\S+ (?=\S)/u, (m) => (/\p{Extended_Pictographic}/u.test(m) ? '' : m)), 56), 'white')}`);
        return message.channel.send([
          `### ${label(cat)} · ${cmds.length} command${cmds.length === 1 ? '' : 's'}`,
          ansiBlock(lines),
          `-# ${p}help <command> for details${pages > 1 ? ` · page ${page}/${pages} (${p}help ${cat} ${page < pages ? page + 1 : 1})` : ''}`,
        ].join('\n'));
      }

      // ,help <command>: full details.
      if (query) {
        const cmd = client.commands.get(query);
        if (!cmd) return message.reply(`No command or category called \`${args[0]}\`. Try \`${p}help\`.`);
        const aliases = cmd.aliases?.length ? `\nAliases: ${cmd.aliases.map((a) => `\`${a}\``).join(', ')}` : '';
        return message.channel.send(card({
          title: `${p}${cmd.name}${cmd.adminOnly || cmd.ownerOnly ? ' 🔒' : ''}`,
          emoji: '📖',
          body: [cmd.description, '', `**Usage:** \`${p}${cmd.usage}\``, aliases.trim() || null],
          footer: `Category: ${label(cmd.category)} · ${p}help ${cmd.category} for the rest`,
        }));
      }

      // ,help: one short line per category. Plain command names (no code spans): Discord stops rendering
      // formatting in a message with too many formatted pieces, which is what broke the old menu.
      const line = (c) => {
        const names = groups[c].map((x) => x.name + (x.adminOnly || x.ownerOnly ? '🔒' : ''));
        const shown = names.length > 9 ? `${names.slice(0, 7).join(', ')} +${names.length - 7} more` : names.join(', ');
        return `**${label(c)}** · ${shown}`;
      };
      await message.channel.send([
        '## 🎀 Deed',
        `-# multipurpose group chat companion · ${all.length} commands`,
        '',
        ...order.map(line),
        '',
        `-# ${p}help <category> for descriptions (e.g. ${p}help casino) · ${p}help <command> for details · 🔒 = GC admins / bot owners`,
      ].join('\n'));
    },
  },

  {
    name: 'ping',
    usage: 'ping',
    description: 'Check latency.',
    async run({ client, message }) {
      const start = Date.now();
      const sent = await message.channel.send('Pinging…');
      const rt = Date.now() - start;
      const c = (ms) => (ms < 150 ? 'green' : ms < 400 ? 'yellow' : 'red');
      await sent.edit(card({
        title: 'Pong!', emoji: '🏓',
        block: [`${color('Gateway   ', 'gray')}${color(`${client.ws.ping}ms`, c(client.ws.ping), true)}`, `${color('Round trip', 'gray')}${color(` ${rt}ms`, c(rt), true)}`],
      }));
    },
  },
  {
    name: 'stats',
    aliases: ['uptime', 'botinfo'],
    usage: 'stats',
    description: 'Uptime and usage stats.',
    async run({ client, message }) {
      const mem = (process.memoryUsage().rss / 1024 / 1024).toFixed(0);
      await message.channel.send(card({
        title: 'Deed stats', emoji: '📊',
        block: rows([
          ['Uptime', formatDuration(Date.now() - client.startedAt)],
          ['Commands run', (data.stats.commands ?? 0).toLocaleString()],
          ['Players', String(Object.keys(data.users).length)],
          ['Memory', `${mem} MB`],
          ['Ping', `${client.ws.ping}ms`],
        ], 'pink', 'white'),
        footer: `running as ${client.user.username} · node ${process.version}`,
      }));
    },
  },
  {
    name: 'time',
    usage: 'time [timezone | @user]',
    description: 'Tell the time. e.g. !time Europe/London or !time @friend',
    async run({ message, args, config }) {
      const mentioned = message.mentions.users.first();
      if (mentioned) {
        const tz = data.timezones[mentioned.id];
        if (!tz) return message.reply(`${mentioned.username} hasn't set a timezone (\`${config.prefix}settz\`).`);
        return message.channel.send(`### 🕒 ${timeIn(tz)}\n-# local time for ${mentioned.username} · ${tz}`);
      }
      const tz = args[0] || data.timezones[message.author.id] || config.defaultTimezone;
      if (!validTz(tz)) return message.reply('Unknown timezone. Use names like `America/Chicago` or `Asia/Tokyo`.');
      await message.channel.send(`### 🕒 ${timeIn(tz)}\n-# ${tz}`);
    },
  },
  {
    name: 'settz',
    usage: 'settz <timezone>',
    description: 'Save your timezone so others can !time @you.',
    async run({ message, args }) {
      if (!args[0] || !validTz(args[0])) return message.reply('Give a valid timezone, like `America/Los_Angeles`.');
      data.timezones[message.author.id] = args[0];
      save();
      await message.reply(`Saved your timezone as ${args[0]} (${timeIn(args[0])}).`);
    },
  },
  {
    name: 'afk',
    usage: 'afk [reason]',
    description: 'Go AFK. Cleared when you next talk; people who ping you see the reason.',
    async run({ message, args }) {
      const reason = args.join(' ').slice(0, 200);
      afk.set(message.author.id, reason);
      await message.reply(`### 💤 You're now AFK${reason ? `\n> ${reason}` : ''}\n-# I'll let people know when they ping you · talk again to come back`);
    },
  },
  {
    name: 'remind',
    aliases: ['remindme', 'reminder'],
    usage: 'remind <10m|2h|1d> <text> · remind list · remind cancel <#>',
    description: 'Set a reminder (survives restarts, max 7 days).',
    async run({ message, args }) {
      const uid = message.author.id;
      if (args[0] === 'list') {
        const list = reminders.listFor(uid);
        if (!list.length) return message.reply('You have no reminders.');
        return message.reply(list.map((r, i) => `${i + 1}. in ${formatDuration(r.at - Date.now())}: ${r.text}`).join('\n'));
      }
      if (args[0] === 'cancel') {
        const r = reminders.cancel(uid, Number(args[1]) - 1);
        return message.reply(r ? `Cancelled: ${r.text}` : 'No reminder with that number (see `remind list`).');
      }
      const ms = parseDuration(args[0]);
      const text = args.slice(1).join(' ').slice(0, 300);
      if (!ms || !text) return message.reply('Usage: `remind 30m take the pizza out`');
      if (ms > 7 * 864e5) return message.reply('Max is 7 days.');
      if (reminders.listFor(uid).length >= 10) return message.reply('You already have 10 reminders.');
      reminders.add({ userId: uid, channelId: message.channel.id, text, at: Date.now() + ms });
      await message.reply(`⏰ Got it, I'll remind you in ${formatDuration(ms)}.`);
    },
  },
  {
    name: 'poll',
    usage: 'poll <question> | <option> | <option> ...',
    description: 'Start a reaction poll (2–9 options, or none for yes/no).',
    async run({ message, args }) {
      const [question, ...options] = args.join(' ').split('|').map((s) => s.trim()).filter(Boolean);
      if (!question) return message.reply('Usage: `poll pizza or tacos? | pizza | tacos`');
      if (options.length === 1 || options.length > 9) return message.reply('Give 2–9 options (or none for yes/no).');
      const body = options.length ? options.map((o, i) => `${NUMBER_EMOJI[i]} ${o}`).join('\n') : '👍 yes   👎 no';
      const poll = await message.channel.send(card({
        title: question, emoji: '📊',
        body: body.split('\n'),
        footer: `poll by ${message.author.username} · react to vote`,
      }));
      const emojis = options.length ? NUMBER_EMOJI.slice(0, options.length) : ['👍', '👎'];
      for (const e of emojis) await poll.react(e);
    },
  },
  {
    name: 'avatar',
    aliases: ['av', 'pfp'],
    usage: 'avatar [@user]',
    description: "Show someone's profile picture.",
    async run({ client, message, args }) {
      const user = (await resolveUser(client, message, args[0])) ?? message.author;
      const url = user.displayAvatarURL({ size: 1024, dynamic: true });
      if (!webEmbeds()) return message.channel.send(`### 🖼️ ${user.globalName ?? user.username}\n${url}`);
      const embed = new WebEmbed(`${user.globalName ?? user.username}'s avatar`, { url, color: '5865f2' })
        .setAuthor(`@${user.username}`).setImage(url, true);
      await message.channel.send(embed.toMessage());
    },
  },
  {
    name: 'userinfo',
    aliases: ['whois', 'ui'],
    usage: 'userinfo [@user]',
    description: 'Info about a user.',
    async run({ client, message, args }) {
      const user = (await resolveUser(client, message, args[0])) ?? message.author;
      const acc = eco.account(user.id);
      const tz = data.timezones[user.id];
      const created = Math.floor(user.createdTimestamp / 1000);
      if (webEmbeds()) {
        const lines = [
          `🆔 ${user.id}`,
          `📅 Joined Discord ${user.createdAt.toDateString()}`,
          `🪙 ${acc.balance.toLocaleString()} coins`,
          tz ? `🕒 ${timeIn(tz)} (${tz})` : null,
          data.afk[user.id] ? `💤 AFK: ${data.afk[user.id].reason ?? 'AFK'}` : null,
        ].filter(Boolean);
        const embed = new WebEmbed(user.globalName ?? user.username, { description: lines.join('\n'), color: '5865f2' })
          .setAuthor(`@${user.username}`).setImage(user.displayAvatarURL({ size: 256, dynamic: true }));
        return message.channel.send(embed.toMessage());
      }
      await message.channel.send(card({
        title: user.globalName ?? user.username, emoji: '👤',
        body: [
          `**@${user.username}** · \`${user.id}\``,
          `📅 Joined Discord <t:${created}:D> (<t:${created}:R>)`,
          `🪙 **${acc.balance.toLocaleString()}** coins`,
          tz ? `🕒 ${timeIn(tz)} *(${tz})*` : null,
          data.afk[user.id] ? `💤 AFK: *${data.afk[user.id].reason}*` : null,
        ],
      }));
    },
  },
];
