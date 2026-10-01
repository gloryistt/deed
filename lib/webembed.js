// "Web embeds" for user accounts, ported from discord.py-self_embed
// (https://github.com/ghostselfbot/discord.py-self_embed).
//
// User accounts can't send real embeds, but Discord unfurls links into embeds. This builds a link to an
// embed-page service (Benny's Embed Generator by default) whose OpenGraph/oEmbed tags Discord turns into
// an embed, and puts it behind a masked link whose text is a single "." so the URL itself doesn't show.
// (The library's original trick, a run of empty spoilers, is patched: Discord shows the pipes literally.)
//
// Trade-offs: embed text is sent to that third-party service; no footers or fields; ~340 char description;
// people with link previews turned off only see the visible fallback text.

const BASE = () => process.env.WEB_EMBED_URL || 'https://benny.fun/api/embed';
// OFF by default: it can't be verified offline how Discord renders this, and the first version embarrassed
// the user in their GC. Turn on with WEB_EMBEDS=on after `embedtest` looks right in a test GC.
const enabled = () => (process.env.WEB_EMBEDS ?? 'off').toLowerCase() === 'on';

const LINK_TEXT = '.';

const clip = (text, max) => (text && text.length > max ? `${text.slice(0, max - 1)}…` : text);

class WebEmbed {
  constructor(title, { description = '', color = '5865f2', url = '' } = {}) {
    this.params = { title: clip(title, 250), description: clip(description, 340), color: WebEmbed.hex(color), url };
  }

  static hex(color) {
    if (typeof color === 'number') return color.toString(16).padStart(6, '0');
    return String(color || '000000').replace(/^#|^0x/i, '');
  }

  setTitle(title) { this.params.title = clip(title, 250); return this; }
  setDescription(text) { this.params.description = clip(text, 340); return this; }
  setColor(color) { this.params.color = WebEmbed.hex(color); return this; }
  setUrl(url) { this.params.url = url; return this; }

  setAuthor(name, url = '') {
    this.params.author_name = clip(name, 250);
    if (url) this.params.author_url = url;
    return this;
  }

  setProvider(name, url = '') {
    this.params.provider_name = clip(name, 250);
    if (url) this.params.provider_url = url;
    return this;
  }

  // big = full-width image; otherwise a thumbnail in the corner.
  setImage(url, big = false) {
    this.params.image = url;
    this.params.big_image = big;
    return this;
  }

  setVideo(url) { this.params.video = url; return this; }

  url() {
    const params = Object.fromEntries(Object.entries(this.params).filter(([, v]) => v !== '' && v !== null && v !== undefined && v !== false));
    return `${BASE()}?${new URLSearchParams(params)}`;
  }

  // Message content: optional visible fallback text, then a masked "." link that Discord turns into the embed.
  // Stays under Discord's 2,000-character limit by trimming the description if needed.
  toMessage(fallback = '') {
    const build = () => `${fallback ? `${fallback} ` : ''}[${LINK_TEXT}](${this.url()})`;
    let msg = build();
    while (msg.length > 2000 && this.params.description) {
      this.params.description = clip(this.params.description, Math.max(0, this.params.description.length - 60));
      if (this.params.description.length <= 1) this.params.description = '';
      msg = build();
    }
    return msg;
  }
}

module.exports = { WebEmbed, enabled };
