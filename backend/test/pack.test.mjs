// On phone timetable packs (src/pack.js, docs/TIMETABLE_PACKS.md): one stop's timetable from the board engine's object,
// compact rows, the same lines, headsigns and platforms the engine's boards show, and the /api/pack answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\n" +
  fs.readFileSync(root + "src/engine.js", "utf8").replace(/\nexport \{ BoardEngine[^}]*\};\s*$/, "\n") + "\n" +
  fs.readFileSync(root + "src/pack.js", "utf8") +
  "\nexport { __default, engDayKey, engBuildBoard, BoardEngine, packBuild, packAnswer };\n";
const tmp = `/tmp/pack-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const day = W.engDayKey(Date.now());
const base = Math.floor(new Date(new Date().toLocaleString("en-US", { timeZone: "Australia/Sydney" }).replace(/,.*/, "") + " 00:00").getTime() / 1000);
const nowS = Math.floor(Date.now() / 1000);
const sec = (minFromNow) => nowS + minFromNow * 60 - base;
const meta = { days: { [day]: base }, routes: [["T1", 1, "#F99D1C", "train", "", "North Shore"], ["400", 5, "#00B5EF", "bus", "", "Bondi to Airport"]], heads: ["Hornsby", "Airport"], routeIds: { train: { NSN_1a: 0 }, bus: { "2500_400": 1 } } };
const stops = { P: ["Testville Station", "", "", 0, 0], P1: ["Testville Station Platform 1", "P", "1", 0, 0], P2: ["Testville Station Platform 2", "P", "2", 0, 0], B: ["Testville Station, Stand A", "P", "", 0, 0], Q: ["Quiet Rd", "", "C", 0, 0] };
const rows = {
  P1: [[sec(5), "T-A", 0, 0, 10], [sec(12), "T-B", 0, 0, 10], [sec(40), "T-C", 0, 0, 10]],
  B: [[sec(3), "B-1", 1, 1, 7], [sec(8), "B-2", 1, 1, 7], [sec(-5), "B-late", 1, 1, 7]],
  Q: [[sec(20), "Q-1", 1, 1, 3]],
};

function fakeState() {
  const db = new DatabaseSync(":memory:");
  let alarm = null;
  return {
    storage: {
      sql: { exec(q, ...args) { if (/^\s*(SELECT)/i.test(q)) { const r = db.prepare(q).all(...args); return { toArray: () => r }; } if (args.length) db.prepare(q).run(...args); else db.exec(q); return { toArray: () => [] }; } },
      getAlarm: async () => alarm, setAlarm: async (t) => { alarm = t; },
    },
  };
}
async function loaded() {
  globalThis.fetch = async () => new Response(new Uint8Array(0));
  const E = new W.BoardEngine(fakeState(), { TFNSW_API_KEY: "k" });
  const post = (p, body) => E.fetch(new Request("https://engine" + p, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
  await post("/load/begin", { ...meta, builtAt: "2026-10-26T00:00:00Z" });
  await post("/load/stops", Object.entries(stops).map(([id, s]) => [id, s[0], s[1], s[2], s[3], s[4]]));
  await post("/load/days", Object.entries(rows).map(([s, r]) => JSON.stringify({ s, d: day, r })).join("\n"));
  await post("/load/trips", "");
  const c = await (await post("/load/commit", {})).json();
  assert.equal(c.ver, 1);
  return E;
}
// The phone's reading of a pack (app/src/lib/timetablePackCore.ts does the same).
function decode(p) {
  const out = [];
  let t = p.base;
  for (let i = 0; i < p.rows.length; i += 4) {
    t += p.rows[i];
    const l = p.lines[p.rows[i + 1]], pl = p.plats[p.rows[i + 3]];
    out.push({ planned: t * 1000, line: l[0], mode: l[1], dest: p.heads[p.rows[i + 2]], platform: pl[1], stopId: pl[0] });
  }
  return out;
}

test("a station's pack holds every platform and stand in time order, without trip ids", async () => {
  const E = await loaded();
  const r = await E.fetch(new Request("https://engine/pack?stop=P"));
  assert.equal(r.status, 200);
  const p = await r.json();
  assert.equal(p.v, 1);
  assert.equal(p.stop.name, "Testville Station");
  assert.equal(p.rows.length % 4, 0);
  const d = decode(p);
  assert.equal(d.length, 6);
  for (let i = 1; i < d.length; i++) assert.ok(d[i].planned >= d[i - 1].planned);
  assert.ok(!JSON.stringify(p).includes("T-A"), "no trip ids");
  assert.ok(p.until * 1000 > Date.now());
  const t1 = d.find((x) => x.line === "T1");
  assert.equal(t1.platform, "Platform 1"); assert.equal(t1.dest, "Hornsby"); assert.equal(t1.mode, "train");
  assert.equal(d.find((x) => x.line === "400").platform, "Stand A");
});

test("every timetable row on the engine's board is in the pack at the same minute, line, headsign and platform", async () => {
  const E = await loaded();
  const p = await (await E.fetch(new Request("https://engine/pack?stop=P"))).json();
  const b = await (await E.fetch(new Request("https://engine/board?stop=P"))).json();
  // Boards give planned times in whole minutes as the Trip Planner does; the pack keeps the timetable's seconds.
  const key = (x) => [x.planned - (x.planned % 60000), x.line, x.dest, x.platform].join("|");
  const inPack = new Set(decode(p).map(key));
  assert.ok(b.items.length >= 4);
  for (const it of b.items) assert.ok(inPack.has(key({ ...it, planned: Date.parse(it.planned) })), "missing " + it.tripId);
});

test("a platform's pack is that platform only; a stand code reads Stand; an unknown stop is 404", async () => {
  const E = await loaded();
  const p1 = decode(await (await E.fetch(new Request("https://engine/pack?stop=P1"))).json());
  assert.deepEqual([...new Set(p1.map((x) => x.line))], ["T1"]);
  const q = decode(await (await E.fetch(new Request("https://engine/pack?stop=Q"))).json());
  assert.equal(q[0].platform, "Stand C");
  assert.equal((await E.fetch(new Request("https://engine/pack?stop=nowhere"))).status, 404);
  assert.equal((await E.fetch(new Request("https://engine/pack?stop=a%20b"))).status, 404);
});

test("the object's other paths still work with the pack path added", async () => {
  const E = await loaded();
  assert.equal((await E.fetch(new Request("https://engine/board?stop=P"))).status, 200);
  assert.ok((await (await E.fetch(new Request("https://engine/status"))).json()).ver >= 1);
});

test("an empty object says no timetable (503), so the phone keeps the pack it has", async () => {
  const E = new W.BoardEngine(fakeState(), {});
  assert.equal((await E.fetch(new Request("https://engine/pack?stop=P"))).status, 503);
});

test("/api/pack: 400 without a stop, the pack with cache headers, 404 passed on, other errors 503", async () => {
  const E = await loaded();
  const env = { ENGINE: { idFromName: (n) => n, get: () => ({ fetch: (u, i) => E.fetch(new Request(u, i)) }) } };
  const ctx = { waitUntil() {} };
  const res = (q) => W.packAnswer(env, ctx, new URL("https://api.transportsydney.app/api/pack" + q), {});
  assert.equal((await res("")).status, 400);
  assert.equal((await res("?stop=%3Cx%3E")).status, 400);
  const ok = await res("?stop=P");
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("cache-control"), /max-age=3600/);
  assert.equal(ok.headers.get("access-control-allow-origin"), "*");
  assert.equal(decode(await ok.json()).length, 6);
  assert.equal((await res("?stop=nowhere")).status, 404);
  const down = { ENGINE: { idFromName: (n) => n, get: () => ({ fetch: async () => new Response("x", { status: 500 }) }) } };
  assert.equal((await W.packAnswer(down, ctx, new URL("https://x/api/pack?stop=P"), {})).status, 503);
});
