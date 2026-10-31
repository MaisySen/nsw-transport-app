// Spoken alert sounds on server pushes (30 Oct, Bidur, build 209: the get off alert came as a banner and was not
// spoken with the phone locked). Build 210 and later has getoff_now.wav and getoff_soon.wav in the app and, with
// Speak alerts on, starts its trip watch with voice: "soon"; that watch's "Next stop" and "Arriving" alerts then ring
// with getoff_soon.wav (Android: the getoff_soon channel the app made). Every other push, and every older build, keeps
// the default sound and channel, byte for byte as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const raw = fs.readFileSync(root + "src/worker.js", "utf8");
const src = raw.replace(/export default\s*\{/, "const __default = {") + "\nexport { expoSound, voiceSound };\n";
const tmp = `/tmp/getoff-voice-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

test("the default sound and channel unless the app's spoken sound is named", () => {
  assert.deepEqual(W.expoSound({}), { sound: "default", channelId: "default" });
  assert.deepEqual(W.expoSound({ sound: null }), { sound: "default", channelId: "default" });
  assert.deepEqual(W.expoSound({ sound: "anything.caf" }), { sound: "default", channelId: "default" }, "only the app's own sounds");
  assert.deepEqual(W.expoSound({ sound: "getoff_soon" }), { sound: "getoff_soon.wav", channelId: "getoff_soon" });
  assert.deepEqual(W.expoSound({ sound: "getoff_now" }), { sound: "getoff_now.wav", channelId: "getoff_now" });
});

test("only a watch whose app said it has the sounds gets one", () => {
  assert.equal(W.voiceSound({ voice: "soon" }), "getoff_soon");
  assert.equal(W.voiceSound({}), null, "builds 201 to 209 never send voice");
  assert.equal(W.voiceSound({ voice: true }), null);
  assert.equal(W.voiceSound(null), null);
});

test("the wiring: stored from the request, carried on the arrival alerts only, into the Expo message", () => {
  assert.match(raw, /\.\.\.\(b\.voice === "soon" \? \{ voice: "soon" \} : \{\}\)/);
  const arrivals = raw.match(/tagSuffix: "a", once: `arr:\$\{i\}`, sound: voiceSound\(spec\)/g) || [];
  assert.equal(arrivals.length, 4, "Next stop and Arriving, last leg and change");
  assert.equal((raw.match(/sound: voiceSound\(spec\)/g) || []).length, 4, "no other alert speaks");
  assert.match(raw, /watchId: w\.id, \.\.\.\(extra\.sound \? \{ sound: extra\.sound \} : \{\}\)/);
  // A passive note of the new trip flow has no sound; every other alert keeps expoSound.
  assert.match(raw, /to: t\.token, title: n\.title, body: n\.body, \.\.\.\(n\.passive \? \{ sound: null, channelId: "default", interruptionLevel: "passive" \} : expoSound\(n\)\), priority: n\.passive \? "normal" : "high",/);
  assert.doesNotMatch(raw, /sound: "default", priority: "high", channelId: "default"/);
});
