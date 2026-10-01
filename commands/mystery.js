// Murder mystery: social deduction with a story, secret roles over DMs, multi-option clues, searches,
// night events, trials, and murderer tricks (frame, clean, weapons).
//
// Flow: lobby → everyone DMs "ready" → roles by DM → prologue → [ night → morning → day (discuss + search)
//       → accusation vote → trial (defense, guilty/innocent) ] until one side wins.
const eco = require('../lib/economy');
const dm = require('../lib/dm');
const onboarding = require('../lib/onboarding');
const { data, save } = require('../lib/db');
const { SETTINGS, CHARACTERS, TRAITS, WEAPONS, ROLES, CLUE_INTROS, EVENTS, DEFAULT_WEAPON } = require('../lib/mystery-data');
const { pick, shuffle, resolveUser, awaitReply } = require('../lib/util');
const { card, color, ansiBlock } = require('../lib/format');
const art = require('../lib/mystery-art');

const ROLE_COLORS = {
  murderer: '#e0253a', accomplice: '#fb923c', detective: '#60a5fa', doctor: '#34d399',
  bodyguard: '#93c5fd', witness: '#fde68a', mayor: '#c4b5fd', jester: '#f472b6', guest: '#cbd5e1',
};
const avatarOf = (p) => p.user.displayAvatarURL?.({ format: 'png', dynamic: false, size: 256 });

// Post text with a generated image attached; if rendering fails, post the text alone.
async function sayWithArt(g, text, render, name = 'mystery.png') {
  let buffer = null;
  try { buffer = await Promise.race([render(), new Promise((_, rej) => setTimeout(() => rej(new Error('render timeout')), 12000))]); } catch (err) { console.error('[mystery art]', err.message); }
  return g.channel.send(buffer ? { content: text, files: [{ attachment: buffer, name }] } : text).catch(() => {});
}

const env = (k, d) => Number(process.env[k] ?? d);
const T = {
  ready: () => env('MM_READY_MS', 90000),
  day: (alive) => env('MM_DAY_MS', Math.min(180000, 45000 + 15000 * alive)),
  vote: () => env('MM_VOTE_MS', 45000),
  defense: () => env('MM_DEFENSE_MS', 20000),
  trial: () => env('MM_TRIAL_MS', 25000),
  night: () => env('MM_NIGHT_MS', 70000),
  min: () => env('MM_MIN_PLAYERS', 4),
};
const MAX_PLAYERS = 25;
const WIN_REWARD = 300;
const MVP_BONUS = 150;
const PLAY_REWARD = 50;

const games = new Map(); // channelId -> game
const playerGame = new Map(); // userId -> game

// ---------------------------------------------------------------- helpers
const label = (p) => `**${p.char.name}** (${p.user.username})`;
const plain = (p) => `${p.char.name} (${p.user.username})`;
const alive = (g) => g.players.filter((p) => p.alive);
const byId = (g, id) => g.players.find((p) => p.id === id);
const say = (g, text) => g.channel.send(text).catch(() => {});
const secs = (ms) => `${Math.round(ms / 1000)}s`;
const team = (p) => ROLES[p.role].team;
const isMurderTeam = (p) => team(p) === 'murderers';
// MVP points for things that actually helped your side (kills, saves, catches, good votes).
const award = (p, pts) => { if (p) p.points = (p.points ?? 0) + pts; };
const WILL_MAX = 300;
// Player-written text gets posted by the bot, so defuse mass pings and keep it inside the quote block.
const sanitize = (text) => String(text).replace(/@(everyone|here)/gi, '@\u200b$1').replace(/<@&/g, '<@\u200b&').replace(/\s*\n\s*/g, ' / ').trim();
function willLines(p, burned = false) {
  if (burned) return [`> 📜 ${p.char.name}’s will was found torn to shreds.`];
  if (!p.will) return [];
  return [`> 📜 **Last will of ${p.char.name}:** *${p.will}*`];
}
const voteWeight = (p) => (p.role === 'mayor' ? (p.revealed ? 3 : 2) : 1);

function numbered(g, filter = () => true) {
  return alive(g).filter(filter).map((p, i) => `\`${i + 1}\` ${plain(p)}`).join('\n');
}

// Match "2", "ashford", "colonel ashford", "bob", or a mention to an alive player.
function findTarget(g, text, filter = () => true) {
  const options = alive(g).filter(filter);
  const t = String(text).trim().toLowerCase().replace(/[<@!>]/g, '');
  if (!t) return null;
  if (/^\d+$/.test(t) && options[Number(t) - 1]) return options[Number(t) - 1];
  return options.find((p) => p.id === t || p.user.username.toLowerCase() === t)
    ?? options.find((p) => p.char.name.toLowerCase().includes(t) || p.user.username.toLowerCase().startsWith(t))
    ?? null;
}

// Resolve when pred() becomes true (re-checked via poke) or after ms.
function waitFor(g, pred, ms) {
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); g.waiter = null; resolve(); };
    const timer = setTimeout(done, ms);
    g.waiter = { pred, done };
    if (pred()) done();
  });
}
const poke = (g) => { if (g.waiter?.pred()) g.waiter.done(); };

function guestList(g) {
  return g.players.map((p) => {
    const t = p.traits;
    const status = p.alive ? (p.revealed ? ' · 🎩 **Mayor**' : '') : ` · ☠️ ${ROLES[p.role].emoji} ${ROLES[p.role].name}`;
    return `> ${p.alive ? '🎭' : '⚰️'} ${label(p)}, ${p.char.title}${status}\n> -# ${t.garment[0]} · ${t.scent[0]} · ${t.mark[0]}`;
  }).join('\n');
}

// ---------------------------------------------------------------- clues
// A clue lists 2–3 traits of one category; if it's true, one of them belongs to the killer.
// Red herrings (and frames) list only innocents' traits, so clues have to be cross-checked.
function makeClue(g, { culprit, truth = 0.65, anchor = null, options = null, intro = null, category = null }) {
  const cat = category ?? pick(Object.keys(TRAITS));
  const innocents = g.players.filter((p) => !isMurderTeam(p));
  let lead = anchor;
  if (!lead) lead = Math.random() < truth ? culprit : pick(innocents.filter((p) => p.alive)) ?? culprit;
  const optionCount = options ?? (g.day >= 3 || g.players.length <= 4 ? 2 : 3);
  const decoys = shuffle(g.players.filter((p) => p !== lead && p !== culprit && (p.alive || Math.random() < 0.3))).slice(0, optionCount - 1);
  const clue = {
    n: g.clues.length + 1,
    category: cat,
    intro: intro ?? pick(CLUE_INTROS[cat]),
    options: shuffle([lead, ...decoys]).map((p) => p.traits[cat][0]),
    day: g.day,
    truthful: lead === culprit,
  };
  g.clues.push(clue);
  return clue;
}
const clueText = (c) => `🔎 **Clue #${c.n}** · ${c.intro} ${c.options.map((o) => `**${o}**`).join(' · ')}`;

// ---------------------------------------------------------------- win conditions
function winner(g) {
  const murderers = alive(g).filter((p) => p.role === 'murderer').length;
  const teamAlive = alive(g).filter(isMurderTeam).length;
  const others = alive(g).length - teamAlive;
  if (murderers === 0 && teamAlive === 0) return 'town';
  if (murderers > 0 && teamAlive >= others) return 'murderers';
  return null;
}

// If every murderer is gone but an accomplice lives, they take over the knife.
function promoteAccomplice(g) {
  if (alive(g).some((p) => p.role === 'murderer')) return null;
  const heir = alive(g).find((p) => p.role === 'accomplice');
  if (!heir) return null;
  heir.role = 'murderer';
  heir.usedFrame = false;
  heir.usedClean = false;
  heir.dmChannel?.send(`## 🔪 You are the new Murderer\n> Your partner is gone. The knife is yours now. Each night: \`kill <#>\`. You also get one \`frame\` and one \`clean\`.`).catch(() => {});
  return heir;
}

function roleCard(g, p) {
  const r = ROLES[p.role];
  const partners = isMurderTeam(p) ? g.players.filter((x) => isMurderTeam(x) && x !== p) : [];
  const verb = (s) => s.replace(/^wears/, 'wear').replace(/^carries/, 'carry').replace(/^smells/, 'smell').replace(/^is /, 'are ')
    .replace(/^has /, 'have ').replace(/^walks/, 'walk').replace(/^chews/, 'chew').replace(/^whistles/, 'whistle').replace(/^hums/, 'hum').replace(/^bites/, 'bite');
  return [
    `## ${r.emoji} You are the ${r.name}`,
    `> 🎭 You play **${p.char.name}**, ${p.char.title}`,
    `> -# you ${verb(p.traits.garment[0])} · ${verb(p.traits.scent[0])} · ${verb(p.traits.mark[0])}`,
    `> ${r.goal}`,
    partners.length ? `> 🤝 Your side: ${partners.map((x) => `${label(x)} (${ROLES[x.role].name})`).join(', ')}` : null,
    `> ${r.how}`,
    `-# ${g.setting.emoji} ${g.setting.name} · keep this secret · DM me \`role\` anytime · \`will <text>\` to leave a last will`,
  ].filter(Boolean).join('\n');
}

function stats(userId) {
  data.mmStats ??= {};
  return (data.mmStats[userId] ??= { games: 0, wins: 0, kills: 0, murderer: 0, convictions: 0 });
}

function cleanup(g) {
  g.phase = 'over';
  if (g.waiter) g.waiter.done();
  games.delete(g.channel.id);
  for (const p of g.players) if (playerGame.get(p.id) === g) playerGame.delete(p.id);
}

// ---------------------------------------------------------------- DMs (roles, night actions)
const TARGET_FILTERS = {
  kill: (p) => (x) => !isMurderTeam(x),
  frame: (p) => (x) => !isMurderTeam(x),
  inspect: (p) => (x) => x.id !== p.id,
  protect: (p) => (x) => x.id !== p.lastProtect,
  guard: (p) => (x) => x.id !== p.id,
  watch: (p) => (x) => x.id !== p.id,
};

function nightPrompt(g, p) {
  const action = ROLES[p.role].night;
  const extras = p.role === 'murderer'
    ? `\n-# also: ${p.usedFrame ? '~~frame~~ (used)' : '`frame <#>`'} · ${p.usedClean ? '~~clean~~ (used)' : '`clean`'} · weapons: ${WEAPONS.map((w) => w[0].split(' ').pop()).join(', ')}`
    : p.role === 'accomplice' ? '\n-# or `skip`' : '';
  return `### ${ROLES[p.role].emoji} Night ${g.day}\n> Reply \`${action} <number or name>\`:\n${numbered(g, TARGET_FILTERS[action](p)).split('\n').map((l) => `> ${l}`).join('\n')}${extras}`;
}

dm.onDM(async (client, message) => {
  const g = playerGame.get(message.author.id);
  if (!g || g.phase === 'over' || g.phase === 'lobby') return false;
  const p = byId(g, message.author.id);
  p.dmChannel = message.channel;
  const reply = (text) => message.channel.send(text).catch(() => {});
  const text = message.content.trim();

  if (g.phase === 'ready') {
    if (!p.ready) {
      p.ready = true;
      await reply(`### ✅ You're in!\n> Your secret role arrives when everyone is ready.\n-# ${g.players.filter((x) => x.ready).length}/${g.players.length} ready`);
      poke(g);
    } else await reply('⏳ Waiting for everyone else to DM me `ready`…');
    return true;
  }
  if (/^role$/i.test(text)) { await reply(roleCard(g, p)); return true; }

  // Last will: revealed when you die. Murderers can write a fake one.
  const willMatch = /^will\b\s*([\s\S]*)$/i.exec(text);
  if (willMatch) {
    if (!p.alive) { await reply('📜 Too late for that. Your will was read when you died.'); return true; }
    const body = sanitize(willMatch[1]);
    if (!body) { await reply(p.will ? `### 📜 Your will\n> *${p.will}*\n-# \`will <text>\` to rewrite it` : '📜 Reply `will <text>` to write a last will. It’s read out if you die.'); return true; }
    p.will = body.slice(0, WILL_MAX);
    await reply(`### 📜 Will saved\n> *${p.will}*${body.length > WILL_MAX ? `\n-# trimmed to ${WILL_MAX} characters` : ''}\n-# it’s read out if you die · rewrite it anytime`);
    return true;
  }

  if (!p.alive) {
    // Ghosts get one anonymous haunt during the day, so dead players still have a say.
    const haunt = /^haunt\s+(.+)$/i.exec(text);
    if (!haunt) { await reply(p.haunted ? '👻 You’re dead, and you’ve already used your haunt. No spoilers!' : '👻 You’re dead. During the day you can `haunt <#>` once: the chat sees an anonymous ghost pointing at that guest.'); return true; }
    if (p.haunted) { await reply('👻 You already used your haunt this game.'); return true; }
    if (g.phase !== 'day' && g.phase !== 'vote') { await reply('👻 Ghosts can only haunt during the day.'); return true; }
    const target = findTarget(g, haunt[1]);
    if (!target) { await reply(`👻 Reply \`haunt <number or name>\`:\n${numbered(g)}`); return true; }
    p.haunted = true;
    await reply(`👻 You drift toward ${label(target)}…`);
    await say(g, `### 👻 The candles gutter\n> A cold hand settles on ${label(target)}’s shoulder. One of the dead is pointing at them.\n-# ghosts can be from either side`);
    return true;
  }

  const action = ROLES[p.role].night;
  if (g.phase !== 'night' || !action) {
    await reply(g.phase === 'night' ? '🌙 You have no night action. Sleep with one eye open…' : '☀️ It’s daytime. Discuss, search and vote in the group chat.\n-# DM me `role` to see your role');
    return true;
  }
  const n = g.night;
  const lower = text.toLowerCase();

  // Murderer tricks.
  if (p.role === 'murderer' && lower === 'clean') {
    if (p.usedClean) { await reply('🧹 You already used your clean-up this game.'); return true; }
    p.usedClean = true;
    n.clean = true;
    await reply('### 🧹 Tonight you’ll clean up after yourself\n> The kill will leave no clues.');
    return true;
  }
  if (p.role === 'murderer' && lower.startsWith('frame')) {
    if (p.usedFrame) { await reply('🎭 You already used your frame this game.'); return true; }
    const target = findTarget(g, text.slice(5), TARGET_FILTERS.frame(p));
    if (!target) { await reply(`🎭 Reply \`frame <number or name>\`:\n${numbered(g, TARGET_FILTERS.frame(p))}`); return true; }
    p.usedFrame = true;
    n.frameClue = target.id;
    n.frames.add(target.id);
    await reply(`### 🎭 Framing ${label(target)}\n> Tonight’s clues will point at them, and the detective will see them as suspicious.`);
    return true;
  }
  if (p.role === 'accomplice' && lower === 'skip') {
    n.acted.add(p.id);
    await reply('🤝 You lie low tonight.');
    poke(g);
    return true;
  }

  const m = new RegExp(`^(?:${action}\\s+)?(.+?)(?:\\s+with\\s+(.+))?$`, 'i').exec(text);
  const target = m && findTarget(g, m[1], TARGET_FILTERS[action](p));
  if (!target) { await reply(nightPrompt(g, p)); return true; }

  if (action === 'kill') {
    const weaponWord = m[2]?.toLowerCase();
    const weapon = weaponWord ? WEAPONS.find((w) => w[0].includes(weaponWord)) : null;
    n.kill = target.id;
    n.killer = p.id;
    n.weapon = weapon ?? n.weapon;
    await reply(`### 🔪 Target: ${label(target)}${weapon ? ` · ${weapon[0]}` : ''}\n-# you can change your mind until morning`);
    for (const partner of alive(g).filter((x) => isMurderTeam(x) && x !== p)) {
      partner.dmChannel?.send(`🔪 ${p.char.name} chose ${label(target)} as tonight's target.`).catch(() => {});
    }
  } else if (action === 'frame') {
    n.frames.add(target.id);
    await reply(`### 🎭 Framing ${label(target)}\n> The detective will see them as suspicious tonight.`);
  } else if (action === 'protect') {
    n.protects.add(target.id);
    p.pendingProtect = target.id;
    await reply(`### 💉 You'll watch over ${label(target)} tonight`);
  } else if (action === 'guard') {
    n.guards.set(p.id, target.id);
    await reply(`### 🛡️ You'll stand guard over ${label(target)} tonight\n-# if the killer comes, you take the hit`);
  } else if (action === 'inspect') {
    n.inspects.set(p.id, target.id);
    await reply(`### 🔍 You investigate ${label(target)}\n-# your findings arrive at dawn`);
  } else if (action === 'watch') {
    n.watches.set(p.id, target.id);
    await reply(`### 👁️ You keep an eye on ${label(target)}’s door\n-# your report arrives at dawn`);
  }
  // Everyone acting tonight leaves their room (the witness sees this). Only the latest choice counts.
  if (action !== 'kill') n.visits.set(p.id, target.id);
  n.acted.add(p.id);
  poke(g);
  return true;
});

// ---------------------------------------------------------------- game flow
async function readyPhase(g) {
  g.phase = 'ready';
  await say(g, card({
    title: 'Check your DMs… well, send one', emoji: '📬',
    body: [
      `Everyone playing: **DM me \`ready\`** within ${secs(T.ready())}.`,
      'I’ll reply there with your secret role. Nobody else will see it.',
      '',
      ...g.players.map((p) => `• ${p.user.username}`),
    ],
    footer: 'players who don’t DM in time are left out',
  }));
  await waitFor(g, () => g.players.every((p) => p.ready), T.ready());
  const missing = g.players.filter((p) => !p.ready);
  for (const p of missing) playerGame.delete(p.id);
  g.players = g.players.filter((p) => p.ready);
  if (missing.length) await say(g, `-# left out (no DM): ${missing.map((p) => p.user.username).join(', ')}`);
}

// Role mix scales with the lobby. The murder team stays around a fifth to a quarter of the table,
// since clues, searches and the info roles give the guests a lot to work with.
function roleList(n) {
  const murderers = n >= 17 ? 3 : n >= 11 ? 2 : 1;
  const roles = Array(murderers).fill('murderer');
  if (n >= 7) roles.push('accomplice');
  roles.push('detective');
  if (n >= 15) roles.push('detective');
  if (n >= 5) roles.push('doctor');
  if (n >= 6) roles.push('jester');
  if (n >= 8) roles.push('mayor');
  if (n >= 9) roles.push('witness');
  if (n >= 10) roles.push('bodyguard');
  while (roles.length < n) roles.push('guest');
  return roles;
}

function assignRoles(g) {
  const shuffledRoles = shuffle(roleList(g.players.length));
  const chars = shuffle([...CHARACTERS]);
  const traitPools = Object.fromEntries(Object.entries(TRAITS).map(([k, v]) => [k, shuffle([...v])]));
  g.players.forEach((p, i) => {
    p.role = shuffledRoles[i];
    p.startRole = p.role;
    p.char = { name: chars[i][0], title: chars[i][1] };
    p.traits = { garment: traitPools.garment[i], scent: traitPools.scent[i], mark: traitPools.mark[i] };
  });
}

async function prologue(g) {
  const s = g.setting;
  const weapon = pick(WEAPONS);
  const room = pick(s.rooms);
  const culprit = pick(g.players.filter((p) => p.role === 'murderer'));
  const clue = makeClue(g, { culprit, truth: 0.6, options: 3 });
  g.events.push(`Prologue: ${s.host} was ${weapon[1]} in the ${room}.`);
  await say(g, [
    `# ${s.emoji} ${s.name}`,
    `> *${s.intro}*`,
    '',
    `> At the stroke of midnight a scream echoes through the ${room}. **${s.host}** is found ${s.hostFound}, ${weapon[1]}.`,
    '> Someone in this room did it. And they’re not finished.',
    '',
    clueText(clue),
    '-# each clue lists 2–3 traits; if it’s true, one belongs to the killer. some clues are red herrings.',
  ].join('\n'));
  await say(g, `### 🎭 The guests\n${guestList(g)}\n-# \`mm clues\` to review · \`mm guests\` for this list`);
}

async function nightPhase(g) {
  g.day++;
  g.phase = 'night';
  g.night = { kill: null, killer: null, weapon: null, protects: new Set(), guards: new Map(), frames: new Set(), frameClue: null, clean: false, inspects: new Map(), watches: new Map(), visits: new Map(), acted: new Set() };
  const s = g.setting;
  await say(g, `### 🌙 Night ${g.day}\n> *${pick(s.night)}*\n> Everyone returns to their rooms. Those with a night role: check your DMs.\n-# night ends in ${secs(T.night())} or when everyone has acted`);

  const actors = () => alive(g).filter((p) => ROLES[p.role].night);
  for (const p of actors()) p.dmChannel?.send(nightPrompt(g, p)).catch(() => {});

  const done = () => actors().every((p) => (p.role === 'murderer' ? g.night.kill : g.night.acted.has(p.id)));
  await waitFor(g, done, T.night());
  g.phase = 'resolving';
  const n = g.night;

  for (const p of g.players) if (p.role === 'doctor') { p.lastProtect = p.pendingProtect ?? null; p.pendingProtect = null; }

  // Detective results (after frames, so the order people act in doesn't matter).
  for (const [detId, targetId] of n.inspects) {
    const det = byId(g, detId), target = byId(g, targetId);
    const suspicious = target.role === 'murderer' || n.frames.has(target.id);
    if (target.role === 'murderer') award(det, 2);
    det.dmChannel?.send(`### 🔍 Dawn report: ${label(target)} looks ${suspicious ? '**SUSPICIOUS** 🔪' : '**innocent** 😇'}\n-# framed people look suspicious, and the accomplice looks innocent`).catch(() => {});
  }

  // Who dies. Idle murderers still strike, at random.
  const murderers = alive(g).filter((p) => p.role === 'murderer');
  let victim = n.kill ? byId(g, n.kill) : null;
  if (!victim?.alive) victim = pick(alive(g).filter((p) => !isMurderTeam(p)));
  const killer = byId(g, n.killer) ?? pick(murderers);
  n.visits.set(killer.id, victim.id);
  const weapon = n.weapon ?? pick(WEAPONS);
  const room = pick(s.rooms);
  g.lastRoom = room;

  // Witness reports: who left their room, and where they went. Frames don't matter here.
  for (const [witId, targetId] of n.watches) {
    const wit = byId(g, witId), target = byId(g, targetId);
    const went = n.visits.has(target.id) ? byId(g, n.visits.get(target.id)) : null;
    if (went && isMurderTeam(target)) award(wit, 2);
    wit.dmChannel?.send(went
      ? `### 👁️ Dawn report: ${label(target)} **left their room** in the night\n> You saw them slip into ${label(went)}’s room.\n-# every night role moves around, not only killers`
      : `### 👁️ Dawn report: ${label(target)} **never left their room**`).catch(() => {});
  }

  const events = EVENTS.filter((e) => alive(g).length >= (e.min ?? 0));
  const event = process.env.MM_EVENTS === 'off' ? null : events.find((e) => Math.random() < e.chance);
  const noClues = n.clean || event?.id === 'outage';
  const bodyguard = [...n.guards].find(([, t]) => t === victim.id)?.[0];

  await say(g, `### 🌅 Morning\n> *${pick(s.morning)}*${event ? `\n> ${event.text}` : ''}`);
  const lines = [];
  let dead = null;
  if (bodyguard && byId(g, bodyguard).alive) {
    dead = byId(g, bodyguard);
    dead.alive = false;
    stats(killer.id).kills++;
    killer.kills = (killer.kills ?? 0) + 1;
    award(killer, 3);
    award(dead, 3);
    lines.push(`### 🛡️ ${dead.char.name} died a hero`, `> ${label(dead)} threw themselves in front of ${label(victim)} in the **${room}** and was ${weapon[1]}.`,
      `> They were the **Bodyguard** 🛡️. With their last breath they saw something…`, ...willLines(dead));
    const c = makeClue(g, { culprit: killer, anchor: killer, options: 2 });
    lines.push('', clueText(c));
    g.events.push(`Night ${g.day}: ${plain(dead)} (Bodyguard) died protecting ${plain(victim)} from ${plain(killer)}.`);
  } else if (n.protects.has(victim.id)) {
    for (const doc of alive(g).filter((x) => x.role === 'doctor' && n.visits.get(x.id) === victim.id)) award(doc, 3);
    lines.push('### 💉 A close call', `> ${label(victim)} was attacked in the **${room}**, but someone got there just in time. They’re shaken, but alive.`);
    if (!noClues) lines.push('', clueText(makeClue(g, { culprit: killer, anchor: n.frameClue ? byId(g, n.frameClue) : null })));
    g.events.push(`Night ${g.day}: ${plain(victim)} was attacked by ${plain(killer)}, but the Doctor saved them.`);
  } else {
    dead = victim;
    victim.alive = false;
    stats(killer.id).kills++;
    killer.kills = (killer.kills ?? 0) + 1;
    award(killer, 3);
    lines.push(`### ⚰️ ${victim.char.name} is dead`, `> ${label(victim)} is found in the **${room}**, ${weapon[1]}.`,
      `> They were the **${ROLES[victim.role].name}** ${ROLES[victim.role].emoji}.`, ...willLines(victim, n.clean && !!victim.will));
    g.events.push(`Night ${g.day}: ${plain(victim)} (${ROLES[victim.role].name}) was ${weapon[1]} in the ${room} by ${plain(killer)}${n.clean ? ' (cleaned up)' : ''}${n.frameClue ? `, framing ${plain(byId(g, n.frameClue))}` : ''}.`);
    if (!noClues) {
      const clueCount = g.players.length >= 6 ? 2 : 1;
      const first = makeClue(g, { culprit: killer, anchor: n.frameClue ? byId(g, n.frameClue) : null });
      lines.push('', clueText(first));
      if (clueCount > 1) lines.push(clueText(makeClue(g, { culprit: killer, truth: 0.55 })));
    } else if (n.clean) {
      lines.push('', '> 🧹 The scene is spotless. Whoever did this cleaned up.');
    }
  }
  if (event?.id === 'seance' && dead) lines.push(clueText(makeClue(g, { culprit: killer, truth: 0.85, options: 2, intro: `👻 ${dead.char.name}’s ghost whispers that the killer:` })));
  if (event?.id === 'dog') lines.push(clueText(makeClue(g, { culprit: killer, truth: 0.6, options: 2, intro: `🐕 The dog was barking at someone who:` })));
  if (event?.id === 'diary') {
    const cleared = pick(alive(g).filter((p) => !isMurderTeam(p) && !p.cleared));
    if (cleared) {
      cleared.cleared = true;
      lines.push(`> 📖 *“${cleared.char.name} could never hurt a soul.”* ${label(cleared)} is **not** a killer.`);
      g.events.push(`Night ${g.day}: a diary page cleared ${plain(cleared)}.`);
    }
  }

  const shown = dead ?? victim;
  const kind = !dead ? 'saved' : dead.role === 'bodyguard' && dead !== victim ? 'hero' : 'dead';
  await sayWithArt(g, lines.join('\n'), () => art.sceneCard({
    kind,
    headline: `Night ${g.day} · ${s.name}`,
    name: shown.char.name,
    subtitle: `@${shown.user.username} · ${shown.char.title}`,
    role: dead ? ROLES[dead.role].name : null,
    roleColor: dead ? ROLE_COLORS[dead.role] : null,
    lines: kind === 'saved'
      ? [`Attacked in the ${room}`, 'but someone got there just in time']
      : kind === 'hero' ? [`Took the blow meant for ${victim.char.name}`, `in the ${room}`] : [`Found in the ${room}`, weapon[1]],
    avatarUrl: avatarOf(shown),
    footer: `${alive(g).length} guests remain`,
  }), `night-${g.day}.png`);
}

async function dayPhase(g) {
  g.phase = 'day';
  g.skip = false;
  g.searched = new Map(); // room -> player who searched it today
  const ms = T.day(alive(g).length);
  await say(g, card({
    title: `Day ${g.day} · Investigation`, emoji: '☀️',
    body: [
      'Cross-check the clues against the guests’ traits. Accuse, defend, lie.',
      `🔍 Everyone alive can **\`mm search <room>\`** once today, and each room can only be searched once. Rooms: ${g.setting.rooms.join(', ')}.`,
      g.lastRoom ? `-# last night’s scene: the ${g.lastRoom} (best odds of evidence)` : null,
      '-# 🎩 a Mayor can `mm reveal` · 👻 the dead can DM me `haunt <#>` once',
    ],
    footer: `accusations open in ${secs(ms)} · host can \`mm skip\` · ${alive(g).length} alive · \`mm clues\``,
  }));
  await waitFor(g, () => g.skip, ms);
}

function tally(g) {
  const counts = new Map();
  for (const target of g.votes.values()) counts.set(target, (counts.get(target) ?? 0) + 1);
  return counts;
}
const accusationsNeeded = (g) => Math.max(2, Math.ceil(alive(g).length * 0.4));

function voteBoard(g, closed = false) {
  const counts = tally(g);
  const rows = alive(g).map((p) => {
    const n = counts.get(p.id) ?? 0;
    return `${color(p.char.name.padEnd(20), 'white')} ${color('█'.repeat(n) || '·', n ? 'red' : 'gray', true)} ${n ? color(String(n), 'red') : ''}`;
  });
  const skips = counts.get('skip') ?? 0;
  rows.push(`${color('skip'.padEnd(20), 'gray')} ${color('█'.repeat(skips) || '·', 'gray')} ${skips || ''}`);
  return [
    `### 🗳️ Day ${g.day} · ${closed ? 'Accusations are in' : 'Who should stand trial?'}`,
    closed ? null : `> \`vote <number or name>\` or \`vote skip\` · needs **${accusationsNeeded(g)}** votes to go to trial\n${numbered(g).split('\n').map((l) => `> ${l}`).join('\n')}`,
    ansiBlock(rows),
    `-# ${g.votes.size}/${alive(g).length} voted${closed ? '' : ` · ${secs(T.vote())} · you can change your vote`}`,
  ].filter(Boolean).join('\n');
}

function trialBoard(g, closed = false) {
  const { accused, votes } = g.trial;
  let guilty = 0, innocent = 0;
  for (const [id, v] of votes) {
    const w = voteWeight(byId(g, id));
    if (v === 'guilty') guilty += w; else innocent += w;
  }
  return {
    guilty, innocent,
    text: [
      `### ⚖️ Trial of ${accused.char.name}${closed ? ' · verdict' : ''}`,
      closed ? null : '> Type **`guilty`** or **`innocent`** (the accused can’t vote)',
      ansiBlock([`${color('GUILTY  ', 'red', true)} ${color('█'.repeat(guilty) || '·', 'red', true)} ${guilty}`, `${color('INNOCENT', 'green', true)} ${color('█'.repeat(innocent) || '·', 'green', true)} ${innocent}`]),
      `-# ${votes.size}/${alive(g).length - 1} voted · a tie means innocent${closed ? '' : ` · ${secs(T.trial())}`}`,
    ].filter(Boolean).join('\n'),
  };
}

async function votePhase(g) {
  g.phase = 'vote';
  g.votes = new Map();
  g.voteMsg = await g.channel.send(voteBoard(g));
  await waitFor(g, () => g.votes.size >= alive(g).length, T.vote());
  g.phase = 'resolving';
  await g.voteMsg.edit(voteBoard(g, true)).catch(() => {});

  const counts = [...tally(g).entries()].filter(([id]) => id !== 'skip').sort((a, b) => b[1] - a[1]);
  const [top, second] = counts;
  const skips = tally(g).get('skip') ?? 0;
  if (!top || top[1] < accusationsNeeded(g) || (second && second[1] === top[1]) || skips >= top[1]) {
    g.events.push(`Day ${g.day}: nobody got enough accusations for a trial.`);
    return say(g, `### ⚖️ No trial today\n> ${!top ? 'Nobody was accused.' : `Not enough agreement (needed ${accusationsNeeded(g)} votes, no ties).`}`);
  }
  return trialPhase(g, byId(g, top[0]));
}

async function trialPhase(g, accused) {
  g.trial = { accused, votes: new Map() };
  g.phase = 'defense';
  await say(g, `### ⚖️ ${accused.char.name} is on trial!\n> <@${accused.id}>, you have **${secs(T.defense())}** to defend yourself. Everyone else: listen.`);
  await waitFor(g, () => false, T.defense());
  g.phase = 'trial';
  g.trialMsg = await g.channel.send(trialBoard(g).text);
  // Plain "guilty" / "innocent" messages count too (no prefix needed during a trial).
  let open = true;
  (async () => {
    while (open && g.phase === 'trial') {
      const m = await awaitReply(g.channel, (x) => /^(guilty|innocent)$/i.test(x.content.trim()), 1000);
      if (m && open) castVerdict(g, m, m.content.trim().toLowerCase());
    }
  })().catch(() => {});
  await waitFor(g, () => g.trial.votes.size >= alive(g).length - 1, T.trial());
  open = false;
  g.phase = 'resolving';
  const { guilty, innocent, text } = trialBoard(g, true);
  await g.trialMsg.edit(text).catch(() => {});

  if (guilty <= innocent) {
    g.events.push(`Day ${g.day}: ${plain(accused)} was tried and found innocent (${guilty}–${innocent}).`);
    return sayWithArt(g, `### 🕊️ ${accused.char.name} is acquitted\n> The vote was ${guilty}–${innocent}. They walk free, for now.`, () => art.sceneCard({
      kind: 'acquitted', headline: `Day ${g.day} · The trial`, name: accused.char.name, subtitle: `@${accused.user.username} · ${accused.char.title}`,
      lines: [`Acquitted ${guilty} to ${innocent}`, 'walks free, for now'], avatarUrl: avatarOf(accused),
    }), `trial-${g.day}.png`);
  }
  accused.alive = false;
  const r = ROLES[accused.role];
  // Voting right helps your side: guilty on the murder team for guests, guilty on an innocent for the murder team.
  for (const [id, v] of g.trial.votes) {
    const voter = byId(g, id);
    if (v === 'guilty' && isMurderTeam(accused) !== isMurderTeam(voter)) award(voter, 2);
  }
  if (isMurderTeam(accused)) stats(accused.id); // make sure an entry exists
  for (const [id, v] of g.trial.votes) if (v === 'guilty' && accused.role === 'murderer') stats(id).convictions++;
  g.events.push(`Day ${g.day}: ${plain(accused)} was convicted ${guilty}–${innocent}. They were the ${r.name}.`);
  const lines = [
    `### ⛓️ ${accused.char.name} is found guilty`,
    `> The door to the cellar slams shut. As they’re dragged away, the truth comes out…`,
    `> ${label(accused)} was ${accused.role === 'murderer' ? '**a MURDERER!** 🔪' : accused.role === 'accomplice' ? '**the ACCOMPLICE!** 🤝' : `the **${r.name}** ${r.emoji}. Innocent.`}`,
    ...willLines(accused),
  ];
  if (accused.role === 'jester') {
    g.jesterWinner = accused;
    award(accused, 5);
    lines.push('', '> 🃏 **…and they’re laughing.** The Jester wanted this. **The Jester wins!**');
  }
  const heir = promoteAccomplice(g);
  if (heir) lines.push('', '> 🔪 *Somewhere in the house, someone picks up the knife…* (the killing isn’t over)');
  return sayWithArt(g, lines.join('\n'), () => art.sceneCard({
    kind: 'guilty', headline: `Day ${g.day} · The trial`, name: accused.char.name, subtitle: `@${accused.user.username} · ${accused.char.title}`,
    role: accused.role === 'jester' ? 'Jester · wins!' : r.name, roleColor: ROLE_COLORS[accused.role],
    lines: [`Convicted ${guilty} to ${innocent}`, isMurderTeam(accused) ? 'caught red-handed' : 'an innocent guest…'], avatarUrl: avatarOf(accused),
  }), `trial-${g.day}.png`);
}

async function finale(g, side) {
  g.phase = 'over';
  const winners = g.players.filter((p) => (side === 'town' ? team(p) === 'town' : team(p) === 'murderers'));
  if (g.jesterWinner) winners.push(g.jesterWinner);
  const score = (p) => (p.points ?? 0) + (p.alive ? 1 : 0);
  const mvp = [...winners].sort((a, b) => score(b) - score(a))[0];
  for (const p of g.players) {
    const s = stats(p.id);
    s.games++;
    if (p.startRole === 'murderer' || p.role === 'murderer') s.murderer++;
    if (winners.includes(p)) s.wins++;
    eco.add(p.id, winners.includes(p) ? WIN_REWARD + (p === mvp ? MVP_BONUS : 0) : PLAY_REWARD);
  }
  save();
  const roleLines = g.players.map((p) => `> ${ROLES[p.startRole].emoji} ${label(p)}: **${ROLES[p.startRole].name}**${p.startRole !== p.role ? ` → ${ROLES[p.role].name}` : ''}${p.alive ? '' : ' ☠️'}${p === mvp ? ' 🏅 MVP' : ''}`);
  await sayWithArt(g, [
    side === 'town'
      ? `# 🎉 The guests win!\n> Every murderer has been caught. ${g.setting.name} is safe… for now.`
      : `# 🔪 The murderers win!\n> By dawn, there's nobody left to stop them.`,
    g.jesterWinner ? `> 🃏 ${label(g.jesterWinner)} the Jester also wins.` : null,
    '',
    '### 🎭 The truth',
    ...roleLines,
    '',
    '### 📜 What happened',
    ...g.events.map((e) => `> ${e}`),
    `-# winners +🪙 ${WIN_REWARD} · MVP +🪙 ${MVP_BONUS} · everyone else +🪙 ${PLAY_REWARD} · \`mm stats\``,
  ].filter((l) => l !== null).join('\n'), () => art.gameOverCard({
    side,
    setting: g.setting.name,
    days: g.day,
    players: g.players.map((p) => ({
      name: p.user.username, char: p.char.name, role: ROLES[p.startRole].name, roleColor: ROLE_COLORS[p.startRole],
      alive: p.alive, avatarUrl: avatarOf(p), mvp: p === mvp, winner: winners.includes(p),
    })),
  }), 'game-over.png');
}

async function runGame(g) {
  try {
    await readyPhase(g);
    if (g.phase === 'over') return;
    if (g.players.length < T.min()) {
      await say(g, `### 🎭 Game cancelled\n> Only ${g.players.length} player${g.players.length === 1 ? '' : 's'} DMed me. Need at least ${T.min()}.`);
      return;
    }
    assignRoles(g);
    for (const p of g.players) await p.dmChannel?.send(roleCard(g, p)).catch(() => {});
    await prologue(g);
    for (;;) {
      // The murderer always gets a night before the first vote.
      await nightPhase(g);
      let w = winner(g);
      if (w) return finale(g, w);
      if (g.phase === 'over') return;
      await dayPhase(g);
      if (g.phase === 'over') return;
      await votePhase(g);
      if (g.phase === 'over') return;
      w = winner(g);
      if (w) return finale(g, w);
    }
  } catch (err) {
    console.error('[mystery]', err);
    say(g, `⚠️ The mystery crashed: ${err.message}`);
  } finally {
    cleanup(g);
  }
}

// ---------------------------------------------------------------- day actions
const NOTHING = ['dust and old letters', 'a mouse, which is now very upset', 'nothing but cobwebs', 'a half-eaten sandwich (not evidence)', 'a creaky floorboard and nothing else'];

function search(g, p, roomText) {
  const t = roomText.trim().toLowerCase();
  const room = t ? g.setting.rooms.find((r) => r.toLowerCase().includes(t)) ?? null : null;
  if (!room) return { error: `Search where? Rooms: ${g.setting.rooms.join(', ')}` };
  g.searched ??= new Map();
  const by = g.searched.get(room);
  if (by) return { error: `The ${room} was already searched today by ${by.char.name}. Try another room.` };
  g.searched.set(room, p);
  const hot = room === g.lastRoom;
  // The murder team "finds nothing": they pocket or wipe whatever was there.
  if (isMurderTeam(p)) {
    if (hot) g.events.push(`Day ${g.day}: ${plain(p)} (${ROLES[p.role].name}) searched the crime scene and destroyed the evidence.`);
    return { nothing: pick(NOTHING) };
  }
  const culprit = pick(alive(g).filter((x) => x.role === 'murderer')) ?? pick(g.players.filter((x) => x.role === 'murderer'));
  if (Math.random() < (hot ? 0.75 : 0.35) && culprit) {
    const clue = makeClue(g, { culprit, truth: hot ? 0.7 : 0.55, options: 2, intro: `In the ${room}, ${p.char.name} finds evidence that the killer:` });
    return { clue };
  }
  return { nothing: pick(NOTHING) };
}

function castVerdict(g, message, verdict) {
  const voter = byId(g, message.author.id);
  if (!voter || !voter.alive) return message.reply('Only living players can vote.');
  if (voter === g.trial.accused) return message.reply('You’re the one on trial. 👀');
  g.trial.votes.set(voter.id, verdict);
  g.trialMsg?.edit(trialBoard(g).text).catch(() => {});
  message.react?.(verdict === 'guilty' ? '⛓️' : '🕊️').catch(() => {});
  poke(g);
}

// ---------------------------------------------------------------- commands
function lobbyText(g, p) {
  return card({
    title: 'Murder Mystery · lobby', emoji: '🔪',
    body: [
      `Hosted by **${g.host.username}** · ${g.players.length}/${MAX_PLAYERS} players (min ${T.min()})`,
      '',
      ...g.players.map((x) => `• ${x.user.username}`),
      '',
      'Secret roles by DM · clues point at traits (some lie) · searches · trials · night events',
      `Roles at this size: ${[...new Set(roleList(Math.max(g.players.length, T.min())))].map((r) => ROLES[r].emoji).join(' ')}`,
    ],
    footer: `${p}mm join · ${p}mm leave · host: ${p}mm start`,
  });
}

const newPlayer = (user) => ({ id: user.id, user, alive: true, ready: false, role: null, char: null, traits: null, dmChannel: null, lastProtect: null });

module.exports = [
  {
    name: 'mystery',
    aliases: ['mm', 'murder', 'murdermystery'],
    usage: 'mm [join | leave | start | stop | skip | search <room> | reveal | clues | guests | roles | stats]',
    description: 'Murder mystery: secret roles by DM, murders, clues, searches, trials (4–25 players).',
    async run({ client, message, args, config }) {
      const p = config.prefix;
      const sub = (args[0] ?? '').toLowerCase();
      const ch = message.channel;
      const me = message.author;
      let g = games.get(ch.id);
      const isHost = g && (g.host.id === me.id || config.isAdmin(me.id, client) || onboarding.isGcManager(ch, me.id));

      if (sub === 'stats') {
        const user = (await resolveUser(client, message, args[1])) ?? me;
        const s = stats(user.id);
        return ch.send(card({
          title: `${user.username}'s mystery record`, emoji: '🔪',
          body: [`🎮 **${s.games}** games · 🏆 **${s.wins}** wins (${s.games ? Math.round((s.wins / s.games) * 100) : 0}%)`, `🔪 **${s.kills}** kills · played murderer **${s.murderer}**×`, `⚖️ **${s.convictions}** murderers convicted`],
        }));
      }
      if (sub === 'roles') {
        return ch.send(`### 🎭 Roles\n${Object.values(ROLES).map((r) => `> ${r.emoji} **${r.name}**: ${r.goal}`).join('\n')}\n-# 4: 🔪🔍 · 5: +💉 · 6: +🃏 · 7: +🤝 · 8: +🎩 · 9: +👁️ · 10: +🛡️ · 11: 2nd 🔪 · 15: 2nd 🔍 · 17: 3rd 🔪\n-# everyone: DM me \`will <text>\` for a last will · the dead can \`haunt <#>\` once`);
      }

      if (!g) {
        if (sub && !['start', 'join', 'new', 'host'].includes(sub)) return message.reply(`No game running. Start one with \`${p}mm\`.`);
        if (playerGame.has(me.id)) return message.reply("You're already in a murder mystery somewhere else.");
        g = { channel: ch, host: me, phase: 'lobby', players: [newPlayer(me)], setting: pick(SETTINGS), clues: [], events: [], day: 0, votes: new Map() };
        games.set(ch.id, g);
        playerGame.set(me.id, g);
        g.lobbyMsg = await ch.send(lobbyText(g, p));
        return;
      }

      if (sub === 'join') {
        if (g.phase !== 'lobby') return message.reply('The game already started. Catch the next one!');
        if (me.id === client.user.id) return message.reply("I'm the narrator, I can't play. 🎭");
        if (byId(g, me.id)) return message.reply("You're already in.");
        if (playerGame.has(me.id)) return message.reply("You're in another game.");
        if (g.players.length >= MAX_PLAYERS) return message.reply('The lobby is full.');
        g.players.push(newPlayer(me));
        playerGame.set(me.id, g);
        await g.lobbyMsg.edit(lobbyText(g, p)).catch(() => {});
        return message.reply(`🎭 You're in! (${g.players.length} players)`);
      }
      if (sub === 'leave') {
        if (g.phase !== 'lobby') return message.reply("You can't leave mid-game. Just don't die. 👀");
        if (!byId(g, me.id)) return message.reply("You're not in this game.");
        g.players = g.players.filter((x) => x.id !== me.id);
        playerGame.delete(me.id);
        if (!g.players.length) { cleanup(g); return ch.send('🎭 Lobby closed (everyone left).'); }
        if (g.host.id === me.id) g.host = g.players[0].user;
        await g.lobbyMsg.edit(lobbyText(g, p)).catch(() => {});
        return message.reply('👋 You left the lobby.');
      }
      if (sub === 'start') {
        if (g.phase !== 'lobby') return message.reply('Already running!');
        if (!isHost) return message.reply(`Only the host (${g.host.username}) can start.`);
        if (g.players.length < T.min()) return message.reply(`Need at least ${T.min()} players (have ${g.players.length}). \`${p}mm join\``);
        runGame(g);
        return;
      }
      if (sub === 'stop' || sub === 'end' || sub === 'cancel') {
        if (!isHost) return message.reply('Only the host or a GC admin can stop the game.');
        cleanup(g);
        return ch.send('### 🎭 Murder mystery stopped\n-# the killer walks free… this time');
      }
      if (sub === 'skip') {
        if (!isHost || g.phase !== 'day') return message.reply('Only the host can skip, and only during the investigation.');
        g.skip = true;
        poke(g);
        return;
      }
      if (sub === 'search') {
        const player = byId(g, me.id);
        if (!player?.alive) return message.reply('Only living players can search.');
        if (g.phase !== 'day') return message.reply('You can only search during the day.');
        if (player.searchedDay === g.day) return message.reply('You already searched today.');
        const result = search(g, player, args.slice(1).join(' '));
        if (result.error) return message.reply(result.error);
        player.searchedDay = g.day;
        return ch.send(result.clue ? `### 🔍 ${player.char.name} found something!\n${clueText(result.clue)}` : `### 🔍 ${player.char.name} searched\n> …and found ${result.nothing}.`);
      }
      if (sub === 'reveal') {
        const player = byId(g, me.id);
        if (!player?.alive) return message.reply('Only living players can do that.');
        if (!['day', 'vote', 'defense', 'trial'].includes(g.phase)) return message.reply('You can only reveal during the day.');
        if (player.role !== 'mayor') return message.reply('🎩 You have nothing to reveal… or do you?');
        if (player.revealed) return message.reply('Everyone already knows. 🎩');
        player.revealed = true;
        g.events.push(`Day ${g.day}: ${plain(player)} revealed themselves as the Mayor.`);
        if (g.phase === 'trial') g.trialMsg?.edit(trialBoard(g).text).catch(() => {});
        return ch.send(`### 🎩 ${player.char.name} is the Mayor!\n> ${label(player)} stands on a chair and produces the deed to the house. Their verdict at trials now counts **triple**.\n-# …and the killer knows exactly who they are now`);
      }
      if (sub === 'clues') {
        if (!g.clues.length) return message.reply('No clues yet.');
        return ch.send(`### 🔎 Clues so far\n${g.clues.map((c) => `> ${clueText(c).replace('🔎 ', '')}`).join('\n')}\n-# if a clue is true, one of its traits belongs to a killer`);
      }
      if (sub === 'guests' || sub === 'players') {
        if (!g.players[0].char) return ch.send(lobbyText(g, p));
        return ch.send(`### 🎭 The guests\n${guestList(g)}`);
      }
      if (g.phase === 'lobby') return ch.send(lobbyText(g, p));
      return ch.send(`### 🔪 ${g.setting.emoji} ${g.setting.name} · ${g.phase === 'night' ? `Night ${g.day}` : `Day ${g.day}`}\n> ${alive(g).length} alive · ${g.clues.length} clues\n-# \`${p}mm clues\` · \`${p}mm guests\` · \`${p}mm search <room>\``);
    },
  },
  {
    name: 'vote',
    usage: 'vote <number | name | skip>',
    description: 'Accuse someone in the murder mystery (they go to trial if enough people agree).',
    async run({ message, args }) {
      const g = games.get(message.channel.id);
      if (!g || g.phase !== 'vote') return message.reply('There’s no accusation vote right now.');
      const voter = byId(g, message.author.id);
      if (!voter || !voter.alive) return message.reply('Only living players can vote.');
      const text = args.join(' ');
      if (!text) return message.reply('Accuse who? `vote <number or name>` or `vote skip`');
      let choice;
      if (/^skip$/i.test(text)) choice = 'skip';
      else {
        const target = findTarget(g, message.mentions.users.first()?.id ?? text);
        if (!target) return message.reply('Not a living guest. Use the number from the list.');
        choice = target.id;
      }
      g.votes.set(voter.id, choice);
      await g.voteMsg?.edit(voteBoard(g)).catch(() => {});
      await message.react?.('🗳️').catch(() => {});
      poke(g);
    },
  },
  ...['guilty', 'innocent'].map((verdict) => ({
    name: verdict,
    usage: verdict,
    description: `Vote ${verdict} at a murder mystery trial (plain "${verdict}" works too).`,
    async run({ message }) {
      const g = games.get(message.channel.id);
      if (!g || g.phase !== 'trial') return message.reply('There’s no trial right now.');
      return castVerdict(g, message, verdict);
    },
  })),
];

module.exports.internals = { games, playerGame, assignRoles, roleList, makeClue, winner, stats, runGame };
