// Snipe logs: recently deleted messages, edits, and removed reactions per GC.
// Kept in memory only (never written to disk), last 10 per GC, expire after an hour.
const onboarding = require('./onboarding');

const MAX = 10;
const TTL = 60 * 60 * 1000;
const logs = { deleted: new Map(), edited: new Map(), reactions: new Map() };

function push(kind, channelId, entry) {
  const list = logs[kind].get(channelId) ?? [];
  list.unshift({ ...entry, at: Date.now() });
  logs[kind].set(channelId, list.slice(0, MAX));
}

function get(kind, channelId, index = 0) {
  const list = (logs[kind].get(channelId) ?? []).filter((e) => Date.now() - e.at < TTL);
  logs[kind].set(channelId, list);
  return { entry: list[index] ?? null, total: list.length };
}

function clear(channelId) {
  for (const map of Object.values(logs)) map.delete(channelId);
}

const tracked = (channel, client) => channel?.type === 'GROUP_DM' && onboarding.isActive(channel);

function register(client) {
  client.on('messageDelete', (m) => {
    if (m.partial || !tracked(m.channel, client) || m.author?.id === client.user.id) return;
    if (!m.content && !m.attachments?.size) return;
    push('deleted', m.channel.id, {
      author: m.author, content: m.content,
      attachments: [...(m.attachments?.values() ?? [])].map((a) => a.url),
      sentAt: m.createdTimestamp,
    });
  });

  client.on('messageUpdate', (before, after) => {
    if (before.partial || !tracked(after.channel, client) || after.author?.id === client.user.id) return;
    if (!before.content || before.content === after.content) return;
    push('edited', after.channel.id, { author: after.author, before: before.content, after: after.content, url: after.url });
  });

  client.on('messageReactionRemove', (reaction, user) => {
    const m = reaction.message;
    if (!tracked(m.channel, client) || user.id === client.user.id) return;
    push('reactions', m.channel.id, { user, emoji: reaction.emoji.toString(), messageAuthor: m.author, messageContent: m.content, url: m.url });
  });
}

module.exports = { register, get, clear, push };
