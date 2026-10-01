// Provably fair RNG, the same idea Stake uses:
//   - a random server seed is picked before the round; players see its SHA-256 hash
//   - every random number comes from HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}:${round}`)
//   - the seed is revealed afterwards, so anyone can re-run the math and check the result
const crypto = require('crypto');

function createRound(clientSeed) {
  const serverSeed = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(serverSeed).digest('hex');
  const nonce = Date.now();
  let round = 0;
  let buffer = Buffer.alloc(0);

  // Next float in [0, 1), built from 4 bytes of HMAC output (like Stake's byte-to-float scheme).
  function float() {
    if (buffer.length < 4) {
      buffer = crypto.createHmac('sha256', serverSeed).update(`${clientSeed}:${nonce}:${round++}`).digest();
    }
    const [a, b, c, d] = buffer;
    buffer = buffer.subarray(4);
    return a / 256 + b / 256 ** 2 + c / 256 ** 3 + d / 256 ** 4;
  }

  const int = (min, max) => min + Math.floor(float() * (max - min + 1));

  // k distinct positions out of n (Fisher–Yates on the fair floats).
  function sample(n, k) {
    const pool = [...Array(n).keys()];
    for (let i = 0; i < k; i++) {
      const j = i + Math.floor(float() * (n - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, k);
  }

  return {
    float, int, sample, hash, nonce, clientSeed,
    reveal: () => serverSeed,
    // Footer text: hash before the round, seed after it.
    footer: (done = false) => (done
      ? `🔓 seed ${serverSeed.slice(0, 16)}… · nonce ${nonce}`
      : `🔒 provably fair · hash ${hash.slice(0, 16)}…`),
  };
}

module.exports = { createRound };
