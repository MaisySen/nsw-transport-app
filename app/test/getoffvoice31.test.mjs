// The owner's chosen get off voice (31 Oct). Bidur turned down the first clips ("This is bad. Be soft female") and a
// second round ("not aussie"), then picked round 3's voice 3, Kylie, a warm, gentle Australian woman ("This is good").
// These pin the two bundled alert sounds to his pick and the words they say, so a later swap is a deliberate change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIPS = {
  getoff_soon: { words: 'Your stop is coming up. Please get ready to get off at the next stop.', min: 4, max: 6.5,
    sha256: '2ebdc8140aa89399aede0ddc2f928f8507c6b0a717ed6da125e1e5542855ed1c' },
  getoff_now: { words: 'Please get off at the next stop.', min: 2, max: 4,
    sha256: 'ad898f45035cbedcf1f83f25d368f789fe92802d65f47d40b84db6f243bfa2df' },
};

function wav(b) {
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  assert.equal(b.toString('ascii', 8, 12), 'WAVE');
  const fmtAt = b.indexOf('fmt ');
  const dataAt = b.indexOf('data');
  const f = { tag: b.readUInt16LE(fmtAt + 8), channels: b.readUInt16LE(fmtAt + 10), rate: b.readUInt32LE(fmtAt + 12), bits: b.readUInt16LE(fmtAt + 22) };
  return { ...f, secs: b.readUInt32LE(dataAt + 4) / (f.rate * f.channels * f.bits / 8) };
}

test('the bundled get off sounds are the voice Bidur picked (Kylie, 31 Oct), in a format both phones play', () => {
  for (const [name, c] of Object.entries(CLIPS)) {
    const b = fs.readFileSync(path.join(root, 'assets', 'sounds', `${name}.wav`));
    assert.equal(crypto.createHash('sha256').update(b).digest('hex'), c.sha256, `${name}.wav is the chosen clip`);
    const w = wav(b);
    assert.deepEqual([w.tag, w.channels, w.rate, w.bits], [1, 1, 44100, 16], `${name}: 16 bit mono linear PCM, 44.1 kHz`);
    assert.ok(w.secs > c.min && w.secs < c.max, `${name} is ${w.secs.toFixed(2)} s (alert sounds must be under 30 s)`);
    assert.match(name, /^[a-z][a-z0-9_]*$/, 'valid Android raw resource name');
  }
});

test('the words the app says the clips speak match what the clips say', () => {
  const core = fs.readFileSync(path.join(root, 'src', 'lib', 'getOffCore.ts'), 'utf8');
  for (const [name, c] of Object.entries(CLIPS)) assert.ok(core.includes(`${name}: '${c.words}'`), name);
  assert.ok(!core.includes('Get off at the next stop. Get off at the next stop.'), 'old twice said words gone');
});
