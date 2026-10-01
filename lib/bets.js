// Shared betting helpers for every casino game.
const eco = require('./economy');

// Users currently in an interactive game, so they can't bet the same coins twice.
const busy = new Set();

function betOrUsage(message, raw, usage) {
  if (busy.has(message.author.id)) {
    message.reply('Finish your current game first.');
    return null;
  }
  const bet = eco.parseBet(message.author.id, raw);
  if (!bet) message.reply(`Usage: \`${usage}\` (you have ${eco.fmt(eco.balance(message.author.id))})`);
  return bet;
}

// Standard result footer: +/- amount and the new balance.
const result = (net, balance) =>
  `${net > 0 ? `**+🪙 ${net.toLocaleString()}**` : net < 0 ? `**-🪙 ${(-net).toLocaleString()}**` : '**±0**'}\n-# balance: 🪙 ${balance.toLocaleString()}`;

// Run an interactive game with the user marked busy and the bet held in escrow.
async function withBet(userId, bet, fn) {
  busy.add(userId);
  eco.take(userId, bet);
  try {
    return await fn();
  } finally {
    busy.delete(userId);
  }
}

module.exports = { busy, betOrUsage, result, withBet };
