// ,stream: Go Live in the group chat call with a YouTube link, a direct video link, a video attachment,
// or (bot owners) a file from the videos/ folder.
const stream = require('../lib/stream');
const voice = require('../lib/voice');
const { card } = require('../lib/format');
const { formatDuration } = require('../lib/util');

const mmss = (sec) => `${Math.floor(sec / 3600) ? `${Math.floor(sec / 3600)}:` : ''}${String(Math.floor((sec % 3600) / 60)).padStart(Math.floor(sec / 3600) ? 2 : 1, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

function videoIn(m) {
  const att = m?.attachments?.find((a) => /^video\//.test(a.contentType ?? '') || /\.(mp4|webm|mkv|mov|m4v)(\?|$)/i.test(a.name ?? ''));
  return att ? { kind: 'url', url: att.url, isVideo: true, title: att.name } : null;
}

async function findSource(message, args) {
  const own = videoIn(message);
  if (own) return own;
  const link = args.find((a) => /^https?:\/\//i.test(a));
  if (link) return { kind: 'url', url: link.replace(/^<|>$/g, '') };
  if (message.reference?.messageId) {
    const ref = await message.fetchReference().catch(() => null);
    const att = videoIn(ref);
    if (att) return att;
    const refLink = ref?.content?.match(/https?:\/\/\S+/)?.[0];
    if (refLink) return { kind: 'url', url: refLink.replace(/[>)]$/, '') };
  }
  return null;
}

module.exports = [
  {
    name: 'stream',
    aliases: ['golive', 'watch'],
    usage: 'stream <youtube link | direct video link> · or attach/reply to a video · stream stop · stream now',
    description: 'Screen-share a video into the GC call (Go Live) so everyone can watch together.',
    cooldown: 10000,
    async run({ client, message, args, config }) {
      const ch = message.channel;
      const sub = (args[0] ?? '').toLowerCase();
      const p = config.prefix;

      if (['stop', 'end', 'off'].includes(sub)) {
        return message.reply(stream.stop(ch.id) ? '### ⏹️ Stopping the stream…' : "I'm not streaming here.");
      }
      if (['now', 'status', 'np'].includes(sub)) {
        const cur = stream.current(ch.id);
        if (!cur) return message.reply("I'm not streaming here.");
        const elapsed = (Date.now() - cur.startedAt) / 1000;
        return ch.send(`### 📺 Streaming: ${cur.title}\n> ${mmss(elapsed)}${cur.duration ? ` / ${mmss(cur.duration)}` : ''} · requested by ${cur.requester}\n-# \`${p}stream stop\` to end`);
      }
      if (sub === 'files') {
        if (!config.isAdmin(message.author.id, client)) return message.reply('Only bot owners can stream local files.');
        const files = stream.listFiles();
        return ch.send(files.length
          ? `### 🎞️ Videos folder\n${files.map((f) => `> \`${f}\``).join('\n')}\n-# \`${p}stream file <name>\``
          : `### 🎞️ Videos folder is empty\n-# put videos in ${stream.VIDEO_DIR}`);
      }

      let src;
      if (sub === 'file') {
        if (!config.isAdmin(message.author.id, client)) return message.reply('Only bot owners can stream local files.');
        if (!args[1]) return message.reply(`Which file? See \`${p}stream files\`.`);
        src = { kind: 'file', name: args.slice(1).join(' ') };
      } else {
        src = await findSource(message, args);
      }
      if (!src) {
        return message.reply(`Usage: \`${p}stream <youtube link or direct video link>\`, or attach / reply to a video.`);
      }
      if (stream.isStreaming(ch.id)) return message.reply(`📺 Already streaming **${stream.current(ch.id).title}**. \`${p}stream stop\` first.`);

      // Needs a call that people are in (Deed joins it; it won't start one and ring everyone).
      let inCall = ch.voiceUsers?.filter((u) => u.id !== client.user.id);
      if (!inCall?.size && ch.sync) inCall = (await voice.refreshCall(client, ch)).filter((u) => u.id !== client.user.id);
      if (!inCall?.size) return message.reply('### 📞 Start a call first\n> Start a voice call in this GC, then run `stream` again and I’ll go live in it.');

      // One thing at a time in a call: streaming replaces music.
      const music = require('./music').internals;
      const q = music.queues.get(ch.id);
      if (q) music.teardown(ch.id, q, '🎵 Music stopped to make room for the stream.');

      const status = await ch.send('### 📺 Getting the stream ready…');
      try {
        const result = await stream.start(client, ch, src, message.author.username, {
          onLive: (entry) => status.edit(card({
            title: `Live: ${entry.title}`, emoji: '📺',
            body: [
              '🔴 **Deed is streaming in the call.** Click Deed’s stream in the call to watch.',
              entry.duration ? `⏱️ ${mmss(entry.duration)}` : null,
            ],
            footer: `requested by ${message.author.username} · ${process.env.STREAM_HEIGHT || 720}p · ${p}stream stop to end`,
          })).catch(() => {}),
        });
        const ran = formatDuration(Date.now() - result.entry.startedAt);
        await ch.send(result.stopped ? `### ⏹️ Stream stopped\n-# ${result.entry.title} · ran ${ran}` : `### 📺 Stream finished\n-# ${result.entry.title} · ${ran}`);
      } catch (err) {
        console.error('[stream]', err);
        await status.edit(`### 📺 Couldn't stream that\n> ${err.message ?? err}`).catch(() => {});
      }
    },
  },
];
