// Supervisor for `npm start`: runs Deed and restarts it in place when it exits with code 75
// (the terminal console's /restart, or `kill -USR2 <pid>`). Any other exit code ends everything.
// Keeping the restart in the same terminal tab means you keep typing in the same window.
const { spawn } = require('child_process');
const path = require('path');

const entry = process.env.DEED_ENTRY || path.join(__dirname, '..', 'index.js');
const RESTART_CODE = 75;
let child = null;
let stopping = false;

function run() {
  child = spawn(process.execPath, [entry], { stdio: 'inherit', env: { ...process.env, DEED_SUPERVISED: '1' } });
  child.on('exit', (code, signal) => {
    child = null;
    if (code === RESTART_CODE && !stopping) {
      console.log('↻ Restarting Deed…');
      return setTimeout(run, 1000);
    }
    process.exit(code ?? (signal ? 1 : 0));
  });
}

// Ctrl+C reaches both processes: let Deed shut itself down cleanly, then follow it out.
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; child?.kill('SIGTERM'); });
run();
