// Item catalog + per-user inventory (fish, rods, bait, rings).
const eco = require('./economy');
const { save } = require('./db');

const RARITIES = {
  junk: { label: 'JUNK', color: 'gray', emoji: '⚫' },
  common: { label: 'COMMON', color: 'white', emoji: '⚪' },
  uncommon: { label: 'UNCOMMON', color: 'green', emoji: '🟢' },
  rare: { label: 'RARE', color: 'blue', emoji: '🔵' },
  epic: { label: 'EPIC', color: 'pink', emoji: '🟣' },
  legendary: { label: 'LEGENDARY', color: 'yellow', emoji: '🟡' },
  mythic: { label: 'MYTHIC', color: 'red', emoji: '🔴' },
};
const RARITY_ORDER = Object.keys(RARITIES);

// Base chance weights per rarity (rods/bait multiply everything above common).
const RARITY_WEIGHTS = { junk: 12, common: 48, uncommon: 24, rare: 10, epic: 4.2, legendary: 1.5, mythic: 0.3 };

// id: [name, emoji, rarity, base price, min kg, max kg]
const FISH = {
  boot: ['Old Boot', '👢', 'junk', 1, 0.5, 1.5],
  can: ['Rusty Can', '🥫', 'junk', 1, 0.1, 0.4],
  seaweed: ['Seaweed', '🌿', 'junk', 2, 0.1, 0.8],
  sardine: ['Sardine', '🐟', 'common', 5, 0.05, 0.2],
  anchovy: ['Anchovy', '🐟', 'common', 4, 0.02, 0.1],
  mackerel: ['Mackerel', '🐟', 'common', 7, 0.3, 1.5],
  trout: ['Trout', '🐟', 'common', 8, 0.5, 3],
  clownfish: ['Clownfish', '🐠', 'uncommon', 16, 0.1, 0.3],
  tang: ['Blue Tang', '🐠', 'uncommon', 18, 0.2, 0.6],
  shrimp: ['Tiger Shrimp', '🦐', 'uncommon', 14, 0.05, 0.3],
  crab: ['King Crab', '🦀', 'uncommon', 22, 1, 8],
  pufferfish: ['Pufferfish', '🐡', 'rare', 45, 0.5, 3],
  squid: ['Giant Squid', '🦑', 'rare', 50, 20, 150],
  octopus: ['Octopus', '🐙', 'rare', 60, 3, 15],
  turtle: ['Sea Turtle', '🐢', 'rare', 70, 40, 180],
  shark: ['Great White', '🦈', 'epic', 150, 400, 1100],
  lobster: ['Golden Lobster', '🦞', 'epic', 180, 2, 9],
  whale: ['Blue Whale', '🐋', 'epic', 220, 40000, 150000],
  dragon: ['Sea Dragon', '🐉', 'legendary', 600, 800, 3000],
  treasure: ['Sunken Treasure', '💰', 'legendary', 800, 30, 120],
  koi: ['Cosmic Koi', '🌌', 'mythic', 2500, 1, 4],
  crown: ["Kraken's Crown", '👑', 'mythic', 3500, 5, 20],
};

// Shop items. type: rod | bait | ring
const SHOP = {
  fiberglass: { name: 'Fiberglass Rod', emoji: '🎣', type: 'rod', price: 1500, luck: 1.35, desc: 'better odds on rare+ fish' },
  carbon: { name: 'Carbon Rod', emoji: '🎣', type: 'rod', price: 6000, luck: 1.9, desc: 'much better odds on rare+ fish' },
  mythril: { name: 'Mythril Rod', emoji: '🔱', type: 'rod', price: 25000, luck: 2.8, desc: 'legendary & mythic hunter' },
  bait: { name: 'Glow Bait ×10', emoji: '🪱', type: 'bait', price: 250, uses: 10, luck: 1.5, desc: '+50% rare odds for 10 casts' },
  padlock: { name: 'Padlock', emoji: '🔒', type: 'protection', price: 400, desc: 'blocks the next robbery attempt, then breaks' },
  guarddog: { name: 'Guard Dog', emoji: '🐕', type: 'protection', price: 2000, hours: 24, desc: '24h of full robbery immunity (stacks)' },
  vault: { name: 'Vault Expansion', emoji: '🏦', type: 'bank', price: 2500, desc: '+10,000 bank space' },
  silverring: { name: 'Silver Ring', emoji: '💍', type: 'ring', price: 1000, tier: 1, desc: 'needed to propose' },
  diamondring: { name: 'Diamond Ring', emoji: '💎', type: 'ring', price: 5000, tier: 2, desc: 'a proper proposal' },
  eternityring: { name: 'Eternity Ring', emoji: '👑', type: 'ring', price: 20000, tier: 3, desc: 'the ultimate commitment' },
};
const ROD_DEFAULT = { name: 'Wooden Rod', emoji: '🎣', luck: 1 };

function user(userId) {
  const acc = eco.account(userId);
  acc.inv ??= {};
  acc.fishdex ??= {};
  return acc;
}

const count = (userId, id) => user(userId).inv[id] ?? 0;

function add(userId, id, n = 1) {
  const acc = user(userId);
  acc.inv[id] = (acc.inv[id] ?? 0) + n;
  save();
}

function remove(userId, id, n = 1) {
  const acc = user(userId);
  if ((acc.inv[id] ?? 0) < n) return false;
  acc.inv[id] -= n;
  if (acc.inv[id] <= 0) delete acc.inv[id];
  save();
  return true;
}

function rodOf(userId) {
  const id = user(userId).rod;
  return id && SHOP[id] ? { id, ...SHOP[id] } : { id: null, ...ROD_DEFAULT };
}

// Match what a user typed ("golden lobster", "lobster", "carbon rod") to a fish or shop id.
function findId(table, text) {
  const q = text.toLowerCase().replace(/[^a-z]/g, '');
  if (!q) return null;
  return Object.keys(table).find((id) => id === q || table[id][0]?.toLowerCase?.().replace(/[^a-z]/g, '') === q || table[id].name?.toLowerCase().replace(/[^a-z]/g, '') === q)
    ?? Object.keys(table).find((id) => id.startsWith(q) || (table[id][0] ?? table[id].name).toLowerCase().replace(/[^a-z]/g, '').includes(q))
    ?? null;
}

// Remaining guard-dog protection in ms (0 if none).
const guardLeft = (userId) => Math.max(0, (user(userId).guardUntil ?? 0) - Date.now());

module.exports = { guardLeft, RARITIES, RARITY_ORDER, RARITY_WEIGHTS, FISH, SHOP, ROD_DEFAULT, user, count, add, remove, rodOf, findId };
