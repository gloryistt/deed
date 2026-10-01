// In-game crypto market: buy/sell with Deed coins at real prices (CoinGecko), plus DEED, a simulated meme coin.
// Play money only: 1 🪙 = $1, a 1% fee each way, no real money or wallets involved.
const eco = require('../lib/economy');
const { data, save } = require('../lib/db');
const { resolveUser } = require('../lib/util');
const { color, ansiBlock } = require('../lib/format');

const REAL = { btc: 'bitcoin', eth: 'ethereum', sol: 'solana', doge: 'dogecoin' };
const NAMES = { btc: ['Bitcoin', '🟠'], eth: ['Ethereum', '🔷'], sol: ['Solana', '🟣'], doge: ['Dogecoin', '🐕'], deed: ['DeedCoin', '🎀'] };
const SYMBOLS = Object.keys(NAMES);
const FEE = 0.01;
const CACHE_MS = 60 * 1000;
const DEED_STEP_MS = 10 * 60 * 1000;
const SPARK = '▁▂▃▄▅▆▇█';

let cache = null; // { at, coins: { btc: { price, change24h, spark: [] } } }

// ---------- DEED: a simulated coin. Random-walk steps every 10 minutes, caught up lazily. ----------
function deedCoin() {
  data.deedcoin ??= { price: 1, history: [1], updatedAt: Date.now() };
  const d = data.deedcoin;
  const steps = Math.min(1008, Math.floor((Date.now() - d.updatedAt) / DEED_STEP_MS));
  for (let i = 0; i < steps; i++) {
    // ~6% volatility per step with a slight pull back toward 1.00 so it never flatlines at 0 or runs off forever.
    const shock = (Math.random() + Math.random() + Math.random() - 1.5) * 0.12;
    const pull = Math.log(1 / d.price) * 0.01;
    d.price = Math.min(1000, Math.max(0.01, d.price * Math.exp(shock + pull)));
    d.history.push(+d.price.toFixed(4));
  }
  if (steps) {
    d.history = d.history.slice(-1008); // 7 days of 10-minute steps
    d.updatedAt += steps * DEED_STEP_MS;
    save();
  }
  const dayAgo = d.history[Math.max(0, d.history.length - 145)];
  return { price: d.price, change24h: ((d.price - dayAgo) / dayAgo) * 100, spark: d.history.filter((_, i, a) => i % Math.ceil(a.length / 168) === 0) };
}

async function market() {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    try {
      const res = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${Object.values(REAL).join(',')}&sparkline=true&price_change_percentage=24h`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const rows = await res.json();
      const coins = {};
      for (const [sym, id] of Object.entries(REAL)) {
        const row = rows.find((r) => r.id === id);
        if (row) coins[sym] = { price: row.current_price, change24h: row.price_change_percentage_24h ?? 0, spark: row.sparkline_in_7d?.price ?? [] };
      }
      cache = { at: Date.now(), coins, stale: false };
    } catch (err) {
      if (!cache) throw new Error('the crypto market is unreachable right now, try again in a minute');
      cache.stale = true; // keep trading on the last known prices
    }
  }
  return { ...cache.coins, deed: deedCoin(), stale: cache.stale };
}

// Last known prices without waiting on the network (for the leaderboard).
const cachedPrice = (sym) => (sym === 'deed' ? deedCoin().price : cache?.coins?.[sym]?.price ?? 0);

function spark(points, width = 20) {
  if (!points?.length) return '';
  const step = Math.max(1, Math.floor(points.length / width));
  const sample = points.filter((_, i) => i % step === 0).slice(-width);
  const min = Math.min(...sample), max = Math.max(...sample);
  return sample.map((v) => SPARK[max === min ? 3 : Math.round(((v - min) / (max - min)) * 7)]).join('');
}

const usd = (n) => (n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n >= 1 ? n.toFixed(2) : n.toPrecision(3));
const units = (n) => (n >= 1 ? n.toLocaleString(undefined, { maximumFractionDigits: 4 }) : n.toPrecision(4));
const pct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

function wallet(userId) {
  const acc = eco.account(userId);
  acc.crypto ??= {};
  return acc.crypto;
}

function portfolioValue(userId, prices) {
  return Object.entries(wallet(userId)).reduce((sum, [sym, h]) => sum + h.units * (prices?.[sym]?.price ?? cachedPrice(sym)), 0);
}

const findSymbol = (text = '') => {
  const t = text.toLowerCase();
  return SYMBOLS.find((s) => s === t || NAMES[s][0].toLowerCase() === t || REAL[s] === t) ?? null;
};

module.exports = [
  {
    name: 'crypto',
    aliases: ['cr', 'market'],
    usage: 'crypto [buy <coin> <🪙> | sell <coin> <amount|all> | wallet [@user] | chart <coin>]',
    description: 'Trade crypto with your coins at real market prices (1 🪙 = $1, play money).',
    async run({ client, message, args, config }) {
      const p = config.prefix;
      const sub = (args[0] ?? 'market').toLowerCase();
      const uid = message.author.id;
      let prices;
      try { prices = await market(); } catch (err) { return message.reply(`📉 ${err.message}`); }
      const staleNote = prices.stale ? ' · ⚠️ prices may be a few minutes old' : '';

      if (sub === 'market' || sub === 'prices') {
        const lines = SYMBOLS.map((s) => {
          const c = prices[s];
          if (!c) return `${color(s.toUpperCase().padEnd(5), 'gray')} ${color('unavailable', 'gray')}`;
          return `${color(s.toUpperCase().padEnd(5), 'white', true)} ${color(`$${usd(c.price)}`.padStart(10), 'yellow', true)} ${color(pct(c.change24h).padStart(8), c.change24h >= 0 ? 'green' : 'red', true)}  ${color(spark(c.spark, 16), c.change24h >= 0 ? 'green' : 'red')}`;
        });
        return message.channel.send([
          '### 📈 Crypto market',
          ansiBlock(lines),
          `-# 1 🪙 = $1 · 1% fee per trade · ${p}crypto buy btc 500 · ${p}crypto wallet · DEED is Deed's own (very volatile) coin${staleNote}`,
        ].join('\n'));
      }

      if (sub === 'chart') {
        const sym = findSymbol(args[1]);
        if (!sym || !prices[sym]) return message.reply(`Which coin? ${SYMBOLS.join(', ')}`);
        const c = prices[sym];
        const hi = Math.max(...c.spark), lo = Math.min(...c.spark);
        return message.channel.send([
          `### ${NAMES[sym][1]} ${NAMES[sym][0]} · $${usd(c.price)}`,
          ansiBlock([
            color(spark(c.spark, 40), c.change24h >= 0 ? 'green' : 'red', true),
            `${color('7d high', 'gray')} ${color(`$${usd(hi)}`, 'green')}   ${color('7d low', 'gray')} ${color(`$${usd(lo)}`, 'red')}   ${color('24h', 'gray')} ${color(pct(c.change24h), c.change24h >= 0 ? 'green' : 'red', true)}`,
          ]),
          `-# last 7 days${staleNote}`,
        ].join('\n'));
      }

      if (sub === 'buy') {
        const sym = findSymbol(args[1]);
        if (!sym || !prices[sym]) return message.reply(`Usage: \`${p}crypto buy <coin> <🪙 amount|all|half>\` · coins: ${SYMBOLS.join(', ')}`);
        const spend = eco.parseBet(uid, args[2]);
        if (!spend) return message.reply(`How many coins? You have ${eco.fmt(eco.balance(uid))} in your wallet.`);
        const price = prices[sym].price;
        const got = (spend * (1 - FEE)) / price;
        eco.add(uid, -spend);
        const w = wallet(uid);
        w[sym] ??= { units: 0, cost: 0 };
        w[sym].units += got;
        w[sym].cost += spend;
        save();
        return message.reply(`### ${NAMES[sym][1]} Bought ${units(got)} ${sym.toUpperCase()}\n> for ${eco.fmt(spend)} at $${usd(price)} (1% fee included)\n-# wallet: ${eco.fmt(eco.balance(uid))} · ${p}crypto wallet${staleNote}`);
      }

      if (sub === 'sell') {
        const sym = findSymbol(args[1]);
        const w = wallet(uid);
        if (!sym || !w[sym]?.units) return message.reply(`You don't own that. Check \`${p}crypto wallet\`.`);
        const held = w[sym].units;
        const raw = (args[2] ?? 'all').toLowerCase();
        const amount = raw === 'all' ? held : raw === 'half' ? held / 2 : Number(raw);
        if (!(amount > 0) || amount > held * 1.000001) return message.reply(`You have ${units(held)} ${sym.toUpperCase()}. Sell a number of coins, \`half\` or \`all\`.`);
        const price = prices[sym].price;
        const payout = Math.floor(amount * price * (1 - FEE));
        const costPart = w[sym].cost * (amount / held);
        w[sym].units -= amount;
        w[sym].cost -= costPart;
        if (w[sym].units < 1e-9) delete w[sym];
        save();
        eco.add(uid, payout);
        const pl = payout - costPart;
        return message.reply(`### ${NAMES[sym][1]} Sold ${units(amount)} ${sym.toUpperCase()}\n> for ${eco.fmt(payout)} at $${usd(price)} · ${pl >= 0 ? '📈 profit' : '📉 loss'} **${pl >= 0 ? '+' : '-'}${eco.fmt(Math.abs(Math.round(pl)))}**\n-# wallet: ${eco.fmt(eco.balance(uid))}${staleNote}`);
      }

      if (sub === 'wallet' || sub === 'portfolio' || sub === 'holdings') {
        const user = (await resolveUser(client, message, args[1])) ?? message.author;
        const w = wallet(user.id);
        const held = Object.entries(w);
        if (!held.length) return message.reply(`${user.username} doesn't own any crypto yet. \`${p}crypto buy btc 100\``);
        let total = 0, cost = 0;
        const lines = held.map(([sym, h]) => {
          const value = h.units * (prices[sym]?.price ?? 0);
          total += value;
          cost += h.cost;
          const pl = value - h.cost;
          return `${color(sym.toUpperCase().padEnd(5), 'white', true)} ${color(units(h.units).padStart(12), 'cyan')} ${color(`🪙${Math.round(value).toLocaleString()}`.padStart(10), 'yellow', true)} ${color(`${pl >= 0 ? '+' : ''}${Math.round(pl).toLocaleString()}`.padStart(8), pl >= 0 ? 'green' : 'red')}`;
        });
        const pl = total - cost;
        return message.channel.send([
          `### 👛 ${user.username}'s crypto wallet`,
          ansiBlock([...lines, '', `${color('Total'.padEnd(18), 'gray')} ${color(`🪙${Math.round(total).toLocaleString()}`.padStart(10), 'yellow', true)} ${color(`${pl >= 0 ? '+' : ''}${Math.round(pl).toLocaleString()} (${cost ? pct((pl / cost) * 100) : '0%'})`, pl >= 0 ? 'green' : 'red', true)}`]),
          `-# value at current prices, after nothing is sold · ${p}crypto sell <coin> all${staleNote}`,
        ].join('\n'));
      }

      return message.reply(`Usage: \`${p}${this.usage}\``);
    },
  },
];

module.exports.internals = { market, deedCoin, portfolioValue, cachedPrice, spark, _setCache: (c) => { cache = c; } };
