// Poker helpers: deck, card text, 7-card hand evaluation, and splitting the pot into side pots.
const { shuffle } = require('./util');

const RANKS = '23456789TJQKA';
const SUITS = ['♠', '♥', '♦', '♣'];
const HANDS = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];

const newDeck = () => shuffle(SUITS.flatMap((s, si) => [...RANKS].map((r, i) => ({ rank: i + 2, suit: si }))));
const cardText = (c) => `${c.rank === 10 ? '10' : RANKS[c.rank - 2]}${SUITS[c.suit]}`;
const cardsText = (cards) => cards.map(cardText).join(' ');
// "As Kh" -> cards (for tests).
const parse = (s) => s.split(/\s+/).map((t) => ({ rank: RANKS.indexOf(t[0].toUpperCase()) + 2, suit: 'shdc'.indexOf(t[1].toLowerCase()) }));

// Score exactly 5 cards: [category, ...tiebreak ranks]. Higher array (compared left to right) wins.
function score5(cards) {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  const uniq = [...new Set(ranks)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (ranks[0] - ranks[4] === 4) straightHigh = ranks[0];
    else if (ranks.join() === '14,5,4,3,2') straightHigh = 5; // the wheel: A-2-3-4-5
  }
  if (straightHigh && flush) return [8, straightHigh];
  // Group by count, then rank: e.g. full house 8-8-8-K-K -> [[3,8],[2,13]].
  const groups = uniq.map((r) => [ranks.filter((x) => x === r).length, r]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const kickers = groups.map((g) => g[1]);
  if (groups[0][0] === 4) return [7, ...kickers];
  if (groups[0][0] === 3 && groups[1][0] === 2) return [6, ...kickers];
  if (flush) return [5, ...ranks];
  if (straightHigh) return [4, straightHigh];
  if (groups[0][0] === 3) return [3, ...kickers];
  if (groups[0][0] === 2 && groups[1][0] === 2) return [2, ...kickers];
  if (groups[0][0] === 2) return [1, ...kickers];
  return [0, ...ranks];
}

function compare(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

// Best 5 of up to 7 cards. Returns { score, name, cards }.
function best(cards) {
  let top = null;
  const n = cards.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++) {
    const five = [cards[a], cards[b], cards[c], cards[d], cards[e]];
    const s = score5(five);
    if (!top || compare(s, top.score) > 0) top = { score: s, cards: five };
  }
  const royal = top.score[0] === 8 && top.score[1] === 14;
  return { ...top, name: royal ? 'Royal flush' : HANDS[top.score[0]] };
}

/**
 * Split what everyone put in this hand into main + side pots.
 * seats: [{ id, total, folded }]. Returns [{ amount, eligible: [ids] }]. Chips nobody else matched
 * (an uncalled bet) form a pot only its owner is eligible for, so they get it back.
 */
function pots(seats) {
  const levels = [...new Set(seats.filter((s) => s.total > 0 && !s.folded).map((s) => s.total))].sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const level of levels) {
    const amount = seats.reduce((n, s) => n + Math.max(0, Math.min(s.total, level) - prev), 0);
    const eligible = seats.filter((s) => !s.folded && s.total >= level).map((s) => s.id);
    if (amount > 0) out.push({ amount, eligible });
    prev = level;
  }
  // Folded players who put in more than every live player: their extra goes to the last pot.
  const extra = seats.reduce((n, s) => n + Math.max(0, s.total - prev), 0);
  if (extra && out.length) out[out.length - 1].amount += extra;
  return out;
}

module.exports = { newDeck, cardText, cardsText, parse, score5, best, compare, pots, HANDS };
