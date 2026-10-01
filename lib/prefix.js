// Per-GC command prefixes. Falls back to PREFIX from .env.
const { data, save } = require('./db');
const config = require('./config');

data.prefixes ??= {}; // channelId -> prefix

const get = (channelId) => data.prefixes[channelId] ?? config.prefix;

function set(channelId, prefix) {
  if (prefix === config.prefix) delete data.prefixes[channelId];
  else data.prefixes[channelId] = prefix;
  save();
}

// 1–5 visible characters, no spaces, nothing that breaks Discord markdown or mentions.
const isValid = (p) => typeof p === 'string' && /^[^\s`*_~|<>@#\\]{1,5}$/.test(p);

module.exports = { get, set, isValid };
