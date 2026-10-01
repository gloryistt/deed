const { transcribe, isAudio } = require('../lib/transcribe');
const { card, color } = require('../lib/format');

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

// Only one transcription at a time so a burst of requests can't pin the CPU.
let transcribing = false;

async function findVoiceMessage(message) {
  if (message.reference?.messageId) {
    const ref = await message.fetchReference().catch(() => null);
    const att = ref?.attachments?.find(isAudio);
    return att ? { msg: ref, att } : null;
  }
  // No reply: use the most recent voice message in the last 25 messages.
  const recent = await message.channel.messages.fetch({ limit: 25, before: message.id }).catch(() => null);
  for (const msg of recent?.values() ?? []) {
    const att = msg.attachments?.find(isAudio);
    if (att) return { msg, att };
  }
  return null;
}


const stripHtml = (html) => html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

// Returns { word, phonetic, meanings: [{ partOfSpeech, definitions: [{ definition, example }] }], source },
// { meanings: [] } if the word doesn't exist, or null if the service is unreachable.
async function wiktionary(word) {
  try {
    const res = await fetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`, {
      headers: { 'User-Agent': 'DeedBot/1.0 (personal Discord group chat bot)' }, signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) return { word, meanings: [], source: 'Wiktionary' };
    if (!res.ok) return null;
    const body = await res.json();
    const meanings = (body.en ?? []).map((m) => ({
      partOfSpeech: m.partOfSpeech,
      definitions: m.definitions.map((d) => ({ definition: stripHtml(d.definition), example: d.examples?.[0] ? stripHtml(d.examples[0]) : null }))
        .filter((d) => d.definition),
    })).filter((m) => m.definitions.length);
    return { word, meanings, source: 'Wiktionary' };
  } catch {
    return null;
  }
}

async function freeDictionary(word) {
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, { signal: AbortSignal.timeout(6000) });
    if (res.status === 404) return { word, meanings: [], source: 'Free Dictionary API' };
    if (!res.ok) return null;
    const entries = await res.json();
    return {
      word: entries[0].word,
      phonetic: entries[0].phonetic || entries[0].phonetics?.find((p) => p.text)?.text,
      meanings: entries.flatMap((e) => e.meanings).map((m) => ({ partOfSpeech: m.partOfSpeech, definitions: m.definitions.map((d) => ({ definition: d.definition, example: d.example })) })),
      source: 'Free Dictionary API',
    };
  } catch {
    return null;
  }
}

module.exports = [
  {
    name: 'define',
    aliases: ['def', 'dict', 'dictionary'],
    usage: 'define <word>',
    description: 'Dictionary definition, pronunciation and examples.',
    async run({ message, args }) {
      const word = args.join(' ').toLowerCase();
      if (!word) return message.reply('Define what?');
      const result = (await wiktionary(word)) ?? (await freeDictionary(word));
      if (result === null) return message.reply("Couldn't reach the dictionary, try again in a sec.");
      if (!result.meanings.length) return message.reply(`No definition found for **${word}**. Try \`urban ${word}\`?`);

      const lines = [];
      for (const meaning of result.meanings.slice(0, 3)) {
        lines.push(`*${meaning.partOfSpeech.toLowerCase()}*`);
        meaning.definitions.slice(0, 2).forEach((d, i) => {
          lines.push(`**${i + 1}.** ${clip(d.definition, 220)}`);
          if (d.example) lines.push(`-# “${clip(d.example, 150)}”`);
        });
        lines.push('');
      }
      if (lines.at(-1) === '') lines.pop();

      await message.channel.send(clip(card({
        title: `${result.word}${result.phonetic ? `  ·  ${result.phonetic}` : ''}`, emoji: '📖',
        body: lines,
        footer: result.source,
      }), 2000));
    },
  },
  {
    name: 'urban',
    aliases: ['ud', 'slang'],
    usage: 'urban <term>',
    description: 'Urban Dictionary definition (slang).',
    async run({ message, args }) {
      const term = args.join(' ');
      if (!term) return message.reply('Look up what?');
      const data = await fetch(`https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(term)}`, { signal: AbortSignal.timeout(10000) })
        .then((r) => r.json()).catch(() => null);
      if (!data) return message.reply("Couldn't reach Urban Dictionary.");
      const top = data.list?.sort((a, b) => b.thumbs_up - a.thumbs_up)[0];
      if (!top) return message.reply(`Nothing on Urban Dictionary for **${term}**.`);
      const strip = (s) => s.replace(/\[([^\]]+)\]/g, '$1').replace(/\r/g, '');
      await message.channel.send(card({
        title: top.word, emoji: '🏙️',
        body: [...clip(strip(top.definition), 700).split('\n'), top.example ? '' : null, top.example ? `*${clip(strip(top.example), 300).replace(/\n+/g, ' ')}*` : null],
        footer: `👍 ${top.thumbs_up.toLocaleString()} · 👎 ${top.thumbs_down.toLocaleString()} · Urban Dictionary`,
      }));
    },
  },
  {
    name: 'transcribe',
    aliases: ['tr', 'stt', 'ts'],
    usage: 'transcribe (reply to a voice message, or use right after one)',
    description: 'Turn a voice message into text.',
    cooldown: 5000,
    async run({ message }) {
      const found = await findVoiceMessage(message);
      if (!found) return message.reply('Reply to a voice message with this command (or send it right after one).');
      const { msg, att } = found;
      if (att.size > 25 * 1024 * 1024) return message.reply('That audio is too big (25 MB max).');
      if (att.duration && att.duration > 600) return message.reply('That audio is too long (10 min max).');
      if (transcribing) return message.reply("I'm already transcribing something, give me a sec.");

      transcribing = true;
      const status = await message.channel.send(`🎙️ Transcribing ${msg.author.username}'s voice message…`);
      const started = Date.now();
      try {
        const { text, language } = await transcribe(att);
        const took = ((Date.now() - started) / 1000).toFixed(1);
        const body = text ? clip(text, 1700).split('\n') : ['*(no speech detected)*'];
        await status.edit(card({
          title: 'Transcript', emoji: '🎙️', private: true, // voice message contents: never sent to the embed service
          body,
          footer: `${msg.author.username}${att.duration ? ` · ${mmss(att.duration)}` : ''}${language && language !== 'en' ? ` · ${language}` : ''} · transcribed in ${took}s`,
        }));
      } catch (err) {
        await status.edit(`❌ Couldn't transcribe: ${err.message}`);
      } finally {
        transcribing = false;
      }
    },
  },
];
