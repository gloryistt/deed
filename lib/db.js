// JSON-file store. Writes go to a temp file then rename, so a crash mid-save can't corrupt it.
const fs = require('fs');
const path = require('path');

const FILE = process.env.DEED_DB || path.join(__dirname, '..', 'data', 'db.json');
const data = { users: {}, afk: {}, timezones: {}, reminders: [], stats: { commands: 0 } };

try {
  Object.assign(data, JSON.parse(fs.readFileSync(FILE, 'utf8')));
} catch (err) {
  if (err.code !== 'ENOENT') {
    // Don't silently wipe a damaged file: keep a copy to recover from.
    const backup = `${FILE}.broken-${Date.now()}`;
    fs.copyFileSync(FILE, backup);
    console.error(`db.json was unreadable, backed up to ${backup}`);
  }
}

function flush() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, FILE);
}

function safeFlush() {
  try {
    flush();
  } catch (err) {
    console.error(`⚠️  Couldn't save data (${err.message}). Will retry on the next change.`);
  }
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(safeFlush, 500);
}

function flushNow() {
  clearTimeout(saveTimer);
  flush();
}

module.exports = { data, save, flushNow };
