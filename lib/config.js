const list = (v) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const admins = list(process.env.ADMIN_IDS);

module.exports = {
  prefix: process.env.PREFIX || '!',
  // GCs that are always active without !setup. Others activate via !setup (one per person).
  allowedGroups: list(process.env.GROUP_IDS),
  cooldownMs: Number(process.env.COOLDOWN_MS || 2500),
  defaultTimezone: process.env.DEFAULT_TZ || 'America/New_York',
  startingBalance: 500,
  dailyAmount: 250,
  gcMaxMembers: Number(process.env.GC_MAX_MEMBERS || 25), // Discord's group chat size limit
  // You (the account running Deed) are always an admin.
  isAdmin: (userId, client) => userId === client.user.id || admins.includes(userId),
};
