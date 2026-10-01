// Command loading + message routing. Kept separate from index.js so tests can drive it.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const afk = require('./afk');
const onboarding = require('./onboarding');
const prefixes = require('./prefix');
const { data, save } = require('./db');
const { formatDuration } = require('./util');

function loadCommands() {
  const commands = new Map();
  const dir = path.join(__dirname, '..', 'commands');
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith('.js')) continue;
    const category = file.replace('.js', '');
    for (const cmd of [].concat(require(path.join(dir, file)))) {
      cmd.category = category;
      commands.set(cmd.name, cmd);
      for (const alias of cmd.aliases ?? []) commands.set(alias, cmd);
    }
  }
  return commands;
}

const lastUse = new Map(); // `${userId}` and `${userId}:${cmd}` -> timestamp

function checkCooldown(userId, cmd) {
  const now = Date.now();
  if (now - (lastUse.get(userId) ?? 0) < config.cooldownMs) return { silent: true };
  const key = `${userId}:${cmd.name}`;
  const left = (lastUse.get(key) ?? 0) + (cmd.cooldown ?? 0) - now;
  if (left > 0) return { left };
  lastUse.set(userId, now);
  lastUse.set(key, now);
  return null;
}

const inactiveHintAt = new Map(); // channelId -> last time we said "run setup"

async function handleMessage(client, message) {
  if (message.channel.type !== 'GROUP_DM' || message.author.bot) return;
  const active = onboarding.isActive(message.channel);

  const prefix = prefixes.get(message.channel.id);
  if (active) await afk.handleMessage(message, prefix, client).catch((e) => console.error('[afk]', e));

  // Commands start with this GC's prefix, or with an @mention of the bot (so a forgotten prefix never locks you out).
  const content = message.content.trim();
  const mention = new RegExp(`^<@!?${client.user.id}>\\s*`);
  let body;
  if (mention.test(content)) {
    body = content.replace(mention, '');
    if (!body) return message.reply(`My prefix here is \`${prefix}\` · try \`${prefix}help\``).catch(() => {});
  } else if (content.startsWith(prefix)) {
    body = content.slice(prefix.length);
  } else return;
  const args = body.trim().split(/\s+/).filter(Boolean);
  const name = args.shift()?.toLowerCase();
  const cmd = client.commands.get(name);
  if (!cmd) return;

  // Not set up in this GC yet: only setup/help work, and we nudge at most once a minute.
  if (!active && !cmd.worksWhenInactive) {
    if (Date.now() - (inactiveHintAt.get(message.channel.id) ?? 0) < 60000) return;
    inactiveHintAt.set(message.channel.id, Date.now());
    return message.reply(`I'm not active in this GC yet. Run \`${prefix}setup\` first!`).catch(() => {});
  }

  if (cmd.ownerOnly && !config.isAdmin(message.author.id, client)) {
    return message.reply('Only bot owners can use that. 🔒').catch(() => {});
  }
  if (cmd.adminOnly && !config.isAdmin(message.author.id, client) && !onboarding.isGcManager(message.channel, message.author.id)) {
    return message.reply("You can't use that one. 🔒").catch(() => {});
  }
  if (message.author.id !== client.user.id) {
    const cd = checkCooldown(message.author.id, cmd);
    if (cd?.silent) return;
    if (cd) return message.reply(`Slow down, try again in ${formatDuration(cd.left)}.`).catch(() => {});
  }

  data.stats.commands = (data.stats.commands ?? 0) + 1;
  data.firstSeen ??= {};
  data.firstSeen[message.author.id] ??= Date.now(); // "using Deed for …" on profile cards
  save();

  try {
    // Commands see this GC's prefix as config.prefix, so help/usage text always matches.
    await cmd.run({ client, message, args, config: { ...config, prefix } });
  } catch (err) {
    console.error(`[${cmd.name}]`, err);
    message.reply(`Something broke: ${err.message}`).catch(() => {});
  }
}

module.exports = { loadCommands, handleMessage };
