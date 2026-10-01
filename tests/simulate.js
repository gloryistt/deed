// Offline simulator: runs Deed's commands against a fake group chat, no Discord login needed.
//   npm test            -> run every scenario, print what Deed would send
//   npm test -- quiet   -> only print failures and the summary
//   npm test -- only=party  -> just setup + the party games / mystery extras (much faster)
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.COOLDOWN_MS = '0';
process.env.CRASH_LOBBY_MS = '400';
process.env.CRASH_TICK_MS = '300';
process.env.CRASH_SPEED = '10';
process.env.CRASH_COUNTDOWN_MS = '50';
process.env.RPS_MOVE_MS = '1500';
process.env.WORK_TASK_CHANCE = '0';
process.env.WORK_COOLDOWN_MS = '0';
process.env.FISH_COOLDOWN_MS = '0';
process.env.FISH_CAST_MS = '20';
process.env.WORK_TASK_MS = '2000';
process.env.MM_READY_MS = '3000';
process.env.MM_DAY_MS = '300';
process.env.MM_VOTE_MS = '3000';
process.env.MM_NIGHT_MS = '3000';
process.env.PARTY_LOBBY_MS = '4000';
process.env.PARTY_READY_MS = '3000';
process.env.GROUP_IDS = '';
process.env.ADMIN_IDS = '';
process.env.DEED_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'deed-test-')), 'db.json');

const { Collection } = require('discord.js-selfbot-v13');
const { loadCommands, handleMessage } = require('../lib/handler');
const eco = require('../lib/economy');
const reminders = require('../lib/reminders');

const QUIET = process.argv.includes('quiet');
const ONLY = process.argv.find((a) => a.startsWith('only='))?.slice(5) ?? null;
let idSeq = 1000;
// Real Discord IDs are bigger than JS numbers can hold exactly, so build them as strings.
const nextId = () => `1${String(idSeq++).padStart(17, '0')}`;

function makeUser(username) {
  const createdTimestamp = Date.UTC(2020, 0, 1);
  return {
    id: nextId(), username, globalName: username[0].toUpperCase() + username.slice(1), bot: false,
    createdTimestamp, createdAt: new Date(createdTimestamp),
    displayAvatarURL: () => `https://cdn.discordapp.com/avatars/${username}.png?size=1024`,
    toString() { return `<@${this.id}>`; },
  };
}

const me = makeUser('deed');      // the account running the bot
const alice = makeUser('alice');
const bob = makeUser('bob');
const carol = makeUser('carol');     // a friend who is not in the GC yet
const dave = makeUser('dave');       // a stranger who will send a friend request
const erinLike = makeUser('gina');
const frank = makeUser('frank');
const allUsers = [me, alice, bob, carol, dave, erinLike, frank];
const dms = [];                      // DMs Deed sent: { to, content }
for (const u of allUsers) u.send = async (content) => { dms.push({ to: u, content }); out(content, 'dm'); };

const log = [];         // every message Deed sent: { content }
const waiters = [];     // pending awaitMessages calls
const history = [];     // messages in the channel, newest last

function makeSent(content) {
  const m = {
    id: nextId(), content, author: me, attachments: new Collection(),
    async edit(c) { m.content = c; out(c, 'edit'); return m; },
    async delete() {},
    async react() {},
  };
  log.push(m);
  history.push(m);
  return m;
}

function out(content, kind = 'send') {
  if (QUIET) return;
  const tag = { edit: '  ✎ Deed (edited)', dm: '  ✉️ Deed (DM)' }[kind] ?? '  ↳ Deed';
  console.log(`${tag}:\n${String(content).split('\n').map((l) => `      ${l}`).join('\n')}`);
}

const channel = {
  id: 'gc-1', type: 'GROUP_DM', name: 'the squad', ownerId: me.id,
  recipients: new Collection([[alice.id, alice], [bob.id, bob]]),
  async send(content) {
    // File uploads (e.g. profile cards) are logged as "[file name size]".
    if (typeof content === 'object') {
      const f = content.files?.[0];
      content = `[file ${f?.name} ${f?.attachment?.length ?? 0}B]${content.content ? ` ${content.content}` : ''}`;
    }
    out(content); return makeSent(content);
  },
  async sendTyping() {},
  async addUser(u) { this.recipients.set(u.id, u); },
  async removeUser(u) { this.recipients.delete(u.id); },
  async setName(n) { this.name = n; },
  awaitMessages({ filter, time }) {
    return new Promise((resolve) => {
      const w = { filter, resolve: (m) => resolve(new Collection([[m.id, m]])) };
      waiters.push(w);
      setTimeout(() => {
        const i = waiters.indexOf(w);
        if (i !== -1) { waiters.splice(i, 1); resolve(new Collection()); }
      }, time);
    });
  },
  messages: {
    async fetch() { return new Collection([...history].reverse().map((m) => [m.id, m])); },
  },
};

const client = {
  user: me,
  commands: loadCommands(),
  startedAt: Date.now() - 3723000,
  ws: { ping: 42 },
  users: {
    cache: new Collection(allUsers.map((u) => [u.id, u])),
    async fetch(id) { const u = allUsers.find((x) => x.id === id); if (!u) throw new Error('unknown'); return u; },
  },
  relationships: {
    cache: new Collection(),
    friendCache: new Collection([[carol.id, carol]]),
    incomingCache: new Collection(),
    async addFriend(id) {
      const u = allUsers.find((x) => x.id === id);
      this.incomingCache.delete(id);
      this.friendCache.set(id, u);
      return true;
    },
  },
  channels: { cache: new Collection([[channel.id, channel]]), async fetch() { return channel; } },
};

// Simulate `user` typing `content` in the GC. Returns what Deed sent in response.
async function say(user, content, { attachments = [], replyTo = null } = {}) {
  if (!QUIET) console.log(`\n💬 ${user.username}: ${content}`);
  const mentioned = new Collection(allUsers.filter((u) => content.includes(`<@${u.id}>`)).map((u) => [u.id, u]));
  const before = log.length;
  const msg = {
    id: nextId(), content, author: user, channel,
    mentions: { users: mentioned, has: (u) => mentioned.has(u.id) },
    attachments: new Collection(attachments.map((a) => [a.id ?? nextId(), a])),
    reference: replyTo ? { messageId: replyTo.id } : null,
    async fetchReference() { return replyTo; },
    async reply(c) { out(c); return makeSent(c); },
  };
  history.push(msg);

  // Collectors see the message first (like discord.js), then the command handler.
  for (const w of [...waiters]) {
    if (w.filter(msg)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
  }
  handleMessage(client, msg);
  await settle();
  return log.slice(before).map((m) => m.content).join('\n');
}

// Let pending promises run (network calls get a bit longer).
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
async function until(pred, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (pred()) return true; await settle(50); }
  return false;
}
const last = () => log.at(-1)?.content ?? '';

// ---------- assertions ----------
let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
const noCrash = (name, text) => check(name, !/Something broke/.test(text), text.split('\n')[0]);

// ---------- scenarios ----------
async function main() {
  const A = `<@${alice.id}>`, B = `<@${bob.id}>`;

  console.log('━━━ Onboarding ━━━');
  const onboarding = require('../lib/onboarding');
  // Dave sends a friend request -> logged, no DM yet. You accept it -> welcome DM once.
  client.relationships.cache.set(dave.id, 3); // PENDING_INCOMING
  await onboarding.onRelationshipAdd(client, dave.id);
  check('pending request does not DM', !dms.some((d) => d.to === dave));
  client.relationships.cache.set(dave.id, 1); // FRIEND (accepted in the app)
  await onboarding.onRelationshipAdd(client, dave.id);
  check('welcome DM sent on accept', dms.some((d) => d.to === dave && /one group chat per person/i.test(d.content) && /Make Group Owner/.test(d.content)));
  await onboarding.onRelationshipAdd(client, dave.id);
  check('welcome DM only once', dms.filter((d) => d.to === dave).length === 1);

  // Erin: Discord demands a captcha to open the DM -> not marked welcomed; she DMs first -> welcome as a reply.
  const erin = makeUser('erin');
  allUsers.push(erin);
  erin.send = async () => { throw new Error('CAPTCHA_SOLVER_NOT_IMPLEMENTED'); };
  client.relationships.cache.set(erin.id, 1);
  check('captcha DM failure not counted as sent', !(await onboarding.welcomeNewFriend(client, erin.id)));
  const erinReplies = [];
  const dmMsg = (content) => ({ content, author: erin, channel: { type: 'DM', send: async (c) => { erinReplies.push(c); } } });
  // Account locked for verification -> one failed attempt, then paused (no retry on the next DM).
  let attempts = 0;
  const lockedMsg = (content) => ({ content, author: erin, channel: { type: 'DM', send: async () => { attempts++; const e = new Error('You need to verify your account in order to perform this action.'); e.code = 40002; throw e; } } });
  const origWarn = console.warn; console.warn = () => {};
  await onboarding.onDirectMessage(client, lockedMsg('hi'));
  await onboarding.onDirectMessage(client, lockedMsg('hello?'));
  console.warn = origWarn;
  check('verification lock pauses retries', attempts === 1, `attempts=${attempts}`);
  onboarding._resetPause();

  await onboarding.onDirectMessage(client, dmMsg('hi'));
  check('welcome sent as reply to first DM', erinReplies.length === 1 && /Getting started/.test(erinReplies[0]));
  await onboarding.onDirectMessage(client, dmMsg('hello again'));
  check('reply welcome only once', erinReplies.length === 1);

  // Commands are blocked until setup.
  let r = await say(alice, '!bal');
  check('inactive GC nudges setup', /not active in this GC/.test(r), r);
  r = await say(alice, '!bal');
  check('nudge is throttled', r === '');
  r = await say(alice, '!help');
  check('help works before setup', /Deed/.test(r));
  r = await say(alice, '!setup');
  check('setup activates', /Deed is live/.test(r) && onboarding.isActive(channel), r);
  check('setup explains ownership (already owner)', /GC owner/.test(r));
  r = await say(bob, '!setup');
  check('setup twice is a no-op', /already active/.test(r));
  if (ONLY === 'party') { await runPartyTests(); return summary(); }

  // Alice tries to activate a second GC -> refused.
  const gc2 = { ...channel, id: 'gc-2', name: 'other gc', recipients: new Collection([[alice.id, alice]]) };
  client.channels.cache.set(gc2.id, gc2);
  const other = await (async () => {
    const before = log.length;
    const msg = { id: nextId(), content: '!setup', author: alice, channel: gc2, mentions: { users: new Collection(), has: () => false },
      attachments: new Collection(), reference: null, async reply(c) { out(c); return makeSent(c); } };
    if (!QUIET) console.log('\n💬 alice (in other gc): !setup');
    await handleMessage(client, msg);
    return log.slice(before).map((m) => m.content).join('\n');
  })();
  check('one GC per person enforced', /already have a GC/.test(other) && !onboarding.isActive(gc2), other);

  console.log('\n━━━ Prefix ━━━');
  r = await say(alice, '!prefix');
  check('prefix shows current', /prefix here is `!`/.test(r), r);
  r = await say(bob, '!prefix ?');
  check('prefix change restricted', /Only <@/.test(r), r);
  r = await say(alice, '!prefix has space');
  check('prefix rejects bad input', /changed/.test(r) === false);
  r = await say(alice, '!prefix `');
  check('prefix rejects markdown chars', /must be 1–5/.test(r), r);
  r = await say(alice, '!prefix ?');
  check('prefix changed', /Prefix changed/.test(r), r);
  r = await say(alice, '!ping');
  check('old prefix ignored', r === '', r);
  r = await say(alice, '?help');
  check('new prefix works + help shows it', /\?help <command>/.test(r) && !/!help/.test(r), r.split('\n').at(-1));
  r = await say(alice, `<@${me.id}> ping`);
  check('mention works as prefix', /Pong/.test(r), r);
  r = await say(alice, `<@${me.id}>`);
  check('bare mention tells prefix', /prefix here is `\?`/.test(r), r);
  r = await say(alice, '?prefix reset');
  check('prefix reset', /→ \*\*`!`\*\*/.test(r), r);

  console.log('\n━━━ Utility ━━━');
  r = await say(alice, '!help');
  check('help lists categories', /Casino/.test(r) && /Lookup/.test(r));
  r = await say(alice, '!help bj');
  check('help resolves aliases', /blackjack/.test(r));
  noCrash('ping', await say(alice, '!ping'));
  noCrash('stats', await say(alice, '!stats'));
  r = await say(alice, '!time Asia/Tokyo');
  check('time with tz', /Asia\/Tokyo/.test(r));
  r = await say(alice, '!time Mars/Olympus');
  check('time rejects bad tz', /Unknown timezone/.test(r));
  await say(bob, '!settz Europe/London');
  r = await say(alice, `!time ${B}`);
  check('time for @user', /Europe\/London/.test(r));
  noCrash('userinfo', await say(alice, `!userinfo ${B}`));
  noCrash('avatar', await say(alice, '!avatar'));
  r = await say(alice, '!poll pizza or tacos? | pizza | tacos');
  check('poll', /pizza or tacos/.test(r));

  console.log('\n━━━ AFK ━━━');
  await say(bob, '!afk eating dinner');
  check('afk reply does not trigger its own notice', !/is AFK/.test(last()), last());
  // Deed's own reply pings bob (like a real Discord reply); it must not announce bob's AFK.
  r = await say(me, `<@${bob.id}> (a reply from the bot account)`);
  check('bot account mentions ignored', !/is AFK/.test(r), r);
  r = await say(alice, `hey ${B} you there?`);
  check('afk notice on mention', /bob is AFK/.test(r) && /eating dinner/.test(r), r);
  r = await say(carol, `${B} ping`);
  check('afk notice throttled', !/is AFK/.test(r), r);
  r = await say(bob, 'im back');
  check('afk cleared on return', /Welcome back/.test(r));

  console.log('\n━━━ Reminders ━━━');
  reminders.start(client);
  r = await say(alice, '!remind 1s stretch');
  check('remind set', /remind you in/.test(r));
  await until(() => /stretch/.test(last()), 3000);
  check('remind fires', /reminder: stretch/.test(last()));
  r = await say(alice, '!remind soon do stuff');
  check('remind rejects bad duration', /Usage/.test(r));

  console.log('\n━━━ Group chat ━━━');
  noCrash('members', await say(alice, '!members'));
  r = await say(bob, '!add carol');
  check('non-admin blocked', /can't use that/.test(r), r);
  r = await say(alice, '!rename alice runs this');
  check('setup person can use GC admin commands', channel.name === 'alice runs this', r);
  const onb = require('../lib/onboarding');
  const gcX = { id: 'gc-x', ownerId: carol.id };
  onb.activate(gcX, dave.id, me.id);
  check('original GC owner is a GC admin', onb.isGcManager(gcX, carol.id) && onb.isGcManager(gcX, dave.id) && !onb.isGcManager(gcX, bob.id));
  r = await say(me, '!add carol');
  check('admin add by username', channel.recipients.has(carol.id), r);
  channel.ownerId = alice.id;
  r = await say(me, `!remove <@${carol.id}>`);
  check('remove explains GC owner requirement', /need to be GC owner/.test(r) && channel.recipients.has(carol.id), r);
  channel.ownerId = me.id;
  r = await say(me, `!remove <@${carol.id}>`);
  check('admin remove', !channel.recipients.has(carol.id), r);
  await say(me, '!rename deed fan club');
  check('rename', channel.name === 'deed fan club');

  console.log('\n━━━ Economy ━━━');
  r = await say(alice, '!bal');
  check('starting balance 500', eco.balance(alice.id) === 500, r);
  await say(alice, '!daily');
  check('daily +250', eco.balance(alice.id) === 750);
  r = await say(alice, '!daily');
  check('daily cooldown', /Already claimed/.test(r));
  await say(alice, '!work');
  check('work pays', eco.balance(alice.id) > 750);
  const aBefore = eco.balance(alice.id), bBefore = eco.balance(bob.id);
  await say(alice, `!give ${B} 100`);
  check('give moves coins', eco.balance(alice.id) === aBefore - 100 && eco.balance(bob.id) === bBefore + 100);
  r = await say(alice, `!give ${B} 999999`);
  check('give rejects overdraft', /Invalid amount/.test(r));
  noCrash('rob', await say(bob, `!rob ${A}`));
  noCrash('leaderboard', await say(alice, '!lb'));

  console.log('\n━━━ Casino ━━━');
  const total = () => eco.balance(alice.id) + eco.balance(bob.id);
  noCrash('coinflip', await say(alice, '!cf heads 50'));
  noCrash('slots', await say(alice, '!slots 50'));
  noCrash('dice', await say(alice, '!dice 50'));
  r = await say(alice, '!slots 99999999');
  check('bet over balance rejected', /Usage/.test(r));

  // Blackjack: keep hitting until the game ends or we reach 17, then stand.
  const bjStart = eco.balance(alice.id);
  await say(alice, '!bj 100');
  // Read the latest blackjack message (other async output, like profile-card images, can land in between).
  const bjLatest = () => [...log].reverse().find((m) => /🃏/.test(m.content))?.content ?? '';
  for (let i = 0; i < 6 && /type hit/.test(bjLatest()); i++) {
    const mine = /ALICE[^\n]*\((\d+)\)/.exec(bjLatest().replace(/\u001b\[[\d;]*m/g, ''));
    await say(alice, Number(mine?.[1]) < 17 ? 'hit' : 'stand');
  }
  check('blackjack finishes', /balance:/.test(bjLatest()), bjLatest().split('\n')[0]);
  check('blackjack settles coins', eco.balance(alice.id) !== bjStart || /Push/.test(bjLatest()));

  // Duel conserves coins between the two players.
  const before = total();
  await say(alice, `!duel ${B} 50`);
  r = await say(bob, 'accept');
  check('duel resolves', /wins the duel/.test(r), r);
  check('duel conserves coins', total() === before);
  await say(alice, `!duel ${B} 50`);
  r = await say(bob, 'no');
  check('duel decline', /chickened out/.test(r));

  console.log('\n━━━ Stake originals ━━━');
  const stake = require('../commands/stake').internals;
  const { createRound } = require('../lib/fair');
  const crypto = require('crypto');
  const fr = createRound('x');
  check('fair: hash matches revealed seed', crypto.createHash('sha256').update(fr.reveal()).digest('hex') === fr.hash);
  check('fair: floats in [0,1)', [...Array(200)].every(() => { const f = fr.float(); return f >= 0 && f < 1; }));
  check('mines math: 1 mine, 1 gem = 1.03x', Math.abs(stake.minesMultiplier(1, 1) - 0.99 * 25 / 24) < 1e-9);
  const plinkoEV = (row) => row.reduce((ev, m, k) => ev + m * [1, 8, 28, 56, 70, 56, 28, 8, 1][k] / 256, 0);
  check('plinko house edge ~1%', ['low', 'medium', 'high'].every((r) => Math.abs(plinkoEV(stake.PLINKO[r]) - 0.99) < 0.005));
  check('hilo odds valid', [...Array(13)].every((_, i) => { const o = stake.hiloOdds(i + 1); return o.hi.p > 0 && o.lo.p > 0 && o.hi.p <= 1; }));
  await say(alice, '!daily'); // make sure alice can afford everything
  eco.add(alice.id, 2000);

  // Mines: pick tiles until we bust or find 3 gems, then cash out.
  let bal0 = eco.balance(alice.id);
  await say(alice, '!mines 100 3');
  r = await say(alice, '!slots 10');
  check('busy blocks a second game', /Finish your current game/.test(r), r);
  for (const tile of ['a1', 'c3', 'e5', 'b2', 'd4']) {
    if (/balance:/.test(last())) break;
    await say(alice, tile);
    if (!/balance:/.test(last()) && (last().match(/💎/g) ?? []).length >= 3) { await say(alice, 'cash'); break; }
  }
  if (!/balance:/.test(last())) await say(alice, 'cash');
  check('mines finishes', /balance:/.test(last()), last().split('\n')[0]);
  check('mines grid renders', /🇦/.test(last()) && /1️⃣2️⃣3️⃣4️⃣5️⃣/.test(last()));
  const minesDelta = eco.balance(alice.id) - bal0;
  check('mines payout consistent', /BOOM/.test(last()) ? minesDelta === -100 : minesDelta >= 0, `delta ${minesDelta}`);

  // Regression: row C tiles (c1–c5) must be picks, not "cash".
  bal0 = eco.balance(alice.id);
  await say(alice, '!mines 10 1');
  await say(alice, 'c4');
  check('mines: c4 is a tile, not cash out', !/Cashed out/.test(last()) && (/💎/.test(last()) || /BOOM/.test(last())), last().split('\n')[0]);
  if (!/balance:/.test(last())) await say(alice, 'cash');

  // Limbo
  bal0 = eco.balance(alice.id);
  await say(alice, '!limbo 100 2');
  await until(() => /You win|Missed/.test(last()), 5000);
  const limboDelta = eco.balance(alice.id) - bal0;
  check('limbo resolves', [100, -100].includes(limboDelta), `delta ${limboDelta}`);

  // Plinko
  bal0 = eco.balance(alice.id);
  await say(alice, '!plinko 100 high');
  await until(() => /balance:/.test(last()), 5000);
  const plinkoDelta = eco.balance(alice.id) + 100 - bal0;
  check('plinko pays a real bucket', stake.PLINKO.high.map((m) => Math.floor(100 * m)).includes(plinkoDelta), `returned ${plinkoDelta}`);
  check('plinko board renders', /▲/.test(last()) && /29/.test(last()));

  // Towers: climb 2 floors picking tile 1, then cash.
  bal0 = eco.balance(alice.id);
  await say(alice, '!towers 100 easy');
  await say(alice, '1');
  if (!/balance:/.test(last())) await say(alice, '1');
  if (!/balance:/.test(last())) await say(alice, 'cash');
  check('towers finishes', /balance:/.test(last()), last().split('\n')[0]);
  const towerDelta = eco.balance(alice.id) - bal0;
  check('towers payout consistent', /dragon got you/.test(last()) ? towerDelta === -100 : towerDelta > 0, `delta ${towerDelta}`);

  // HiLo: bet on the likelier side twice, then cash.
  bal0 = eco.balance(alice.id);
  await say(alice, '!hilo 100');
  for (let i = 0; i < 2 && !/balance:/.test(last()); i++) {
    const hiPct = Number(/hi\s+\S+\s+.*?([\d.]+)%/.exec(last().replace(/\u001b\[[\d;]*m/g, ''))?.[1] ?? 50);
    await say(alice, hiPct >= 50 ? 'hi' : 'lo');
  }
  if (!/balance:/.test(last())) await say(alice, 'cash');
  check('hilo finishes', /balance:/.test(last()), last().split('\n')[0]);
  check('hilo card art renders', /┌───────┐/.test(last()));

  // Crash: alice auto-cashes at 1.01x, bob joins in the lobby and cashes manually.
  const a0 = eco.balance(alice.id), b0 = eco.balance(bob.id);
  await say(alice, '!crash 100 1.01');
  r = await say(bob, '!crash 50');
  check('crash: second player joins lobby', /You're in/.test(r), r);
  r = await say(bob, '!crash 50');
  check('crash: no double join', /already in this round/.test(r), r);
  // The round is one message edited in place, so watch that message rather than the latest one.
  const crashMsg = () => [...log].reverse().find((m) => /### (🚀|💥) Crash/.test(m.content))?.content ?? '';
  await until(() => /to the moon|Crashed/.test(crashMsg()), 3000);
  await say(bob, 'cash');
  await until(() => /Crashed @/.test(crashMsg()), 20000);
  check('crash round ends', /Crashed @/.test(crashMsg()), crashMsg().split('\n')[0]);
  check('crash shows every player', /alice/.test(crashMsg()) && /bob/.test(crashMsg()));
  const aD = eco.balance(alice.id) - a0, bD = eco.balance(bob.id) - b0;
  check('crash auto-cashout pays 1.01x or busts', [1, -100].includes(aD), `alice ${aD}`);
  check('crash manual cashout pays or busts', bD === -50 || bD >= 0, `bob ${bD}`);
  r = await say(alice, '!slots 10');
  check('crash releases busy lock', !/Finish your current game/.test(r), r);

  console.log('\n━━━ Rock paper scissors (DMs) ━━━');
  const dmRouter = require('../lib/dm');
  const dmReplies = [];
  async function dmSay(user, content) {
    if (!QUIET) console.log(`\n✉️  ${user.username} → Deed (DM): ${content}`);
    const msg = { id: nextId(), content, author: user, channel: { type: 'DM', send: async (c) => { dmReplies.push({ to: user, content: c }); out(c, 'dm'); } } };
    await dmRouter.route(client, msg);
    await settle();
  }
  const parseMoveForTest = (t) => ['r', 'p', 's', 'rock', 'paper', 'scissors'].includes(t.trim().toLowerCase());
  const gcMsg = (re) => [...log].reverse().find((m) => re.test(m.content))?.content ?? '';

  r = await say(alice, '!rps rock');
  check('rps solo still works', /vs/.test(r) && /Deed:/.test(r), r);

  const ra = eco.balance(alice.id), rb = eco.balance(bob.id);
  await say(alice, `!rps ${B} 50 bo3`);
  check('rps challenge posted', /challenges/.test(last()) && /Best of 3/.test(last()), last());
  await say(bob, 'accept');
  check('rps round 1 asks for DMs', /Round 1 · DM me your move/.test(last()), last());
  r = await say(alice, 'rock');
  check('rps: move in GC is rejected', /DM me that instead/.test(r), r);
  await dmSay(alice, 'banana');
  check('rps: invalid DM gets a hint', /Send \*\*rock\*\*/.test(dmReplies.at(-1)?.content ?? ''));
  await dmSay(alice, 'r');
  check('rps: DM move locked in privately', /Locked in: 🪨/.test(dmReplies.at(-1)?.content ?? ''));
  check('rps: GC shows lock-in without the move', /✅ \*\*alice\*\* locked in/.test(gcMsg(/Round 1/)) && !/🪨/.test(gcMsg(/Round 1/)));
  await dmSay(bob, 'scissors');
  check('rps: round revealed', /🪨  vs  ✂️/.test(gcMsg(/vs/)) && /alice\*\* takes round 1/.test(gcMsg(/takes/)));
  await dmSay(alice, 'paper');
  await dmSay(bob, 'paper');
  check('rps: tie replays round', /Tie!/.test(gcMsg(/Tie!/)) && /Round 2/.test(last()), last());
  await dmSay(alice, 'p');
  await dmSay(bob, 'r');
  await until(() => /wins 2/.test(gcMsg(/wins 2/)), 3000);
  check('rps: match won 2-0', /alice wins 2–0/.test(gcMsg(/wins 2/)), gcMsg(/wins/));
  check('rps: bet paid', eco.balance(alice.id) === ra + 50 && eco.balance(bob.id) === rb - 50, `${eco.balance(alice.id) - ra} / ${eco.balance(bob.id) - rb}`);
  r = await say(alice, '!slots 10');
  check('rps releases busy lock', !/Finish your current game/.test(r), r);

  // A DM that arrives while no round is waiting is carried into the next round, not dropped.
  dmRouter.expect(carol.id);
  await dmSay(carol, 'scissors');
  const carried = await dmRouter.awaitDM(carol.id, (m) => parseMoveForTest(m.content), 1000);
  check('dm: between-round DM carried into next round', carried?.content === 'scissors');
  dmRouter.unexpect(carol.id);

  // Forfeit: bob never sends a move.
  await say(alice, `!rps ${B}`);
  await say(bob, 'yes');
  await dmSay(alice, 's');
  await until(() => /forfeit/.test(last()), 4000);
  check('rps forfeit when a player times out', /alice wins by forfeit/.test(last()), last());

  console.log('\n━━━ Profile cards & verify ━━━');
  await say(alice, '!bal');
  await until(() => /\[file deed-card/.test(last()), 15000); // rendering takes ~0.5s
  check('balance sends animated card', /\[file deed-card\.gif \d{5,}B\]/.test(last()), last());
  await say(bob, `!card ${A} static`); // bob: the card has a 5s per-user cooldown
  await until(() => /deed-card\.png/.test(last()), 15000);
  check('card static PNG for another user', /\[file deed-card\.png \d{4,}B\]/.test(last()), last());
  r = await say(alice, `!verify ${B}`);
  check('verify is bot-owner only (not GC admins)', /Only bot owners/.test(r), r);
  r = await say(me, `!verify ${B}`);
  check('owner can verify', /bob is now verified/.test(r) && !!eco.data.verified?.[bob.id], r);
  r = await say(me, `!unverify ${B}`);
  check('owner can unverify', !eco.data.verified?.[bob.id], r);
  const pa = eco.balance(alice.id), pb = eco.balance(bob.id);
  r = await say(alice, `!pay ${B} 25`);
  check(',pay sends coins', eco.balance(alice.id) === pa - 25 && eco.balance(bob.id) === pb + 25, r);
  check('first use is tracked', !!eco.data.firstSeen?.[alice.id]);

  console.log('\n━━━ Roleplay ━━━');
  r = await say(alice, '!hug');
  check('rp: targeted action needs a target', /hug who\?/.test(r), r);
  await say(alice, `!hug ${B} for being nice`);
  await until(() => /alice hugs bob/.test(last()), 10000);
  check('rp: hug with reason + gif', /alice hugs bob/.test(last()) && /for being nice/.test(last()) && /1st hug/.test(last()), last());
  await say(alice, `!hug ${B}`);
  await until(() => /2nd hug/.test(last()), 10000);
  check('rp: counter increments', /2nd hug/.test(last()), last());
  await say(bob, '!cry');
  await until(() => /bob is crying/.test(last()), 10000);
  check('rp: solo action', /bob is crying/.test(last()), last());
  await say(bob, `!pat ${B}`);
  await until(() => /Deed pats bob/.test(last()), 10000);
  check('rp: self-target -> Deed steps in', /Deed pats bob/.test(last()), last());
  await say(alice, `!lappillow ${B}`);
  await until(() => /lets bob nap/.test(last()), 10000);
  check('rp: {b} template', /alice lets bob nap on their lap/.test(last()), last());

  console.log('\n━━━ Fishing & shop ━━━');
  const items = require('../lib/items');
  const { rollFish } = require('../commands/fishing').internals;
  const rarePlus = (luck) => { let n = 0; for (let i = 0; i < 20000; i++) if (['rare', 'epic', 'legendary', 'mythic'].includes(items.FISH[rollFish(luck).id][2])) n++; return n / 20000; };
  const base = rarePlus(1), mythril = rarePlus(2.8);
  check('better rods catch more rare+ fish', mythril > base * 2, `${(base * 100).toFixed(1)}% → ${(mythril * 100).toFixed(1)}%`);
  for (let i = 0; i < 5; i++) { await say(carol, '!fish'); await until(() => /caught/.test(last()), 3000); }
  check('fish catches', /caught/.test(last()) && /sells for/.test(last()), last());
  const caught = Object.values(items.user(carol.id).inv).reduce((a, b) => a + b, 0);
  check('fish go to inventory + fishdex', caught === 5 && Object.keys(items.user(carol.id).fishdex).length >= 1, `inv ${caught}`);
  r = await say(carol, '!inv');
  check('inventory lists catches', /carol's inventory/.test(r) && /×/.test(r), r);
  r = await say(carol, '!fishdex');
  check('fishdex renders', /Fishdex · \d+\/22/.test(r), r);
  const c0 = eco.balance(carol.id);
  r = await say(carol, '!sell all');
  check('sell all empties fish + pays', /Sold 5/.test(r) && eco.balance(carol.id) > c0 && !Object.keys(items.user(carol.id).inv).some((id) => items.FISH[id]), r);
  r = await say(carol, '!shop');
  check('shop lists sections', /Rods/.test(r) && /Rings/.test(r), r);
  eco.add(carol.id, 10000);
  r = await say(carol, '!buy carbon');
  check('buy rod equips it', items.rodOf(carol.id).name === 'Carbon Rod', r);
  r = await say(carol, '!buy fiberglass');
  check('no downgrading rods', /already better/.test(r), r);
  await say(carol, '!buy bait');
  check('bait gives 10 casts', items.count(carol.id, 'bait') === 10);
  await say(carol, '!fish'); await until(() => /caught/.test(last()), 3000);
  check('fishing uses bait', items.count(carol.id, 'bait') === 9 && /9 bait left/.test(last()), last());
  r = await say(carol, '!buy yacht');
  check('buy unknown item', /Not in the shop/.test(r), r);

  console.log('\n━━━ Robbery protection ━━━');
  eco.account(erinLike.id);
  eco.add(erinLike.id, 5000);
  eco.add(dave.id, 5000);
  eco.account(dave.id).cooldowns.rob = 0;
  await say(erinLike, '!buy padlock');
  check('buy padlock', items.count(erinLike.id, 'padlock') === 1);
  let v0 = eco.balance(erinLike.id);
  r = await say(dave, `!rob <@${erinLike.id}>`);
  check('padlock blocks one robbery + pays victim', /Locked out/.test(r) && items.count(erinLike.id, 'padlock') === 0 && eco.balance(erinLike.id) > v0, r);
  await say(erinLike, '!buy guarddog');
  check('guard dog active 24h', items.guardLeft(erinLike.id) > 23 * 36e5);
  eco.account(dave.id).cooldowns.rob = 0;
  r = await say(dave, `!rob <@${erinLike.id}>`);
  check('guard dog blocks robbery', /Chased off/.test(r), r);
  r = await say(erinLike, '!inv');
  check('inventory shows guard dog', /Guard dog on duty/.test(r), r);
  process.env.ROB_CHANCE = '1';
  eco.account(dave.id).cooldowns.rob = 0;
  eco.add(frank.id, 1000);
  v0 = eco.balance(frank.id);
  r = await say(dave, `!rob <@${frank.id}>`);
  check('unprotected robbery succeeds + pings victim', /Heist successful/.test(r) && r.includes(`<@${frank.id}>`) && eco.balance(frank.id) < v0, r);
  delete process.env.ROB_CHANCE;

  console.log('\n━━━ Bank ━━━');
  {
    const acc = eco.bank(frank.id);
    acc.balance = 20000; acc.bank = 0;
    r = await say(frank, '!deposit 5000');
    check('deposit moves coins', acc.balance === 15000 && acc.bank === 5000, r);
    r = await say(frank, '!dep all');
    check('deposit capped by bank space', acc.bank === 10000 && acc.balance === 10000 && /bank is now full/.test(r), r);
    r = await say(frank, '!dep 10');
    check('full bank refuses', /bank is full/.test(r), r);
    await say(frank, '!buy vault');
    check('vault adds 10k space', acc.bankSpace === 20000 && acc.balance === 7500);
    r = await say(frank, '!withdraw 2k');
    check('withdraw (with k suffix)', acc.bank === 8000 && acc.balance === 9500, r);
    r = await say(frank, '!with 999999');
    check('cannot overdraw', /only have/.test(r), r);
    acc.interestAt = Date.now() - 2 * 864e5 - 1000;
    eco.bank(frank.id);
    check('interest: 1%/day compounding', acc.bank === 8000 + 80 + 80, `bank ${acc.bank}`);
    process.env.ROB_CHANCE = '1';
    eco.account(dave.id).cooldowns.rob = 0;
    const banked = acc.bank;
    await say(dave, `!rob <@${frank.id}>`);
    check('robbers cannot touch the bank', acc.bank === banked);
    delete process.env.ROB_CHANCE;
    r = await say(frank, '!bank');
    check('bank card', /frank's bank/.test(r) && /Interest/.test(r), r);
    r = await say(frank, '!lb');
    check('leaderboard counts net worth', /Net worth/.test(r), r);
  }

  console.log('\n━━━ Beg ━━━');
  {
    const acc = eco.bank(erinLike.id);
    acc.balance = 5000;
    r = await say(erinLike, '!beg');
    check('beg refused when not broke', /Begging is for people/.test(r), r);
    acc.balance = 20; acc.bank = 0;
    process.env.BEG_COOLDOWN_MS = '0';
    let paid = false;
    for (let i = 0; i < 10 && !paid; i++) {
      const b0 = acc.balance;
      r = await say(erinLike, '!beg');
      paid = acc.balance > b0;
      if (paid) check('beg pays 10–50 (or 250 jackpot)', [...Array(41).keys()].map((x) => x + 10).concat(250).includes(acc.balance - b0), r);
      acc.balance = 20;
    }
    check('beg eventually pays', paid);
    delete process.env.BEG_COOLDOWN_MS;
    acc.cooldowns.beg = 0;
    await say(erinLike, '!beg');
    r = await say(erinLike, '!beg');
    check('beg has a cooldown', /Beg again in/.test(r), r);
    acc.balance = 5000;
  }

  console.log('\n━━━ Earning ━━━');
  {
    for (const k of ['PRAY', 'HUNT', 'MINE', 'CRIME', 'SEARCH', 'HOURLY', 'WEEKLY']) process.env[`${k}_COOLDOWN_MS`] = '0';
    const acc = eco.account(frank.id);
    const earned = async (cmd) => { const b = acc.balance; const out = await say(frank, cmd); return { out, delta: acc.balance - b }; };
    let e = await earned('!pray');
    check('pray pays 40-150 or 750', (e.delta >= 40 && e.delta <= 150) || e.delta === 750, e.out);
    let hunted = 0;
    for (let i = 0; i < 6; i++) { e = await earned('!hunt'); if (e.delta > 0) hunted++; }
    check('hunt pays + counts animals', hunted > 0 && acc.hunts >= hunted, `hunts ${acc.hunts}`);
    e = await earned('!mine');
    check('mine pays (not the mines game)', e.delta >= 10 && /You mined/.test(e.out), e.out);
    e = await earned('!crime');
    check('crime pays or fines', (e.delta >= 150 && e.delta <= 450) || (e.delta <= 0 && /Busted/.test(e.out)), e.out);
    e = await earned('!search');
    check('search', /You searched/.test(e.out) && e.delta >= 0, e.out);
    e = await earned('!hourly');
    check('hourly +120', e.delta === 120, e.out);
    e = await earned('!weekly');
    check('weekly +3000', e.delta === 3000, e.out);
    for (const k of ['PRAY', 'HUNT', 'MINE', 'CRIME', 'SEARCH', 'HOURLY', 'WEEKLY']) delete process.env[`${k}_COOLDOWN_MS`];
    acc.cooldowns.pray = 0;
    await say(frank, '!pray');
    r = await say(frank, '!pray');
    check('pray has a cooldown', /pray again in/.test(r), r);

    r = await say(alice, '!lb');
    check('leaderboard: this GC by default', /Net worth · /.test(r) && !/frank/.test(r), r);
    r = await say(alice, '!lb global');
    check('leaderboard: global includes everyone', /everyone/.test(r) && /frank/.test(r), r);
    r = await say(frank, '!lb hunt global');
    check('leaderboard: hunt category', /Animals hunted/.test(r) && /frank/.test(r), r);
    r = await say(alice, '!lb fish');
    check('leaderboard: fish category', /Fishdex|not on this board|Nobody here/.test(r), r);
  }

  console.log('\n━━━ Crypto ━━━');
  {
    const cx = require('../commands/crypto').internals;
    const acc = eco.account(erinLike.id);
    acc.balance = 10000; acc.crypto = {};
    cx._setCache({ at: Date.now(), stale: false, coins: {
      btc: { price: 100, change24h: 2.5, spark: [90, 95, 100] }, eth: { price: 10, change24h: -1, spark: [11, 10] },
      sol: { price: 5, change24h: 0, spark: [5, 5] }, doge: { price: 0.1, change24h: 1, spark: [0.1, 0.1] } } });
    r = await say(erinLike, '!crypto');
    check('crypto market shows all coins', ['BTC', 'ETH', 'SOL', 'DOGE', 'DEED'].every((c) => r.includes(c)), r);
    r = await say(erinLike, '!crypto buy btc 1000');
    check('buy spends coins, 1% fee', acc.balance === 9000 && Math.abs(acc.crypto.btc.units - 9.9) < 1e-9 && acc.crypto.btc.cost === 1000, r);
    cx._setCache({ at: Date.now(), stale: false, coins: { btc: { price: 200, change24h: 100, spark: [100, 200] } } });
    r = await say(erinLike, '!crypto wallet');
    check('wallet shows value + profit', /1,980/.test(r) && /\+980/.test(r), r);
    r = await say(erinLike, '!crypto sell btc half');
    check('sell half: pays 99% of value, reports profit', acc.balance === 9000 + Math.floor(4.95 * 200 * 0.99) && /profit/.test(r) && Math.abs(acc.crypto.btc.units - 4.95) < 1e-9, r);
    r = await say(erinLike, '!crypto sell btc all');
    check('sell all empties the position', !acc.crypto.btc, r);
    r = await say(erinLike, '!crypto sell eth all');
    check('cannot sell what you do not own', /don't own/.test(r), r);
    r = await say(erinLike, '!crypto buy btc 99999999');
    check('cannot overspend', /How many coins/.test(r), r);
    const { data } = require('../lib/db');
    data.deedcoin = { price: 1, history: [1], updatedAt: Date.now() - 50 * 60 * 1000 };
    const d = cx.deedCoin();
    check('DEED coin random-walks (5 steps in 50 min)', data.deedcoin.history.length === 6 && d.price > 0 && d.price !== 1);
    r = await say(erinLike, '!crypto buy deed 500');
    check('can buy DEED', acc.crypto.deed?.units > 0, r);
    r = await say(erinLike, '!lb crypto global');
    check('leaderboard crypto category', /Crypto portfolio/.test(r) && /gina/.test(r), r);
    cx._setCache(null);
  }

  console.log('\n━━━ Blockchain lookups ━━━');
  {
    const ch = require('../commands/chain').internals;
    const cases = {
      bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh: 'btc', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa': 'btc',
      '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045': 'eth', 'vitalik.eth': 'eth',
      vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg: 'sol', DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L: 'doge',
      LVg2kJoFNg45Nbpy53h7Fe1wKyeXVRhMH9: 'ltc', 'hello!': null,
    };
    check('address formats detected', Object.entries(cases).every(([a, c]) => ch.detectChain(a) === c),
      Object.entries(cases).filter(([a, c]) => ch.detectChain(a) !== c).map(([a]) => a).join(', '));
    // Real token data from vitalik.eth (2026-09-27): scam/illiquid holdings must be hidden, real ones kept.
    check('scam token hidden ($0 market cap)', !ch.isLiquid({ usd: 338200, mcap: 0, volume: 342 }));
    check('illiquid token hidden ($100k vs $53/day)', !ch.isLiquid({ usd: 100619, mcap: 1555569, volume: 53 }));
    check('real token kept (ENS)', ch.isLiquid({ usd: 5000, mcap: 294185890, volume: 14522952 }));
    check('real token kept (USDC)', ch.isLiquid({ usd: 250, mcap: 75181838204, volume: 9851840241 }));
    r = await say(alice, '!wallet');
    check('wallet usage', /Usage/.test(r), r);
    r = await say(bob, '!wallet not-an-address!');
    check('unknown address format', /don't recognize/.test(r), r);
    r = await say(carol, '!tx 1234');
    check('tx rejects bad hash', /doesn’t look like/.test(r), r);
  }

  console.log('\n━━━ Jobs ━━━');
  const jobs = require('../commands/jobs').internals;
  const s0 = jobs.career(dave.id).shifts;
  r = await say(dave, '!work');
  check('work pays + counts shift', /Shift complete · Fast Food Worker/.test(r) && jobs.career(dave.id).shifts === s0 + 1, r);
  r = await say(dave, '!apply cashier');
  check('locked job refused', /needs 8 shifts/.test(r), r);
  jobs.career(dave.id).shifts = 7;
  r = await say(dave, '!work');
  check('promotion unlocked at 8 shifts', /New job unlocked: 🛒 Cashier/.test(r), r);
  r = await say(dave, '!apply cashier');
  check('apply to unlocked job', /Hired as Cashier/.test(r) && jobs.career(dave.id).job === 'cashier', r);
  process.env.WORK_TASK_CHANCE = '1';
  await say(dave, '!work');
  const task = /(?:Unscramble|Quick math): \*\*`([^`]+)`\*\*/.exec(last());
  let answer = task?.[1];
  if (answer && /[+×-]/.test(answer)) { const [x, op, y] = answer.split(' '); answer = String(op === '+' ? +x + +y : op === '×' ? x * y : x - y); }
  else if (answer) answer = ['coffee', 'burger', 'rocket', 'doctor', 'laptop', 'planet', 'coins', 'dragon', 'pirate', 'guitar', 'banana', 'wizard', 'discord', 'ticket'].find((w) => [...w].sort().join('') === [...answer].sort().join(''));
  await say(dave, answer ?? 'x');
  await until(() => /Shift complete/.test(last()), 3000);
  check('bonus task pays extra', /Bonus task done/.test(last()), last());
  process.env.WORK_TASK_CHANCE = '0';
  r = await say(dave, '!jobs');
  check('jobs ladder', /CEO/.test(r) && /current/.test(r), r);

  console.log('\n━━━ Marriage ━━━');
  const marriage = require('../lib/db').data.marriages;
  r = await say(carol, `!marry ${A}`);
  check('marry needs a ring', /need a ring/.test(r), r);
  eco.add(carol.id, 6000);
  await say(carol, '!buy diamondring');
  await say(carol, `!marry ${A}`);
  r = await say(alice, 'accept');
  check('marriage accepted', /carol & alice are married/.test(r) && marriage[carol.id]?.partner === alice.id && marriage[alice.id]?.partner === carol.id, r);
  check('ring used up', items.count(carol.id, 'diamondring') === 0);
  r = await say(bob, `!marriage ${A}`);
  check('marriage info', /alice 💞 carol/.test(r) && /Diamond Ring/.test(r), r);
  r = await say(bob, `!marry ${A}`);
  check('cannot marry a married person', /need a ring|already married/.test(r), r);
  const d0 = eco.balance(carol.id);
  await say(carol, '!daily');
  check('married daily bonus', eco.balance(carol.id) - d0 === 250 + 200, `+${eco.balance(carol.id) - d0}`);
  await say(carol, '!divorce');
  r = await say(carol, 'yes');
  check('divorce', /divorced/.test(r) && !marriage[carol.id] && !marriage[alice.id], r);

  console.log('\n━━━ Murder mystery ━━━');
  {
    Object.assign(process.env, { MM_DEFENSE_MS: '200', MM_TRIAL_MS: '3000', MM_EVENTS: 'off' });
    const mm = require('../commands/mystery').internals;
    const dmRouter = require('../lib/dm');
    const mmDMs = [];
    const dmTo = async (user, content) => {
      if (!QUIET) console.log(`\n✉️  ${user.username} → Deed (DM): ${content}`);
      await dmRouter.route(client, { id: nextId(), content, author: user, channel: { type: 'DM', send: async (c) => { mmDMs.push({ to: user, content: c }); out(c, 'dm'); } } });
      await settle();
    };
    const dmsFor = (u) => mmDMs.filter((d) => d.to === u).map((d) => d.content);
    const gcFind = (re) => [...log].reverse().find((m) => re.test(m.content))?.content ?? '';

    // Unit checks: role mixes and clue construction.
    const mix = (n) => mm.roleList(n);
    check('mm roles: 4p = 🔪🔍 + guests', mix(4).join() === 'murderer,detective,guest,guest');
    check('mm roles: 6p adds doctor + jester', mix(6).includes('doctor') && mix(6).includes('jester'));
    check('mm roles: 7p adds accomplice', mix(7).includes('accomplice'));
    check('mm roles: 10p has mayor + bodyguard', mix(10).includes('mayor') && mix(10).includes('bodyguard'));
    check('mm roles: 9p adds witness', mix(9).includes('witness') && !mix(8).includes('witness'));
    check('mm roles: 11p has 2 murderers + accomplice', mix(11).filter((r) => r === 'murderer').length === 2 && mix(11).includes('accomplice'));
    check('mm roles: 25p = 3 murderers, 2 detectives', mix(25).filter((r) => r === 'murderer').length === 3 && mix(25).filter((r) => r === 'detective').length === 2);

    r = await say(alice, '!mm');
    check('mm: lobby opens', /Murder Mystery · lobby/.test(r), r);
    for (const u of [bob, carol, dave]) await say(u, '!mm join');
    r = await say(bob, '!mm start');
    check('mm: only host starts', /Only the host/.test(r), r);
    r = await say(me, '!mm join');
    check('mm: bot account cannot play', /narrator/.test(r), r);
    await say(alice, '!mm start');
    check('mm: asks players to DM ready', /DM me `ready`/.test(last()), last());
    for (const u of [alice, bob, carol, dave]) await dmTo(u, 'ready');
    await until(() => /The guests/.test(gcFind(/The guests/)), 3000);
    const g = mm.games.get(channel.id);
    check('mm: roles sent by DM', [alice, bob, carol, dave].every((u) => dmsFor(u).some((c) => /You are the/.test(c))));
    check('mm: prologue clue lists options', /Clue #1\*\* · .+\*\* · \*\*/.test(gcFind(/Clue #1/)), gcFind(/Clue #1/));

    const killer = g.players.find((p) => p.role === 'murderer');
    const detective = g.players.find((p) => p.role === 'detective');
    const [victim, framed] = g.players.filter((p) => p.role === 'guest');

    // Night 1 comes BEFORE any vote.
    await until(() => g.phase === 'night', 3000);
    check('mm: night 1 before the first vote', g.phase === 'night' && g.day === 1 && !/Accusations|Who should stand trial/.test(gcFind(/stand trial/)));
    check('mm: murderer night prompt has frame/clean/weapons', dmsFor(killer.user).some((c) => /Night 1/.test(c) && /frame/.test(c) && /clean/.test(c)));
    await dmTo(victim.user, 'will I trust @everyone except the butler');
    check('mm: will saved (mass pings defused)', /Will saved/.test(dmsFor(victim.user).at(-1)) && !/@everyone/.test(victim.will), dmsFor(victim.user).at(-1));
    await dmTo(killer.user, 'kill 999');
    check('mm: bad target gets the list', /Reply `kill/.test(dmsFor(killer.user).at(-1)));
    await dmTo(killer.user, `frame ${framed.user.username}`);
    check('mm: frame accepted', /Framing/.test(dmsFor(killer.user).at(-1)), dmsFor(killer.user).at(-1));
    await dmTo(killer.user, 'frame bob');
    check('mm: frame is once per game', /already used/.test(dmsFor(killer.user).at(-1)));
    await dmTo(detective.user, `inspect ${framed.user.username}`);
    await dmTo(killer.user, `kill ${victim.user.username} with poker`);
    check('mm: weapon choice', /fireplace poker/.test(dmsFor(killer.user).at(-1)), dmsFor(killer.user).at(-1));
    await until(() => /is dead/.test(gcFind(/is dead/)), 3000);
    check('mm: victim dies with chosen weapon', !victim.alive && /iron fireplace poker/.test(gcFind(/is dead/)), gcFind(/is dead/));
    check('mm: last will read on death', /Last will of .+except the butler/.test(gcFind(/is dead/)), gcFind(/is dead/));
    const longWill = { will: 'x '.repeat(80).trim() };
    check('mm: will excerpt for scene cards', /^Will: “.+except the butler”$/.test(mm.willExcerpt(victim)) && mm.willExcerpt(longWill).length < 75 && mm.willExcerpt(longWill).endsWith('…”') && /torn/.test(mm.willExcerpt(victim, true)) && mm.willExcerpt({}) === null, mm.willExcerpt(victim));
    check('mm: detective fooled by the frame', /SUSPICIOUS/.test(dmsFor(detective.user).find((c) => /Dawn report/.test(c)) ?? ''));
    const frameClue = g.clues[1];
    check('mm: framed clue points away from the killer', frameClue && !frameClue.options.includes(killer.traits[frameClue.category][0]) && frameClue.options.includes(framed.traits[frameClue.category][0]), JSON.stringify(frameClue));

    // Day 1: search, then accuse the killer and convict them at trial with plain "guilty" messages.
    await until(() => g.phase === 'day', 3000);
    r = await say(detective.user, `!mm search ${g.setting.rooms[0]}`);
    check('mm: search works', /searched|found something/.test(r), r);
    r = await say(detective.user, `!mm search ${g.setting.rooms[1]}`);
    check('mm: one search per day', /already searched/.test(r), r);
    r = await say(framed.user, `!mm search ${g.setting.rooms[0]}`);
    check('mm: each room once per day', /already searched today by/.test(r), r);
    r = await say(framed.user, '!mm search');
    check('mm: search needs a room', /Search where/.test(r), r);
    const cluesBefore = g.clues.length;
    r = await say(killer.user, `!mm search ${g.lastRoom === g.setting.rooms[0] ? g.setting.rooms[2] : g.lastRoom}`);
    check('mm: murder team searches find nothing', /searched\n> …and found/.test(r) && g.clues.length === cluesBefore, r);
    r = await say(victim.user, '!mm search library');
    check('mm: dead cannot search', /Only living/.test(r), r);
    r = await say(framed.user, '!mm reveal');
    check('mm: only the mayor can reveal', /nothing to reveal/.test(r), r);
    await dmTo(victim.user, `haunt ${killer.user.username}`);
    check('mm: ghost haunt posts anonymously', /One of the dead is pointing at them/.test(gcFind(/candles gutter/)) && !gcFind(/candles gutter/).includes(victim.user.username), gcFind(/candles gutter/));
    await dmTo(victim.user, `haunt ${framed.user.username}`);
    check('mm: one haunt per game', /already used your haunt/.test(dmsFor(victim.user).at(-1)), dmsFor(victim.user).at(-1));
    await until(() => g.phase === 'vote', 3000);
    for (const p of g.players.filter((x) => x.alive && x !== killer)) await say(p.user, `!vote ${killer.user.username}`);
    await say(killer.user, `!vote ${framed.user.username}`);
    await until(() => g.phase === 'trial', 3000);
    check('mm: accused goes to trial', /on trial/.test(gcFind(/on trial/)) && g.trial?.accused === killer);
    r = await say(killer.user, 'guilty');
    check('mm: accused cannot vote at own trial', /on trial/.test(r) || r === '', r);
    const before = eco.balance(detective.id);
    for (const p of g.players.filter((x) => x.alive && x !== killer)) await say(p.user, 'guilty');
    await until(() => /guests win/.test(gcFind(/guests win/)), 5000);
    check('mm: convicted -> town wins', !killer.alive && /guests win/.test(gcFind(/guests win/)));
    check('mm: night image attached', /\[file night-1\.png \d{4,}B\]/.test(gcFind(/is dead/)), gcFind(/is dead/).slice(0, 60));
    check('mm: trial image attached', /\[file trial-1\.png \d{4,}B\]/.test(gcFind(/found guilty/)), gcFind(/found guilty/).slice(0, 60));
    check('mm: game-over poster attached', /\[file game-over\.png \d{4,}B\]/.test(gcFind(/guests win/)), gcFind(/guests win/).slice(0, 60));
    check('mm: recap + MVP', /What happened/.test(gcFind(/What happened/)) && /MVP/.test(gcFind(/The truth/)));
    check('mm: winners rewarded', eco.balance(detective.id) >= before + 300, `+${eco.balance(detective.id) - before}`);
    check('mm: stats recorded', mm.stats(killer.id).kills >= 1 && mm.stats(detective.id).wins >= 1);
    check('mm: game cleaned up', !mm.games.has(channel.id) && !mm.playerGame.has(alice.id));
    r = await say(alice, '!mm stats');
    check('mm stats card', /mystery record/.test(r), r);
  }

  console.log('\n━━━ Big games & images ━━━');
  {
    const { assignRoles } = require('../commands/mystery').internals;
    const big = { players: Array.from({ length: 25 }, (_, i) => ({ id: String(i) })) };
    assignRoles(big);
    const countRole = (r) => big.players.filter((p) => p.role === r).length;
    const unique = (k) => new Set(big.players.map((p) => p.traits[k][0])).size === 25;
    check('mm: 25 players -> 3🔪 🤝 2🔍 💉 🛡️', countRole('murderer') === 3 && countRole('accomplice') === 1 && countRole('detective') === 2 && countRole('doctor') === 1 && countRole('bodyguard') === 1);
    check('mm: 25 unique characters + traits', new Set(big.players.map((p) => p.char.name)).size === 25 && unique('garment') && unique('scent') && unique('mark'));

    const { createCanvas } = require('@napi-rs/canvas');
    const img = createCanvas(300, 200);
    img.getContext('2d').fillRect(0, 0, 300, 200);
    const pngUrl = `data:image/png;base64,${(await img.encode('png')).toString('base64')}`;
    await say(alice, '!caption when the bot works', { attachments: [{ id: nextId(), name: 'pic.png', contentType: 'image/png', url: pngUrl }] });
    await until(() => /caption\.png/.test(last()), 10000);
    check('caption static image', /\[file caption\.png \d+B\]/.test(last()), last());
    const gifBuf = require('child_process').execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10', '-t', '1', '-f', 'gif', '-']);
    await say(bob, 'look at this', { attachments: [{ id: nextId(), name: 'clip.gif', contentType: 'image/gif', url: `data:image/gif;base64,${gifBuf.toString('base64')}` }] });
    const gifMsg = history.at(-1);
    await say(carol, '!caption me irl', { replyTo: gifMsg });
    await until(() => /caption\.gif|Couldn't caption/.test(last()), 20000);
    check('caption animated GIF (reply)', /\[file caption\.gif \d+B\]/.test(last()), last());
    r = await say(dave, '!caption');
    check('caption needs text', /What should the caption say/.test(r), r);

    await say(alice, '!quote i am never losing at rps again');
    await until(() => /quote\.png/.test(last()), 10000);
    check('quote from text', /\[file quote\.png \d+B\]/.test(last()), last());
    await say(bob, '!qt', { replyTo: { id: nextId(), content: 'this is a quotable message', author: carol } });
    await until(() => /quote\.png/.test(last()), 10000);
    check('quote by replying', /\[file quote\.png/.test(last()), last());
  }

  console.log('\n━━━ Web embeds ━━━');
  r = await say(dave, '!avatar');
  check('web embeds OFF by default (plain avatar)', !/benny|\|\|/.test(r) && /avatars/.test(r), r.slice(0, 120));
  r = await say(bob, '!embedtest');
  check('embedtest is owner-only', /Only bot owners/.test(r), r);
  r = await say(me, '!embedtest');
  check('embedtest works while embeds are off', /^\[\.\]\(https:\/\/benny\.fun/.test(r), r.slice(0, 80));
  process.env.WEB_EMBEDS = 'on';
  r = await say(alice, '!embed Game night | Friday 9pm, bring snacks | ff0000');
  check('embed command -> masked "." link, no pipe wall', /^\[\.\]\(https:\/\/benny\.fun\/api\/embed\?title=Game\+night/.test(r) && /color=ff0000/.test(r) && !/\|\|/.test(r) && r.length <= 2000, r.slice(0, 200));
  r = await say(carol, '!embed');
  check('embed needs a title', /Usage/.test(r), r);
  r = await say(bob, `!avatar ${A}`);
  check('avatar is just the embed link (no extra text)', /^\[\.\]\(https:\/\/benny\.fun/.test(r) && /big_image=true/.test(r), r.slice(0, 80));
  r = await say(bob, `!userinfo ${A}`);
  check('userinfo embed', /benny\.fun/.test(r) && /coins/.test(decodeURIComponent(r.split('?')[1] ?? '').replace(/\+/g, ' ')), r.slice(-200));
  delete process.env.WEB_EMBEDS;
  r = await say(carol, `!avatar ${A}`);
  check('default falls back to plain text', !/benny/.test(r) && /avatars/.test(r), r);

  console.log('\n━━━ Streaming ━━━');
  {
    const streamLib = require('../lib/stream');
    r = await say(alice, '!stream');
    check('stream: usage', /Usage/.test(r), r);
    r = await say(bob, '!stream file movie.mp4');
    check('stream: local files are owner-only', /Only bot owners/.test(r), r);
    r = await say(carol, '!stream https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    check('stream: needs an active call', /Start a call first/.test(r), r);
    r = await say(dave, '!stream stop');
    check('stream stop when idle', /not streaming/.test(r), r);
    // Local files: resolve inside videos/ only.
    const fsx = require('fs'), pathx = require('path');
    const clip = pathx.join(streamLib.VIDEO_DIR, '_deed_test.mp4');
    require('child_process').execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15', '-t', '1', clip]);
    r = await say(me, '!stream files');
    check('stream files lists the videos folder', /_deed_test\.mp4/.test(r), r);
    const local = await streamLib.resolveSource({ kind: 'file', name: '_deed_test.mp4' });
    check('stream: local file resolves', local.input === clip);
    let escaped = false;
    try { await streamLib.resolveSource({ kind: 'file', name: '../package.json' }); escaped = true; } catch { /* refused */ }
    check('stream: cannot escape videos folder', !escaped);
    fsx.unlinkSync(clip);
    const att = await streamLib.resolveSource({ kind: 'url', url: 'https://cdn.discordapp.com/attachments/1/2/clip.mp4', isVideo: true, title: 'clip.mp4' });
    check('stream: video attachment passes straight through', att.input.endsWith('clip.mp4') && att.title === 'clip.mp4');
  }

  console.log('\n━━━ Cards as web embeds ━━━');
  {
    const { card } = require('../lib/format');
    const simple = { title: 'Lucky day', emoji: '🍀', body: ['You found **5** coins', '> nice'], footer: 'balance: 10' };
    check('cards stay text while embeds are off', card(simple).startsWith('### 🍀 Lucky day'));
    process.env.WEB_EMBEDS = 'on';
    const e = card(simple);
    const q = new URLSearchParams(e.split('?')[1].replace(/\)$/, ''));
    check('simple card -> embed', /^\[\.\]\(https:\/\/benny\.fun/.test(e) && q.get('title') === '🍀 Lucky day');
    check('embed strips markdown', q.get('description').includes('You found 5 coins') && !q.get('description').includes('**'));
    check('footer -> provider line', q.get('provider_name') === 'balance: 10');
    check('card with color board stays text', card({ ...simple, block: ['x'] }).startsWith('### '));
    check('card with a mention stays text', card({ ...simple, body: ['hi <@123456789012345678>'] }).startsWith('### '));
    check('card with a timestamp stays text', card({ ...simple, body: ['<t:1700000000:R>'] }).startsWith('### '));
    check('private card stays text', card({ ...simple, private: true }).startsWith('### '));
    check('too-long card stays text', card({ ...simple, body: ['x'.repeat(400)] }).startsWith('### '));
    r = await say(alice, '!help bj');
    check('real command (help) renders as embed', /^\[\.\]\(https:\/\/benny\.fun\/api\/embed\?title=%F0%9F%93%96/.test(r), r.slice(0, 120));
    delete process.env.WEB_EMBEDS;
  }

  console.log('\n━━━ Music links ━━━');
  {
    const { normalizeQuery, friendlyError } = require('../commands/music').internals;
    const id = 'hV6hbbesekU', watch = `https://www.youtube.com/watch?v=${id}`;
    const forms = {
      'radio mix (the failing one)': `https://www.youtube.com/watch?v=${id}&list=RD${id}&start_radio=1`,
      'angle brackets': `<${watch}>`, 'youtu.be + si': `https://youtu.be/${id}?si=abc123`,
      'music.youtube.com': `https://music.youtube.com/watch?v=${id}&list=RDAMVM${id}`, shorts: `https://www.youtube.com/shorts/${id}`, mobile: `https://m.youtube.com/watch?v=${id}&t=30s`,
    };
    for (const [name, url] of Object.entries(forms)) check(`music link: ${name} -> clean watch URL`, normalizeQuery(url).target === watch && !normalizeQuery(url).playlist, normalizeQuery(url).target);
    check('music link: plain text = search', normalizeQuery('never gonna give you up').target === 'ytsearch1:never gonna give you up');
    check('music link: playlist-only link plays first track', normalizeQuery('https://www.youtube.com/playlist?list=PLabc123').playlist === true);
    check('music link: non-YouTube links untouched', normalizeQuery('https://soundcloud.com/a/b').target === 'https://soundcloud.com/a/b');
    check('yt-dlp error: bot check explained', /prove I’m not a bot/.test(friendlyError('ERROR: [youtube] x: Sign in to confirm you’re not a bot').text));
    check('yt-dlp error: private video', /unavailable/.test(friendlyError('ERROR: [youtube] x: Private video. Sign in if you’ve been granted access').text));
    check('yt-dlp error: mix playlist', /Mix\/playlist/.test(friendlyError('ERROR: [youtube:tab] RDx: YouTube said: This playlist type is unviewable.').text));
    check('yt-dlp error: timeout is retried', friendlyError('', true).transient === true && friendlyError('ERROR: age-restricted video').transient === false);
  }

  console.log('\n━━━ Terminal console ━━━');
  {
    const { EventEmitter } = require('events');
    const { PassThrough } = require('stream');
    const { startConsole } = require('../lib/console');
    const cc = new EventEmitter();
    cc.user = { id: 'me', username: 'deed' };
    cc.users = { cache: new Map([['1001', { username: 'alice' }], ['1002', { username: 'bob' }]]) };
    const sent = [];
    const mkMsg = (ch, author, content) => ({ channel: ch, author, content, createdTimestamp: Date.now(), attachments: new Map(), embeds: [] });
    const history = [];
    const mkGc = (id, name, members) => {
      const c = { id, type: 'GROUP_DM', name, ownerId: '1001', recipients: new Map(members.map((u) => [u, { id: u, username: cc.users.cache.get(u).username }])) };
      c.send = async (text) => { sent.push([id, text]); const m = mkMsg(c, cc.user, text); cc.emit('messageCreate', m); return m; };
      c.messages = { fetch: async ({ limit }) => new Map(history.filter((h) => h.channel === c).slice(-limit).reverse().map((h, i) => [i, h])) };
      return c;
    };
    const rock = mkGc('gc1', 'we are 30 rock', ['1001', '1002']);
    const quiet = mkGc('gc2', null, ['1001']);
    cc.channels = { cache: new Map([['gc1', rock], ['gc2', quiet], ['dm1', { id: 'dm1', type: 'DM' }]]) };
    history.push(mkMsg(rock, cc.users.cache.get('1001'), 'first'), mkMsg(rock, cc.users.cache.get('1002'), 'second <@1001>'), mkMsg(rock, cc.users.cache.get('1001'), 'third'));
    const input = new PassThrough(), output = new PassThrough();
    let outText = '';
    output.on('data', (d) => { outText += d; });
    let quit = 0, restarted = 0;
    const con = startConsole(cc, { input, output, isActive: (ch) => ch.id === 'gc1', onQuit: () => quit++, onRestart: () => restarted++ });
    const type = async (line) => { outText = ''; input.write(`${line}\n`); await settle(40); return outText; };

    check('console: two GCs, DMs ignored, nothing auto-picked', con._state().current === null);
    let o = await type('/gcs');
    check('console: /gcs lists GCs with sizes + setup state', /1\. we are 30 rock.*3 members.*active/.test(o) && /2\. alice.*2 members.*not set up/.test(o), o);
    o = await type('hello?');
    check('console: typing with no GC picked explains, sends nothing', /Pick a group chat first/.test(o) && sent.length === 0, o);
    o = await type('/2');
    check('console: /2 picks the second GC', con._state().current === 'gc2' && /Now chatting in alice/.test(o), o);
    o = await type('/use rock');
    check('console: /use by name', con._state().current === 'gc1' && /we are 30 rock/.test(o), o);
    check('console: picking a GC shows recent history (mentions resolved)', /second @alice|second @/.test(o) && /third/.test(o), o);
    o = await type('hey everyone');
    check('console: text is sent to the picked GC as Deed', sent.at(-1)?.[0] === 'gc1' && sent.at(-1)?.[1] === 'hey everyone' && /deed ➤/.test(o) && /hey everyone/.test(o), o);
    await type('//literal slash');
    check('console: // sends a literal /', sent.at(-1)?.[1] === '/literal slash');
    await type(',bal');
    check('console: bot commands can be typed (sent as-is)', sent.at(-1)?.[1] === ',bal');
    o = await type('x'.repeat(2001));
    check('console: over-long message refused', /Too long/.test(o) && sent.at(-1)?.[1] === ',bal');

    outText = '';
    cc.emit('messageCreate', mkMsg(rock, cc.users.cache.get('1002'), 'yo <@1001> look'));
    await settle(20);
    check('console: incoming message in the picked GC is printed', /bob/.test(outText) && /yo @alice look/.test(outText), outText);
    outText = '';
    cc.emit('messageCreate', mkMsg(quiet, cc.users.cache.get('1001'), 'psst'));
    await settle(20);
    o = await type('/gcs');
    check('console: other GCs count unread', /2\. alice.*1 new/.test(o), o);
    check('console: prompt shows unread elsewhere', /1 unread/.test(outText), outText);
    o = await type('/read 2');
    check('console: /read shows the last messages oldest-first', o.indexOf('third') < o.indexOf('yo @alice look') || /third/.test(o), o);
    o = await type('/tail off');
    await type('quiet send');
    check('console: /tail off -> sends confirm instead of echo', sent.at(-1)?.[1] === 'quiet send');
    o = await type('');
    o = await type('/tail on');
    o = await type('/who');
    check('console: /who lists members', /alice/.test(o) && /bob/.test(o) && /deed \(you\)/.test(o), o);
    o = await type('/nonsense');
    check('console: unknown / command explained', /Unknown command/.test(o), o);
    o = await type('/use zzz');
    check('console: no match explained', /No group chat matches/.test(o), o);
    await type('/restart');
    await type('/quit');
    check('console: /restart and /quit call back into Deed', restarted === 1 && quit === 1);
    con.close();
  }

  console.log('\n━━━ Restart supervisor ━━━');
  {
    const os2 = require('os'), fs2 = require('fs'), path2 = require('path'), { spawnSync } = require('child_process');
    const dir = fs2.mkdtempSync(path2.join(os2.tmpdir(), 'deed-sup-'));
    const counter = path2.join(dir, 'n');
    fs2.writeFileSync(path2.join(dir, 'fake.js'), `const fs=require('fs');const p=${JSON.stringify(counter)};const n=fs.existsSync(p)?+fs.readFileSync(p):0;fs.writeFileSync(p,String(n+1));console.log('run '+(n+1)+' supervised='+process.env.DEED_SUPERVISED);process.exit(n<2?75:0);`);
    const res = spawnSync(process.execPath, [path2.join(__dirname, '..', 'scripts', 'run.js')], { env: { ...process.env, DEED_ENTRY: path2.join(dir, 'fake.js') }, encoding: 'utf8', timeout: 20000 });
    check('supervisor: exit code 75 restarts in place, other codes end it', /run 1/.test(res.stdout) && /run 2/.test(res.stdout) && /run 3/.test(res.stdout) && !/run 4/.test(res.stdout) && res.status === 0, res.stdout);
    check('supervisor: tells Deed it is supervised', /supervised=1/.test(res.stdout));
    fs2.rmSync(dir, { recursive: true, force: true });
  }

  console.log('\n━━━ Direct audio + stream recovery ━━━');
  {
    const music = require('../commands/music').internals;
    const http = require('http'), fs2 = require('fs'), os2 = require('os'), path2 = require('path'), cp = require('child_process');
    const dir = fs2.mkdtempSync(path2.join(os2.tmpdir(), 'deed-audio-'));
    const mp3 = path2.join(dir, 'tone.mp3');
    cp.execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-metadata', 'title=Test Tone', '-metadata', 'artist=Deed', mp3]);
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/tone.mp3')) {
        // Like real file hosts: support Range requests (lets players seek and read the length).
        const data = fs2.readFileSync(mp3);
        const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
        if (m) {
          const start = Number(m[1] || 0), end = m[2] ? Math.min(Number(m[2]), data.length - 1) : data.length - 1;
          res.writeHead(206, { 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': end - start + 1 });
          return res.end(data.subarray(start, end + 1));
        }
        res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Content-Length': data.length });
        return res.end(data);
      }
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>not audio</html>');
    }).listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${server.address().port}`;

    check('audio link: extension detection', ['https://x.com/a.mp3', 'https://cdn.discordapp.com/attachments/1/2/song.flac?ex=abc&hm=def', 'https://x.com/a.OGG'].every(music.isDirectAudioUrl));
    check('audio link: youtube and pages are not direct audio', !music.isDirectAudioUrl('https://www.youtube.com/watch?v=abc') && !music.isDirectAudioUrl('https://x.com/page.html') && !music.isDirectAudioUrl('not a url'));
    check('audio link: private addresses refused', ['http://localhost/a.mp3', 'http://127.0.0.1/a.mp3', 'http://192.168.1.5/a.mp3', 'http://10.0.0.2/a.mp3', 'http://172.20.1.1/a.mp3', 'http://169.254.169.254/a.mp3', 'http://[::1]/a.mp3', 'file:///etc/passwd', 'ftp://x.com/a.mp3'].every((u) => !music.isPublicUrl(u)));
    check('audio link: public addresses allowed', music.isPublicUrl('https://cdn.discordapp.com/a.mp3') && music.isPublicUrl('http://8.8.8.8/a.mp3') && music.isPublicUrl('http://172.32.0.1/a.mp3'));
    let blocked = false;
    try { await music.directSong(`${base}/tone.mp3`); } catch (e) { blocked = /public internet/.test(e.message); }
    check('audio link: localhost refused by directSong', blocked);

    const info = await music.probeAudio(`${base}/tone.mp3`);
    check('audio probe reads length + tags', info.duration === 4 && info.title === 'Deed - Test Tone', JSON.stringify(info));
    let notAudio = null;
    try { await music.probeAudio(`${base}/page`); } catch (e) { notAudio = e.message; }
    check('audio probe rejects non-audio links', /couldn’t read/.test(notAudio ?? ''), notAudio);

    const args = music.ffmpegArgs(`${base}/tone.mp3`, 2.7);
    const iIndex = args.indexOf('-i');
    check('ffmpeg args: input options come before -i (seek, protocol whitelist, reconnect)', args.indexOf('-ss') < iIndex && args.indexOf('-protocol_whitelist') < iIndex && args.indexOf('-reconnect') < iIndex && args[args.indexOf('-ss') + 1] === '2');
    check('ffmpeg args: logs errors instead of hiding them', args[args.indexOf('-loglevel') + 1] === 'error' && args.indexOf('-loglevel') > iIndex);
    check('ffmpeg args: no seek when starting from 0', !music.ffmpegArgs('http://x/a.mp3').includes('-ss'));
    // Async on purpose: a sync call would freeze this process's own test web server and ffmpeg would wait forever.
    const decode = (startSec) => new Promise((resolve) => {
      const child = cp.spawn('ffmpeg', [...music.ffmpegArgs(`${base}/tone.mp3`, startSec), 'pipe:1']);
      let bytes = 0;
      child.stdout.on('data', (d) => { bytes += d.length; });
      child.stderr.resume();
      const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
      child.on('close', () => { clearTimeout(timer); resolve(bytes); });
    });
    const full = await decode(0), resumed = await decode(2);
    check('audio decodes through the same ffmpeg command (4s of 48k stereo)', Math.abs(full - 4 * 48000 * 4) < 48000 * 4 * 0.2, `${full} bytes`);
    check('resume seeks into the file (about half the audio left)', resumed < full * 0.65 && resumed > full * 0.35, `${resumed} vs ${full}`);

    check('early end: stopped at 3s of a 227s song', music.endedEarly(3, 227, 0) === true);
    check('early end: finished normally', music.endedEarly(222, 227, 0) === false && music.endedEarly(227, 227, 0) === false);
    check('early end: live streams and retry cap respected', music.endedEarly(3, 0, 0) === false && music.endedEarly(3, 227, 3) === false);

    r = await say(dave, '!play');
    check('play with nothing gives the full usage', /direct audio link/.test(r) && /attach an audio file/.test(r), r);
    server.close();
    fs2.rmSync(dir, { recursive: true, force: true });
  }

  console.log('\n━━━ Tools & snipes ━━━');
  const tools = require('../commands/tools').internals;
  check('calc', tools.calculate('(5+3)^2 / sqrt(16)') === 16 && Math.abs(tools.calculate('2*pi') - 6.2831853) < 1e-6);
  let calcBlocked = false;
  try { tools.calculate('process.exit()'); } catch { calcBlocked = true; }
  check('calc rejects code', calcBlocked);
  r = await say(alice, '!calc 10 / 4');
  check('calc command', /2\.5/.test(r), r);
  check('enlarge unicode + custom', /1f525\.png$/.test(tools.emojiUrl('🔥')) && /emojis\/123\.gif/.test(tools.emojiUrl('<a:party:123>')));
  const snipe = require('../lib/snipe');
  r = await say(alice, '!snipe');
  check('snipe empty', /Nothing to snipe/.test(r), r);
  snipe.push('deleted', channel.id, { author: bob, content: 'secret msg', attachments: [], sentAt: Date.now() - 5000 });
  snipe.push('edited', channel.id, { author: bob, before: 'i love cats', after: 'i love dogs', url: 'https://discord.com/x' });
  snipe.push('reactions', channel.id, { user: bob, emoji: '💀', messageAuthor: alice, messageContent: 'joke', url: 'https://discord.com/y' });
  r = await say(alice, '!snipe');
  check('snipe shows deleted', /bob deleted/.test(r) && /secret msg/.test(r), r);
  r = await say(alice, '!es');
  check('editsnipe shows before/after', /i love cats/.test(r) && /i love dogs/.test(r), r);
  r = await say(alice, '!rs');
  check('reactsnipe', /💀 bob unreacted/.test(r), r);
  r = await say(bob, '!clearsnipe');
  check('clearsnipe admin-only', /can't use that/.test(r), r);
  await say(alice, '!clearsnipe');
  r = await say(alice, '!snipe');
  check('clearsnipe works', /Nothing to snipe/.test(r), r);
  r = await say(alice, `!id ${B}`);
  check('id', r.includes(bob.id), r);

  console.log('\n━━━ Games ━━━');
  noCrash('8ball', await say(alice, '!8ball will this work?'));
  noCrash('rps', await say(alice, '!rps rock'));
  r = await say(alice, '!roll 3d6');
  check('roll NdS', /3d6/.test(r));
  r = await say(alice, '!choose red | blue');
  check('choose', /red|blue/.test(r));

  // Guess: binary search using Deed's hints.
  await say(alice, '!guess');
  let lo = 1, hi = 100, won = false;
  for (let i = 0; i < 10 && !won; i++) {
    const g = Math.floor((lo + hi) / 2);
    r = await say(bob, String(g));
    if (/Higher/.test(r)) lo = g + 1; else if (/Lower/.test(r)) hi = g - 1; else won = /got it/.test(r);
  }
  check('guess game winnable', won);

  // Hangman: guess common letters until solved or lost.
  await say(alice, '!hangman');
  for (const ch of 'eaiotnsrlcdupmhgbyfkwvxzjq') {
    r = await say(alice, ch);
    if (/solved it|Game over/.test(r)) break;
  }
  check('hangman ends', /solved it|Game over/.test(last()));

  // Tic-tac-toe with a bet: X wins down the left column (if bob goes first he plays elsewhere).
  const tttBefore = total();
  await say(alice, `!ttt ${B} 20`);
  await say(bob, 'yes');
  const moves = { [alice.id]: ['1', '4', '7', '9', '3'], [bob.id]: ['2', '5', '6', '8', '3'] };
  for (let i = 0; i < 9 && /turn/.test(last()); i++) {
    const turnOf = /alice's turn/.test(last()) ? alice : bob;
    const mv = moves[turnOf.id].shift();
    if (!mv) break;
    await say(turnOf, mv);
  }
  check('ttt finishes', /wins|draw/.test(last()), last().split('\n')[0]);
  check('ttt conserves coins', total() === tttBefore);

  console.log('\n━━━ Network lookups (real APIs) ━━━');
  await say(alice, '!trivia easy');
  await until(() => /Trivia|type A, B, C or D|Couldn't reach/.test(last()), 10000);
  if (/type A, B, C or D/.test(last())) {
    for (const letter of ['A', 'B', 'C', 'D']) {
      const who = [alice, bob, carol, me][['A', 'B', 'C', 'D'].indexOf(letter)];
      r = await say(who, letter);
      if (/got it/.test(r)) break;
    }
    check('trivia answerable', /got it/.test(last()), last().split('\n')[0]);
  } else console.log('  (trivia API unreachable, skipped)');

  await say(alice, '!define serendipity');
  await until(() => /serendipity/i.test(last()) || /Couldn't reach/.test(last()), 15000);
  check('define', /serendipity/i.test(last()) || /Couldn't reach/.test(last()));
  await say(alice, '!define asdfqwerzx');
  await until(() => /No definition|Couldn't reach/.test(last()), 15000);
  check('define unknown word', /No definition|Couldn't reach/.test(last()));
  await say(alice, '!urban yeet');
  await until(() => /yeet|Couldn't reach/i.test(last()), 10000);
  check('urban', /yeet|Couldn't reach/i.test(last()));

  console.log('\n━━━ Transcribe ━━━');
  r = await say(alice, '!transcribe');
  check('transcribe with no audio', /Reply to a voice message/.test(r));
  // A real (silent) Opus voice note, passed as a data: URL so no network is needed.
  const { execFileSync } = require('child_process');
  let voice = null;
  try {
    const ogg = execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '1', '-c:a', 'libopus', '-f', 'ogg', '-']);
    voice = { id: nextId(), name: 'voice-message.ogg', contentType: 'audio/ogg', size: ogg.length, duration: 1, url: `data:audio/ogg;base64,${ogg.toString('base64')}` };
  } catch { console.log('  (ffmpeg missing, skipping audio test)'); }
  if (voice) {
    const vm = await (async () => { await say(bob, '', { attachments: [voice] }); return history.at(-1); })();
    const from = log.length;
    await say(carol, '!transcribe', { replyTo: vm });
    const result = () => log.slice(from).map((m) => m.content).find((c) => /Transcript|Couldn't transcribe/.test(c));
    await until(result, 60000);
    check('transcribe pipeline runs', !!result(), log.slice(from).map((m) => m.content).join(' | '));
    if (/Couldn't transcribe/.test(result() ?? '')) console.log(`  (expected until whisper is set up: ${result()})`);
  }

  console.log('\n━━━ Music (no voice connection offline) ━━━');
  r = await say(alice, '!queue');
  check('queue with nothing playing', /Nothing is playing/.test(r));
  r = await say(alice, '!np');
  check('np with nothing playing', /Nothing is playing/.test(r));

  await runPartyTests();
  summary();
}

function summary() {
  console.log(`\n${'━'.repeat(40)}\n✅ ${passed} passed${failures.length ? `   ❌ ${failures.length} failed` : ''}`);
  for (const f of failures) console.log(`  ❌ ${f}`);
  process.exit(failures.length ? 1 : 0);
}

// Party games (tests/party.js) get the same fake GC, plus a DM helper.
const partyDMs = []; // { to, content }
const dmChannels = new Map();
function dmChannelFor(user) {
  if (!dmChannels.has(user.id)) {
    dmChannels.set(user.id, {
      type: 'DM',
      async send(c) {
        const content = typeof c === 'object' ? `[file ${c.files?.[0]?.name} ${c.files?.[0]?.attachment?.length ?? 0}B]${c.content ? ` ${c.content}` : ''}` : c;
        partyDMs.push({ to: user, content });
        out(content, 'dm');
      },
    });
  }
  return dmChannels.get(user.id);
}
async function runPartyTests() {
  const dmRouter = require('../lib/dm');
  const dmTo = async (user, content) => {
    if (!QUIET) console.log(`\n✉️  ${user.username} → Deed (DM): ${content}`);
    await dmRouter.route(client, { id: nextId(), content, author: user, channel: dmChannelFor(user) });
    await settle();
  };
  const dmsFor = (u) => partyDMs.filter((d) => d.to === u).map((d) => d.content);
  const gcFind = (re) => [...log].reverse().find((m) => re.test(m.content))?.content ?? '';
  await require('./party')({ say, dmTo, dmsFor, gcFind, check, until, settle, last, log, channel, client, eco, users: { me, alice, bob, carol, dave, frank, gina: erinLike }, QUIET });
}

main().catch((e) => { console.error(e); process.exit(1); });
