// One-off admin helper: add a user to a group chat Deed is in.
//   node scripts/add-to-gc.js <username> [gc id or name]
// With no GC given, it picks the single GC the user isn't already in (and refuses if that's ambiguous).
// Stop the running bot first: this logs in as Deed briefly.
require('dotenv').config({ quiet: true });
const { Client } = require('discord.js-selfbot-v13');

const [username, gcQuery] = process.argv.slice(2);
if (!username) {
  console.error('Usage: node scripts/add-to-gc.js <username> [gc id or name]');
  process.exit(1);
}

const client = new Client();
const done = (code, msg) => {
  console.log(msg);
  client.destroy();
  process.exit(code);
};

client.on('ready', async () => {
  try {
    await client.relationships.fetch().catch(() => {});
    const user = client.relationships.friendCache.find((u) => u.username.toLowerCase() === username.toLowerCase());
    if (!user) return done(1, `✗ ${username} isn't on Deed's friends list. Discord only lets Deed add friends to a group chat.`);

    const gcs = [...client.channels.cache.values()].filter((c) => c.type === 'GROUP_DM');
    let candidates = gcs.filter((c) => !c.recipients.has(user.id));
    if (gcQuery) candidates = candidates.filter((c) => c.id === gcQuery || (c.name ?? '').toLowerCase().includes(gcQuery.toLowerCase()));
    console.log(`Deed is in ${gcs.length} group chat(s):`);
    for (const c of gcs) console.log(`  • ${c.name ?? '(unnamed)'} · ${c.recipients.size + 1} members · ${c.recipients.has(user.id) ? `${username} already in` : `${username} not in`}`);

    if (candidates.length === 0) return done(1, `✗ No group chat to add ${username} to (already in all of them, or no match).`);
    if (candidates.length > 1) return done(1, `✗ ${username} is missing from ${candidates.length} GCs; pass the GC name or id to pick one.`);

    const gc = candidates[0];
    await gc.addUser(user);
    done(0, `✓ Added ${username} to "${gc.name ?? '(unnamed)'}" (now ${gc.recipients.size + 1} members).`);
  } catch (err) {
    done(1, `✗ Discord refused: ${err.message}`);
  }
});

client.login(process.env.DISCORD_TOKEN).catch((err) => done(1, `✗ Login failed: ${err.message}`));
setTimeout(() => done(1, '✗ Timed out after 45s.'), 45000);
