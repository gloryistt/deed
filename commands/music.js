// Music in the GC call. Needs ffmpeg + yt-dlp installed (brew install ffmpeg yt-dlp).
const { execFile } = require('child_process');
const { shuffle } = require('../lib/util');
const { card, color } = require('../lib/format');
const prism = require('prism-media');
const {
  createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType, VoiceConnectionStatus, entersState,
} = require('@discordjs/voice');
const voice = require('../lib/voice');

// One queue per GC.
// { connection, player, resource, songs: [{ title, duration, page, requester }], volume,
//   loop: 'off'|'song'|'queue', textChannel, skipping, failed }
const queues = new Map();

// ---------- direct audio files (links and Discord attachments) ----------
const AUDIO_EXT = /\.(mp3|wav|ogg|oga|opus|flac|m4a|aac|weba|webm|mka|wma|aiff?|mp4|m4v|mov|mkv)$/i; // video files play their sound
const YOUTUBE_HOST = /(^|\.)(youtube\.com|youtu\.be)$/i;

// Only links from the public internet: no localhost or home-network addresses.
function isPublicUrl(raw) {
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol)) return false;
    const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h) || h.startsWith('fe80:')) return false;
    const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
    if (m) {
      const [a, b] = [Number(m[1]), Number(m[2])];
      if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return false;
    }
    return true;
  } catch { return false; }
}

const isDirectAudioUrl = (raw) => {
  try { const u = new URL(raw.trim().replace(/^<|>$/g, '')); return !YOUTUBE_HOST.test(u.hostname) && AUDIO_EXT.test(u.pathname); } catch { return false; }
};

// Read a remote audio file's length and tags with ffprobe (also proves it really is audio).
function probeAudio(url) {
  return new Promise((resolve, reject) => {
    execFile('ffprobe', ['-v', 'error', '-protocol_whitelist', 'http,https,tcp,tls,crypto', '-show_entries', 'format=duration:format_tags=title,artist:stream=codec_type', '-of', 'json', url],
      { timeout: 20000 }, (err, stdout) => {
        if (err) return reject(new Error(err.code === 'ENOENT' ? 'ffprobe is not installed (comes with ffmpeg)' : 'I couldn’t read that as an audio file (is the link direct and public?)'));
        try {
          const j = JSON.parse(stdout);
          if (!(j.streams ?? []).some((st) => st.codec_type === 'audio')) return reject(new Error('that file has no audio in it'));
          const tags = Object.fromEntries(Object.entries(j.format?.tags ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
          resolve({ duration: Math.round(Number(j.format?.duration) || 0), title: tags.title ? (tags.artist ? `${tags.artist} - ${tags.title}` : tags.title) : null });
        } catch { reject(new Error('I couldn’t read that as an audio file')); }
      });
  });
}

async function directSong(url, name) {
  const clean = url.trim().replace(/^<|>$/g, '');
  if (!isPublicUrl(clean)) throw new Error('I can only play links from the public internet');
  const info = await probeAudio(clean);
  const fileName = name ?? decodeURIComponent(new URL(clean).pathname.split('/').pop() || 'audio');
  return { title: info.title ?? fileName, duration: info.duration, page: clean, direct: true };
}

// An audio/video file attached to the command message, or to the message it replies to.
async function findAttachment(message) {
  const isAudio = (a) => /^(audio|video)\//.test(a.contentType ?? '') || AUDIO_EXT.test((a.name ?? '').split('?')[0]);
  const own = message.attachments?.find(isAudio);
  if (own) return own;
  if (message.reference?.messageId) return (await message.fetchReference().catch(() => null))?.attachments?.find(isAudio) ?? null;
  return null;
}

// Optional: use your browser's YouTube login when YouTube asks the bot to prove it isn't one
// (set YTDLP_COOKIES_BROWSER=chrome|safari|firefox|edge in .env).
const cookieArgs = () => (process.env.YTDLP_COOKIES_BROWSER ? ['--cookies-from-browser', process.env.YTDLP_COOKIES_BROWSER] : []);

// Turn yt-dlp's stderr into something a person can act on.
function friendlyError(stderr = '', timedOut = false) {
  const line = (stderr.split('\n').reverse().find((l) => l.startsWith('ERROR')) ?? '').replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, '').trim();
  const t = `${line} ${stderr}`;
  let reason;
  if (timedOut) reason = { text: 'YouTube took too long to answer, try again in a moment', transient: true };
  else if (/sign in to confirm|not a bot/i.test(t)) reason = { text: 'YouTube is asking me to prove I’m not a bot (set YTDLP_COOKIES_BROWSER in .env to use a browser login)', transient: false };
  else if (/confirm your age|age.restricted|inappropriate for some users/i.test(t)) reason = { text: 'that video is age-restricted', transient: false };
  else if (/private video|video unavailable|has been removed|no longer available|copyright|blocked it|not available in your country|live event will begin/i.test(t)) reason = { text: 'that video is unavailable (private, removed, blocked, or not started yet)', transient: false };
  else if (/unviewable|this playlist/i.test(t)) reason = { text: 'that’s a YouTube Mix/playlist link I can’t open. Send the link of the video itself', transient: false };
  else if (/not a valid url|unsupported url/i.test(t)) reason = { text: 'that link isn’t one I can play', transient: false };
  else if (/http error 429|too many requests|unable to download|timed out|connection|temporary failure|getaddrinfo/i.test(t)) reason = { text: 'couldn’t reach YouTube just now, try again in a moment', transient: true };
  else reason = { text: line ? `yt-dlp said: ${line.slice(0, 140)}` : 'yt-dlp returned nothing for that', transient: false };
  return reason;
}

function ytdlp(args) {
  return new Promise((resolve, reject) => {
    execFile('yt-dlp', [...cookieArgs(), ...args], { timeout: 30000 }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout.trim());
      if (err.code === 'ENOENT') return reject(new Error('yt-dlp is not installed (brew install yt-dlp)'));
      const reason = friendlyError(stderr, err.killed || err.signal === 'SIGTERM');
      console.error(`[music] yt-dlp failed: ${(stderr || err.message).split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 300)}`);
      const e = new Error(reason.text);
      e.transient = reason.transient;
      reject(e);
    });
  });
}

// One retry for hiccups (timeouts, rate limits); permanent problems (private video…) fail straight away.
async function ytdlpRetry(args) {
  try {
    return await ytdlp(args);
  } catch (err) {
    if (!err.transient) throw err;
    await new Promise((r) => setTimeout(r, 1500));
    return ytdlp(args);
  }
}

// Clean up what people paste: <angle brackets>, youtu.be / shorts / music.youtube.com links, and the
// "&list=RD…" radio-mix parameters that make yt-dlp think it's a playlist. Plain text becomes a search.
function normalizeQuery(raw) {
  const q = raw.trim().replace(/^<|>$/g, '');
  if (!/^https?:\/\//i.test(q)) return { target: `ytsearch1:${q}`, playlist: false };
  try {
    const u = new URL(q);
    const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
    let id = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com') id = u.searchParams.get('v') ?? u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})/)?.[1] ?? null;
    if (id && /^[\w-]{11}$/.test(id)) return { target: `https://www.youtube.com/watch?v=${id}`, playlist: false };
    // A playlist link with no video in it: play its first track.
    if (host === 'youtube.com' && u.searchParams.get('list')) return { target: q, playlist: true };
  } catch { /* fall through: let yt-dlp try the raw link */ }
  return { target: q, playlist: false };
}

// Look up title/duration/page now; the actual stream URL is fetched right before playing,
// because YouTube stream URLs expire after a few hours.
async function lookup(query) {
  const { target, playlist } = normalizeQuery(query);
  const out = await ytdlpRetry([playlist ? '--playlist-items' : '--no-playlist', ...(playlist ? ['1'] : []), '--skip-download', '--print', 'title', '--print', 'duration', '--print', 'webpage_url', target]);
  const [title, duration, page] = out.split('\n');
  if (!page) throw new Error('I couldn’t find anything playable for that');
  return { title, duration: Number(duration) || 0, page };
}

const streamUrl = (page) => ytdlpRetry(['-f', 'bestaudio', '--no-playlist', '-g', page]).then((o) => o.split('\n')[0]);

const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

function progressBar(elapsed, total, width = 16) {
  if (!total) return `${mmss(elapsed)} 🔴 live`;
  const pos = Math.min(width - 1, Math.floor((elapsed / total) * width));
  return `${mmss(elapsed)} ${'▬'.repeat(pos)}🔘${'▬'.repeat(width - pos - 1)} ${mmss(total)}`;
}

const isPaused = (q) => q.player.state.status === AudioPlayerStatus.Paused;

// ffmpeg arguments to decode a remote audio URL into raw PCM. Input options (reconnect, seek, protocol
// whitelist: http(s) only, so a link can't make ffmpeg read local files) all go BEFORE -i.
function ffmpegArgs(url, startSec = 0) {
  return ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
    '-protocol_whitelist', 'http,https,tcp,tls,crypto', '-analyzeduration', '0',
    ...(startSec > 0 ? ['-ss', String(Math.floor(startSec))] : []),
    '-i', url, '-loglevel', 'error', '-f', 's16le', '-ar', '48000', '-ac', '2'];
}

// Decode with ffmpeg into a player resource. `diag` collects ffmpeg's exit code and error output so an
// early stop can be explained (and logged) instead of silently skipping the song.
function audioResource(url, volume, startSec = 0) {
  const ffmpeg = new prism.FFmpeg({ args: ffmpegArgs(url, startSec) });
  const diag = { stderr: '', exit: null };
  ffmpeg.process.stderr?.on('data', (d) => { diag.stderr = (diag.stderr + d).slice(-600); });
  ffmpeg.process.on('exit', (code, signal) => { diag.exit = code ?? signal; });
  const resource = createAudioResource(ffmpeg, { inputType: StreamType.Raw, inlineVolume: true });
  resource.volume.setVolume(volume);
  resource.diag = diag;
  resource.startSec = startSec;
  return resource;
}

// Did a track stop well before its real end? (Not for live streams: duration 0.)
const endedEarly = (playedSec, durationSec, retries = 0) => durationSec > 0 && playedSec < durationSec - 8 && retries < 3;

function teardown(channelId, q, notice) {
  if (queues.get(channelId) !== q) return;
  queues.delete(channelId);
  q.player.stop(true);
  if (q.connection.state.status !== VoiceConnectionStatus.Destroyed) q.connection.destroy();
  if (notice) q.textChannel.send(notice).catch(() => {});
}

// Called whenever the player finishes a track (naturally, skipped, or errored).
function onTrackEnd(channelId, q) {
  if (queues.get(channelId) !== q) return; // stopped
  const song = q.songs[0];
  const res = q.resource;
  if (song && res && !q.skipping && !q.failed) {
    const played = (res.startSec ?? 0) + res.playbackDuration / 1000;
    if (endedEarly(played, song.duration, song.retries ?? 0)) {
      // The stream dropped (YouTube closed the connection, network hiccup…): reconnect from where it stopped.
      song.retries = (song.retries ?? 0) + 1;
      const why = (res.diag?.stderr ?? '').trim().split('\n').pop() || 'no error output';
      console.error(`[music] "${song.title}" stopped early at ${Math.round(played)}s of ${song.duration}s (ffmpeg exit ${res.diag?.exit}): ${why.slice(0, 200)}`);
      q.textChannel.send(`⚠️ The stream dropped at ${mmss(played)}, reconnecting… (${song.retries}/3)`).catch(() => {});
      return playNext(channelId, Math.max(0, played - 1), true);
    }
    if (song.retries >= 3 && song.duration && played < song.duration - 8) {
      const why = (res.diag?.stderr ?? '').trim().split('\n').pop();
      q.textChannel.send(`⚠️ Couldn’t keep **${song.title}** playing${why ? `: ${why.slice(0, 160)}` : ''}. Moving on.`).catch(() => {});
    }
  }
  const finished = q.songs.shift();
  if (q.failed) q.failed = false;
  else if (q.skipping) { if (q.loop === 'queue') q.songs.push(finished); }
  else if (q.loop === 'song') q.songs.unshift(finished);
  else if (q.loop === 'queue') q.songs.push(finished);
  q.skipping = false;
  playNext(channelId);
}

function createQueue(channel, connection) {
  const player = createAudioPlayer();
  connection.subscribe(player);
  const q = { connection, player, resource: null, songs: [], volume: 0.5, loop: 'off', textChannel: channel, skipping: false, failed: false };

  player.on('stateChange', (before, after) => {
    if (before.status !== AudioPlayerStatus.Idle && after.status === AudioPlayerStatus.Idle) onTrackEnd(channel.id, q);
  });
  player.on('error', (err) => {
    q.failed = true;
    channel.send(`⚠️ Error playing **${q.songs[0]?.title ?? 'track'}**: ${err.message}`).catch(() => {});
  });

  // If the call drops, give Discord a few seconds to reconnect us before giving up.
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5000),
      ]);
    } catch {
      teardown(channel.id, q, '📞 Lost the call, stopping music.');
    }
  });
  connection.on(VoiceConnectionStatus.Destroyed, () => teardown(channel.id, q));

  queues.set(channel.id, q);
  return q;
}

async function playNext(channelId, startSec = 0, isRetry = false) {
  const q = queues.get(channelId);
  if (!q) return;
  const song = q.songs[0];
  if (!song) return teardown(channelId, q, 'Queue finished 🎶 Leaving the call.');
  if (!isRetry) song.retries = 0;
  try {
    const url = song.direct ? song.page : await streamUrl(song.page); // direct audio links need no yt-dlp
    if (queues.get(channelId) !== q) return; // stopped while resolving
    q.resource = audioResource(url, q.volume, startSec);
    q.player.play(q.resource);
    if (!isRetry && (q.loop !== 'song' || !q.announcedLoop)) {
      q.textChannel.send(`### 🎶 Now playing\n> **${song.title}**\n-# ${song.duration ? mmss(song.duration) : song.direct ? 'length unknown' : 'live'} · requested by ${song.requester}${q.songs.length > 1 ? ` · ${q.songs.length - 1} up next` : ''}`).catch(() => {});
    }
    q.announcedLoop = q.loop === 'song';
  } catch (err) {
    q.textChannel.send(`⚠️ Skipping **${song.title}**: ${err.message}`).catch(() => {});
    q.songs.shift();
    playNext(channelId);
  }
}

function requireQueue(message) {
  const q = queues.get(message.channel.id);
  if (!q) message.reply('Nothing is playing. Use `play <song>`.');
  return q;
}

module.exports = [
  {
    name: 'play',
    aliases: ['p'],
    usage: 'play <song name | youtube link | direct audio link> · or attach / reply to an audio file',
    description: 'Join the GC call and play a song, a direct audio file (.mp3 .wav .ogg .flac …) or an attachment (or queue it).',
    cooldown: 3000,
    async run({ client, message, args }) {
      if (require('../lib/stream').isStreaming(message.channel.id)) return message.reply('📺 I’m streaming in this call right now. `stream stop` first, then play music.');
      const query = args.join(' ');
      const attachment = await findAttachment(message);
      if (!query && !attachment) return message.reply('What should I play? A song name, a YouTube link, a direct audio link (.mp3, .wav, .ogg, .flac…), or attach an audio file.');
      // Only hop into a call that's already running; starting one would ring everyone in the GC.
      let inCall = message.channel.voiceUsers?.filter((u) => u.id !== client.user.id);
      // Nobody seen in the call? Ask Discord for the latest call state first (e.g. a call that was
      // already running when Deed started) before telling people to start one.
      if (!queues.has(message.channel.id) && !inCall?.size && message.channel.sync) {
        inCall = (await voice.refreshCall(client, message.channel)).filter((u) => u.id !== client.user.id);
      }
      if (!queues.has(message.channel.id) && !inCall?.size) {
        return message.reply('### 📞 Start a call first\n> Start a voice call in this GC, then run `play` again and I\'ll hop in.');
      }
      const searching = await message.channel.send(attachment || isDirectAudioUrl(query) ? '🎧 Loading the audio file…' : '🔎 Searching…');
      let song;
      try {
        const found = attachment ? await directSong(attachment.url, attachment.name)
          : isDirectAudioUrl(query) ? await directSong(query)
            : await lookup(query);
        song = { ...found, requester: message.author.username };
      } finally {
        await searching.delete().catch(() => {});
      }

      let q = queues.get(message.channel.id);
      if (q) {
        if (q.songs.length >= 100) return message.reply('Queue is full (100 songs).');
        q.songs.push(song);
        return message.channel.send(`➕ Queued **${song.title}** [${song.duration ? mmss(song.duration) : '?:??'}] at #${q.songs.length - 1}`);
      }

      let connection;
      try {
        connection = await voice.join(message.channel);
      } catch (err) {
        console.error('[voice]', err.message ?? err);
        return message.reply([
          "### 📞 Couldn't join the call",
          `> ${err.message ?? err}`,
          '-# make sure the call is still going, then try again · run with DEBUG_VOICE=1 to see details in the terminal',
        ].join('\n'));
      }
      q = createQueue(message.channel, connection);
      q.songs.push(song);
      playNext(message.channel.id);
    },
  },
  {
    name: 'nowplaying',
    aliases: ['np', 'current'],
    usage: 'nowplaying',
    description: "What's playing, with progress.",
    async run({ message }) {
      const q = requireQueue(message);
      if (!q) return;
      const song = q.songs[0];
      const elapsed = (q.resource?.playbackDuration ?? 0) / 1000;
      await message.channel.send(card({
        title: isPaused(q) ? 'Paused' : 'Now playing', emoji: isPaused(q) ? '⏸️' : '🎶',
        body: [`**[${song.title}](<${song.page}>)**`],
        block: [color(progressBar(elapsed, song.duration), 'pink', true)],
        footer: `requested by ${song.requester} · 🔊 ${Math.round(q.volume * 100)}% · loop ${q.loop}`,
      }));
    },
  },
  {
    name: 'skip',
    aliases: ['s', 'next'],
    usage: 'skip',
    description: 'Skip the current song.',
    async run({ message }) {
      const q = requireQueue(message);
      if (!q) return;
      await message.channel.send(`⏭️ Skipped **${q.songs[0]?.title}**`);
      // Skipping always moves on, even in song-loop mode (see onTrackEnd).
      q.skipping = true;
      if (q.player.state.status === AudioPlayerStatus.Idle) onTrackEnd(message.channel.id, q); // still loading
      else q.player.stop(true); // goes Idle -> onTrackEnd
    },
  },
  {
    name: 'queue',
    aliases: ['q'],
    usage: 'queue [page]',
    description: 'Show the queue.',
    async run({ message, args }) {
      const q = requireQueue(message);
      if (!q) return;
      const [now, ...upNext] = q.songs;
      const pages = Math.max(1, Math.ceil(upNext.length / 10));
      const page = Math.min(Math.max(Number(args[0]) || 1, 1), pages);
      const slice = upNext.slice((page - 1) * 10, page * 10);
      const total = q.songs.reduce((s, x) => s + x.duration, 0);
      await message.channel.send(card({
        title: 'Queue', emoji: '📜',
        body: [
          `▶️ **${now.title}** \`${mmss(now.duration)}\``,
          '',
          ...(upNext.length
            ? slice.map((s, i) => `\`${String((page - 1) * 10 + i + 1).padStart(2)}\` ${s.title} \`${mmss(s.duration)}\` · *${s.requester}*`)
            : ['*nothing queued after this*']),
        ],
        footer: `${q.songs.length} songs · ${mmss(total)} total · loop ${q.loop}${pages > 1 ? ` · page ${page}/${pages}` : ''}`,
      }));
    },
  },
  {
    name: 'unqueue',
    aliases: ['rm', 'dequeue'],
    usage: 'unqueue <queue #>',
    description: 'Remove a song from the queue.',
    async run({ message, args }) {
      const q = requireQueue(message);
      if (!q) return;
      const i = Number(args[0]);
      if (!Number.isInteger(i) || i < 1 || i >= q.songs.length) return message.reply('Give a queue number (see `queue`).');
      const [removed] = q.songs.splice(i, 1);
      await message.channel.send(`🗑️ Removed **${removed.title}**`);
    },
  },
  {
    name: 'shuffle',
    usage: 'shuffle',
    description: 'Shuffle the upcoming songs.',
    async run({ message }) {
      const q = requireQueue(message);
      if (!q) return;
      if (q.songs.length < 3) return message.reply('Not enough songs to shuffle.');
      q.songs = [q.songs[0], ...shuffle(q.songs.slice(1))];
      await message.channel.send('🔀 Shuffled the queue.');
    },
  },
  {
    name: 'loop',
    aliases: ['repeat'],
    usage: 'loop [off|song|queue]',
    description: 'Loop the current song or the whole queue.',
    async run({ message, args }) {
      const q = requireQueue(message);
      if (!q) return;
      const modes = ['off', 'song', 'queue'];
      q.loop = modes.includes(args[0]) ? args[0] : modes[(modes.indexOf(q.loop) + 1) % 3];
      await message.channel.send({ off: '➡️ Loop off', song: '🔂 Looping this song', queue: '🔁 Looping the queue' }[q.loop]);
    },
  },
  {
    name: 'pause',
    aliases: ['resume'],
    usage: 'pause',
    description: 'Pause / resume.',
    async run({ message }) {
      const q = requireQueue(message);
      if (!q) return;
      if (isPaused(q)) { q.player.unpause(); await message.channel.send('▶️ Resumed'); }
      else { q.player.pause(); await message.channel.send('⏸️ Paused'); }
    },
  },
  {
    name: 'volume',
    aliases: ['vol'],
    usage: 'volume <0-150>',
    description: 'Set the volume.',
    async run({ message, args }) {
      const q = requireQueue(message);
      if (!q) return;
      if (!args[0]) return message.reply(`🔊 Volume is ${Math.round(q.volume * 100)}%`);
      const v = Number(args[0]);
      if (Number.isNaN(v)) return message.reply('Give a number 0–150.');
      q.volume = Math.min(Math.max(v, 0), 150) / 100;
      q.resource?.volume?.setVolume(q.volume);
      await message.channel.send(`🔊 Volume ${Math.round(q.volume * 100)}%`);
    },
  },
  {
    name: 'stop',
    aliases: ['leave', 'dc'],
    usage: 'stop',
    description: 'Stop music, clear the queue, and leave the call.',
    async run({ message }) {
      const q = requireQueue(message);
      if (!q) return;
      teardown(message.channel.id, q);
      await message.channel.send('⏹️ Stopped and left the call.');
    },
  },
];

// Used by streaming: a call can only have one of music or a stream at a time.
module.exports.internals = { queues, teardown, normalizeQuery, friendlyError, ffmpegArgs, endedEarly, isPublicUrl, isDirectAudioUrl, probeAudio, directSong };
