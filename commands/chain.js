// Real blockchain lookups (public, read-only data, like a block explorer):
//   ,wallet <address | name.eth>   balance, USD value, tx count, recent activity, top ETH tokens
//   ,tx <hash>                     a Bitcoin or Ethereum transaction
// Free APIs, no keys: mempool.space (BTC), Blockscout (ETH + ENS), Solana public RPC, BlockCypher (DOGE/LTC),
// CoinGecko (USD prices).
const { color, ansiBlock } = require('../lib/format');

const CHAINS = {
  btc: { name: 'Bitcoin', emoji: '🟠', unit: 'BTC', gecko: 'bitcoin' },
  eth: { name: 'Ethereum', emoji: '🔷', unit: 'ETH', gecko: 'ethereum' },
  sol: { name: 'Solana', emoji: '🟣', unit: 'SOL', gecko: 'solana' },
  doge: { name: 'Dogecoin', emoji: '🐕', unit: 'DOGE', gecko: 'dogecoin' },
  ltc: { name: 'Litecoin', emoji: '⚪', unit: 'LTC', gecko: 'litecoin' },
};

const get = async (url, opts = {}) => {
  const res = await fetch(url, { ...opts, headers: { 'User-Agent': 'DeedBot/1.0', ...(opts.headers ?? {}) }, signal: AbortSignal.timeout(10000) });
  if (res.status === 404 || res.status === 400) return null;
  if (res.status === 429) throw new Error('that blockchain API is rate limiting us, try again in a minute');
  if (!res.ok) throw new Error(`blockchain API error (${res.status})`);
  return res.json();
};

let priceCache = { at: 0, prices: {} };
async function usdPrices() {
  if (Date.now() - priceCache.at < 60000) return priceCache.prices;
  const ids = Object.values(CHAINS).map((c) => c.gecko).join(',');
  const body = await get(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`).catch(() => null);
  if (body) priceCache = { at: Date.now(), prices: Object.fromEntries(Object.entries(CHAINS).map(([k, c]) => [k, body[c.gecko]?.usd ?? 0])) };
  return priceCache.prices;
}

// Guess the chain from the address format.
function detectChain(addr) {
  if (/^0x[0-9a-fA-F]{40}$/.test(addr) || /\.eth$/i.test(addr)) return 'eth';
  if (/^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(addr)) return 'btc';
  if (/^(ltc1[02-9ac-hj-np-z]{11,71}|[LM][1-9A-HJ-NP-Za-km-z]{26,33})$/.test(addr)) return 'ltc';
  if (/^D[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr)) return 'doge';
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) return 'sol';
  return null;
}

// A token holding counts only if it could realistically be sold (see lookupEth).
const isLiquid = (t) => t.mcap > 0 && t.usd <= t.mcap * 0.2 && t.usd <= Math.max(t.volume, 1) * 10;

const short = (a) => (a.length > 16 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const amount = (n) => (n === 0 ? '0' : n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n >= 1 ? n.toFixed(4) : n.toPrecision(4));
const usd = (n) => `$${n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(2)}`;
const when = (ts) => (ts ? `<t:${Math.floor(ts)}:R>` : 'pending');

// ---------- per-chain lookups: { balance, txCount, recent: [{ delta, time, hash }], tokens, label, explorer } ----------
async function lookupBtc(addr) {
  const info = await get(`https://mempool.space/api/address/${addr}`);
  if (!info) return null;
  const sats = (s) => (s.funded_txo_sum - s.spent_txo_sum);
  const txs = (await get(`https://mempool.space/api/address/${addr}/txs`)) ?? [];
  const recent = txs.slice(0, 5).map((tx) => {
    const received = tx.vout.filter((o) => o.scriptpubkey_address === addr).reduce((s, o) => s + o.value, 0);
    const sent = tx.vin.filter((i) => i.prevout?.scriptpubkey_address === addr).reduce((s, i) => s + i.prevout.value, 0);
    return { delta: (received - sent) / 1e8, time: tx.status.block_time, hash: tx.txid };
  });
  return {
    balance: (sats(info.chain_stats) + sats(info.mempool_stats)) / 1e8,
    txCount: info.chain_stats.tx_count + info.mempool_stats.tx_count,
    recent,
    explorer: `https://mempool.space/address/${addr}`,
  };
}

async function lookupEth(addrOrName) {
  let addr = addrOrName;
  if (/\.eth$/i.test(addr)) {
    const found = await get(`https://eth.blockscout.com/api/v2/search?q=${encodeURIComponent(addr)}`);
    addr = found?.items?.find((i) => i.ens_info?.name?.toLowerCase() === addrOrName.toLowerCase())?.address_hash
      ?? found?.items?.find((i) => i.type === 'ens_domain')?.address_hash;
    if (!addr) return null;
  }
  const info = await get(`https://eth.blockscout.com/api/v2/addresses/${addr}`);
  if (!info) return null;
  const [counters, tokens, txs] = await Promise.all([
    get(`https://eth.blockscout.com/api/v2/addresses/${addr}/counters`).catch(() => null),
    get(`https://eth.blockscout.com/api/v2/addresses/${addr}/tokens?type=ERC-20`).catch(() => null),
    get(`https://eth.blockscout.com/api/v2/addresses/${addr}/transactions`).catch(() => null),
  ]);
  // Only count holdings that could actually be sold: the token needs a real market cap, and the holding can't be
  // a big slice of that cap or dwarf a day's trading volume. This hides airdropped scam tokens with fake prices
  // (e.g. a "$338k" token with a $0 market cap, or "$100k" of a token that trades $53/day).
  const priced = (tokens?.items ?? []).filter((t) => t.token?.exchange_rate).map((t) => {
    const qty = Number(t.value) / 10 ** Number(t.token.decimals ?? 18);
    return {
      symbol: t.token.symbol, qty, usd: qty * Number(t.token.exchange_rate),
      mcap: Number(t.token.circulating_market_cap ?? 0), volume: Number(t.token.volume_24h ?? 0),
    };
  });
  const liquid = isLiquid;
  const hiddenTokens = priced.filter((t) => t.usd >= 1 && !liquid(t)).length;
  const topTokens = priced
    .filter((t) => t.usd >= 1 && liquid(t))
    .sort((a, b) => b.usd - a.usd)
    .slice(0, 5);
  const lower = addr.toLowerCase();
  const recent = (txs?.items ?? []).slice(0, 5).map((tx) => {
    const eth = Number(tx.value) / 1e18;
    const outgoing = tx.from?.hash?.toLowerCase() === lower;
    return { delta: outgoing ? -eth : eth, time: Date.parse(tx.timestamp) / 1000, hash: tx.hash, method: tx.method };
  });
  return {
    address: addr,
    label: info.ens_domain_name ?? null,
    balance: Number(info.coin_balance ?? 0) / 1e18,
    txCount: Number(counters?.transactions_count ?? 0),
    recent,
    tokens: topTokens,
    hiddenTokens,
    tokensFailed: tokens === null,
    explorer: `https://eth.blockscout.com/address/${addr}`,
  };
}

async function lookupSol(addr) {
  const rpc = (method, params) => get('https://api.mainnet-beta.solana.com', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const bal = await rpc('getBalance', [addr]);
  if (!bal || bal.error) return null;
  const sigs = await rpc('getSignaturesForAddress', [addr, { limit: 5 }]).catch(() => null);
  return {
    balance: bal.result.value / 1e9,
    txCount: null,
    recent: (sigs?.result ?? []).map((s) => ({ delta: null, time: s.blockTime, hash: s.signature })),
    explorer: `https://solscan.io/account/${addr}`,
  };
}

async function lookupBlockcypher(chain, addr) {
  const info = await get(`https://api.blockcypher.com/v1/${chain}/main/addrs/${addr}?limit=5`);
  if (!info) return null;
  const recent = (info.txrefs ?? []).slice(0, 5).map((t) => ({
    delta: (t.tx_input_n === -1 ? 1 : -1) * t.value / 1e8, time: Date.parse(t.confirmed) / 1000, hash: t.tx_hash,
  }));
  return {
    balance: info.final_balance / 1e8,
    txCount: info.n_tx,
    recent,
    explorer: `https://live.blockcypher.com/${chain}/address/${addr}/`,
  };
}

const LOOKUP = { btc: lookupBtc, eth: lookupEth, sol: lookupSol, doge: (a) => lookupBlockcypher('doge', a), ltc: (a) => lookupBlockcypher('ltc', a) };

// ---------- transactions ----------
async function lookupTx(hash) {
  if (/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    const tx = await get(`https://eth.blockscout.com/api/v2/transactions/${hash}`);
    if (!tx) return null;
    return {
      chain: 'eth',
      lines: [
        ['Status', tx.status === 'ok' ? '✅ success' : tx.status === 'error' ? `❌ failed${tx.result ? ` (${tx.result})` : ''}` : '⏳ pending'],
        ['From', short(tx.from?.hash ?? '?') + (tx.from?.ens_domain_name ? ` (${tx.from.ens_domain_name})` : '')],
        ['To', short(tx.to?.hash ?? '?') + (tx.to?.ens_domain_name ? ` (${tx.to.ens_domain_name})` : '')],
        ['Value', `${amount(Number(tx.value) / 1e18)} ETH`],
        ['Fee', `${amount(Number(tx.fee?.value ?? 0) / 1e18)} ETH`],
        ['Method', tx.method ?? 'transfer'],
        ['Block', tx.block_number ? `#${tx.block_number.toLocaleString()} · ${tx.confirmations ?? 0} confirmations` : 'pending'],
      ],
      time: Date.parse(tx.timestamp) / 1000,
      usdOf: Number(tx.value) / 1e18,
      explorer: `https://eth.blockscout.com/tx/${hash}`,
    };
  }
  if (/^[0-9a-fA-F]{64}$/.test(hash)) {
    const tx = await get(`https://mempool.space/api/tx/${hash}`);
    if (!tx) return null;
    const tip = await get('https://mempool.space/api/blocks/tip/height').catch(() => null);
    const total = tx.vout.reduce((s, o) => s + o.value, 0) / 1e8;
    const conf = tx.status.confirmed && tip ? tip - tx.status.block_height + 1 : 0;
    return {
      chain: 'btc',
      lines: [
        ['Status', tx.status.confirmed ? `✅ confirmed · ${conf.toLocaleString()} confirmations` : '⏳ unconfirmed (in mempool)'],
        ['Inputs', `${tx.vin.length}`],
        ['Outputs', `${tx.vout.length}`],
        ['Total out', `${amount(total)} BTC`],
        ['Fee', `${amount(tx.fee / 1e8)} BTC · ${(tx.fee / (tx.weight / 4)).toFixed(1)} sat/vB`],
        ['Block', tx.status.confirmed ? `#${tx.status.block_height.toLocaleString()}` : 'pending'],
      ],
      time: tx.status.block_time,
      usdOf: total,
      explorer: `https://mempool.space/tx/${hash}`,
    };
  }
  return undefined;
}

module.exports = [
  {
    name: 'wallet',
    aliases: ['addr', 'address', 'chain'],
    usage: 'wallet <address | name.eth> [btc|eth|sol|doge|ltc]',
    description: 'Look up a real crypto wallet: balance, USD value, transactions, top tokens. BTC, ETH, SOL, DOGE, LTC.',
    cooldown: 3000,
    async run({ message, args, config }) {
      const addr = (args.find((a) => !CHAINS[a.toLowerCase()]) ?? '').replace(/[<>]/g, '');
      const forced = args.find((a) => CHAINS[a.toLowerCase()])?.toLowerCase();
      if (!addr) return message.reply(`Usage: \`${config.prefix}wallet <address or name.eth>\` · works with ${Object.values(CHAINS).map((c) => c.unit).join(', ')}`);
      const chain = forced ?? detectChain(addr);
      if (!chain) return message.reply("I don't recognize that address format. Add the chain: `wallet <address> btc|eth|sol|doge|ltc`.");
      const c = CHAINS[chain];

      await message.channel.sendTyping?.().catch(() => {});
      let info;
      try {
        [info] = await Promise.all([LOOKUP[chain](addr), usdPrices()]);
      } catch (err) {
        return message.reply(`🔗 Couldn't look that up: ${err.message}`);
      }
      if (!info) return message.reply(`🔗 No ${c.name} wallet found for \`${short(addr)}\`.`);
      const price = priceCache.prices[chain] ?? 0;
      const shown = info.address && info.address !== addr ? `${addr} → ${short(info.address)}` : short(addr);

      const stats = [
        `${color('Balance'.padEnd(13), 'gray')} ${color(`${amount(info.balance)} ${c.unit}`, 'yellow', true)}`,
        price ? `${color('Value'.padEnd(13), 'gray')} ${color(usd(info.balance * price), 'green', true)} ${color(`@ ${usd(price)}`, 'gray')}` : null,
        info.txCount != null ? `${color('Transactions'.padEnd(13), 'gray')} ${color(info.txCount.toLocaleString(), 'cyan')}` : null,
      ].filter(Boolean);
      if (info.tokens?.length) {
        stats.push('', color('Top tokens', 'gray'));
        for (const t of info.tokens) stats.push(`${color(t.symbol.slice(0, 10).padEnd(10), 'white', true)} ${color(amount(t.qty).padStart(14), 'cyan')} ${color(usd(t.usd).padStart(12), 'green')}`);
      }
      const recent = info.recent.map((r) => {
        const d = r.delta == null ? 'transaction' : r.delta === 0 ? '⚙️ contract call' : `${r.delta > 0 ? '🟢 +' : '🔴 '}${amount(r.delta)} ${c.unit}`;
        return `> ${d} ${r.method && r.method !== 'transfer' ? `\`${r.method}\` ` : ''}· ${when(r.time)}`;
      });

      await message.channel.send([
        `### ${c.emoji} ${c.name} wallet${info.label ? ` · ${info.label}` : ''}`,
        `-# ${shown}`,
        ansiBlock(stats),
        recent.length ? '**Recent activity**' : null,
        ...recent,
        `-# [view on explorer](<${info.explorer}>) · public blockchain data${info.hiddenTokens ? ` · ${info.hiddenTokens} spam/illiquid tokens hidden` : ''}${info.tokensFailed ? ' · token list unavailable right now (big wallets can time out)' : ''}`,
      ].filter(Boolean).join('\n'));
    },
  },
  {
    name: 'tx',
    aliases: ['transaction'],
    usage: 'tx <hash>',
    description: 'Look up a real Bitcoin or Ethereum transaction.',
    cooldown: 3000,
    async run({ message, args, config }) {
      const hash = (args[0] ?? '').replace(/[<>]/g, '');
      if (!hash) return message.reply(`Usage: \`${config.prefix}tx <transaction hash>\` (Bitcoin or Ethereum)`);
      if (!/^(0x)?[0-9a-fA-F]{64}$/.test(hash)) return message.reply('That doesn’t look like a Bitcoin (64 hex) or Ethereum (0x + 64 hex) transaction hash.');
      let tx;
      try {
        [tx] = await Promise.all([lookupTx(hash), usdPrices()]);
      } catch (err) {
        return message.reply(`🔗 Couldn't look that up: ${err.message}`);
      }
      if (tx === undefined) return message.reply('That doesn’t look like a Bitcoin (64 hex) or Ethereum (0x + 64 hex) transaction hash.');
      if (!tx) return message.reply('🔗 Transaction not found.');
      const c = CHAINS[tx.chain];
      const price = priceCache.prices[tx.chain] ?? 0;
      const width = Math.max(...tx.lines.map(([k]) => k.length));
      await message.channel.send([
        `### ${c.emoji} ${c.name} transaction`,
        `-# ${short(hash)} · ${when(tx.time)}`,
        ansiBlock([
          ...tx.lines.map(([k, v]) => `${color(k.padEnd(width), 'gray')}  ${color(v, 'white', true)}`),
          price && tx.usdOf ? `${color('≈ USD'.padEnd(width), 'gray')}  ${color(usd(tx.usdOf * price), 'green', true)}` : null,
        ].filter(Boolean)),
        `-# [view on explorer](<${tx.explorer}>)`,
      ].join('\n'));
    },
  },
];

module.exports.internals = { detectChain, LOOKUP, lookupTx, isLiquid };
