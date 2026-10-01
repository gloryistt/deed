const { data, save } = require('./db');
const config = require('./config');

// Don't repeat the same "X is AFK" notice more than once a minute per channel.
const NOTICE_COOLDOWN_MS = 60000;
const lastNotice = new Map(); // `${channelId}:${userId}` -> timestamp

function set(userId, reason) {
  data.afk[userId] = { reason: reason || null, since: Date.now() };
  save();
}

function ago(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m ago` : `${Math.floor(h / 24)}d ago`;
}

async function handleMessage(message, prefix = config.prefix, client = null) {
  const { author } = message;
  // Ignore the bot account's own messages: its replies ping people, which would
  // otherwise trigger "X is AFK" (and would clear the owner's own AFK).
  if (client && author.id === client.user.id) return;

  const isAfkCommand = message.content.toLowerCase().startsWith(`${prefix}afk`);

  if (data.afk[author.id] && !isAfkCommand) {
    const { since } = data.afk[author.id];
    delete data.afk[author.id];
    save();
    await message.reply(`### 👋 Welcome back, ${author.username}!\n-# AFK removed · you were gone ${ago(Date.now() - since).replace(' ago', '')}`);
  }

  // Mentions include people pinged by a reply, so replying to an AFK person counts too.
  for (const user of message.mentions.users.values()) {
    const entry = data.afk[user.id];
    if (!entry || user.id === author.id) continue;
    const key = `${message.channel.id}:${user.id}`;
    if (Date.now() - (lastNotice.get(key) ?? 0) < NOTICE_COOLDOWN_MS) continue;
    lastNotice.set(key, Date.now());
    const reason = entry.reason && entry.reason !== 'AFK' ? `\n> ${entry.reason}` : '';
    await message.reply(`### 💤 ${user.username} is AFK${reason}\n-# since ${ago(Date.now() - entry.since)}`);
  }
}

module.exports = { set, handleMessage };
