// Resolve a user from a mention, an ID, or a username/display name in the GC.
async function resolveUser(client, message, arg) {
  if (!arg) return null;
  const mentioned = message.mentions.users.first();
  if (mentioned) return mentioned;

  const id = arg.replace(/[<@!>]/g, '');
  if (/^\d{15,21}$/.test(id)) return client.users.fetch(id).catch(() => null);

  const q = arg.toLowerCase();
  const pool = [...(message.channel.recipients?.values() ?? []), ...(client.relationships?.friendCache.values() ?? [])];
  return pool.find((u) => u.username.toLowerCase() === q || u.globalName?.toLowerCase() === q) ?? null;
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// "10m", "1h30m", "2d" -> ms. Returns null if unparseable.
function parseDuration(str) {
  const units = { s: 1e3, m: 6e4, h: 36e5, d: 864e5 };
  const parts = [...(str ?? '').toLowerCase().matchAll(/(\d+)\s*([smhd])/g)];
  if (!parts.length || parts.map((p) => p[0]).join('') !== str.toLowerCase().replace(/\s/g, '')) return null;
  return parts.reduce((ms, [, n, u]) => ms + Number(n) * units[u], 0);
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${s % 60}s`].filter(Boolean).slice(0, 2).join(' ');
}

// Wait for the next message in the channel that passes `filter`. Resolves null on timeout.
async function awaitReply(channel, filter, time = 30000) {
  const got = await channel.awaitMessages({ filter, max: 1, time }).catch(() => null);
  return got?.first() ?? null;
}

// Ask `user` to type yes/accept. Returns true if they do in time.
async function confirm(channel, user, time = 30000) {
  const reply = await awaitReply(channel, (m) => m.author.id === user.id && /^(y|yes|accept|no|n|decline)$/i.test(m.content.trim()), time);
  return !!reply && /^(y|yes|accept)$/i.test(reply.content.trim());
}

module.exports = { resolveUser, pick, randInt, shuffle, parseDuration, formatDuration, awaitReply, confirm };
