// Routes direct messages sent to Deed.
//   1. Games waiting for a player's private input (awaitDM) get first dibs.
//   2. Otherwise, registered handlers run in order (e.g. the welcome message).
// Deed never opens a DM itself here: players message first, Deed only replies,
// which avoids Discord's captcha on bot-started DMs.

const waiters = []; // { userId, filter, hint, resolve, timer }
const handlers = [];
// Players in a DM-based game. A DM that arrives while no round is waiting (e.g. right between
// rounds) is held for a few seconds and handed to the next round instead of being dropped.
const expecting = new Set();
const buffered = new Map(); // userId -> { message, at }
const BUFFER_MS = 30000;

const expect = (userId) => expecting.add(userId);
function unexpect(userId) {
  expecting.delete(userId);
  buffered.delete(userId);
}

function remove(w) {
  const i = waiters.indexOf(w);
  if (i !== -1) waiters.splice(i, 1);
  clearTimeout(w.timer);
}

// Wait for `userId` to DM something matching `filter`. Resolves the message, or null on timeout.
// If they DM something that doesn't match, they're told `hint` instead.
function awaitDM(userId, filter, time, hint) {
  const held = buffered.get(userId);
  buffered.delete(userId);
  if (held && Date.now() - held.at < BUFFER_MS && filter(held.message)) return Promise.resolve(held.message);
  return new Promise((resolve) => {
    const w = { userId, filter, hint, resolve };
    w.timer = setTimeout(() => { remove(w); resolve(null); }, time);
    waiters.push(w);
  });
}

const isWaiting = (userId) => waiters.some((w) => w.userId === userId);

function cancelFor(userId) {
  for (const w of waiters.filter((x) => x.userId === userId)) { remove(w); w.resolve(null); }
}

function onDM(handler) {
  handlers.push(handler);
}

async function route(client, message) {
  if (message.channel.type !== 'DM' || message.author.id === client.user.id || message.author.bot) return false;

  const mine = waiters.filter((w) => w.userId === message.author.id);
  const match = mine.find((w) => w.filter(message));
  if (match) {
    remove(match);
    match.resolve(message);
    return true;
  }
  if (mine.length) {
    await message.channel.send(mine[0].hint ?? "That's not a valid move.").catch(() => {});
    return true;
  }
  if (expecting.has(message.author.id)) {
    buffered.set(message.author.id, { message, at: Date.now() });
    return true;
  }

  for (const h of handlers) {
    if (await h(client, message)) return true;
  }
  return false;
}

module.exports = { awaitDM, isWaiting, cancelFor, onDM, route, expect, unexpect };
