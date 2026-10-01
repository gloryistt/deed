// Roleplay actions with anime GIFs from nekos.best (free, SFW, no API key).
const { data, save } = require('../lib/db');
const { resolveUser } = require('../lib/util');

// name: [emoji, "{a} ___ {b}" when targeted, "{a} ___" when solo (null = target required), extra aliases]
const ACTIONS = {
  hug: ['🤗', 'hugs', null], cuddle: ['🫂', 'cuddles', null], kiss: ['💋', 'kisses', null],
  peck: ['😚', 'gives a little peck to', null], blowkiss: ['😘', 'blows a kiss to', 'blows a kiss'],
  pat: ['🫳', 'pats', null], handhold: ['🤝', 'holds hands with', null], handshake: ['🤝', 'shakes hands with', null],
  highfive: ['🙌', 'high-fives', null], carry: ['🏋️', 'carries', null], lappillow: ['😴', 'lets {b} nap on their lap', null],
  feed: ['🍙', 'feeds', null], nom: ['😋', 'noms on', 'noms something'], tickle: ['🤭', 'tickles', null],
  poke: ['👉', 'pokes', null], boop: ['👉', 'boops', null, 'poke'], bite: ['😬', 'bites', null], slap: ['👋', 'slaps', null],
  punch: ['👊', 'punches', null], bonk: ['🔨', 'bonks', null], yeet: ['🚀', 'yeets', 'yeets something'],
  shoot: ['🔫', 'shoots', null], baka: ['💢', 'calls {b} a baka', 'yells BAKA'], kabedon: ['🧱', 'kabedons', null],
  stare: ['👀', 'stares at', 'stares'], wave: ['👋', 'waves at', 'waves'], wink: ['😉', 'winks at', 'winks'],
  smug: ['😏', 'looks smug at', 'looks smug'], laugh: ['😂', 'laughs at', 'laughs'], salute: ['🫡', 'salutes', 'salutes'],
  cry: ['😭', 'cries on', 'is crying'], dance: ['💃', 'dances with', 'is dancing'], blush: ['😊', 'blushes at', 'is blushing'],
  smile: ['😊', 'smiles at', 'smiles'], happy: ['😄', 'is happy with', 'is happy'], pout: ['😤', 'pouts at', 'pouts'],
  angry: ['😠', 'is angry at', 'is angry'], sleep: ['😴', 'falls asleep on', 'is sleeping'], yawn: ['🥱', 'yawns at', 'yawns'],
  shrug: ['🤷', 'shrugs at', 'shrugs'], think: ['🤔', 'thinks about', 'is thinking'], facepalm: ['🤦', 'facepalms at', 'facepalms'],
  nod: ['🙂', 'nods at', 'nods'], nope: ['🙅', 'says nope to', 'says nope'], thumbsup: ['👍', 'gives a thumbs up to', 'gives a thumbs up'],
  clap: ['👏', 'claps for', 'claps'], shocked: ['😱', 'is shocked by', 'is shocked'], confused: ['😕', 'is confused by', 'is confused'],
  bored: ['😑', 'is bored of', 'is bored'], sip: ['☕', 'sips tea at', 'sips tea'], tableflip: ['🙃', 'flips a table at', 'flips a table'],
  lurk: ['👀', 'lurks behind', 'is lurking'], run: ['🏃', 'runs from', 'runs away'], teehee: ['🤭', 'teehees at', 'teehees'],
};

async function fetchGif(category) {
  try {
    const res = await fetch(`https://nekos.best/api/v2/${category}`, { signal: AbortSignal.timeout(8000) });
    const body = await res.json();
    return body.results?.[0] ?? null;
  } catch {
    return null;
  }
}

function countFor(action, a, b) {
  data.rp ??= {};
  const key = `${action}:${a}:${b}`;
  data.rp[key] = (data.rp[key] ?? 0) + 1;
  save();
  return data.rp[key];
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

module.exports = Object.entries(ACTIONS).map(([name, [emoji, targeted, solo, category]]) => ({
  name,
  usage: `${name} ${solo ? '[@user]' : '<@user>'} [reason]`,
  description: solo ? `${emoji} ${name}, optionally at someone` : `${emoji} ${name} someone`,
  async run({ client, message, args }) {
    const me = message.author;
    const target = message.mentions.users.first() ?? (args[0] ? await resolveUser(client, message, args[0]) : null);
    if (!target && !solo) return message.reply(`${emoji} ${name} who? \`${name} @user\``);

    const reason = args.slice(target ? 1 : 0).join(' ').replace(/<@!?\d+>/g, '').trim().slice(0, 200);
    let title, footer = '';
    if (target && target.id !== me.id) {
      title = targeted.includes('{b}') ? `${me.username} ${targeted.replace('{b}', target.username)}` : `${me.username} ${targeted} ${target.username}`;
      const n = countFor(name, me.id, target.id);
      footer = `${me.username}'s ${ordinal(n)} ${name} for ${target.username}`;
    } else if (target) {
      // Targeting yourself: Deed steps in.
      title = targeted.includes('{b}') ? `Deed ${targeted.replace('{b}', me.username)}` : `Deed ${targeted} ${me.username}`;
      footer = 'Deed got you 🫶';
    } else {
      title = `${me.username} ${solo}`;
    }

    const gif = await fetchGif(category ?? name);
    await message.channel.send([
      `### ${emoji} ${title}`,
      reason ? `> ${reason}` : null,
      `-# ${[footer, gif?.anime_name ? `from ${gif.anime_name}` : null].filter(Boolean).join(' · ') || name}`,
      gif?.url ?? null,
    ].filter(Boolean).join('\n'));
  },
}));
