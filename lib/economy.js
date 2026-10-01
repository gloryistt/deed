const { data, save } = require('./db');
const config = require('./config');

function account(userId) {
  if (!data.users[userId]) {
    data.users[userId] = { balance: config.startingBalance, cooldowns: {}, won: 0, lost: 0 };
    save();
  }
  const acc = data.users[userId];
  acc.cooldowns ??= {};
  return acc;
}

const balance = (userId) => account(userId).balance;

function add(userId, amount) {
  const acc = account(userId);
  acc.balance += amount;
  save();
  return acc.balance;
}

// Hold a bet: coins leave the balance now, the outcome is decided later with settle().
function take(userId, amount) {
  account(userId).balance -= amount;
  save();
}

// Finish a bet that was held with take(): pay back `returned` and record the net win/loss.
function settle(userId, stake, returned) {
  const acc = account(userId);
  acc.balance += returned;
  const net = returned - stake;
  if (net > 0) acc.won = (acc.won ?? 0) + net;
  if (net < 0) acc.lost = (acc.lost ?? 0) - net;
  save();
  return { balance: acc.balance, net };
}

function recordLoss(userId, amount) {
  account(userId).lost = (account(userId).lost ?? 0) + amount;
  save();
}

// Parses "100", "1k", "all", "half". Returns null if invalid or more than they have.
function parseBet(userId, raw) {
  const bal = balance(userId);
  const s = String(raw ?? '').toLowerCase();
  let bet;
  if (s === 'all' || s === 'max') bet = bal;
  else if (s === 'half') bet = Math.floor(bal / 2);
  else if (/^\d+(\.\d+)?k$/.test(s)) bet = Math.floor(parseFloat(s) * 1000);
  else bet = Math.floor(Number(s));
  if (!Number.isFinite(bet) || bet <= 0 || bet > bal) return null;
  return bet;
}

// Named per-user cooldowns (daily, work, rob). Returns ms remaining, or 0 and starts it.
function useCooldown(userId, key, ms) {
  const acc = account(userId);
  const left = (acc.cooldowns[key] ?? 0) + ms - Date.now();
  if (left > 0) return left;
  acc.cooldowns[key] = Date.now();
  save();
  return 0;
}

const fmt = (n) => `🪙 ${n.toLocaleString()}`;

// ---------- bank ----------
// Coins in the bank can't be robbed or gambled. Space starts at 10k; vault expansions add more.
// Interest: 1% per day on the bank balance, max 500/day, credited lazily whenever the bank is touched.
const BANK_BASE_SPACE = 10000;
const BANK_EXPANSION = 10000;
const DAY = 864e5;

function bank(userId) {
  const acc = account(userId);
  acc.bank ??= 0;
  acc.bankSpace ??= BANK_BASE_SPACE;
  acc.interestAt ??= Date.now();
  const days = Math.floor((Date.now() - acc.interestAt) / DAY);
  if (days > 0) {
    let earned = 0;
    for (let d = 0; d < Math.min(days, 30); d++) {
      const i = Math.min(500, Math.floor(acc.bank * 0.01), acc.bankSpace - acc.bank);
      if (i <= 0) break;
      acc.bank += i;
      earned += i;
    }
    acc.interestAt += days * DAY;
    acc.lastInterest = earned;
    save();
  }
  return acc;
}

const netWorth = (userId) => balance(userId) + (account(userId).bank ?? 0);

module.exports = { account, balance, add, take, settle, recordLoss, parseBet, useCooldown, fmt, data, bank, netWorth, BANK_EXPANSION };
