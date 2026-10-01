// Party game scenarios, run by tests/simulate.js (which supplies the fake GC + DM helpers).
module.exports = async function partyTests(h) {
  const { say, dmTo, dmsFor, gcFind, check, until, settle, eco, users } = h;
  const { me, alice, bob, carol, dave, frank, gina } = users;
  const party = require('../lib/party');
  const lastDM = (u) => dmsFor(u).at(-1) ?? '';

  // Open a lobby with `cmd`, have `joiners` join, start it, and DM ready for everyone.
  async function open(cmd, host, joiners, { ready = [host, ...joiners] } = {}) {
    await say(host, cmd);
    for (const u of joiners) await say(u, 'join');
    await say(host, 'start');
    await until(() => /DM me `ready`/.test(gcFind(/DM me `ready`/)), 3000);
    for (const u of ready) await dmTo(u, 'ready');
    await settle(100);
  }

  console.log('\n━━━ Party: lobby ━━━');
  {
    let r = await say(alice, '!spyfall');
    check('party lobby opens', /Spyfall · lobby/.test(r), r);
    r = await say(bob, '!spyfall');
    check('one party game per GC', /already running here/.test(r), r);
    r = await say(bob, 'start');
    check('only the host can start', /Only the host/.test(r), r);
    r = await say(alice, 'start');
    check('lobby needs the minimum', /Need at least 3/.test(r), r);
    await say(alice, 'cancel');
    await until(() => !party.channelGame(h.channel), 2000);
    check('host can cancel; locks released', !party.channelGame(h.channel) && !party.playingIn(alice.id));
  }

  console.log('\n━━━ Party: Spyfall ━━━');
  {
    process.env.SPY_ROUND_MS = '20000';
    await open('!spyfall', alice, [bob, carol]);
    await until(() => /the round begins/.test(gcFind(/the round begins/)), 3000);
    const players = [alice, bob, carol];
    const spy = players.find((u) => dmsFor(u).some((c) => /You are the SPY/.test(c)));
    const agents = players.filter((u) => u !== spy);
    const loc = /Location: (.+)/.exec(dmsFor(agents[0]).find((c) => /Location:/.test(c)) ?? '')?.[1];
    check('spyfall: exactly one spy, others share a location', spy && agents.every((u) => dmsFor(u).some((c) => c.includes(`Location: ${loc}`))), loc);
    check('spyfall: spy is not told the location', !dmsFor(spy).some((c) => c.includes(`Location: ${loc}`)));
    let r = await say(agents[0], 'locations');
    check('spyfall: locations list', /Possible locations/.test(r), r);
    // A failed (non-unanimous) accusation.
    r = await say(agents[0], `accuse ${agents[1].username}`);
    check('spyfall: accusation vote opens', /accuses/.test(r), r);
    await say(spy, 'no');
    await say(agents[1], 'no').catch(() => {});
    await until(() => /Not unanimous/.test(gcFind(/Not unanimous|accuses/)), 3000);
    check('spyfall: non-unanimous accusation fails', /Not unanimous/.test(gcFind(/Not unanimous/)));
    r = await say(agents[0], `accuse ${spy.username}`);
    check('spyfall: one accusation each', /already used/.test(r), r);
    // The spy guesses right.
    const before = eco.balance(spy.id);
    await dmTo(spy, 'guess atlantis');
    check('spyfall: bad location gets the list', /Not a location/.test(lastDM(spy)), lastDM(spy));
    await dmTo(spy, `guess ${loc}`);
    await until(() => /spy wins/.test(gcFind(/spy wins|players win/)), 3000);
    check('spyfall: correct guess -> spy wins + paid', /spy wins/.test(gcFind(/spy wins|players win/)) && eco.balance(spy.id) - before === 300, gcFind(/spy wins|players win/));
    await until(() => !party.channelGame(h.channel), 2000);
    check('spyfall: cleaned up', !party.channelGame(h.channel) && players.every((u) => !party.playingIn(u.id)));

    // Round runs out -> everyone votes the spy -> last chance guess is wrong -> players win.
    process.env.SPY_ROUND_MS = '600';
    process.env.SPY_FINAL_MS = '3000';
    process.env.SPY_GUESS_MS = '2000';
    await open('!spyfall', bob, [alice, carol, dave]);
    await until(() => /Time's up/.test(gcFind(/Time's up/)), 5000);
    const p2 = [bob, alice, carol, dave];
    const spy2 = p2.find((u) => dmsFor(u).filter((c) => /You are the SPY|Location:/.test(c)).at(-1)?.includes('SPY'));
    const order = /Time's up[\s\S]*/.exec(gcFind(/Time's up/))[0];
    const spyNum = [...order.matchAll(/`(\d+)` (\w+)/g)].find((m) => m[2] === spy2.username)[1];
    r = await say(spy2, spyNum);
    check('spyfall: no voting for yourself', /can’t vote for yourself/.test(r), r);
    for (const u of p2.filter((x) => x !== spy2)) await say(u, spyNum);
    await until(() => /one last chance/.test(gcFind(/one last chance/)), 4000);
    check('spyfall: caught spy gets a last chance', /one last chance/.test(gcFind(/one last chance/)));
    await dmTo(spy2, 'guess beach');
    await until(() => /players win|spy wins/.test(gcFind(/players win|spy wins/)) && !party.channelGame(h.channel), 4000);
    const end = gcFind(/players win|spy wins/);
    const actuallyBeach = /Beach/.test(end.split('\n')[1]) && /guessed the location/.test(end);
    check('spyfall: wrong last guess -> players win', /players win/.test(end) || actuallyBeach, end.split('\n').slice(0, 2).join(' | '));
  }

  console.log('\n━━━ Party: Codenames ━━━');
  {
    const cn = require('../lib/games/codenames').internals;
    process.env.CN_CLUE_MS = '4000';
    process.env.CN_GUESS_MS = '4000';
    await open('!codenames', alice, [bob, carol, dave]);
    await until(() => /Codenames · teams/.test(gcFind(/Codenames · teams/)), 3000);
    const all = [alice, bob, carol, dave];
    const spyOf = (team) => all.find((u) => dmsFor(u).some((c) => new RegExp(`You are the ${team} spymaster`).test(c)));
    const red = spyOf('Red'), blue = spyOf('Blue');
    check('codenames: two spymasters, key image by DM', red && blue && red !== blue && /\[file key\.png \d{4,}B\]/.test(dmsFor(red).at(-1)), dmsFor(red).at(-1)?.slice(0, 60));
    await until(() => /give your team a clue/.test(gcFind(/give your team a clue/)), 3000);
    const b = cn.boards.get(h.channel.id);
    const turn = b.first;
    const spy = turn === 'red' ? red : blue;
    const teams = /Red\*\*: 🧠 \w+ \(spymaster\) · ([^\n]+)\n.*Blue\*\*: 🧠 \w+ \(spymaster\) · ([^\n]+)/.exec(gcFind(/Codenames · teams/));
    const guesser = all.find((u) => u.username === teams[turn === 'red' ? 1 : 2].split(', ')[0]);
    check('codenames: board image posted', /\[file codenames\.png \d{4,}B\]/.test(gcFind(/turn/)), gcFind(/turn/).slice(0, 60));
    const own = b.words.find((w, i) => b.key[i] === turn);
    let r = await say(spy, `clue ${own.split(' ')[0]} 2`);
    check('codenames: clue cannot be a board word', /on the board/.test(r), r);
    r = await say(spy, 'clue zzzz 2');
    check('codenames: clue accepted', /Clue: \*\*ZZZZ\*\* · 2/.test(r), r);
    r = await say(spy, own);
    check('codenames: spymaster cannot guess', !/correct/.test(r), r);
    r = await say(guesser, own);
    check('codenames: correct guess', /correct/.test(r), r);
    const before = eco.balance(spy.id);
    const assassin = b.words[b.key.indexOf('assassin')];
    await say(guesser, assassin);
    await until(() => /team wins/.test(gcFind(/team wins/)), 3000);
    const loser = turn === 'red' ? 'Blue' : 'Red';
    check('codenames: assassin loses the game', new RegExp(`${loser} team wins`).test(gcFind(/team wins/)) && /assassin/.test(gcFind(/team wins/)), gcFind(/team wins/).slice(0, 120));
    check('codenames: no coins for the losers', eco.balance(spy.id) === before);
    await until(() => !party.channelGame(h.channel), 2000);
    check('codenames: cleaned up', !party.channelGame(h.channel) && all.every((u) => !party.playingIn(u.id)));
  }

  console.log('\n━━━ Party: Fill in the Blank ━━━');
  {
    Object.assign(process.env, { BLANKS_ROUNDS: '2', BLANKS_ANSWER_MS: '2500', BLANKS_VOTE_MS: '2500' });
    await open('!blanks', alice, [bob, carol]);
    await until(() => /Round 1\/2/.test(gcFind(/Round 1\/2/)), 3000);
    check('blanks: prompt DMed to players', /Round 1 · DM me your answer/.test(lastDM(bob)), lastDM(bob));
    await dmTo(alice, 'a sandwich @everyone');
    check('blanks: answer locked in', /Locked in/.test(lastDM(alice)), lastDM(alice));
    await dmTo(bob, 'my ex');
    await dmTo(carol, 'tax fraud');
    await until(() => /Vote for the funniest/.test(gcFind(/Vote for the funniest/)), 3000);
    const ballot = gcFind(/Vote for the funniest/);
    check('blanks: answers shown anonymously, pings defused', !/alice|bob|carol/.test(ballot) && !/@everyone/.test(ballot) && /tax fraud/.test(ballot), ballot);
    const num = (t) => /`(\d)` (.+)/g && [...ballot.matchAll(/`(\d)` (.+)/g)].find((m) => m[2].includes(t))[1];
    let r = await say(carol, num('tax fraud'));
    check('blanks: no voting for your own', /your own/.test(r), r);
    const before = eco.balance(carol.id);
    await say(alice, num('tax fraud'));
    await say(bob, num('tax fraud'));
    await say(carol, num('my ex'));
    await until(() => /Round 1 results/.test(gcFind(/Round 1 results/)), 3000);
    check('blanks: results credit the author', /\*\*tax fraud\*\* · carol · 2 votes \(\+200\)/.test(gcFind(/Round 1 results/)), gcFind(/Round 1 results/));
    await until(() => /Round 2\/2/.test(gcFind(/Round 2\/2/)), 3000);
    check('blanks: last round is double', /double points/.test(gcFind(/Round 2\/2/)));
    await dmTo(bob, 'only me');
    await until(() => /Not enough answers/.test(gcFind(/Not enough answers/)), 4000);
    check('blanks: round with <2 answers is skipped', /Not enough answers/.test(gcFind(/Not enough answers/)));
    await until(() => /win/.test(gcFind(/# 🏆/)), 3000);
    check('blanks: winner announced + paid', /carol wins/.test(gcFind(/# 🏆/)) && eco.balance(carol.id) - before === 40 + 200, `${gcFind(/# 🏆/).split('\n')[0]} +${eco.balance(carol.id) - before}`);
    await until(() => !party.channelGame(h.channel), 2000);
    check('blanks: cleaned up', !party.channelGame(h.channel) && !party.playingIn(carol.id));
  }

  console.log("\n━━━ Party: Liar's Dice ━━━");
  {
    const ld = require('../lib/games/liarsdice').internals;
    const table = [{ roll: [1, 5, 5] }, { roll: [2, 1, 3] }];
    check('liarsdice: 1s are wild when counting', ld.countFace(table, 5) === 4 && ld.countFace(table, 3) === 3);
    check('liarsdice: bid ordering', ld.isHigher({ count: 3, face: 2 }, { count: 2, face: 6 }) && ld.isHigher({ count: 2, face: 5 }, { count: 2, face: 4 }) && !ld.isHigher({ count: 2, face: 3 }, { count: 2, face: 4 }));

    process.env.LD_DICE = '1';
    process.env.LD_TURN_MS = '4000';
    const a0 = eco.balance(alice.id), b0 = eco.balance(bob.id);
    let r = await say(alice, '!liarsdice 999999999');
    check('liarsdice: buy-in must be affordable', /Usage/.test(r), r);
    await until(() => !party.channelGame(h.channel), 2000);
    await open('!liarsdice 100', alice, [bob]);
    await until(() => /'s turn/.test(gcFind(/'s turn/)), 3000);
    check('liarsdice: buy-ins held', eco.balance(alice.id) === a0 - 100 && eco.balance(bob.id) === b0 - 100);
    check('liarsdice: dice sent by DM', /your dice/.test(lastDM(alice)) && /your dice/.test(lastDM(bob)));
    const first = /### 🎲 (\w+)'s turn/.exec(gcFind(/'s turn/))[1] === 'alice' ? alice : bob;
    const second = first === alice ? bob : alice;
    r = await say(first, 'liar');
    check('liarsdice: nothing to call yet', /no bid to call/.test(r), r);
    r = await say(first, '1 1');
    check('liarsdice: no bidding on wild 1s', /1s are wild/.test(r), r);
    r = await say(first, '3 5');
    check('liarsdice: bid capped at dice on table', /between 1 and 2/.test(r), r);
    await say(first, '1 5');
    await until(() => new RegExp(`${second.username}'s turn`).test(gcFind(/'s turn/)), 3000);
    r = await say(second, '1 4');
    check('liarsdice: bids must go up', /Too low/.test(r), r);
    await say(second, 'liar');
    await until(() => /wins Liar's Dice/.test(gcFind(/wins Liar's Dice/)), 3000);
    const champ = /# 🏆 (\w+) wins/.exec(gcFind(/wins Liar's Dice/))[1] === 'alice' ? alice : bob;
    const loser = champ === alice ? bob : alice;
    check('liarsdice: reveal shows everyone’s dice', /calls .+ a liar/.test(gcFind(/calls/)) && /told the truth|was lying/.test(gcFind(/calls/)));
    check('liarsdice: winner takes the pot', eco.balance(champ.id) === (champ === alice ? a0 : b0) + 100 && eco.balance(loser.id) === (loser === alice ? a0 : b0) - 100,
      `${eco.balance(champ.id) - (champ === alice ? a0 : b0)} / ${eco.balance(loser.id) - (loser === alice ? a0 : b0)}`);
    await until(() => !party.channelGame(h.channel), 2000);
    check('liarsdice: cleaned up', !party.channelGame(h.channel) && !require('../lib/bets').busy.has(alice.id));
  }

  console.log("\n━━━ Party: Texas Hold'em ━━━");
  {
    const poker = require('../lib/poker');
    const best = (x) => poker.best(poker.parse(x));
    check('poker: hand ranks', best('As Ks Qs Js Ts 2d 3c').name === 'Royal flush' && best('Ah 2d 3c 4s 5h 9d Kc').name === 'Straight' && best('9h 9d 9c Ks Kh 2d 3c').name === 'Full house');
    check('poker: kickers + split pots', poker.compare(best('Ah Ad Kc 2s 3h 7d 8c').score, best('Ah Ad Qc 2s 3h 7d 8c').score) > 0 && poker.compare(best('Ah Kd 2c 3s 4h 9d 9c').score, best('Ac Kc 2c 3s 4h 9d 9c').score) === 0);
    const sp = poker.pots([{ id: 'a', total: 100 }, { id: 'b', total: 300 }, { id: 'c', total: 300 }, { id: 'd', total: 50, folded: true }]);
    check('poker: side pots', sp.length === 2 && sp[0].amount === 350 && sp[0].eligible.length === 3 && sp[1].amount === 400 && sp[1].eligible.join() === 'b,c', JSON.stringify(sp));

    Object.assign(process.env, { POKER_TURN_MS: '4000', POKER_BREAK_MS: '1500' });
    for (const u of [alice, bob, carol]) eco.add(u.id, 5000);
    const a0 = eco.balance(alice.id), b0 = eco.balance(bob.id);
    let r = await say(alice, '!poker 5');
    check('poker: minimum buy-in', /at least/.test(r), r);
    await until(() => !party.channelGame(h.channel), 2000);
    await open('!poker 1000', alice, [bob]);
    await until(() => /alice to act/.test(gcFind(/to act/)), 4000);
    check('poker: hole cards by DM', /Hand #1 · your cards/.test(lastDM(alice)) && /Hand #1 · your cards/.test(lastDM(bob)));
    check('poker: buy-ins held', eco.balance(alice.id) === a0 - 1000 && eco.balance(bob.id) === b0 - 1000);
    r = await say(alice, 'check');
    check('poker: cannot check facing a bet', /can’t check/.test(r), r);
    r = await say(alice, 'raise 30');
    check('poker: minimum raise enforced', /Minimum raise is to 40/.test(r), r);
    await say(alice, 'call');
    await until(() => /bob to act/.test(gcFind(/to act/)), 3000);
    await say(bob, 'check');
    await until(() => /Flop/.test(gcFind(/Flop:/)), 3000);
    await until(() => /bob to act/.test(gcFind(/to act/)) && /Flop/.test(gcFind(/to act/)), 3000);
    await say(bob, 'bet 100');
    await until(() => /alice to act/.test(gcFind(/to act/)) && /to call/.test(gcFind(/to act/)), 3000);
    await say(alice, 'fold');
    await until(() => /bob wins/.test(gcFind(/bob wins/)), 3000);
    check('poker: fold gives the pot (uncalled bet back)', /bob wins 🪙 140/.test(gcFind(/bob wins/)), gcFind(/bob wins/));
    await until(() => /cashout/.test(gcFind(/next hand in/)), 3000);
    await say(alice, 'cashout');
    await until(() => /Table closed/.test(gcFind(/Table closed/)), 4000);
    check('poker: cashout settles chips', eco.balance(alice.id) === a0 - 20 && eco.balance(bob.id) === b0 + 20, `${eco.balance(alice.id) - a0} / ${eco.balance(bob.id) - b0}`);
    await until(() => !party.channelGame(h.channel), 2000);
    check('poker: cleaned up', !party.channelGame(h.channel) && !require('../lib/bets').busy.has(bob.id) && !party.playingIn(alice.id));

    // All-in preflop runs the board out to a showdown; coins are conserved.
    const total0 = eco.balance(alice.id) + eco.balance(bob.id) + eco.balance(carol.id);
    const from = h.log.length;
    const since = (re) => h.log.slice(from).filter((m) => re.test(m.content));
    await open('!poker 500', alice, [bob, carol]);
    for (let k = 0; k < 6 && !since(/Showdown|wins 🪙/).length; k++) {
      await until(() => since(/to act/).length > k || since(/Showdown|wins 🪙/).length, 4000);
      if (since(/Showdown|wins 🪙/).length) break;
      const who = /### 🃏 (\w+) to act/.exec(since(/to act/).at(-1).content)[1];
      await say([alice, bob, carol].find((x) => x.username === who), k === 0 ? 'allin' : 'call');
    }
    await until(() => since(/Showdown/).length, 4000);
    check('poker: all-in showdown runs out the board', /Showdown · \*\*(\S+ ){4}\S+\*\*/.test(since(/Showdown/)[0]?.content ?? ''), since(/Showdown|wins/)[0]?.content);
    await until(() => since(/Table closed|next hand in/).length, 4000);
    if (!since(/Table closed/).length) await say(alice, 'endgame');
    await until(() => !party.channelGame(h.channel), 5000);
    check('poker: coins conserved', eco.balance(alice.id) + eco.balance(bob.id) + eco.balance(carol.id) === total0, `${eco.balance(alice.id) + eco.balance(bob.id) + eco.balance(carol.id) - total0}`);
  }

  console.log('\n━━━ Party: Heist ━━━');
  {
    process.env.HEIST_VOTE_MS = '2500';
    for (const u of [alice, bob, carol]) eco.add(u.id, 1000);
    const total0 = eco.balance(alice.id) + eco.balance(bob.id) + eco.balance(carol.id);
    const from = h.log.length;
    const since = (re) => h.log.slice(from).filter((m) => re.test(m.content));
    await open('!heist 100', alice, [bob, carol]);
    await until(() => since(/Stage 1\/3/).length, 4000);
    const crew = [alice, bob, carol];
    const rat = crew.find((u) => dmsFor(u).some((c) => /You are the RAT/.test(c)));
    check('heist: exactly one rat, everyone else told they are crew', rat && crew.filter((u) => u !== rat).every((u) => dmsFor(u).some((c) => /You are crew/.test(c))));
    check('heist: stakes held', eco.balance(alice.id) + eco.balance(bob.id) + eco.balance(carol.id) === total0 - 300);
    await dmTo(rat, 'sabotage');
    check('heist: rat can sabotage', /odds just got worse/.test(lastDM(rat)), lastDM(rat));
    for (let n = 1; n <= 3; n++) {
      await until(() => since(new RegExp(`Stage ${n}/3`)).length || since(/Busted|got away/).length, 4000);
      if (since(/Busted|got away/).length) break;
      for (const u of crew) await say(u, '2');
      await until(() => since(/it worked|went wrong/).length >= n, 4000);
    }
    await until(() => since(/Who's the rat|Busted|got away/).length, 4000);
    if (since(/Who's the rat/).length) {
      const ballot = since(/Who's the rat/)[0].content;
      const num = [...ballot.matchAll(/`(\d)` (\w+)/g)].find((m) => m[2] === rat.username)?.[1];
      for (const u of crew.filter((x) => x !== rat)) await say(u, num);
      await say(rat, num === '1' ? '2' : '1');
    }
    await until(() => since(/Busted|got away/).length, 4000);
    const end = since(/Busted|got away/)[0]?.content ?? '';
    check('heist: ends with a payout or a bust', /Busted|got away/.test(end), end);
    if (/caught the rat/.test(end)) check('heist: caught rat gets nothing', new RegExp(`${rat.username}\\*\\* nothing`).test(end), end);
    await until(() => !party.channelGame(h.channel), 3000);
    check('heist: cleaned up', !party.channelGame(h.channel) && !require('../lib/bets').busy.has(rat.id));
  }

  console.log('\n━━━ Connect 4 ━━━');
  {
    const { c4Drop, c4Win } = require('../commands/games').connect4;
    const grid = Array.from({ length: 6 }, () => Array(7).fill(null));
    [0, 1, 2].forEach((c) => c4Drop(grid, c, 0));
    check('connect4: no win with three', !c4Win(grid, 5, 2));
    check('connect4: horizontal win', c4Win(grid, c4Drop(grid, 3, 0), 3)?.length === 4);
    const diag = Array.from({ length: 6 }, () => Array(7).fill(null));
    for (let k = 0; k < 4; k++) { for (let j = 0; j < k; j++) c4Drop(diag, k, 1); c4Drop(diag, k, 0); }
    check('connect4: diagonal win', !!c4Win(diag, 2, 3));

    for (const u of [alice, bob]) eco.add(u.id, 500);
    const a0 = eco.balance(alice.id), b0 = eco.balance(bob.id);
    await say(alice, `!connect4 <@${bob.id}> 50`);
    await say(bob, 'accept');
    await until(() => /'s turn/.test(gcFind(/'s turn|connects/)), 3000);
    const first = /(\w+)'s turn/.exec(gcFind(/'s turn/))[1] === 'alice' ? alice : bob;
    const second = first === alice ? bob : alice;
    check('connect4: board image', /\[file connect4\.png \d{4,}B\]/.test(gcFind(/'s turn/)), gcFind(/'s turn/).slice(0, 50));
    let r = await say(second, '1');
    check('connect4: only the current player moves', !/'s turn/.test(r), r);
    for (let k = 0; k < 3; k++) { await say(first, '1'); await say(second, '2'); }
    await say(first, '1');
    await until(() => /connects four/.test(gcFind(/connects four/)), 3000);
    check('connect4: four in a column wins + pays', new RegExp(`${first.username} connects four`).test(gcFind(/connects four/)) && eco.balance(first.id) === (first === alice ? a0 : b0) + 50, gcFind(/connects four/).slice(0, 80));
    await until(() => !party.channelGame(h.channel), 2000);
  }

  console.log('\n━━━ Wordle ━━━');
  {
    const w = require('../lib/games/wordle').internals;
    check('wordle: grading handles repeated letters', w.grade('speed', 'abide').join('') === 'bbyby' && w.grade('eerie', 'there').join('') === 'ybybg' && w.grade('crane', 'crane').join('') === 'ggggg');
    check('wordle: answers are valid guesses', w.ANSWERS.length > 500 && w.ANSWERS.every((x) => w.VALID.has(x)));
    process.env.WORDLE_DAY = '100';
    const answer = w.answerFor(100);
    const wrong = answer === 'crane' ? 'slate' : 'crane';
    let r = await say(alice, `!wordle ${wrong}`);
    check('wordle: guesses in the GC are refused (spoilers)', /DM me your guesses/.test(r), r);
    r = await say(alice, '!wordle');
    check('wordle: GC card + sets the results channel', /Wordle #101/.test(r), r);
    await dmTo(alice, 'wordle zzzzz');
    check('wordle: unknown words rejected', /isn’t in my word list/.test(lastDM(alice)), lastDM(alice));
    await dmTo(alice, `wordle ${wrong}`);
    check('wordle: guess graded', /1\/6/.test(lastDM(alice)) && /[🟩🟨⬛]{5}/u.test(lastDM(alice)), lastDM(alice));
    const before = eco.balance(alice.id);
    await dmTo(alice, answer); // bare word works once a game is going
    check('wordle: solved in 2 pays 350', /Got it!/.test(lastDM(alice)) && eco.balance(alice.id) - before === 350, lastDM(alice));
    check('wordle: spoiler-free grid posted to the GC', /alice solved Wordle #101 · 2\/6/.test(gcFind(/solved Wordle/)) && !gcFind(/solved Wordle/).toLowerCase().includes(answer), gcFind(/solved Wordle/));
    await dmTo(alice, `wordle ${wrong}`);
    check('wordle: one game per day', /already finished/.test(lastDM(alice)), lastDM(alice));
    r = await say(alice, '!wordle stats');
    check('wordle: stats', /1\*\* played/.test(r) && /streak \*\*1\*\*/.test(r), r);
    process.env.WORDLE_DAY = '101';
    for (const g of ['crane', 'slate', 'pious', 'nymph', 'blitz', 'gawky'].filter((x) => x !== w.answerFor(101)).slice(0, 6)) await dmTo(alice, `wordle ${g}`);
    check('wordle: six misses ends the game and shows the word', /The word was/.test(lastDM(alice)) || /Got it/.test(lastDM(alice)), lastDM(alice));
    delete process.env.WORDLE_DAY;
  }

  console.log('\n━━━ Murder mystery: new roles & features ━━━');
  {
    const mm = require('../commands/mystery').internals;
    const saved = { ...process.env };
    Object.assign(process.env, { MM_DEFENSE_MS: '200', MM_TRIAL_MS: '3000', MM_EVENTS: 'off', MM_DAY_MS: '8000', MM_VOTE_MS: '3000', MM_NIGHT_MS: '3000', MM_QUESTION_MS: '2000', MM_READY_MS: '3000' });
    const roles14 = mm.roleList(14);
    check('mm: 11–14 players add survivor, executioner, vigilante, medium', ['survivor', 'executioner', 'vigilante', 'medium'].every((r) => roles14.includes(r)) && roles14.length === 14 && !mm.roleList(10).includes('survivor'));
    const chaos = mm.roleList(10, 'chaos');
    check('mm: chaos mode keeps the table size and never doubles a special', chaos.length === 10 && ['survivor', 'executioner', 'vigilante', 'medium'].every((r) => chaos.filter((x) => x === r).length <= 1));

    // Game A: executioner, vigilante vs vest, lovers, bets, interrogation, board, achievements.
    const six = [alice, bob, carol, dave, frank, gina];
    for (const u of six) eco.add(u.id, 1000);
    await say(alice, '!mm');
    for (const u of six.slice(1)) await say(u, '!mm join');
    const g = mm.games.get(h.channel.id);
    let r = await say(carol, '!spyfall');
    check('mm: party games blocked while a mystery runs here', /already running|already in a game of \*\*Murder Mystery/.test(r), r);
    r = await say(me, '!spyfall');
    check('mm: …even for people not in it', /already running/.test(r), r);
    g.forceRoles = ['murderer', 'executioner', 'vigilante', 'medium', 'survivor', 'guest'];
    g.forceLovers = [dave.id, gina.id];
    g.forceExeTarget = carol.id;
    r = await say(alice, '!mm start chaos');
    check('mm: start with a mode', /Chaos mode/.test(r) && g.mode === 'chaos', r);
    for (const u of six) await dmTo(u, 'ready');
    await until(() => g.phase === 'night', 5000);
    const roleDM = (u) => dmsFor(u).filter((c) => /You are the/.test(c)).at(-1) ?? '';
    check('mm: executioner told their target', /Your target: \*\*.+\*\* \(carol\)/.test(roleDM(bob)), roleDM(bob));
    check('mm: lovers told about each other', /in love with .+\(gina\)/.test(roleDM(dave)) && /in love with .+\(dave\)/.test(roleDM(gina)));
    check('mm: survivor starts with 2 vests', /2 left/.test(roleDM(frank)), roleDM(frank));
    await dmTo(frank, 'vest');
    check('mm: survivor vest', /Vest on/.test(lastDM(frank)), lastDM(frank));
    await dmTo(carol, `shoot ${frank.username}`);
    check('mm: vigilante takes aim', /take aim/.test(lastDM(carol)), lastDM(carol));
    await dmTo(alice, `kill ${gina.username}`);
    await until(() => g.phase === 'day', 5000);
    const morning = gcFind(/is dead/);
    check('mm: lover dies of a broken heart', !g.players.find((p) => p.id === dave.id).alive && /broken heart/.test(morning), morning.slice(0, 300));
    check('mm: vest stops the vigilante', g.players.find((p) => p.id === frank.id).alive && /but they survived/.test(morning));

    r = await say(bob, '!mm bet alice 100');
    check('mm: living players cannot bet', /Only the dead and spectators/.test(r), r);
    const gina0 = eco.balance(gina.id);
    r = await say(gina, '!mm bet alice 100');
    check('mm: ghosts can bet', /bets 🪙 100/.test(r) && /3\.2×/.test(r), r);
    r = await say(bob, `!mm question ${frank.username}`);
    check('mm: interrogation asks a question', /Interrogation/.test(r), r);
    r = await say(frank, 'I was asleep, obviously');
    check('mm: interrogation answer quoted', /🗣️ \*\*.+:\*\* “I was asleep, obviously”/.test(r), r);
    r = await say(carol, '!mm question bob');
    check('mm: one interrogation per day', /already been interrogated/.test(r), r);
    r = await say(alice, '!mm board');
    await until(() => /evidence-board\.png/.test(gcFind(/evidence-board/)), 8000);
    check('mm: evidence board image', /\[file evidence-board\.png \d{4,}B\]/.test(gcFind(/evidence-board/)), gcFind(/Evidence board/).slice(0, 80));
    await say(alice, '!mm skip');
    await until(() => g.phase === 'vote', 3000);
    for (const u of [alice, bob, frank]) await say(u, `!vote ${carol.username}`);
    await say(carol, '!vote skip');
    await until(() => g.phase === 'trial', 4000);
    for (const u of [alice, bob, frank]) await say(u, 'guilty');
    await until(() => /Executioner wins/.test(gcFind(/found guilty/)), 5000);
    check('mm: executioner wins when their target is convicted', /Executioner wins/.test(gcFind(/found guilty/)), gcFind(/found guilty/).slice(0, 200));
    await until(() => g.phase === 'night', 5000);
    await dmTo(alice, `kill ${frank.username}`);
    await until(() => /murderers win/.test(gcFind(/murderers win/)), 6000);
    const fin = gcFind(/murderers win/);
    check('mm: executioner listed as a co-winner', /Executioner also wins/.test(fin), fin.slice(0, 300));
    check('mm: bets settled at the end', /gina\*\* bet 🪙 100 on .+: won 🪙 320/.test(fin) && eco.balance(gina.id) === gina0 + 220 + 50, `${eco.balance(gina.id) - gina0}`); // +50 for playing
    check('mm: achievements unlocked', /Hanging Judge/.test(fin) && mm.stats(bob.id).achievements.includes('hanging_judge'), fin.split('Achievements')[1]?.slice(0, 200));
    await until(() => !mm.games.has(h.channel.id) && !party.channelGame(h.channel), 3000);
    check('mm: locks released after the game', !party.playingIn(alice.id) && !party.channelGame(h.channel));
    r = await say(alice, '!mm top');
    check('mm: leaderboard', /Mystery leaderboard/.test(r) && /alice/.test(r), r);
    r = await say(bob, '!mm stats');
    check('mm: stats show achievements', /Hanging Judge/.test(r), r);

    // Game B: quick mode, medium talks to the dead, spectator bet refunded when the host stops the game.
    const four = [alice, bob, carol, dave];
    await say(alice, '!mm');
    for (const u of four.slice(1)) await say(u, '!mm join');
    const g2 = mm.games.get(h.channel.id);
    r = await say(alice, '!mm mode quick');
    check('mm: mode set in the lobby', /Mode set to \*\*quick/.test(r) && g2.mode === 'quick', r);
    g2.forceRoles = ['murderer', 'medium', 'guest', 'guest'];
    await say(alice, '!mm start');
    for (const u of four) await dmTo(u, 'ready');
    await until(() => g2.phase === 'night', 5000);
    await dmTo(alice, `kill ${carol.username}`);
    await until(() => g2.phase === 'day', 5000);
    const frank0 = eco.balance(frank.id);
    r = await say(frank, '!mm bet alice 50');
    check('mm: spectators can bet', /bets 🪙 50/.test(r) && eco.balance(frank.id) === frank0 - 50, r);
    await say(alice, '!mm skip');
    await until(() => g2.phase === 'vote', 3000);
    for (const u of [alice, bob, dave]) await say(u, '!vote skip');
    await until(() => g2.phase === 'night', 5000);
    await dmTo(bob, 'who did this to you?');
    check('mm: medium reaches the dead', /A medium reaches across:\*\* who did this to you\?/.test(lastDM(carol)), lastDM(carol));
    await dmTo(carol, 'it was alice!!');
    check('mm: the dead answer the medium', /👻 \*\*.+\*\* \(carol, Guest\): it was alice!!/.test(lastDM(bob)), lastDM(bob));
    await say(alice, '!mm stop');
    await until(() => !mm.games.has(h.channel.id), 3000);
    check('mm: unsettled bets refunded when stopped', eco.balance(frank.id) === frank0, `${eco.balance(frank.id) - frank0}`);
    Object.assign(process.env, saved);
  }
};
