// Careers: a job ladder, shifts that count toward promotions, and bonus mini-tasks.
const eco = require('../lib/economy');
const { save } = require('../lib/db');
const { pick, randInt, awaitReply, formatDuration, shuffle } = require('../lib/util');
const { color, ansiBlock, bar } = require('../lib/format');

const WORK_COOLDOWN = () => Number(process.env.WORK_COOLDOWN_MS ?? 60 * 60 * 1000);
const TASK_CHANCE = () => Number(process.env.WORK_TASK_CHANCE ?? 0.5);
const TASK_MS = () => Number(process.env.WORK_TASK_MS ?? 15000);

// id: [title, emoji, shifts needed, min pay, max pay, flavor lines]
const JOBS = {
  fastfood: ['Fast Food Worker', '🍔', 0, 60, 100, ['flipped 200 burgers', 'survived the lunch rush', 'fixed the ice cream machine (a miracle)']],
  cashier: ['Cashier', '🛒', 8, 90, 150, ['scanned 1,000 items', 'handled a Karen gracefully', 'balanced the register to the cent']],
  barista: ['Barista', '☕', 18, 120, 190, ['drew a perfect latte heart', 'memorized 40 custom orders', 'survived a 7am rush']],
  programmer: ['Programmer', '💻', 32, 170, 270, ['fixed a bug by adding another bug', 'shipped to prod on a Friday', 'closed 12 tickets']],
  doctor: ['Doctor', '🩺', 50, 240, 380, ['saved a life', 'wrote unreadable prescriptions', 'pulled a 12-hour shift']],
  pilot: ['Pilot', '✈️', 75, 320, 500, ['landed smoothly in a storm', 'flew to Tokyo and back', 'announced mild turbulence']],
  astronaut: ['Astronaut', '🚀', 105, 430, 680, ['fixed the space station', 'floated around for science', 'saw 16 sunrises']],
  ceo: ['CEO', '👑', 150, 650, 1000, ['bought a smaller company', 'gave a TED talk', 'made the stock go up']],
};
const JOB_IDS = Object.keys(JOBS);

const WORDS = ['coffee', 'burger', 'rocket', 'doctor', 'laptop', 'planet', 'coins', 'dragon', 'pirate', 'guitar', 'banana', 'wizard', 'discord', 'ticket'];

function career(userId) {
  const acc = eco.account(userId);
  acc.career ??= { job: null, shifts: 0 };
  return acc.career;
}

const unlocked = (shifts) => JOB_IDS.filter((id) => shifts >= JOBS[id][2]);
const bestUnlocked = (shifts) => unlocked(shifts).at(-1);

function makeTask() {
  if (Math.random() < 0.5) {
    const word = pick(WORDS);
    let scrambled = word;
    while (scrambled === word) scrambled = shuffle([...word]).join('');
    return { prompt: `Unscramble: **\`${scrambled}\`**`, answer: word };
  }
  const a = randInt(3, 19), b = randInt(3, 19), op = pick(['+', '×', '-']);
  const answer = op === '+' ? a + b : op === '×' ? a * b : a - b;
  return { prompt: `Quick math: **\`${a} ${op} ${b}\`**`, answer: String(answer) };
}

module.exports = [
  {
    name: 'work',
    aliases: ['shift'],
    usage: 'work',
    description: 'Work a shift at your job (hourly). Sometimes there is a bonus task.',
    async run({ message, config }) {
      const uid = message.author.id;
      const c = career(uid);
      c.job ??= 'fastfood';
      const left = eco.useCooldown(uid, 'work', WORK_COOLDOWN());
      if (left) return message.reply(`😮‍💨 You're off the clock. Next shift in ${formatDuration(left)}.`);

      const [title, emoji, , min, max, flavor] = JOBS[c.job];
      let pay = randInt(min, max);
      let bonusLine = null;

      if (Math.random() < TASK_CHANCE()) {
        const task = makeTask();
        await message.channel.send(`### ${emoji} Bonus task!\n> ${task.prompt}\n-# ${message.author.username}: answer within ${TASK_MS() / 1000}s for +50% pay`);
        const reply = await awaitReply(message.channel, (m) => m.author.id === uid, TASK_MS());
        if (reply && reply.content.trim().toLowerCase() === task.answer) {
          bonusLine = `✅ Bonus task done: **+${Math.round(pay / 2)}**`;
          pay += Math.round(pay / 2);
        } else {
          bonusLine = `❌ Bonus task missed (it was \`${task.answer}\`)`;
        }
      }

      c.shifts++;
      save();
      const bal = eco.add(uid, pay);
      const before = bestUnlocked(c.shifts - 1);
      const now = bestUnlocked(c.shifts);
      const next = JOB_IDS.find((id) => JOBS[id][2] > c.shifts);
      const promo = now !== before ? `🎉 **New job unlocked: ${JOBS[now][1]} ${JOBS[now][0]}!** Use \`${config.prefix}apply ${now}\`` : null;

      await message.channel.send([
        `### ${emoji} Shift complete · ${title}`,
        `> You ${pick(flavor)} and earned **🪙 ${pay.toLocaleString()}**`,
        bonusLine ? `> ${bonusLine}` : null,
        promo ? `> ${promo}` : null,
        next ? ansiBlock([`${color(bar((c.shifts - JOBS[bestUnlocked(c.shifts)][2]) / (JOBS[next][2] - JOBS[bestUnlocked(c.shifts)][2]), 16), 'green')} ${color(`${c.shifts}/${JOBS[next][2]} shifts to ${JOBS[next][0]}`, 'gray')}`]) : null,
        `-# balance: 🪙 ${bal.toLocaleString()} · next shift in 1h`,
      ].filter(Boolean).join('\n'));
    },
  },
  {
    name: 'jobs',
    aliases: ['career', 'joblist'],
    usage: 'jobs',
    description: 'The career ladder and what you have unlocked.',
    async run({ message, config }) {
      const c = career(message.author.id);
      const lines = JOB_IDS.map((id) => {
        const [title, emoji, need, min, max] = JOBS[id];
        const status = c.job === id ? '⬅️ **current**' : c.shifts >= need ? '✅' : `🔒 ${need} shifts`;
        return `> ${emoji} **${title}** · 🪙 ${min}–${max}/shift · \`${id}\` ${status}`;
      });
      await message.channel.send([`### 💼 Careers`, ...lines, `-# ${c.shifts} shifts worked · switch with \`${config.prefix}apply <job>\``].join('\n'));
    },
  },
  {
    name: 'apply',
    usage: 'apply <job>',
    description: 'Switch to a job you have unlocked.',
    async run({ message, args }) {
      const c = career(message.author.id);
      const q = (args[0] ?? '').toLowerCase();
      const id = JOB_IDS.find((j) => j === q || JOBS[j][0].toLowerCase().replace(/\s/g, '') === q.replace(/\s/g, ''));
      if (!id) return message.reply('Which job? See `jobs`.');
      if (c.shifts < JOBS[id][2]) return message.reply(`🔒 ${JOBS[id][0]} needs ${JOBS[id][2]} shifts (you have ${c.shifts}).`);
      c.job = id;
      save();
      await message.channel.send(`### ${JOBS[id][1]} Hired as ${JOBS[id][0]}!\n-# 🪙 ${JOBS[id][3]}–${JOBS[id][4]} per shift`);
    },
  },
];

module.exports.internals = { JOBS, career };
