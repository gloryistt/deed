// Shared plumbing for group party games (spyfall, codenames, blanks, liar's dice, poker, heist, mystery):
//   - one party game per GC, and one game per player at a time
//   - a plain-text lobby: people type `join` / `leave`, the host types `start`
//   - the "DM me ready" gate: Deed can't open DMs itself (Discord throws a captcha), so players message
//     first and Deed answers in that DM with their secret info.
const dm = require('./dm');
const eco = require('./economy');
const { awaitReply } = require('./util');
const { card } = require('./format');

const env = (k, d) => Number(process.env[k] ?? d);
const channels = new Map(); // channelId -> game name
const players = new Map(); // userId -> game name

function claimChannel(message, name) {
  const current = channels.get(message.channel.id);
  if (current) {
    message.reply(`A game of **${current}** is already running here.`).catch(() => {});
    return false;
  }
  channels.set(message.channel.id, name);
  return true;
}
const releaseChannel = (channel) => channels.delete(channel.id);
const channelGame = (channel) => channels.get(channel.id) ?? null;

const playingIn = (userId) => players.get(userId) ?? null;
const lockPlayer = (userId, name) => players.set(userId, name);
const unlockPlayer = (userId, name) => { if (!name || players.get(userId) === name) players.delete(userId); };

// Player-written text gets posted by the bot: defuse mass pings and keep it on one line.
const clean = (text, max = 200) => String(text).replace(/@(everyone|here)/gi, '@​$1').replace(/<@&/g, '<@​&')
  .replace(/\s*\n\s*/g, ' / ').trim().slice(0, max);

/**
 * Plain-text lobby. The host is in automatically. Resolves the list of users, or null if it was cancelled.
 *   opts: { name, title, emoji, min, max, bet, rules: [lines], ms }
 */
async function lobby(client, message, { name, title, emoji, min, max, bet = 0, rules = [], ms = env('PARTY_LOBBY_MS', 120000) }) {
  const channel = message.channel;
  const host = message.author;
  const users = [host];
  lockPlayer(host.id, name);
  const text = (note = '') => card({
    title: `${title} · lobby`, emoji,
    body: [
      `Hosted by **${host.username}** · ${users.length}/${max} players (min ${min})${bet ? ` · buy-in **${eco.fmt(bet)}**` : ''}`,
      '',
      ...users.map((u) => `• ${u.username}`),
      '',
      ...rules,
      note || null,
    ],
    footer: `type join · leave · host: start · cancel · starts on its own in ${Math.round(ms / 1000)}s if there are ${min}+`,
  });
  const msg = await channel.send(text());
  const refresh = () => msg.edit(text()).catch(() => {});
  const end = Date.now() + ms;
  const release = () => { for (const u of users) unlockPlayer(u.id, name); };

  while (Date.now() < end) {
    const m = await awaitReply(channel, (x) => /^(join|leave|start|cancel)$/i.test(x.content.trim()) && x.author.id !== client.user.id, end - Date.now());
    if (!m) break;
    const cmd = m.content.trim().toLowerCase();
    const u = m.author;
    const inLobby = users.some((x) => x.id === u.id);
    if (cmd === 'join') {
      if (inLobby) { m.reply("You're already in.").catch(() => {}); continue; }
      if (playingIn(u.id)) { m.reply(`You're already in a game of **${playingIn(u.id)}**.`).catch(() => {}); continue; }
      if (users.length >= max) { m.reply('The lobby is full.').catch(() => {}); continue; }
      if (bet && eco.balance(u.id) < bet) { m.reply(`The buy-in is ${eco.fmt(bet)} and you have ${eco.fmt(eco.balance(u.id))}.`).catch(() => {}); continue; }
      users.push(u);
      lockPlayer(u.id, name);
      m.react?.('✅').catch(() => {});
      refresh();
    } else if (cmd === 'leave') {
      if (!inLobby) continue;
      users.splice(users.findIndex((x) => x.id === u.id), 1);
      unlockPlayer(u.id, name);
      if (u.id === host.id) { release(); await channel.send(`### ${emoji} Lobby closed\n> The host left.`).catch(() => {}); return null; }
      m.react?.('👋').catch(() => {});
      refresh();
    } else if (cmd === 'cancel') {
      if (u.id !== host.id) continue;
      release();
      await channel.send(`### ${emoji} ${title} cancelled`).catch(() => {});
      return null;
    } else if (cmd === 'start') {
      if (u.id !== host.id) { m.reply(`Only the host (${host.username}) can start.`).catch(() => {}); continue; }
      if (users.length < min) { m.reply(`Need at least ${min} players (have ${users.length}).`).catch(() => {}); continue; }
      return users;
    }
  }
  if (users.length >= min) return users;
  release();
  await channel.send(`### ${emoji} ${title} cancelled\n> Not enough players joined (needed ${min}).`).catch(() => {});
  return null;
}

/**
 * Ask every user to DM `ready`. Resolves [{ user, dm }] for those who did (dm = their DM channel).
 * Anyone who doesn't make it is unlocked so they can play something else.
 */
async function gatherDMs(channel, users, { name, emoji, why = 'I’ll send your secret info there.', ms = env('PARTY_READY_MS', 90000) }) {
  await channel.send(card({
    title: 'DM me `ready`', emoji: '📬',
    body: [`Everyone playing: **send me a DM saying \`ready\`** within ${Math.round(ms / 1000)}s.`, why, '', ...users.map((u) => `• ${u.username}`)],
    footer: 'players who don’t DM in time are left out',
  })).catch(() => {});
  const ready = await Promise.all(users.map((user) => dm.awaitDM(user.id, (m) => /^ready\b/i.test(m.content.trim()), ms, '📬 Reply `ready` to join the game.')
    .then(async (m) => {
      if (!m) return null;
      dm.expect(user.id); // later DMs that arrive between prompts are held for the next prompt
      await m.channel.send(`### ✅ You're in!\n> ${emoji} The game starts once everyone is ready. Keep this DM open.`).catch(() => {});
      return { user, dm: m.channel };
    })));
  const missing = users.filter((u, i) => !ready[i]);
  for (const u of missing) unlockPlayer(u.id, name);
  if (missing.length) await channel.send(`-# left out (no DM): ${missing.map((u) => u.username).join(', ')}`).catch(() => {});
  return ready.filter(Boolean);
}

/**
 * Wait for each player's DM matching `filter` (in parallel). onEach(player, message) runs as each arrives.
 * Resolves Map(userId -> message) for those who answered in time.
 */
async function collectDMs(list, filter, ms, hint, onEach) {
  const got = new Map();
  await Promise.all(list.map((p) => dm.awaitDM(p.user.id, filter, ms, hint).then(async (m) => {
    if (!m) return;
    got.set(p.user.id, m);
    await onEach?.(p, m);
  })));
  return got;
}

// Release every lock a game holds. Safe to call twice.
function finish(channel, users, name) {
  if (channels.get(channel.id) === name) channels.delete(channel.id);
  for (const u of users) {
    const id = u.user?.id ?? u.id;
    unlockPlayer(id, name);
    dm.cancelFor(id);
    dm.unexpect(id);
  }
}

// "2", "bob", "@bob", or part of a username -> one of `list` (items are users or { user }).
function findPlayer(list, text) {
  const t = String(text ?? '').trim().toLowerCase().replace(/[<@!>]/g, '');
  if (!t) return null;
  const user = (x) => x.user ?? x;
  if (/^\d+$/.test(t) && t.length < 4 && list[Number(t) - 1]) return list[Number(t) - 1];
  return list.find((x) => user(x).id === t || user(x).username.toLowerCase() === t)
    ?? list.find((x) => user(x).username.toLowerCase().startsWith(t)) ?? null;
}

// Plain-text vote in the GC: each voter types a number (they can change it). Resolves Map(voterId -> index).
async function numberVote(channel, voters, count, ms, { canVote = () => true, onVote } = {}) {
  const votes = new Map();
  const ids = new Set(voters.map((v) => v.id ?? v.user.id));
  const end = Date.now() + ms;
  while (Date.now() < end && votes.size < ids.size) {
    const m = await awaitReply(channel, (x) => ids.has(x.author.id) && /^\d{1,2}$/.test(x.content.trim()), end - Date.now());
    if (!m) break;
    const i = Number(m.content.trim()) - 1;
    if (i < 0 || i >= count) continue;
    const why = canVote(m.author.id, i);
    if (why !== true) { m.reply(why || "You can't vote for that.").catch(() => {}); continue; }
    votes.set(m.author.id, i);
    m.react?.('🗳️').catch(() => {});
    onVote?.(m.author.id, i);
  }
  return votes;
}

// Tally a Map of votes -> [[option, count], ...] sorted by count (desc).
function tally(votes) {
  const counts = new Map();
  for (const v of votes.values()) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/**
 * Run a party game: claims the GC, runs fn(track), and always releases every lock afterwards (even on a crash).
 * Call track(users) with everyone who ends up involved so they get unlocked.
 */
async function host(message, name, fn) {
  if (playingIn(message.author.id)) return message.reply(`You're already in a game of **${playingIn(message.author.id)}**.`).catch(() => {});
  if (!claimChannel(message, name)) return;
  const touched = new Map([[message.author.id, message.author]]);
  const track = (list) => { for (const x of list) touched.set((x.user ?? x).id, x.user ?? x); };
  try {
    await fn(track);
  } catch (err) {
    console.error(`[${name}]`, err);
    await message.channel.send(`⚠️ ${name} crashed: ${err.message}`).catch(() => {});
  } finally {
    finish(message.channel, [...touched.values()], name);
  }
}

module.exports = {
  host, env, claimChannel, releaseChannel, channelGame, playingIn, lockPlayer, unlockPlayer, clean,
  lobby, gatherDMs, collectDMs, finish, findPlayer, numberVote, tally,
};
