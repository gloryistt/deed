// Group-chat voice via @discordjs/voice, which supports Discord's DAVE end-to-end encryption.
// (The selfbot library's own voice code predates DAVE, so Discord rejects it with 4006.)
const {
  joinVoiceChannel, entersState, VoiceConnectionStatus, getVoiceConnection,
} = require('@discordjs/voice');

// @discordjs/voice was built for servers, where every call has a guild id. Group-chat calls don't,
// so translate at the edges:
//   outgoing join/leave payloads: guild_id must be null
//   incoming voice server info:   use the channel id as the "server id" the voice gateway expects
function groupDmAdapter(channel) {
  return (methods) => {
    const inner = channel.voiceAdapterCreator({
      onVoiceServerUpdate: (d) => methods.onVoiceServerUpdate({ ...d, guild_id: d.guild_id ?? channel.id }),
      onVoiceStateUpdate: (d) => methods.onVoiceStateUpdate(d),
      destroy: () => methods.destroy(),
    });
    return {
      sendPayload: (payload) => {
        const p = payload?.d?.guild_id === channel.id ? { ...payload, d: { ...payload.d, guild_id: null } } : payload;
        return inner.sendPayload(p);
      },
      destroy: () => inner.destroy(),
    };
  };
}

async function join(channel) {
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.id, // keyed by channel id; rewritten to null on the wire
    adapterCreator: groupDmAdapter(channel),
    selfDeaf: true,
    selfMute: false,
    debug: process.env.DEBUG_VOICE === '1',
  });
  if (process.env.DEBUG_VOICE === '1') {
    connection.on('debug', (m) => console.log(`[VOICE] ${m}`));
    connection.on('stateChange', (a, b) => console.log(`[VOICE] ${a.status} -> ${b.status}`));
  }
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20000);
  } catch (err) {
    connection.destroy();
    throw new Error("couldn't connect to the call within 20 seconds");
  }
  return connection;
}

const current = (channelId) => getVoiceConnection(channelId);

// Discord only tells a client about a call that was already running if the client asks (gateway op 13,
// what the official app sends when you open a DM). channel.sync() sends it; Discord answers with a
// CALL_CREATE event listing everyone in the call (or nothing, if there's no call).
function refreshCall(client, channel, timeout = 2500) {
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); client.off('callCreate', onCall); resolve(channel.voiceUsers); };
    const onCall = (call) => { if (call.channelId === channel.id) done(); };
    const timer = setTimeout(done, timeout);
    client.on('callCreate', onCall);
    try { channel.sync(); } catch { done(); }
  });
}

// At startup, learn about calls already running in every active GC (one per second, gentle on rate limits).
async function syncActiveCalls(client, isActive) {
  const gcs = [...client.channels.cache.values()].filter((c) => c.type === 'GROUP_DM' && isActive(c));
  let live = 0;
  for (const gc of gcs) {
    const users = await refreshCall(client, gc, 1500);
    if (users.size) live++;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (gcs.length) console.log(`📞 Checked ${gcs.length} GC${gcs.length === 1 ? '' : 's'} for calls: ${live} active`);
}

module.exports = { join, current, groupDmAdapter, refreshCall, syncActiveCalls };
