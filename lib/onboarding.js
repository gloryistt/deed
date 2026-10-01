// New-user flow:
//   1. Someone sends Deed a friend request -> you accept it in the app -> Deed DMs them a welcome + setup steps.
//   2. They add her to a group chat -> she introduces herself there.
//   3. They run !setup in the GC -> it's activated and tied to them (one GC per person).
const { data, save } = require('./db');
const config = require('./config');

data.activations ??= {}; // channelId -> { by: userId, at: timestamp }

const OWNER_HOWTO = 'Open the member list, right-click **Deed**, then **Make Group Owner**.';

const activationFor = (channelId) => data.activations[channelId] ?? null;
const activeGcOf = (userId) => Object.entries(data.activations).find(([, a]) => a.by === userId)?.[0] ?? null;

function isActive(channel) {
  if (config.allowedGroups.includes(channel.id)) return true;
  return !!activationFor(channel.id);
}

function activate(channel, userId, botId) {
  // Remember who owned the GC at setup: they usually hand ownership to Deed afterwards,
  // but should keep their admin powers.
  const owner = channel.ownerId && channel.ownerId !== botId ? channel.ownerId : null;
  data.activations[channel.id] = { by: userId, owner, at: Date.now() };
  save();
}

// GC managers can use 🔒 commands in that GC: whoever ran setup, and the GC's original owner.
function isGcManager(channel, userId) {
  const act = activationFor(channel.id);
  return !!act && (act.by === userId || act.owner === userId);
}

function deactivate(channelId) {
  delete data.activations[channelId];
  save();
}

function welcomeDM(user, p = config.prefix) {
  return [
    `## 🎀 Hey ${user.globalName ?? user.username}, I'm Deed!`,
    '-# games · gambling · music · voice-message transcripts · utilities',
    '',
    '### 🚀 Getting started',
    '> **1.** Add me to your group chat',
    `> **2.** Type \`${p}setup\` in the GC to activate me`,
    `> **3.** Type \`${p}help\` to see everything I can do`,
    '',
    '### 📌 Rules',
    '> • **One group chat per person.** You can only activate me in one GC.',
    `> -# Want me somewhere else? Run \`${p}deactivate\` in the old GC first.`,
    '> • **Some commands need me to be the GC owner** (like `remove`).',
    `> -# ${OWNER_HOWTO}`,
    '> • Anyone you want me to `add` has to send me a friend request first.',
    '',
    '-# thanks for the friend request · reply here anytime with questions',
  ].join('\n');
}

function gcIntro(p = config.prefix) {
  return [
    '## 🎀 Hi, I\'m Deed!',
    `> Someone run **\`${p}setup\`** to activate me in this group chat.`,
    '> ',
    '> • Each person can activate me in **one** GC only.',
    `> • Make me the **GC owner** to unlock owner-only commands. ${OWNER_HOWTO}`,
    `-# ${p}help for commands`,
  ].join('\n');
}

const { Constants: { RelationshipTypes } } = require('discord.js-selfbot-v13');

data.welcomed ??= {}; // userId -> timestamp, so each person only gets the welcome DM once

// Discord flags accounts that accept friend requests automatically, and the library blocks it
// on purpose. So you accept requests by hand in the Discord app, and Deed takes it from there.
async function welcomeNewFriend(client, userId) {
  if (data.welcomed[userId]) return false;
  if (client.relationships.cache.get(userId) !== RelationshipTypes.FRIEND) return false;
  if (Date.now() < pausedUntil) return false;
  const user = await client.users.fetch(userId);
  try {
    await user.send(welcomeDM(user));
  } catch (e) {
    if (/verify your account/i.test(e.message)) { pauseWelcomes(e); return false; }
    // Discord often wants a captcha before an account opens a brand-new DM. We don't try to
    // get around that; instead the welcome goes out as a reply when they message Deed first.
    console.log(`✉️  Couldn't open a DM with ${user.username} (${e.message}). I'll send the welcome when they message me first.`);
    return false;
  }
  data.welcomed[userId] = Date.now();
  save();
  console.log(`👋 Sent welcome DM to ${user.username}`);
  return true;
}

// If Discord says the account needs verification (or a captcha), stop sending welcomes for a while
// instead of retrying on every message. Repeated failed attempts make the account look more like a bot.
let pausedUntil = 0;
const PAUSE_MS = 30 * 60 * 1000;
const isAccountBlock = (e) => e?.code === 40002 || /verify your account|CAPTCHA/i.test(e?.message ?? '');

function pauseWelcomes(err) {
  pausedUntil = Date.now() + PAUSE_MS;
  console.warn(`⏸️  Discord blocked a message (${err.message}). Pausing welcome messages for 30 min. Log into the account and complete any verification Discord asks for.`);
}

// A friend who hasn't had the welcome yet messaged Deed in DMs: reply with it there.
async function onDirectMessage(client, message) {
  if (message.channel.type !== 'DM' || message.author.id === client.user.id || message.author.bot) return false;
  if (data.welcomed[message.author.id] || Date.now() < pausedUntil) return false;
  try {
    await message.channel.send(welcomeDM(message.author));
  } catch (e) {
    if (isAccountBlock(e)) { pauseWelcomes(e); return false; }
    throw e;
  }
  data.welcomed[message.author.id] = Date.now();
  save();
  console.log(`👋 Sent welcome to ${message.author.username} (reply in DMs)`);
  return true;
}

async function onRelationshipAdd(client, userId) {
  const type = client.relationships.cache.get(userId);
  if (type === RelationshipTypes.PENDING_INCOMING) {
    const user = await client.users.fetch(userId).catch(() => null);
    console.log(`📨 Friend request from ${user?.username ?? userId}. Accept it in the Discord app; they get the welcome once they're added (or when they DM me).`);
  } else if (type === RelationshipTypes.FRIEND) {
    await welcomeNewFriend(client, userId);
  }
}

function logPending(client) {
  const pending = [...client.relationships.incomingCache.values()];
  if (pending.length) {
    console.log(`📨 ${pending.length} pending friend request(s): ${pending.map((u) => u.username).join(', ')}. Accept them in the Discord app.`);
  }
}

function register(client) {
  // Welcome runs after any game waiting on a DM (see lib/dm.js).
  require('./dm').onDM((c, message) => onDirectMessage(c, message).catch((e) => { console.error('[welcome]', e.message); return false; }));

  client.on('relationshipAdd', (userId) => {
    onRelationshipAdd(client, userId).catch((e) => console.error('[friend]', e.message));
  });

  // Fired when Deed is added to a group chat.
  client.on('channelCreate', (channel) => {
    if (channel.type !== 'GROUP_DM' || isActive(channel)) return;
    channel.send(gcIntro()).catch(() => {});
  });

  client.on('channelUpdate', (before, after) => {
    if (after.type !== 'GROUP_DM' || before.ownerId === after.ownerId || !isActive(after)) return;
    if (after.ownerId === client.user.id) {
      after.send('### 👑 Thanks for making me GC owner!\n-# owner-only commands like `remove` are unlocked').catch(() => {});
    } else if (before.ownerId === client.user.id) {
      after.send('### 👑 I\'m no longer the GC owner\n-# owner-only commands like `remove` are disabled').catch(() => {});
    }
  });
}

module.exports = {
  OWNER_HOWTO, isActive, activate, deactivate, isGcManager, activationFor, activeGcOf,
  welcomeDM, gcIntro, welcomeNewFriend,
  _resetPause: () => { pausedUntil = 0; }, onDirectMessage, onRelationshipAdd, logPending, register,
};
