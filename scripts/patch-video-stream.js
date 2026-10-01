// Fix for @dank074/discord-video-stream on macOS: it binds ffmpeg's volume-control (ZMQ) socket to a random
// 127.x.x.x address, which works on Linux (all of 127/8 is loopback) but not on macOS, where only 127.0.0.1
// exists. There, ffmpeg fails with "Could not bind ZMQ socket ... Can't assign requested address".
// This rewrites it to 127.0.0.1 with a random port. Runs automatically after `npm install` (postinstall).
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'node_modules', '@dank074', 'discord-video-stream', 'dist', 'media', 'newApi.js');
if (!fs.existsSync(file)) process.exit(0);
let src = fs.readFileSync(file, 'utf8');
if (src.includes('/* deed-macos-zmq-patch */')) process.exit(0);

const before = 'const zmqEndpoint = `tcp://${loopbackIp}:42069`;';
if (!src.includes(before)) {
  console.warn('[patch-video-stream] library changed; skipping macOS ZMQ patch (check streaming still works)');
  process.exit(0);
}
src = src.replace(before, '/* deed-macos-zmq-patch */ const zmqEndpoint = process.platform === "darwin" ? `tcp://127.0.0.1:${randomInclusive(40000, 60000)}` : `tcp://${loopbackIp}:42069`;');
fs.writeFileSync(file, src);
console.log('[patch-video-stream] applied macOS ZMQ loopback fix');
