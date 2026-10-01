const snipe = require('../lib/snipe');
const onboarding = require('../lib/onboarding');
const prefixes = require('../lib/prefix');
const { resolveUser } = require('../lib/util');
const { gcMaxMembers } = require('../lib/config');
const { card, color, ansiBlock } = require('../lib/format');
const { WebEmbed, enabled: webEmbeds } = require('../lib/webembed');

const clip = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const ago = (ms) => {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};
const quote = (text) => clip(text || '*(no text)*', 900).split('\n').map((l) => `> ${l}`).join('\n');
const snipeIndex = (arg) => Math.max(0, (parseInt(arg, 10) || 1) - 1);

// ---------- calc: a small safe expression evaluator (no eval of arbitrary code) ----------
const CALC_TOKENS = /\s*(\d+(?:\.\d+)?|\.\d+|\*\*|[-+*/%^(),]|sqrt|cbrt|sin|cos|tan|log|ln|abs|round|floor|ceil|pi|e)\s*/gy;
function calculate(expr) {
  const tokens = [];
  CALC_TOKENS.lastIndex = 0;
  let m;
  while (CALC_TOKENS.lastIndex < expr.length && (m = CALC_TOKENS.exec(expr))) tokens.push(m[1]);
  if (CALC_TOKENS.lastIndex !== expr.length || !tokens.length) throw new Error('only numbers, + - * / % ^ ( ) and sqrt, sin, cos, tan, log, ln, abs, round, pi, e');
  const fns = { sqrt: 'Math.sqrt', cbrt: 'Math.cbrt', sin: 'Math.sin', cos: 'Math.cos', tan: 'Math.tan', log: 'Math.log10', ln: 'Math.log', abs: 'Math.abs', round: 'Math.round', floor: 'Math.floor', ceil: 'Math.ceil', pi: 'Math.PI', e: 'Math.E' };
  const js = tokens.map((t) => (t === '^' ? '**' : fns[t] ?? t)).join(' ');
  // Every token was whitelisted above, so this can only be arithmetic on Math functions.
  const value = Function(`"use strict"; return (${js});`)();
  if (typeof value !== 'number' || Number.isNaN(value)) throw new Error("that doesn't work out to a number");
  return value;
}

// ---------- emoji → image URL ----------
function emojiUrl(raw) {
  const custom = /^<(a?):\w+:(\d+)>$/.exec(raw);
  if (custom) return `https://cdn.discordapp.com/emojis/${custom[2]}.${custom[1] ? 'gif' : 'png'}?size=256`;
  const codepoints = [...raw].map((c) => c.codePointAt(0).toString(16)).filter((c) => c !== 'fe0f');
  if (!codepoints.length || /^[0-9a-f]{1,3}$/.test(codepoints[0]) && codepoints.length === 1) return null;
  return `https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/72x72/${codepoints.join('-')}.png`;
}

module.exports = [
  // ---------------- snipes ----------------
  {
    name: 'snipe',
    aliases: ['sn'],
    usage: 'snipe [#]',
    description: 'Show the last deleted message in this GC (or the #th most recent).',
    async run({ message, args }) {
      const { entry, total } = snipe.get('deleted', message.channel.id, snipeIndex(args[0]));
      if (!entry) return message.reply('🔫 Nothing to snipe.');
      await message.channel.send([
        `### 🔫 ${entry.author.username} deleted`,
        quote(entry.content),
        ...entry.attachments.map((u) => `📎 ${u}`),
        `-# sent ${ago(Date.now() - entry.sentAt)} · deleted ${ago(Date.now() - entry.at)} · ${snipeIndex(args[0]) + 1}/${total}`,
      ].join('\n'));
    },
  },
  {
    name: 'editsnipe',
    aliases: ['es', 'esnipe'],
    usage: 'editsnipe [#]',
    description: 'Show what a message said before it was edited.',
    async run({ message, args }) {
      const { entry, total } = snipe.get('edited', message.channel.id, snipeIndex(args[0]));
      if (!entry) return message.reply('✏️ No edits to snipe.');
      await message.channel.send([
        `### ✏️ ${entry.author.username} edited`,
        '**Before**', quote(entry.before),
        '**After**', quote(entry.after),
        `-# ${ago(Date.now() - entry.at)} · [jump](<${entry.url}>) · ${snipeIndex(args[0]) + 1}/${total}`,
      ].join('\n'));
    },
  },
  {
    name: 'reactsnipe',
    aliases: ['rs', 'rsnipe'],
    usage: 'reactsnipe [#]',
    description: 'Show the last removed reaction.',
    async run({ message, args }) {
      const { entry, total } = snipe.get('reactions', message.channel.id, snipeIndex(args[0]));
      if (!entry) return message.reply('😶 No removed reactions to snipe.');
      await message.channel.send([
        `### ${entry.emoji} ${entry.user.username} unreacted`,
        `> on ${entry.messageAuthor?.username ?? 'a message'}: ${clip(entry.messageContent || '*(no text)*', 200)}`,
        `-# ${ago(Date.now() - entry.at)} · [jump](<${entry.url}>) · ${snipeIndex(args[0]) + 1}/${total}`,
      ].join('\n'));
    },
  },
  {
    name: 'clearsnipe',
    aliases: ['cs'],
    adminOnly: true,
    usage: 'clearsnipe',
    description: 'Wipe the snipe logs for this GC.',
    async run({ message }) {
      snipe.clear(message.channel.id);
      await message.channel.send('### 🧹 Snipe logs cleared');
    },
  },

  // ---------------- users & GC ----------------
  {
    name: 'banner',
    usage: 'banner [@user]',
    description: "Show someone's profile banner.",
    async run({ client, message, args }) {
      const target = (await resolveUser(client, message, args[0])) ?? message.author;
      const user = await client.users.fetch(target.id, { force: true }).catch(() => target);
      const url = user.bannerURL?.({ size: 1024, dynamic: true });
      if (url && webEmbeds()) {
        const embed = new WebEmbed(`${user.globalName ?? user.username}'s banner`, { url, color: user.hexAccentColor ?? '5865f2' })
          .setAuthor(`@${user.username}`).setImage(url, true);
        return message.channel.send(embed.toMessage());
      }
      if (url) return message.channel.send(`### 🖼️ ${user.globalName ?? user.username}'s banner\n${url}`);
      const accent = user.hexAccentColor;
      await message.reply(accent ? `${user.username} has no banner image, just the color **${accent}**.` : `${user.username} doesn't have a banner.`);
    },
  },
  {
    name: 'gcinfo',
    aliases: ['serverinfo', 'si', 'gi'],
    usage: 'gcinfo',
    description: 'Info about this group chat.',
    async run({ client, message }) {
      const ch = message.channel;
      const created = Math.floor(ch.createdTimestamp / 1000);
      const act = onboarding.activationFor(ch.id);
      await message.channel.send(card({
        title: ch.name ?? 'Unnamed group chat', emoji: '👥',
        body: [
          `👑 Owner: <@${ch.ownerId}>`,
          `👤 Members: **${ch.recipients.size + 1}** / ${gcMaxMembers}`,
          `📅 Created <t:${created}:D> (<t:${created}:R>)`,
          act ? `🚀 Set up by <@${act.by}> <t:${Math.floor(act.at / 1000)}:R>` : null,
          `⌨️ Prefix: \`${prefixes.get(ch.id)}\``,
          ch.iconURL?.() ? `🖼️ [icon](<${ch.iconURL({ size: 1024 })}>)` : null,
        ],
        footer: `ID ${ch.id}`,
      }));
    },
  },
  {
    name: 'gcicon',
    aliases: ['icon'],
    usage: 'gcicon',
    description: "Show this GC's icon.",
    async run({ message }) {
      const url = message.channel.iconURL?.({ size: 1024 });
      await message.channel.send(url ? `### 🖼️ ${message.channel.name ?? 'GC'} icon\n${url}` : "This GC doesn't have an icon.");
    },
  },
  {
    name: 'id',
    usage: 'id [@user]',
    description: "Get someone's user ID.",
    async run({ client, message, args }) {
      const user = (await resolveUser(client, message, args[0])) ?? message.author;
      await message.reply(`🆔 **${user.username}**: \`${user.id}\``);
    },
  },
  {
    name: 'enlarge',
    aliases: ['emoji', 'big', 'e'],
    usage: 'enlarge <emoji>',
    description: 'Show an emoji as a big image.',
    async run({ message, args }) {
      const url = args[0] && emojiUrl(args[0]);
      if (!url) return message.reply('Give me an emoji, like `enlarge 🔥`.');
      await message.channel.send(url);
    },
  },

  {
    name: 'embed',
    aliases: ['emb'],
    usage: 'embed <title> | [description] | [hex color] | [image url]',
    description: 'Send a custom embed, e.g. embed Game night | Friday 9pm, bring snacks | ff0000',
    cooldown: 5000,
    async run({ message, args }) {
      if (!webEmbeds()) return message.reply('Web embeds are off until they’re confirmed to work. A bot owner can try `embedtest`.');
      const [title, description = '', rawColor = '', image = ''] = args.join(' ').split('|').map((s) => s.trim());
      if (!title) return message.reply('Usage: `embed <title> | description | color | image url`');
      const colorHex = /^#?[0-9a-f]{6}$/i.test(rawColor) ? rawColor : '5865f2';
      const embed = new WebEmbed(title, { description: description.replace(/\\n/g, '\n'), color: colorHex })
        .setAuthor(message.author.globalName ?? message.author.username);
      if (/^https?:\/\//.test(image)) embed.setImage(image, true);
      await message.channel.send(embed.toMessage());
    },
  },

  {
    name: 'embedtest',
    ownerOnly: true,
    usage: 'embedtest',
    description: 'Send one test web embed (even while they are off) to check how Discord shows it.',
    async run({ message }) {
      const embed = new WebEmbed('Deed embed test', { description: 'If you can see this as an embed with a blue bar and only a tiny "." for the link, web embeds work. Turn them on with WEB_EMBEDS=on.', color: '5865f2' })
        .setAuthor('deed');
      await message.channel.send(embed.toMessage());
    },
  },

  // ---------------- utilities ----------------
  {
    name: 'calc',
    aliases: ['math', 'calculate'],
    usage: 'calc <expression>',
    description: 'Calculator, e.g. calc (5+3)^2 / sqrt(16)',
    async run({ message, args }) {
      const expr = args.join(' ');
      if (!expr) return message.reply('Usage: `calc 2 + 2 * 3`');
      try {
        const value = calculate(expr);
        const shown = Number.isInteger(value) ? value.toLocaleString() : String(+value.toPrecision(12));
        await message.channel.send(ansiBlock([color(clip(expr, 60), 'gray'), `${color('=', 'gray')} ${color(shown, 'green', true)}`]));
      } catch (err) {
        await message.reply(`🧮 Can't calculate that: ${err.message}`);
      }
    },
  },
  {
    name: 'weather',
    aliases: ['w'],
    usage: 'weather <city>',
    description: 'Current weather anywhere.',
    async run({ message, args }) {
      const place = args.join(' ');
      if (!place) return message.reply('Usage: `weather Chicago`');
      const data = await fetch(`https://wttr.in/${encodeURIComponent(place)}?format=j1`, { signal: AbortSignal.timeout(10000) })
        .then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const now = data?.current_condition?.[0];
      if (!now) return message.reply(`Couldn't get weather for **${clip(place, 50)}**.`);
      const area = data.nearest_area?.[0];
      const where = [area?.areaName?.[0]?.value, area?.region?.[0]?.value, area?.country?.[0]?.value].filter(Boolean).join(', ');
      const desc = now.weatherDesc?.[0]?.value ?? '';
      const icon = /thunder/i.test(desc) ? '⛈️' : /snow|sleet|blizzard/i.test(desc) ? '🌨️' : /rain|drizzle|shower/i.test(desc) ? '🌧️'
        : /fog|mist|haze/i.test(desc) ? '🌫️' : /overcast|cloud/i.test(desc) ? (/partly/i.test(desc) ? '⛅' : '☁️') : '☀️';
      const today = data.weather?.[0];
      await message.channel.send(card({
        title: `${where || place}`, emoji: icon,
        body: [`**${desc}**`],
        block: [
          `${color('Temp      ', 'gray')}${color(`${now.temp_F}°F / ${now.temp_C}°C`, 'yellow', true)}`,
          `${color('Feels like', 'gray')}${color(` ${now.FeelsLikeF}°F / ${now.FeelsLikeC}°C`, 'white')}`,
          today ? `${color('High / low', 'gray')}${color(` ${today.maxtempF}° / ${today.mintempF}°F`, 'white')}` : null,
          `${color('Humidity  ', 'gray')}${color(`${now.humidity}%`, 'cyan')}`,
          `${color('Wind      ', 'gray')}${color(`${now.windspeedMiles} mph ${now.winddir16Point}`, 'cyan')}`,
        ].filter(Boolean),
        footer: 'wttr.in',
      }));
    },
  },
  {
    name: 'clean',
    aliases: ['purge', 'clear'],
    adminOnly: true,
    usage: 'clean [count 1-25]',
    description: "Delete Deed's own recent messages (it can't delete other people's in a GC).",
    async run({ client, message, args }) {
      const count = Math.min(25, Math.max(1, parseInt(args[0], 10) || 10));
      const recent = await message.channel.messages.fetch({ limit: 100 });
      const mine = [...recent.values()].filter((m) => m.author.id === client.user.id).slice(0, count);
      for (const m of mine) {
        await m.delete().catch(() => {});
        await new Promise((r) => setTimeout(r, 400)); // gentle pace, avoids rate limits
      }
      const done = await message.channel.send(`🧹 Deleted ${mine.length} of my messages.`);
      setTimeout(() => done.delete().catch(() => {}), 4000);
    },
  },
];

module.exports.internals = { calculate, emojiUrl };
