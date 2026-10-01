// Reminders are saved to disk so they still fire after a restart.
const { data, save } = require('./db');

const timers = new Map();
let client = null;

async function fire(r) {
  timers.delete(r.id);
  data.reminders = data.reminders.filter((x) => x.id !== r.id);
  save();
  const channel = client.channels.cache.get(r.channelId) ?? (await client.channels.fetch(r.channelId).catch(() => null));
  channel?.send(`⏰ <@${r.userId}> reminder: ${r.text}`).catch(() => {});
}

function schedule(r) {
  // setTimeout caps at ~24.8 days; reminders are limited to 7d so this is fine.
  timers.set(r.id, setTimeout(() => fire(r), Math.max(0, r.at - Date.now())));
}

function start(c) {
  client = c;
  for (const r of data.reminders) if (!timers.has(r.id)) schedule(r);
}

function add({ userId, channelId, text, at }) {
  const r = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, userId, channelId, text, at };
  data.reminders.push(r);
  save();
  if (client) schedule(r);
  return r;
}

function listFor(userId) {
  return data.reminders.filter((r) => r.userId === userId).sort((a, b) => a.at - b.at);
}

function cancel(userId, index) {
  const r = listFor(userId)[index];
  if (!r) return null;
  clearTimeout(timers.get(r.id));
  timers.delete(r.id);
  data.reminders = data.reminders.filter((x) => x.id !== r.id);
  save();
  return r;
}

module.exports = { start, add, listFor, cancel };
