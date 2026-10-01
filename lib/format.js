// "Fake embeds" for user accounts, built from Discord markdown:
//   ### headings, > block quotes, -# small grey text, and ```ansi blocks for colored text.

const ANSI = {
  gray: 30, red: 31, green: 32, yellow: 33, blue: 34, pink: 35, cyan: 36, white: 37,
};

// Colored text, only renders inside an ```ansi block.
const color = (text, c = 'white', bold = false) => `\u001b[${bold ? '1;' : '0;'}${ANSI[c]}m${text}\u001b[0m`;

// A colored code block. `lines` can already contain color() calls.
const ansiBlock = (lines) => `\`\`\`ansi\n${[].concat(lines).join('\n')}\n\`\`\``;

/**
 * Card: the closest thing to an embed. With WEB_EMBEDS=on it becomes a real-looking web embed when it fits
 * (see asWebEmbed); otherwise:
 *   ### 🎰 Title
 *   > body line
 *   > body line
 *   (optional ansi block)
 *   -# footer
 */
// Strip Discord markdown for plain-text contexts (web embed descriptions don't render markdown).
const plain = (text) => text
  .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/__([^_]+)__/g, '$1')
  .replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\(<?[^)>]+>?\)/g, '$1').replace(/^-# /gm, '');

// Can this card become a web embed? Not if it has an ansi block (colors/alignment), Discord-only syntax
// that an embed would show raw (mentions, timestamps, custom emoji), private content, or is too long.
function asWebEmbed({ title, emoji, body, footer, color: accent, private: isPrivate }, lines) {
  const web = require('./webembed');
  if (!web.enabled() || isPrivate || !title) return null;
  const text = [title, ...lines, footer ?? ''].join('\n');
  if (/<[@#][!&]?\d+>|<t:\d+|<a?:\w+:\d+>|```/.test(text)) return null;
  const description = plain(lines.join('\n')).trim();
  if (description.length > 340 || title.length > 250) return null;
  const embed = new web.WebEmbed(`${emoji ? `${emoji} ` : ''}${plain(title)}`, { description, color: accent ?? '5865f2' });
  if (footer) embed.setProvider(plain(footer).slice(0, 250)); // providers show as the small grey line up top
  return embed.toMessage();
}

function card({ title, emoji, body = [], block, footer, color: accent, private: isPrivate }) {
  const lines = [].concat(body).filter((l) => l !== null && l !== undefined && l !== false);
  if (!block) {
    const embedded = asWebEmbed({ title, emoji, body, footer, color: accent, private: isPrivate }, lines);
    if (embedded) return embedded;
  }
  const out = [];
  if (title) out.push(`### ${emoji ? `${emoji} ` : ''}${title}`);
  for (const line of lines) {
    out.push(line === '' ? '> ' : `> ${line}`);
  }
  if (block) out.push(ansiBlock(block));
  if (footer) out.push(`-# ${footer}`);
  return out.join('\n');
}

// Aligned "label  value" rows for inside an ansi block.
function rows(pairs, labelColor = 'gray', valueColor = 'white') {
  const width = Math.max(...pairs.map(([k]) => k.length));
  return pairs.map(([k, v]) => `${color(k.padEnd(width), labelColor)}  ${color(v, valueColor, true)}`);
}

// ██████░░░░ style bar.
function bar(fraction, width = 12) {
  const filled = Math.round(Math.max(0, Math.min(1, fraction)) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

const small = (text) => `-# ${text}`;
const error = (text) => `❌ ${text}`;

module.exports = { color, ansiBlock, card, rows, bar, small, error, plain };
