require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');
const { loadCommands, handleMessage } = require('./lib/handler');
const reminders = require('./lib/reminders');
const onboarding = require('./lib/onboarding');
const dm = require('./lib/dm');
const { flushNow } = require('./lib/db');
const config = require('./lib/config');

if (!process.env.DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

// Only one copy of Deed may run at a time: two copies answer everything twice and fight over the data file.
const fs = require('fs');
const path = require('path');
const LOCK = path.join(__dirname, 'data', 'deed.pid');
try {
  const pid = Number(fs.readFileSync(LOCK, 'utf8'));
  process.kill(pid, 0); // throws if that process is gone
  if (pid !== process.pid) {
    console.error(`Deed is already running (process ${pid}). Stop that one first (Ctrl+C in its terminal, or: kill ${pid}).`);
    process.exit(1);
  }
} catch {
  // no lock file, or the old process is gone
}
fs.mkdirSync(path.dirname(LOCK), { recursive: true });
fs.writeFileSync(LOCK, String(process.pid));
process.on('exit', () => {
  try { if (Number(fs.readFileSync(LOCK, 'utf8')) === process.pid) fs.unlinkSync(LOCK); } catch {}
});

const client = new Client();
client.commands = loadCommands();
client.startedAt = Date.now();

let consoleStarted = false;
client.on('ready', () => {
  console.log(`Deed is up as ${client.user.tag}`);
  console.log(`Prefix: ${config.prefix} | GCs: ${config.allowedGroups.length ? config.allowedGroups.join(', ') : 'all'}`);
  reminders.start(client);
  onboarding.logPending(client);
  require('./lib/voice').syncActiveCalls(client, onboarding.isActive).catch((e) => console.error('[voice]', e.message));

  // Type in this terminal to chat as Deed in a group chat (only when run interactively; CONSOLE=off disables).
  if (!consoleStarted && process.stdin.isTTY && process.env.CONSOLE !== 'off') {
    consoleStarted = true;
    require('./lib/console').startConsole(client, {
      isActive: onboarding.isActive,
      onQuit: () => process.emit('SIGINT'),
      onRestart: process.env.DEED_SUPERVISED ? () => process.emit('SIGUSR2') : null,
    });
  }
});

onboarding.register(client);
require('./lib/snipe').register(client);

client.on('messageCreate', (message) => {
  if (message.channel.type === 'DM') dm.route(client, message).catch((e) => console.error('[dm]', e));
  else handleMessage(client, message);
});
client.on('error', (err) => console.error('[client]', err));
if (process.env.DEBUG_VOICE === '1') {
  client.on('debug', (msg) => { if (msg.includes('VOICE')) console.log(msg); });
}
client.on('shardDisconnect', () => console.warn('Disconnected from Discord, reconnecting…'));
client.on('shardResume', () => console.log('Reconnected.'));

process.on('unhandledRejection', (err) => console.error('[unhandled]', err));
// Keep Deed online if a library throws from deep inside a stream (e.g. a broken ffmpeg pipe mid-stream).
process.on('uncaughtException', (err) => console.error('[uncaught]', err));

// Save data and leave voice cleanly on Ctrl+C / kill. SIGUSR2 restarts (exit code 75 makes the `npm start`
// supervisor relaunch Deed in the same terminal).
function shutdown(code) {
  console.log(code === 75 ? 'Restarting…' : 'Shutting down…');
  try { flushNow(); } catch (e) { console.error(e); }
  for (const c of require('@discordjs/voice').getVoiceConnections().values()) c.destroy();
  client.destroy();
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(0));
process.on('SIGUSR2', () => shutdown(75));

client.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error('Login failed:', err.message);
  process.exit(1);
});
