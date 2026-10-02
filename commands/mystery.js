// Murder mystery: social deduction with a story, secret roles over DMs, multi-option clues, searches,
// night events, trials, and murderer tricks (frame, clean, weapons).
//
// Flow: lobby → everyone DMs "ready" → roles by DM → prologue → [ night → morning → day (discuss + search)
//       → accusation vote → trial (defense, guilty/innocent) ] until one side wins.
const eco = require('../lib/economy');
const dm = require('../lib/dm');
const onboarding = require('../lib/onboarding');
const { data, save } = require('../lib/db');
const party = require('../lib/party');
const { SETTINGS, CHARACTERS, TRAITS, WEAPONS, ROLES, CLUE_INTROS, EVENTS, QUESTIONS } = require('../lib/mystery-data');
const { pick, shuffle, resolveUser, awaitReply } = require('../lib/util');
const { card, color, ansiBlock } = require('../lib/format');
const art = require('../lib/mystery-art');
const cards = require('../lib/mystery-cards');

const ROLE_COLORS = {
  murderer: '#e0253a', accomplice: '#fb923c', detective: '#60a5fa', doctor: '#34d399',
  bodyguard: '#93c5fd', witness: '#fde68a', mayor: '#c4b5fd', jester: '#f472b6', guest: '#cbd5e1',
  vigilante: '#a3a3a3', medium: '#a78bfa', survivor: '#86efac', executioner: '#94a3b8',
};
const NAME = 'Murder Mystery'; // for the shared party-game locks (one game per GC / per player)
const avatarOf = (p) => p.user.displayAvatarURL?.({ format: 'png', dynamic: false, size: 256 });

// Post text with a generated image attached; if rendering fails, post the text alone.
async function sendArt(channel, text, render, name = 'mystery.png') {
  if (!channel) return null;
  let buffer = null;
  try { buffer = await Promise.race([render(), new Promise((_, rej) => setTimeout(() => rej(new Error('render timeout')), 12000))]); } catch (err) { console.error('[mystery art]', err.message); }
  if (!buffer && !text) return null;
  return channel.send(buffer ? { content: text, files: [{ attachment: buffer, name }] } : text).catch(() => {});
}
const sayWithArt = (g, text, render, name) => sendArt(g.channel, text, render, name);
const weaponsOf = (g) => [...WEAPONS, ...(g.setting.weapons ?? [])];
const capitalize = (t) => t.charAt(0).toUpperCase() + t.slice(1);
// A dead guest's will, on parchment (skipped when the killer burned it).
const postWill = (g, p) => p.will && sendArt(g.channel, `-# 📜 the last will of ${p.char.name}`, () => cards.will({ name: p.char.name, text: p.will }), `will-${p.id}.png`);

const env = (k, d) => Number(process.env[k] ?? d);
const T = {
  ready: () => env('MM_READY_MS', 90000),
  day: (alive) => env('MM_DAY_MS', Math.min(180000, 45000 + 15000 * alive)),
  vote: () => env('MM_VOTE_MS', 45000),
  defense: () => env('MM_DEFENSE_MS', 20000),
  trial: () => env('MM_TRIAL_MS', 25000),
  night: () => env('MM_NIGHT_MS', 70000),
  min: () => env('MM_MIN_PLAYERS', 4),
  question: () => env('MM_QUESTION_MS', 30000),
};
// Game modes: quick shortens every timer; chaos adds special roles, lovers and more night events.
const MODES = {
  classic: { emoji: '🎭', blurb: 'the standard game' },
  quick: { emoji: '⚡', blurb: 'shorter timers' },
  chaos: { emoji: '🌀', blurb: 'extra special roles, lovers, and more night events' },
};
const pace = (g, ms) => Math.round(ms * (g.mode === 'quick' ? 0.6 : 1));
const BET_MAX = 5000;
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
const startedOnMurderTeam = (p) => ROLES[p.startRole].team === 'murderers';
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
// A short quote of the will for the scene card (the full text is in the message).
const WILL_EXCERPT = 60;
function willExcerpt(p, burned = false) {
  if (!p.will) return null;
  if (burned) return 'Their will was torn to shreds';
  const cut = p.will.length <= WILL_EXCERPT ? p.will : `${p.will.slice(0, WILL_EXCERPT).replace(/\s+\S*$/, '')}…`;
  return `Will: “${cut}”`;
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

// After any death: lovers follow each other, an Executioner whose target died some other way becomes a
// Jester, and if every murderer is gone an accomplice takes over the knife. Adds lines to `lines`.
function aftermath(g, lines, { news = [], when = `Day ${g.day}` } = {}) {
  for (let changed = true; changed;) {
    changed = false;
    for (const p of g.players) {
      const lover = p.lover ? byId(g, p.lover) : null;
      if (p.alive || !lover?.alive) continue;
      lover.alive = false;
      changed = true;
      lines.push(`> 💔 **${lover.char.name}** couldn’t live without ${p.char.name} and died of a broken heart. They were the **${ROLES[lover.role].name}** ${ROLES[lover.role].emoji}.`, ...willLines(lover));
      g.events.push(`${when}: ${plain(lover)} (${ROLES[lover.role].name}) died of a broken heart after losing ${plain(p)}.`);
      news.push({ title: 'A broken heart', text: `${lover.char.name} could not live without ${p.char.name}.` });
    }
  }
  for (const exe of alive(g).filter((x) => x.role === 'executioner' && !x.exeWon)) {
    const target = byId(g, exe.exeTarget);
    if (target && !target.alive) {
      exe.role = 'jester';
      exe.dmChannel?.send(`## 🃏 Your target is dead
> ${target.char.name} died before you could get them convicted. **You are now the Jester:** win by getting yourself voted guilty.`).catch(() => {});
    }
  }
  const heir = promoteAccomplice(g);
  if (heir) {
    lines.push('', '> 🔪 *Somewhere in the house, someone picks up the knife…* (the killing isn’t over)');
    news.push({ title: 'Not over yet', text: 'Witnesses report someone quietly picking up the knife.' });
  }
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
    p.exeTarget && p.role === 'executioner' ? `> 🎯 Your target: ${label(byId(g, p.exeTarget))}` : null,
    p.lover ? `> 💘 You’re in love with ${label(byId(g, p.lover))}. If one of you dies, so does the other. You still play for your own side.` : null,
    `> ${r.how}${p.role === 'survivor' ? ` (${p.vests ?? 0} left)` : ''}`,
    `-# ${g.setting.emoji} ${g.setting.name} · keep this secret · DM me \`role\` anytime · \`will <text>\` to leave a last will`,
  ].filter(Boolean).join('\n');
}

// The secret dossier image that goes with the role card.
function dossierFor(g, p) {
  const r = ROLES[p.role];
  const partners = isMurderTeam(p) ? g.players.filter((x) => isMurderTeam(x) && x !== p) : [];
  const notes = [
    partners.length ? `PARTNER${partners.length > 1 ? 'S' : ''}: ${partners.map((x) => `${x.char.name} (${x.user.username})`).join(', ')}` : null,
    p.role === 'executioner' && p.exeTarget ? `TARGET: ${byId(g, p.exeTarget).char.name} (${byId(g, p.exeTarget).user.username})` : null,
    p.lover ? `IN LOVE WITH: ${byId(g, p.lover).char.name} (${byId(g, p.lover).user.username})` : null,
  ].filter(Boolean);
  return cards.dossier({
    setting: g.setting.name, name: p.char.name, title: p.char.title, user: p.user.username, url: avatarOf(p),
    role: r.name, roleColor: ROLE_COLORS[p.role], goal: r.goal,
    traits: [p.traits.garment[0], p.traits.scent[0], p.traits.mark[0]], notes,
  });
}

function stats(userId) {
  data.mmStats ??= {};
  const s = (data.mmStats[userId] ??= { games: 0, wins: 0, kills: 0, murderer: 0, convictions: 0 });
  s.achievements ??= [];
  return s;
}

function cleanup(g) {
  g.phase = 'over';
  if (g.waiter) g.waiter.done();
  games.delete(g.channel.id);
  if (party.channelGame(g.channel) === NAME) party.releaseChannel(g.channel);
  for (const p of g.players) {
    if (playerGame.get(p.id) === g) playerGame.delete(p.id);
    party.unlockPlayer(p.id, NAME);
  }
  // Bets that never got settled (game stopped or crashed) are refunded.
  for (const [id, b] of g.bets ?? []) if (!b.settled) { eco.settle(id, b.amount, b.amount); b.settled = true; }
}

// ---------------------------------------------------------------- DMs (roles, night actions)
const TARGET_FILTERS = {
  kill: (p) => (x) => !isMurderTeam(x),
  frame: (p) => (x) => !isMurderTeam(x),
  inspect: (p) => (x) => x.id !== p.id,
  protect: (p) => (x) => x.id !== p.lastProtect,
  guard: (p) => (x) => x.id !== p.id,
  watch: (p) => (x) => x.id !== p.id,
  shoot: (p) => (x) => x.id !== p.id,
};
// Who the night waits for. A Vigilante who already fired has nothing left to do.
const nightAction = (p) => (p.role === 'vigilante' && p.usedShot ? null : ROLES[p.role].night);

function nightPrompt(g, p) {
  const action = ROLES[p.role].night;
  const extras = p.role === 'murderer'
    ? `\n-# also: ${p.usedFrame ? '~~frame~~ (used)' : '`frame <#>`'} · ${p.usedClean ? '~~clean~~ (used)' : '`clean`'} · weapons: ${weaponsOf(g).map((w) => w[0].split(' ').pop()).join(', ')}`
    : p.role === 'accomplice' || p.role === 'vigilante' ? '\n-# or `skip`' : '';
  const team = isMurderTeam(p) && alive(g).some((x) => isMurderTeam(x) && x !== p) ? '\n-# 🤫 anything else you DM me goes to your partner' : '';
  return `### ${ROLES[p.role].emoji} Night ${g.day}\n> Reply \`${action} <number or name>\`:\n${numbered(g, TARGET_FILTERS[action](p)).split('\n').map((l) => `> ${l}`).join('\n')}${extras}${team}`;
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

  // The Medium talks with the dead at night: their DMs go to every ghost, and the ghosts' replies come back.
  if (g.phase === 'night') {
    const mediums = alive(g).filter((x) => x.role === 'medium');
    if (p.alive && p.role === 'medium') {
      const ghosts = g.players.filter((x) => !x.alive);
      if (!ghosts.length) { await reply('🔮 You reach out… but there are no spirits here yet.'); return true; }
      for (const gh of ghosts) gh.dmChannel?.send(`🔮 **A medium reaches across:** ${sanitize(text).slice(0, 300)}\n-# reply tonight and they’ll hear you`).catch(() => {});
      await reply(`🔮 Your words reach the other side (${ghosts.length} spirit${ghosts.length === 1 ? '' : 's'}).`);
      return true;
    }
    if (!p.alive && mediums.length && !/^haunt\s/i.test(text)) {
      for (const md of mediums) md.dmChannel?.send(`👻 **${p.char.name}** (${p.user.username}, ${ROLES[p.role].name}): ${sanitize(text).slice(0, 300)}`).catch(() => {});
      await reply('👻 Your words drift to the medium…');
      return true;
    }
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

  // Survivor: put on a vest for the night.
  if (p.role === 'survivor' && /^vest$/i.test(text)) {
    if (g.phase !== 'night') { await reply('🦺 Vests go on at night.'); return true; }
    if (g.night.vests.has(p.id)) { await reply('🦺 You’re already wearing one tonight.'); return true; }
    if (!p.vests) { await reply('🦺 You’re out of vests. Good luck.'); return true; }
    p.vests--;
    g.night.vests.add(p.id);
    await reply(`### 🦺 Vest on\n> You’ll survive one attack tonight. ${p.vests} left.`);
    return true;
  }

  const action = nightAction(p);
  if (g.phase !== 'night' || !action) {
    await reply(g.phase === 'night' ? (p.role === 'survivor' ? '🌙 DM me `vest` to wear a vest tonight.' : p.role === 'vigilante' ? '🔫 You’ve used your bullet. Sleep tight.' : '🌙 You have no night action. Sleep with one eye open…') : '☀️ It’s daytime. Discuss, search and vote in the group chat.\n-# DM me `role` to see your role');
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
  if ((p.role === 'accomplice' || p.role === 'vigilante') && lower === 'skip') {
    n.acted.add(p.id);
    n.shots.delete(p.id);
    n.visits.delete(p.id);
    await reply(p.role === 'vigilante' ? '🔫 You keep your bullet for another night.' : '🤝 You lie low tonight.');
    poke(g);
    return true;
  }

  // Murder-team chat: anything that isn't an action goes to the rest of the team (or force it with `say …`).
  const partners = isMurderTeam(p) ? alive(g).filter((x) => isMurderTeam(x) && x !== p) : [];
  const isCommand = new RegExp(`^(${action}|frame|clean|skip)\\b`, 'i').test(text) || findTarget(g, text.replace(/\s+with\s+.+$/i, ''), TARGET_FILTERS[action](p));
  if (partners.length && (/^say\s+/i.test(text) || !isCommand)) {
    const msg = sanitize(text.replace(/^say\s+/i, '')).slice(0, 400);
    for (const x of partners) x.dmChannel?.send(`🔪 **${p.char.name}** (${p.user.username}): ${msg}`).catch(() => {});
    await reply(`🤫 Sent to ${partners.map((x) => x.char.name).join(', ')}.`);
    return true;
  }

  const m = new RegExp(`^(?:${action}\\s+)?(.+?)(?:\\s+with\\s+(.+))?$`, 'i').exec(text);
  const target = m && findTarget(g, m[1], TARGET_FILTERS[action](p));
  if (!target) { await reply(nightPrompt(g, p)); return true; }

  if (action === 'kill') {
    const weaponWord = m[2]?.toLowerCase();
    const weapon = weaponWord ? weaponsOf(g).find((w) => w[0].includes(weaponWord)) : null;
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
  } else if (action === 'shoot') {
    n.shots.set(p.id, target.id);
    await reply(`### 🔫 You take aim at ${label(target)}\n-# you only get one bullet · \`skip\` to change your mind before dawn`);
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
  for (const p of missing) { playerGame.delete(p.id); party.unlockPlayer(p.id, NAME); }
  g.players = g.players.filter((p) => p.ready);
  if (missing.length) await say(g, `-# left out (no DM): ${missing.map((p) => p.user.username).join(', ')}`);
}

// Role mix scales with the lobby. The murder team stays around a fifth to a quarter of the table,
// since clues, searches and the info roles give the guests a lot to work with.
function roleList(n, mode = 'classic') {
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
  if (n >= 11) roles.push('survivor');
  if (n >= 12) roles.push('executioner');
  if (n >= 13) roles.push('vigilante');
  if (n >= 14) roles.push('medium');
  while (roles.length < n) roles.push('guest');
  // Chaos: about half the plain guests get a special role instead.
  if (mode === 'chaos') {
    const specials = ['survivor', 'executioner', 'vigilante', 'medium', 'witness', 'bodyguard', 'doctor'];
    for (let i = 0; i < roles.length; i++) {
      const open = specials.filter((r) => !roles.includes(r));
      if (roles[i] === 'guest' && open.length && Math.random() < 0.5) roles[i] = pick(open);
    }
  }
  return roles;
}

function assignRoles(g) {
  const shuffledRoles = g.forceRoles ?? shuffle(roleList(g.players.length, g.mode));
  // The GC's custom cast (mm cast) is used first, then the built-in characters.
  const custom = shuffle([...(data.mmCast?.[g.channel.id] ?? [])]);
  const chars = [...custom, ...shuffle(CHARACTERS.filter(([name]) => !custom.some(([c]) => c.toLowerCase() === name.toLowerCase())))];
  const traitPools = Object.fromEntries(Object.entries(TRAITS).map(([k, v]) => [k, shuffle([...v])]));
  g.players.forEach((p, i) => {
    p.role = shuffledRoles[i];
    p.startRole = p.role;
    p.char = { name: chars[i][0], title: chars[i][1] };
    p.traits = { garment: traitPools.garment[i], scent: traitPools.scent[i], mark: traitPools.mark[i] };
    if (p.role === 'survivor') p.vests = 2;
  });
  // Executioners get a guest-side target; with nobody suitable they're just a Jester.
  for (const exe of g.players.filter((p) => p.role === 'executioner')) {
    const options = g.players.filter((p) => team(p) === 'town');
    const target = (g.forceExeTarget && byId(g, g.forceExeTarget)) ?? pick(options);
    if (target) exe.exeTarget = target.id; else { exe.role = 'jester'; exe.startRole = 'jester'; }
  }
  // Lovers: always in chaos mode, sometimes in big games. Never two of the murder team (they already know each other).
  const n = g.players.length;
  let pair = g.forceLovers?.map((id) => byId(g, id));
  if (!pair && ((g.mode === 'chaos' && n >= 5) || (n >= 9 && Math.random() < 0.4))) {
    for (let tries = 0; tries < 20 && !pair; tries++) {
      const [a, b] = shuffle([...g.players]);
      if (!(isMurderTeam(a) && isMurderTeam(b))) pair = [a, b];
    }
  }
  if (pair) { pair[0].lover = pair[1].id; pair[1].lover = pair[0].id; }
}

async function prologue(g) {
  const s = g.setting;
  const weapon = pick(weaponsOf(g));
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
  g.night = { kill: null, killer: null, weapon: null, protects: new Set(), guards: new Map(), frames: new Set(), frameClue: null, clean: false, inspects: new Map(), watches: new Map(), visits: new Map(), shots: new Map(), vests: new Set(), acted: new Set() };
  const s = g.setting;
  const nightMs = pace(g, T.night());
  await say(g, `### 🌙 Night ${g.day}\n> *${pick(s.night)}*\n> Everyone returns to their rooms. Those with a night role: check your DMs.\n-# night ends in ${secs(nightMs)} or when everyone has acted`);

  const actors = () => alive(g).filter((p) => nightAction(p));
  for (const p of actors()) p.dmChannel?.send(nightPrompt(g, p)).catch(() => {});
  for (const p of alive(g).filter((x) => x.role === 'survivor' && x.vests)) p.dmChannel?.send(`### 🏕️ Night ${g.day}\n> DM me \`vest\` to wear a bulletproof vest tonight (${p.vests} left).`).catch(() => {});
  if (alive(g).some((x) => x.role === 'medium') && g.players.some((x) => !x.alive)) {
    for (const p of alive(g).filter((x) => x.role === 'medium')) p.dmChannel?.send(`### 🔮 Night ${g.day}\n> The veil is thin. DM me anything and the dead will hear it.`).catch(() => {});
    for (const p of g.players.filter((x) => !x.alive)) p.dmChannel?.send('### 🔮 A medium is listening tonight\n> Anything you DM me now reaches them.').catch(() => {});
  }

  const done = () => actors().every((p) => (p.role === 'murderer' ? g.night.kill : g.night.acted.has(p.id)));
  await waitFor(g, done, nightMs);
  g.phase = 'resolving';
  const n = g.night;

  for (const p of g.players) if (p.role === 'doctor') { p.lastProtect = p.pendingProtect ?? null; p.pendingProtect = null; }

  // Detective results (after frames, so the order people act in doesn't matter).
  for (const [detId, targetId] of n.inspects) {
    const det = byId(g, detId), target = byId(g, targetId);
    const suspicious = target.role === 'murderer' || n.frames.has(target.id);
    if (target.role === 'murderer') { award(det, 2); det.foundMurderer = true; }
    sendArt(det.dmChannel, `### 🔍 Dawn report: ${label(target)} looks ${suspicious ? '**SUSPICIOUS** 🔪' : '**innocent** 😇'}\n-# framed people look suspicious, and the accomplice looks innocent`,
      () => cards.caseFile({ night: g.day, subject: target.char.name, user: target.user.username, url: avatarOf(target), suspicious }), 'case-file.png');
  }

  // Who dies. Idle murderers still strike, at random.
  const murderers = alive(g).filter((p) => p.role === 'murderer');
  let victim = n.kill ? byId(g, n.kill) : null;
  if (!victim?.alive) victim = pick(alive(g).filter((p) => !isMurderTeam(p)));
  const killer = byId(g, n.killer) ?? pick(murderers);
  n.visits.set(killer.id, victim.id);
  const weapon = n.weapon ?? pick(weaponsOf(g));
  const room = pick(s.rooms);
  g.lastRoom = room;
  (g.scenes ??= []).push({ room, night: g.day });
  const before = new Set(alive(g));
  const news = []; // side stories for the morning paper

  // Witness reports: who left their room, and where they went. Frames don't matter here.
  for (const [witId, targetId] of n.watches) {
    const wit = byId(g, witId), target = byId(g, targetId);
    const went = n.visits.has(target.id) ? byId(g, n.visits.get(target.id)) : null;
    if (went && isMurderTeam(target)) award(wit, 2);
    sendArt(wit.dmChannel, went
      ? `### 👁️ Dawn report: ${label(target)} **left their room** in the night\n> You saw them slip into ${label(went)}’s room.\n-# every night role moves around, not only killers`
      : `### 👁️ Dawn report: ${label(target)} **never left their room**`,
    () => cards.cctv({ night: g.day, subject: target.char.name, url: avatarOf(target), went: went?.char.name ?? null }), 'cctv.png');
  }

  const events = [...(s.events ?? []), ...EVENTS].filter((e) => alive(g).length >= (e.min ?? 0));
  const event = process.env.MM_EVENTS === 'off' ? null : events.find((e) => Math.random() < e.chance * (g.mode === 'chaos' ? 2.5 : 1));
  const effect = event?.effect ?? event?.id; // setting events reuse the standard effects with their own story
  if (event) news.push({ title: 'Strange night', text: event.text.replace(/\*\*/g, '').replace(/^\S+\s/u, '') });
  const noClues = n.clean || effect === 'outage';
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
    dead.hero = true;
    lines.push(`### 🛡️ ${dead.char.name} died a hero`, `> ${label(dead)} threw themselves in front of ${label(victim)} in the **${room}** and was ${weapon[1]}.`,
      `> They were the **Bodyguard** 🛡️. With their last breath they saw something…`, ...willLines(dead));
    const c = makeClue(g, { culprit: killer, anchor: killer, options: 2 });
    lines.push('', clueText(c));
    g.events.push(`Night ${g.day}: ${plain(dead)} (Bodyguard) died protecting ${plain(victim)} from ${plain(killer)}.`);
    (killer.victims ??= []).push(dead.char.name);
  } else if (n.protects.has(victim.id) || n.vests.has(victim.id)) {
    for (const doc of alive(g).filter((x) => x.role === 'doctor' && n.visits.get(x.id) === victim.id)) { award(doc, 3); doc.saves = (doc.saves ?? 0) + 1; }
    lines.push('### 💉 A close call', n.protects.has(victim.id)
      ? `> ${label(victim)} was attacked in the **${room}**, but someone got there just in time. They’re shaken, but alive.`
      : `> ${label(victim)} was attacked in the **${room}**, but the blow hit a bulletproof vest. They’re bruised, but alive.`);
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
    (killer.victims ??= []).push(victim.char.name);
    if (!noClues) {
      const clueCount = g.players.length >= 6 ? 2 : 1;
      const first = makeClue(g, { culprit: killer, anchor: n.frameClue ? byId(g, n.frameClue) : null });
      lines.push('', clueText(first));
      if (clueCount > 1) lines.push(clueText(makeClue(g, { culprit: killer, truth: 0.55 })));
    } else if (n.clean) {
      lines.push('', '> 🧹 The scene is spotless. Whoever did this cleaned up.');
    }
  }
  if (effect === 'seance' && dead) lines.push(clueText(makeClue(g, { culprit: killer, truth: 0.85, options: 2, intro: event.intro ?? `👻 ${dead.char.name}’s ghost whispers that the killer:` })));
  if (effect === 'dog') lines.push(clueText(makeClue(g, { culprit: killer, truth: 0.6, options: 2, intro: event.intro ?? '🐕 The dog was barking at someone who:' })));
  if (effect === 'diary') {
    const cleared = pick(alive(g).filter((p) => !isMurderTeam(p) && !p.cleared));
    if (cleared) {
      cleared.cleared = true;
      lines.push(`> 📖 *“${cleared.char.name} could never hurt a soul.”* ${label(cleared)} is **not** a killer.`);
      g.events.push(`Night ${g.day}: a diary page cleared ${plain(cleared)}.`);
      news.push({ title: 'Diary page found', text: `A torn page in the host’s own hand clears ${cleared.char.name} of any wrongdoing.` });
    }
  }

  // The Vigilante fires after the killer has struck.
  for (const [vigId, targetId] of n.shots) {
    const vig = byId(g, vigId), target = byId(g, targetId);
    vig.usedShot = true;
    if (!target.alive) { lines.push('', `> 🔫 A gunshot echoes through the halls… but ${target.char.name} was already dead.`); continue; }
    if (n.protects.has(target.id) || n.vests.has(target.id)) {
      lines.push('', '### 🔫 A gunshot at dawn', `> Someone fired at ${label(target)}, but they survived.`);
      g.events.push(`Night ${g.day}: ${plain(vig)} (Vigilante) shot at ${plain(target)}, who survived.`);
      news.push({ title: 'Gunshot at dawn', text: `Someone fired at ${target.char.name}, who somehow survived.` });
      continue;
    }
    target.alive = false;
    lines.push('', '### 🔫 A gunshot at dawn', `> ${label(target)} was shot dead. They were the **${ROLES[target.role].name}** ${ROLES[target.role].emoji}.`, ...willLines(target));
    g.events.push(`Night ${g.day}: ${plain(vig)} (Vigilante) shot ${plain(target)} (${ROLES[target.role].name}).`);
    news.push({ title: 'Gunshot at dawn', text: `${target.char.name} was shot dead before sunrise. They were the ${ROLES[target.role].name}.` });
    if (isMurderTeam(target)) { award(vig, 4); vig.vigKill = true; }
    else if (team(target) === 'town' && vig.alive) {
      vig.alive = false;
      lines.push(`> 😔 **${vig.char.name}**, the Vigilante, couldn’t live with what they’d done.`, ...willLines(vig));
      g.events.push(`Night ${g.day}: ${plain(vig)} (Vigilante) died of guilt.`);
      news.push({ title: 'Overcome with guilt', text: `${vig.char.name}, who fired the shot, could not live with it.` });
    }
  }
  aftermath(g, lines, { news, when: `Night ${g.day}` });

  // The morning paper.
  const shown = dead ?? victim;
  const kind = !dead ? 'saved' : dead.role === 'bodyguard' && dead !== victim ? 'hero' : 'dead';
  const who = `${shown.char.name}, ${shown.char.title}`;
  const headline = kind === 'saved' ? `${capitalize(shown.char.title)} survives attack in the ${room}`
    : kind === 'hero' ? `Bodyguard dies saving ${victim.char.name}` : `${capitalize(shown.char.title)} found dead in the ${room}`;
  const lead = kind === 'saved'
    ? [`${who}, was attacked in the ${room} overnight and lived to tell the tale${n.vests.has(victim.id) ? ', saved by a bulletproof vest' : ''}.`, 'The attacker remains at large. Guests are advised to lock their doors.']
    : [`${who}, was found in the ${room} this morning, ${weapon[1]}. ${kind === 'hero' ? `They died shielding ${victim.char.name}. They` : 'They'} were the ${ROLES[dead.role].name}.`,
      n.clean ? 'The scene had been scrubbed spotless, and the will was torn to shreds.' : noClues ? 'In the darkness, investigators found nothing useful.' : 'Investigators found fresh evidence at the scene.',
      dead.will && !(n.clean && kind === 'dead') ? 'A last will was found on the body (see below).' : `${alive(g).length} guests remain.`];
  await sayWithArt(g, lines.join('\n'), () => cards.newspaper({
    paper: s.paper ?? `The ${s.name} Gazette`,
    dateline: `Night ${g.day} · ${s.name} · ${alive(g).length} guests remain`,
    headline,
    photo: { url: avatarOf(shown), name: shown.char.name, caption: `${who} (@${shown.user.username}).`, gray: kind !== 'saved' },
    lead,
    sidebars: news,
    stamp: kind === 'saved' ? { text: 'SURVIVED', color: '#1f7a46' } : kind === 'hero' ? { text: 'HERO', color: '#1d4ed8' } : null,
  }), `night-${g.day}.png`);
  for (const p of g.players.filter((x) => before.has(x) && !x.alive)) {
    if (!(p === victim && n.clean)) await postWill(g, p);
  }
}

async function dayPhase(g) {
  g.phase = 'day';
  g.skip = false;
  g.searched = new Map(); // room -> player who searched it today
  const ms = pace(g, T.day(alive(g).length));
  await sayWithArt(g, card({
    title: `Day ${g.day} · Investigation`, emoji: '☀️',
    body: [
      'Cross-check the clues against the guests’ traits. Accuse, defend, lie.',
      `🔍 Everyone alive can **\`mm search <room>\`** once today, and each room can only be searched once. Rooms: ${g.setting.rooms.join(', ')}.`,
      g.lastRoom ? `-# last night’s scene: the ${g.lastRoom} (best odds of evidence)` : null,
      '🔦 Once a day, someone can `mm question <guest>` to put them on the spot.',
      '-# 🎩 a Mayor can `mm reveal` · 👻 the dead can DM me `haunt <#>` once · 🎰 the dead and spectators can `mm bet <guest> <coins>` · `mm board` · `mm map`',
    ],
    footer: `accusations open in ${secs(ms)} · host can \`mm skip\` · ${alive(g).length} alive · \`mm clues\``,
  }), () => renderMap(g), `map-day-${g.day}.png`);
  await waitFor(g, () => g.skip, ms);
}

function renderMap(g) {
  return cards.floorPlan({
    setting: g.setting.name, day: g.day, rooms: g.setting.rooms, scene: g.lastRoom, scenes: g.scenes ?? [],
    searched: Object.fromEntries([...(g.searched ?? new Map())].map(([room, p]) => [room, p.char.name])),
  });
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
    `-# ${g.votes.size}/${alive(g).length} voted${closed ? '' : ` · ${secs(pace(g, T.vote()))} · you can change your vote`}`,
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
      `-# ${votes.size}/${alive(g).length - 1} voted · a tie means innocent${closed ? '' : ` · ${secs(pace(g, T.trial()))}`}`,
    ].filter(Boolean).join('\n'),
  };
}

async function votePhase(g) {
  g.phase = 'vote';
  g.votes = new Map();
  g.voteMsg = await g.channel.send(voteBoard(g));
  await waitFor(g, () => g.votes.size >= alive(g).length, pace(g, T.vote()));
  g.phase = 'resolving';
  await g.voteMsg.edit(voteBoard(g, true)).catch(() => {});

  const counts = [...tally(g).entries()].filter(([id]) => id !== 'skip').sort((a, b) => b[1] - a[1]);
  const [top, second] = counts;
  const skips = tally(g).get('skip') ?? 0;
  const noTrial = !top || top[1] < accusationsNeeded(g) || (second && second[1] === top[1]) || skips >= top[1];
  // Who accused whom, drawn as red strings.
  const board = () => cards.accusationBoard({
    day: g.day,
    players: alive(g).map((p) => ({ id: p.id, name: p.char.name, url: avatarOf(p) })),
    votes: [...g.votes.entries()],
    result: noTrial ? 'No trial today' : `${byId(g, top[0]).char.name} goes to trial`,
  });
  if (noTrial) {
    g.events.push(`Day ${g.day}: nobody got enough accusations for a trial.`);
    return sayWithArt(g, `### ⚖️ No trial today\n> ${!top ? 'Nobody was accused.' : `Not enough agreement (needed ${accusationsNeeded(g)} votes, no ties).`}`, board, `accusations-${g.day}.png`);
  }
  return trialPhase(g, byId(g, top[0]), board);
}

async function trialPhase(g, accused, board = null) {
  g.trial = { accused, votes: new Map() };
  g.phase = 'defense';
  accused.trials = (accused.trials ?? 0) + 1;
  const onTrial = `### ⚖️ ${accused.char.name} is on trial!\n> <@${accused.id}>, you have **${secs(pace(g, T.defense()))}** to defend yourself. Everyone else: listen.`;
  if (board) await sayWithArt(g, onTrial, board, `accusations-${g.day}.png`); else await say(g, onTrial);
  await waitFor(g, () => false, pace(g, T.defense()));
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
  await waitFor(g, () => g.trial.votes.size >= alive(g).length - 1, pace(g, T.trial()));
  open = false;
  g.phase = 'resolving';
  const { guilty, innocent, text } = trialBoard(g, true);
  await g.trialMsg.edit(text).catch(() => {});

  if (guilty <= innocent) {
    if (isMurderTeam(accused)) accused.acquitted = true;
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
  for (const exe of g.players.filter((x) => x.role === 'executioner' && x.exeTarget === accused.id && x.alive && !x.exeWon)) {
    exe.exeWon = true;
    award(exe, 5);
    lines.push('', `> ⚖️ Somewhere in the crowd, someone smiles. ${accused.char.name} was the Executioner’s target. **The Executioner wins!** (they stay in the game)`);
    g.events.push(`Day ${g.day}: ${plain(exe)} (Executioner) got their target convicted.`);
  }
  aftermath(g, lines);
  // Killers get a WANTED poster, innocents a front-page correction, the Jester their victory card.
  const render = isMurderTeam(accused)
    ? () => cards.wanted({ name: accused.char.name, user: accused.user.username, role: r.name, url: avatarOf(accused), crimes: accused.victims ?? [], reward: `${WIN_REWARD} COINS` })
    : accused.role !== 'jester'
      ? () => cards.newspaper({
        paper: g.setting.paper ?? `The ${g.setting.name} Gazette`,
        dateline: `Day ${g.day} · ${g.setting.name} · correction`,
        headline: `Innocent ${accused.char.title.replace(/^the /, '')} convicted`,
        photo: { url: avatarOf(accused), name: accused.char.name, caption: `${accused.char.name} (@${accused.user.username}), led away to the cellar.` },
        lead: [`${accused.char.name} was convicted ${guilty}–${innocent} yesterday and dragged off to the cellar. They were the ${r.name}, and entirely innocent.`, 'The real killer is still among the guests. This paper regrets the error.'],
        sidebars: lines.some((l) => /broken heart/.test(l)) ? [{ title: 'A broken heart', text: 'Their lover did not survive the news.' }] : [],
        stamp: { text: 'CORRECTION', color: '#b3202a' },
      })
      : () => art.sceneCard({
        kind: 'guilty', headline: `Day ${g.day} · The trial`, name: accused.char.name, subtitle: `@${accused.user.username} · ${accused.char.title}`,
        role: 'Jester · wins!', roleColor: ROLE_COLORS.jester,
        lines: [`Convicted ${guilty} to ${innocent}`, 'and laughing about it', willExcerpt(accused)].filter(Boolean), avatarUrl: avatarOf(accused),
      });
  const out = await sayWithArt(g, lines.join('\n'), render, `trial-${g.day}.png`);
  await postWill(g, accused);
  for (const p of g.players.filter((x) => x !== accused && !x.alive && x.lover === accused.id && x.will)) await postWill(g, p);
  return out;
}

const ACHIEVEMENTS = {
  first_win: ['🥇', 'Case Closed', 'Win your first mystery'],
  perfect_murder: ['🔪', 'Perfect Murder', 'Win as a murderer without ever standing trial'],
  sharp_eye: ['🔍', 'Sharp Eye', 'Catch a murderer as the Detective'],
  guardian: ['💉', 'Guardian Angel', 'Save someone as the Doctor'],
  martyr: ['🛡️', 'Martyr', 'Die protecting someone as the Bodyguard'],
  fool: ['🃏', 'Fool’s Gold', 'Get convicted as the Jester'],
  hanging_judge: ['⚖️', 'Hanging Judge', 'Get your target convicted as the Executioner'],
  still_standing: ['🏕️', 'Still Standing', 'Survive to the end as the Survivor'],
  lovebirds: ['💘', 'Lovebirds', 'Make it to the end with your lover alive'],
  sharpshooter: ['🔫', 'Sharpshooter', 'Shoot a killer as the Vigilante'],
  silver_tongue: ['🗣️', 'Silver Tongue', 'Get acquitted while on the murder team'],
  veteran: ['🎖️', 'Veteran', 'Play 25 mysteries'],
};

function earnedAchievements(g, p, side, winners) {
  const lover = p.lover ? byId(g, p.lover) : null;
  return Object.entries({
    first_win: winners.includes(p),
    perfect_murder: p.startRole === 'murderer' && side === 'murderers' && !p.trials,
    sharp_eye: p.foundMurderer,
    guardian: p.saves > 0,
    martyr: p.hero,
    fool: g.jesterWinner === p,
    hanging_judge: p.exeWon,
    still_standing: p.role === 'survivor' && p.alive,
    lovebirds: !!lover && p.alive && lover.alive,
    sharpshooter: p.vigKill,
    silver_tongue: p.acquitted,
    veteran: stats(p.id).games >= 25,
  }).filter(([, ok]) => ok).map(([id]) => id);
}

async function finale(g, side) {
  g.phase = 'over';
  const winners = g.players.filter((p) => (side === 'town' ? team(p) === 'town' : team(p) === 'murderers'));
  if (g.jesterWinner) winners.push(g.jesterWinner);
  const exes = g.players.filter((p) => p.exeWon);
  const survivors = g.players.filter((p) => p.role === 'survivor' && p.alive);
  winners.push(...exes, ...survivors);
  const score = (p) => (p.points ?? 0) + (p.alive ? 1 : 0);
  const mvp = [...winners].sort((a, b) => score(b) - score(a))[0];
  const unlocked = [];
  for (const p of g.players) {
    const s = stats(p.id);
    s.name = p.user.username;
    s.roles ??= {};
    s.roles[p.startRole] = (s.roles[p.startRole] ?? 0) + 1;
    s.games++;
    if (p.startRole === 'murderer' || p.role === 'murderer') s.murderer++;
    if (winners.includes(p)) s.wins++;
    eco.add(p.id, winners.includes(p) ? WIN_REWARD + (p === mvp ? MVP_BONUS : 0) : PLAY_REWARD);
    for (const id of earnedAchievements(g, p, side, winners)) {
      if (s.achievements.includes(id)) continue;
      s.achievements.push(id);
      unlocked.push(`> ${ACHIEVEMENTS[id][0]} **${p.user.username}** unlocked **${ACHIEVEMENTS[id][1]}**: ${ACHIEVEMENTS[id][2].toLowerCase()}`);
    }
  }
  // Spectator / ghost bets on who the killer was.
  const betLines = [];
  for (const [id, b] of g.bets ?? []) {
    const target = byId(g, b.target);
    const won = startedOnMurderTeam(target);
    const back = won ? Math.floor(b.amount * b.mult) : 0;
    eco.settle(id, b.amount, back);
    b.settled = true;
    betLines.push(`> ${won ? '💰' : '💸'} **${b.user.username}** bet ${eco.fmt(b.amount)} on ${target.char.name}: ${won ? `won ${eco.fmt(back)}` : 'lost'}`);
  }
  save();
  const roleLines = g.players.map((p) => `> ${ROLES[p.startRole].emoji} ${label(p)}: **${ROLES[p.startRole].name}**${p.startRole !== p.role ? ` → ${ROLES[p.role].name}` : ''}${p.lover ? ' 💘' : ''}${p.alive ? '' : ' ☠️'}${p === mvp ? ' 🏅 MVP' : ''}`);
  await sayWithArt(g, [
    side === 'town'
      ? `# 🎉 The guests win!\n> Every murderer has been caught. ${g.setting.name} is safe… for now.`
      : `# 🔪 The murderers win!\n> By dawn, there's nobody left to stop them.`,
    g.jesterWinner ? `> 🃏 ${label(g.jesterWinner)} the Jester also wins.` : null,
    ...exes.map((p) => `> ⚖️ ${label(p)} the Executioner also wins.`),
    ...survivors.map((p) => `> 🏕️ ${label(p)} survived, and wins too.`),
    '',
    '### 🎭 The truth',
    ...roleLines,
    '',
    '### 📜 What happened',
    ...g.events.map((e) => `> ${e}`),
    ...(betLines.length ? ['', '### 🎰 Bets', ...betLines] : []),
    ...(unlocked.length ? ['', '### 🏆 Achievements', ...unlocked] : []),
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
  await sayWithArt(g, '-# 🎬 how it happened', () => cards.timeline({ setting: g.setting.name, side, rounds: timelineRounds(g) }), 'timeline.png');
}

// Turn the event log ("Night 2: …", "Day 2: …") into timeline columns, colored by what happened.
const EVENT_KINDS = [
  [/Bodyguard\) died protecting/, 'hero'], [/broken heart/, 'heartbreak'], [/died of guilt/, 'guilt'], [/\(Vigilante\) shot/, 'shot'],
  [/saved them|who survived/, 'save'], [/was convicted/, 'convict'], [/found innocent/, 'acquit'], [/nobody got enough/, 'notrial'],
  [/Mayor/, 'reveal'], [/Executioner/, 'exe'], [/destroyed the evidence/, 'clean'], [/ was .+ by |^Prologue/, 'kill'],
];
function timelineRounds(g) {
  const rounds = [];
  const byLabel = new Map();
  for (const e of g.events) {
    const m = /^(Prologue|Night \d+|Day \d+):\s*(.*)$/.exec(e);
    if (!m) continue;
    let r = byLabel.get(m[1]);
    if (!r) { r = { label: m[1], night: !/^Day/.test(m[1]), items: [] }; byLabel.set(m[1], r); rounds.push(r); }
    // Drop the "(username)" after each character name; keep roles like "(Detective)".
    const text = g.players.reduce((t, p) => t.split(` (${p.user.username})`).join(''), m[2]).slice(0, 160);
    if (r.items.length < 6) r.items.push({ kind: (EVENT_KINDS.find(([re]) => re.test(e)) ?? [null, 'event'])[1], text });
  }
  return rounds;
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
    for (const p of g.players) await sendArt(p.dmChannel, roleCard(g, p), () => dossierFor(g, p), 'dossier.png');
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
      `Mode: ${MODES[g.mode].emoji} **${g.mode}** (${MODES[g.mode].blurb})`,
    ],
    footer: `${p}mm join · ${p}mm leave · host: ${p}mm start [classic | quick | chaos]`,
  });
}

const newPlayer = (user) => ({ id: user.id, user, alive: true, ready: false, role: null, char: null, traits: null, dmChannel: null, lastProtect: null });

module.exports = [
  {
    name: 'mystery',
    aliases: ['mm', 'murder', 'murdermystery'],
    usage: 'mm [join | leave | start [quick|chaos] | stop | skip | search <room> | question <guest> | reveal | board | map | bet <guest> <coins> | clues | guests | roles | howto | stats | top | cast]',
    description: 'Murder mystery: secret roles by DM, murders, clues, searches, trials (4–25 players). Modes: classic, quick, chaos.',
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
        const fav = Object.entries(s.roles ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0];
        return sendArt(ch, card({
          title: `${user.username}'s mystery record`, emoji: '🔪',
          body: [
            `🎮 **${s.games}** games · 🏆 **${s.wins}** wins (${s.games ? Math.round((s.wins / s.games) * 100) : 0}%)`,
            `🔪 **${s.kills}** kills · played murderer **${s.murderer}**×`,
            `⚖️ **${s.convictions}** murderers convicted`,
            `🏆 Achievements (${s.achievements.length}/${Object.keys(ACHIEVEMENTS).length}): ${s.achievements.length ? s.achievements.map((id) => `${ACHIEVEMENTS[id][0]} ${ACHIEVEMENTS[id][1]}`).join(' · ') : 'none yet'}`,
          ],
        }), () => cards.profileCard({
          user: user.username, url: user.displayAvatarURL?.({ format: 'png', dynamic: false, size: 256 }), s,
          favorite: fav ? { name: ROLES[fav].name, color: ROLE_COLORS[fav] } : null,
          achievements: Object.entries(ACHIEVEMENTS).map(([id, [emoji, name]]) => [id, emoji, name, s.achievements.includes(id)]),
        }), 'mystery-profile.png');
      }
      if (sub === 'howto' || sub === 'rules' || sub === 'tutorial') {
        return sendArt(ch, `### 🔪 How to play\n> Start a lobby with \`${p}mm\`, everyone joins with \`${p}mm join\`, the host runs \`${p}mm start\`. Then everyone DMs me \`ready\`.\n-# \`${p}mm roles\` explains every role`, () => cards.howto({ prefix: p }), 'how-to-play.png');
      }
      if (sub === 'cast') {
        data.mmCast ??= {};
        const list = (data.mmCast[ch.id] ??= []);
        const action = (args[1] ?? 'list').toLowerCase();
        const clean = (t, max) => sanitize(t).replace(/[*_`~|>#\\]/g, '').trim().slice(0, max);
        if (action === 'list') {
          return ch.send(list.length
            ? card({ title: `Custom cast · ${list.length}/25`, emoji: '🎭', body: list.map(([n, t], i) => `\`${i + 1}\` **${n}**, ${t}`), footer: `${p}mm cast add Name | title · ${p}mm cast remove <#> · ${p}mm cast clear · used before the built-in characters` })
            : `### 🎭 Custom cast\n> None yet. GC admins can add characters: \`${p}mm cast add Name | title\`\n-# custom characters are handed out first, then the built-in ones`);
        }
        if (!config.isAdmin(me.id, client) && !onboarding.isGcManager(ch, me.id)) return message.reply('Only GC admins can change the cast.');
        if (action === 'add') {
          const [rawName = '', rawTitle = ''] = args.slice(2).join(' ').split('|');
          const name = clean(rawName, 32), title = clean(rawTitle, 40) || 'the mysterious guest';
          if (!name) return message.reply(`Usage: \`${p}mm cast add Name | title\` (e.g. \`${p}mm cast add Big Steve | the gym bro\`)`);
          if (list.length >= 25) return message.reply('The cast is full (25). Remove someone first.');
          if (list.some(([n]) => n.toLowerCase() === name.toLowerCase())) return message.reply(`**${name}** is already in the cast.`);
          list.push([name, title]);
          save();
          return message.reply(`🎭 Added **${name}**, ${title}. (${list.length}/25)`);
        }
        if (action === 'remove' || action === 'rm') {
          const q = args.slice(2).join(' ').toLowerCase();
          const i = /^\d+$/.test(q) ? Number(q) - 1 : list.findIndex(([n]) => n.toLowerCase() === q);
          if (!list[i]) return message.reply('Remove who? Use the number from `mm cast`.');
          const [gone] = list.splice(i, 1);
          save();
          return message.reply(`🎭 Removed **${gone[0]}**.`);
        }
        if (action === 'clear') { list.length = 0; save(); return message.reply('🎭 Custom cast cleared. Back to the built-in characters.'); }
        return message.reply(`\`${p}mm cast [list | add Name | title | remove <#> | clear]\``);
      }
      if (sub === 'top' || sub === 'leaderboard' || sub === 'lb') {
        const by = ['wins', 'kills', 'convictions', 'games'].includes(args[1]) ? args[1] : 'wins';
        const rows = Object.entries(data.mmStats ?? {}).filter(([, s]) => s.games > 0).sort((a, b) => b[1][by] - a[1][by] || b[1].wins - a[1].wins).slice(0, 10);
        if (!rows.length) return ch.send('### 🔪 Mystery leaderboard\n> Nobody has finished a game yet.');
        return ch.send(card({
          title: `Mystery leaderboard · ${by}`, emoji: '🏆',
          body: rows.map(([id, s], i) => `${['🥇', '🥈', '🥉'][i] ?? `\`${i + 1}\``} **${s.name ?? `<@${id}>`}** · ${s[by]} ${by} · ${s.games ? Math.round((s.wins / s.games) * 100) : 0}% wins · ${s.achievements?.length ?? 0} 🏆`),
          footer: `${p}mm top [wins | kills | convictions | games]`,
        }));
      }
      if (sub === 'roles') {
        return ch.send(`### 🎭 Roles\n${Object.values(ROLES).map((r) => `> ${r.emoji} **${r.name}**: ${r.goal}`).join('\n')}\n> 💘 **Lovers** (chaos mode, sometimes 9+): two players linked. If one dies, so does the other.\n-# 4: 🔪🔍 · 5: +💉 · 6: +🃏 · 7: +🤝 · 8: +🎩 · 9: +👁️ · 10: +🛡️ · 11: 2nd 🔪 +🏕️ · 12: +⚖️ · 13: +🔫 · 14: +🔮 · 15: 2nd 🔍 · 17: 3rd 🔪 · chaos: more specials\n-# everyone: DM me \`will <text>\` for a last will · the dead can \`haunt <#>\` once`);
      }

      if (!g) {
        if (sub && !['start', 'join', 'new', 'host'].includes(sub)) return message.reply(`No game running. Start one with \`${p}mm\`.`);
        if (playerGame.has(me.id)) return message.reply("You're already in a murder mystery somewhere else.");
        if (party.playingIn(me.id)) return message.reply(`You're already in a game of **${party.playingIn(me.id)}**.`);
        if (!party.claimChannel(message, NAME)) return;
        g = { channel: ch, host: me, phase: 'lobby', mode: 'classic', players: [newPlayer(me)], setting: pick(SETTINGS), clues: [], events: [], day: 0, votes: new Map(), bets: new Map() };
        games.set(ch.id, g);
        playerGame.set(me.id, g);
        party.lockPlayer(me.id, NAME);
        g.lobbyMsg = await ch.send(lobbyText(g, p));
        return;
      }

      if (sub === 'join') {
        if (g.phase !== 'lobby') return message.reply('The game already started. Catch the next one!');
        if (me.id === client.user.id) return message.reply("I'm the narrator, I can't play. 🎭");
        if (byId(g, me.id)) return message.reply("You're already in.");
        if (playerGame.has(me.id) || party.playingIn(me.id)) return message.reply("You're in another game.");
        if (g.players.length >= MAX_PLAYERS) return message.reply('The lobby is full.');
        g.players.push(newPlayer(me));
        playerGame.set(me.id, g);
        party.lockPlayer(me.id, NAME);
        await g.lobbyMsg.edit(lobbyText(g, p)).catch(() => {});
        return message.reply(`🎭 You're in! (${g.players.length} players)`);
      }
      if (sub === 'leave') {
        if (g.phase !== 'lobby') return message.reply("You can't leave mid-game. Just don't die. 👀");
        if (!byId(g, me.id)) return message.reply("You're not in this game.");
        g.players = g.players.filter((x) => x.id !== me.id);
        playerGame.delete(me.id);
        party.unlockPlayer(me.id, NAME);
        if (!g.players.length) { cleanup(g); return ch.send('🎭 Lobby closed (everyone left).'); }
        if (g.host.id === me.id) g.host = g.players[0].user;
        await g.lobbyMsg.edit(lobbyText(g, p)).catch(() => {});
        return message.reply('👋 You left the lobby.');
      }
      if (sub === 'mode') {
        if (g.phase !== 'lobby') return message.reply('The mode is set before the game starts.');
        if (!isHost) return message.reply(`Only the host (${g.host.username}) can change the mode.`);
        const mode = (args[1] ?? '').toLowerCase();
        if (!MODES[mode]) return message.reply(`Modes: ${Object.entries(MODES).map(([k, v]) => `${v.emoji} \`${k}\` (${v.blurb})`).join(' · ')}`);
        g.mode = mode;
        await g.lobbyMsg.edit(lobbyText(g, p)).catch(() => {});
        return message.reply(`${MODES[mode].emoji} Mode set to **${mode}**.`);
      }
      if (sub === 'start') {
        if (g.phase !== 'lobby') return message.reply('Already running!');
        if (!isHost) return message.reply(`Only the host (${g.host.username}) can start.`);
        if (g.players.length < T.min()) return message.reply(`Need at least ${T.min()} players (have ${g.players.length}). \`${p}mm join\``);
        if (args[1] && MODES[args[1].toLowerCase()]) g.mode = args[1].toLowerCase();
        if (g.mode !== 'classic') await ch.send(`### ${MODES[g.mode].emoji} ${g.mode[0].toUpperCase()}${g.mode.slice(1)} mode\n> ${MODES[g.mode].blurb}`);
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
      if (sub === 'map') {
        if (!g.players[0].char || !g.day) return message.reply('The floor plan goes up after the first night.');
        return sayWithArt(g, `### 🗺️ ${g.setting.name} · floor plan`, () => renderMap(g), 'map.png');
      }
      if (sub === 'board') {
        if (!g.players[0].char) return message.reply('The board goes up once the game starts.');
        const traitOf = (x) => [x.traits.garment[0], x.traits.scent[0], x.traits.mark[0]];
        const guests = g.players.map((x) => ({
          name: x.char.name, user: x.user.username, traits: traitOf(x), alive: x.alive,
          role: x.alive ? null : ROLES[x.role].name, roleColor: ROLE_COLORS[x.role], mayor: x.alive && x.revealed,
          pins: g.clues.filter((c) => c.options.some((o) => traitOf(x).includes(o))).map((c) => c.n),
        }));
        return sayWithArt(g, `### 📌 Evidence board\n-# red tags show which clues mention each guest. remember: some clues are lies`, () => art.evidenceBoard({
          setting: g.setting.name, day: g.day, guests, clues: g.clues,
        }), 'evidence-board.png');
      }
      if (sub === 'bet') {
        if (['lobby', 'ready', 'over'].includes(g.phase)) return message.reply('Bets open once the game is underway.');
        if (me.id === client.user.id) return;
        const player = byId(g, me.id);
        if (player?.alive) return message.reply('Only the dead and spectators can bet. 👻');
        if (player && startedOnMurderTeam(player)) return message.reply('Ghosts of the murder team know too much to bet. 🔪');
        if (g.bets.has(me.id)) return message.reply('You already placed a bet this game.');
        const target = findTarget(g, args.slice(1, -1).join(' '));
        const raw = eco.parseBet(me.id, args.at(-1));
        if (!target || !raw || args.length < 3) return message.reply(`Usage: \`${p}mm bet <guest> <coins>\` (an alive guest you think is on the murder team, up to ${eco.fmt(BET_MAX)})`);
        const amount = Math.min(raw, BET_MAX);
        const murderTeam = Math.max(1, alive(g).filter(isMurderTeam).length);
        const mult = Math.min(6, Math.max(1.5, Math.round((alive(g).length / murderTeam) * 0.8 * 10) / 10));
        eco.take(me.id, amount);
        g.bets.set(me.id, { target: target.id, amount, mult, user: me, settled: false });
        return ch.send(`### 🎰 ${me.username} bets ${eco.fmt(amount)} on ${label(target)}\n> Pays **${mult}×** if they turn out to be on the murder team.\n-# settled when the game ends`);
      }
      if (sub === 'question' || sub === 'interrogate') {
        const player = byId(g, me.id);
        if (!player?.alive) return message.reply('Only living players can interrogate.');
        if (g.phase !== 'day') return message.reply('Interrogations happen during the investigation.');
        if (g.questionDay === g.day) return message.reply('Someone has already been interrogated today.');
        if (player.usedQuestion) return message.reply('You already used your interrogation this game.');
        const target = findTarget(g, args.slice(1).join(' '), (x) => x !== player);
        if (!target) return message.reply(`Question who?\n${numbered(g, (x) => x !== player)}`);
        g.questionDay = g.day;
        player.usedQuestion = true;
        const q = pick(QUESTIONS).replace('{room}', g.lastRoom ?? pick(g.setting.rooms)).replace('{host}', g.setting.host);
        await ch.send(`### 🔦 Interrogation\n> **${player.char.name}** turns the lamp on ${label(target)}:\n> *“${q}”*\n-# <@${target.id}>, answer in the chat within ${secs(T.question())}`);
        const ans = await awaitReply(ch, (x) => x.author.id === target.id && !x.content.startsWith(p), T.question());
        if (ans) {
          g.events.push(`Day ${g.day}: ${plain(target)} was interrogated by ${plain(player)}.`);
          return ch.send(`> 🗣️ **${target.char.name}:** “${sanitize(ans.content).slice(0, 300)}”`);
        }
        g.events.push(`Day ${g.day}: ${plain(target)} refused to answer ${plain(player)}’s interrogation.`);
        return ch.send(`### 🤐 ${target.char.name} says nothing\n> The silence is deafening. Suspicious…`);
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

module.exports.internals = { games, playerGame, assignRoles, roleList, makeClue, winner, stats, runGame, willExcerpt, ACHIEVEMENTS };
