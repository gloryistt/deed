// Terminal console: while Deed is running, type in its terminal to chat in a group chat as Deed.
//   /gcs            list group chats (with unread counts)
//   /use <n|name>   pick one (or just /1, /2 …)
//   anything else   is sent to the picked GC, as Deed ("//hi" sends "/hi")
const readline = require('readline');

const HELP = [
  '/gcs                  list group chats',
  '/use <number|name>    pick the GC you’re typing in (shortcut: /1, /2 …)',
  '/read [n]             show the last n messages (default 10)',
  '/who                  members of the picked GC',
  '/tail on|off          live-print new messages from the picked GC',
  '/restart              restart Deed (when started with npm start)',
  '/quit                 shut Deed down',
  'anything else         is sent as Deed. Start with // to send a literal /',
  'Deed’s own commands work too: typing ,bal sends it, and Deed answers as usual.',
];

function startConsole(client, { input = process.stdin, output = process.stdout, isActive = () => true, onQuit = () => {}, onRestart = null } = {}) {
  const tty = Boolean(output.isTTY);
  const paint = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const dim = paint(90), bold = paint(1), cyan = paint(36), green = paint(32), yellow = paint(33), red = paint(31);

  const rl = readline.createInterface({ input, output, terminal: tty });
  let current = null; // channel id
  let tail = true;
  const unread = new Map();

  const gcs = () => [...client.channels.cache.values()].filter((c) => c.type === 'GROUP_DM');
  const nameOf = (ch) => {
    if (ch.name) return ch.name;
    const names = [...ch.recipients.values()].map((u) => u.username);
    return names.length ? names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '') : 'unnamed';
  };
  const selected = () => (current ? client.channels.cache.get(current) ?? null : null);
  const unreadElsewhere = () => [...unread].filter(([id]) => id !== current).reduce((n, [, c]) => n + c, 0);

  function setPrompt() {
    const ch = selected();
    const more = unreadElsewhere();
    rl.setPrompt(`${ch ? cyan(`[${nameOf(ch)}]`) : dim('[no GC · /gcs]')}${more ? yellow(` (${more} unread)`) : ''} › `);
  }
  const redraw = () => {
    if (tty) { readline.clearLine(output, 0); readline.cursorTo(output, 0); }
    setPrompt();
    rl.prompt(true);
  };
  // Print above the prompt without clobbering what's being typed.
  const print = (text = '') => {
    if (tty) { readline.clearLine(output, 0); readline.cursorTo(output, 0); }
    output.write(`${text}\n`);
    setPrompt();
    rl.prompt(true);
  };

  function fmt(m) {
    const time = new Date(m.createdTimestamp ?? Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const own = m.author?.id === client.user?.id;
    let text = (m.content ?? '').replace(/<@!?(\d+)>/g, (_, id) => `@${client.users.cache.get(id)?.username ?? id}`);
    const extras = [...(m.attachments?.values?.() ?? [])].map((a) => `📎 ${a.name ?? 'attachment'}`);
    if (m.embeds?.length) extras.push('[embed]');
    if (extras.length) text = `${text}${text ? ' ' : ''}${dim(extras.join(' '))}`;
    const head = `${dim(time)} ${own ? green(`${m.author?.username ?? 'deed'} ➤`) : bold(m.author?.username ?? '?')}`;
    return `${head}  ${text.split('\n').join(`\n${' '.repeat(7)}`)}`;
  }

  function list() {
    const all = gcs();
    if (!all.length) return print('Deed isn’t in any group chats.');
    print(all.map((ch, i) => {
      const n = unread.get(ch.id) ?? 0;
      return `${ch.id === current ? green('▶') : ' '} ${bold(String(i + 1).padStart(2))}. ${nameOf(ch)} ${dim(`· ${ch.recipients.size + 1} members · ${isActive(ch) ? 'active' : 'not set up'}`)}${n ? yellow(` · ${n} new`) : ''}`;
    }).join('\n'));
  }

  async function read(n = 10) {
    const ch = selected();
    if (!ch) return print(red('Pick a group chat first: /gcs then /use <number>'));
    try {
      const msgs = await ch.messages.fetch({ limit: Math.min(Math.max(n, 1), 50) });
      const lines = [...msgs.values()].reverse().map(fmt);
      print(lines.length ? lines.join('\n') : dim('(no messages)'));
    } catch (err) {
      print(red(`Couldn't read messages: ${err.message}`));
    }
  }

  function choose(arg) {
    const all = gcs();
    const q = arg.trim().toLowerCase();
    if (!q) return print('Usage: /use <number | name>');
    const matches = /^\d+$/.test(q) && q.length < 6
      ? [all[Number(q) - 1]].filter(Boolean)
      : all.filter((c) => c.id === q || nameOf(c).toLowerCase().includes(q));
    if (!matches.length) return print(red(`No group chat matches "${arg}". /gcs to list.`));
    if (matches.length > 1) return print(`Several match, be more specific:\n${matches.map((c) => `  ${nameOf(c)}`).join('\n')}`);
    current = matches[0].id;
    unread.delete(current);
    print(`${green(`Now chatting in ${nameOf(matches[0])}`)} ${dim('· type to send as deed · /read for history · /gcs to switch')}`);
    return read(5);
  }

  async function send(text) {
    const ch = selected();
    if (!ch) return print(red('Pick a group chat first: /gcs then /use <number>'));
    if (text.length > 2000) return print(red(`Too long (${text.length}/2000 characters).`));
    try {
      await ch.send(text);
      if (!tail) print(dim('✓ sent'));
    } catch (err) {
      print(red(`Couldn't send: ${err.message}`));
    }
  }

  rl.on('line', (raw) => {
    const line = raw.trim();
    if (!line) return redraw();
    if (line.startsWith('//')) return void send(line.slice(1));
    if (!line.startsWith('/')) return void send(line);
    const [cmd, ...rest] = line.slice(1).split(/\s+/);
    const arg = rest.join(' ');
    switch (cmd.toLowerCase()) {
      case 'gcs': case 'list': case 'ls': return list();
      case 'use': case 'gc': case 'select': return void choose(arg);
      case 'read': case 'history': case 'log': return void read(parseInt(arg, 10) || 10);
      case 'who': case 'members': {
        const ch = selected();
        if (!ch) return print(red('Pick a group chat first.'));
        return print([...ch.recipients.values()].map((u) => `${u.id === ch.ownerId ? '👑' : '•'} ${u.username}`).concat(`${ch.ownerId === client.user.id ? '👑' : '•'} ${client.user.username} (you)`).join('\n'));
      }
      case 'tail':
        tail = arg.toLowerCase() === 'off' ? false : arg.toLowerCase() === 'on' ? true : !tail;
        return print(`Live messages ${tail ? green('on') : yellow('off')}`);
      case 'restart':
        if (!onRestart) return print(yellow('Restart only works when started with npm start.'));
        print(yellow('Restarting…'));
        return onRestart();
      case 'quit': case 'exit': case 'stop':
        return onQuit();
      case 'help': case '?':
        return print(HELP.join('\n'));
      default:
        if (/^\d+$/.test(cmd)) return void choose(cmd);
        return print(red(`Unknown command /${cmd}. /help lists them. (To send a message starting with /, use //)`));
    }
  });

  client.on('messageCreate', (m) => {
    if (m.channel?.type !== 'GROUP_DM') return;
    if (m.channel.id === current) {
      if (tail) print(fmt(m));
    } else if (m.author?.id !== client.user?.id) {
      unread.set(m.channel.id, (unread.get(m.channel.id) ?? 0) + 1);
      redraw();
    }
  });

  rl.on('SIGINT', onQuit);
  rl.on('close', () => output.write('(console closed; Deed is still running)\n'));

  const all = gcs();
  if (all.length === 1) current = all[0].id;
  setPrompt();
  print([
    `${bold('⌨️  Console')} ${dim('· type here to chat as Deed in a group chat')}`,
    `  ${dim('/gcs')} list · ${dim('/use <n>')} pick · ${dim('/read')} history · ${dim('/help')} all commands`,
    current ? green(`  Chatting in ${nameOf(all[0])} (the only group chat)`) : '',
  ].filter(Boolean).join('\n'));

  return { rl, close: () => rl.close(), _state: () => ({ current, tail }) };
}

module.exports = { startConsole };
