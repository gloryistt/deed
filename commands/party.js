// Group party games. Each game lives in lib/games/; shared lobby / DM plumbing is in lib/party.js.
module.exports = [
  require('../lib/games/spyfall'),
  require('../lib/games/codenames'),
  require('../lib/games/blanks'),
  require('../lib/games/liarsdice'),
  require('../lib/games/poker'),
  require('../lib/games/heist'),
];
