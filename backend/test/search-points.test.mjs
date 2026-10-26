// Trip history keeps stops, never a position (store/apple/app-privacy.md, 26 Oct, g25): a watched trip that starts
// from where you are ("lon:lat:EPSG:4326") writes no searches row; a stop to stop trip still does.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\nexport { logSearch };\n";
const tmp = `/tmp/search-points-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

function fakeEnv() {
  const writes = [];
  const stmt = (q, args = []) => ({ bind: (...a) => stmt(q, a), run: async () => { if (/INSERT INTO searches/.test(q)) writes.push(args); return { meta: { changes: 1 } }; }, all: async () => ({ results: [] }), first: async () => null });
  return { writes, env: { DB: { prepare: (q) => stmt(q), batch: async (l) => l.map(() => ({ results: [] })) } } };
}

test("a trip from a point is not kept in trip history", async () => {
  const { writes, env } = fakeEnv();
  await W.logSearch(env, { profile: "p1", device: "d1", from: { id: "151.20930:-33.88310:EPSG:4326", name: "Your location" }, to: { id: "200060", name: "Central Station" }, src: "watch" });
  await W.logSearch(env, { profile: "p1", device: "d1", from: { id: "2150106", name: "Parramatta Station" }, to: { id: "150.99:-33.81:EPSG:4326", name: "A point" }, src: "watch" });
  assert.equal(writes.length, 0);
});

test("a stop to stop trip is still kept", async () => {
  const { writes, env } = fakeEnv();
  await W.logSearch(env, { profile: "p1", device: "d1", from: { id: "2150106", name: "Parramatta Station" }, to: { id: "2000338", name: "Wynyard Station" }, src: "watch" });
  assert.equal(writes.length, 1);
  assert.equal(writes[0][5], "2150106");
});
