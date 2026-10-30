// Stop lists from the timetable run (26 Oct 2026, g24): raptor.js rpRun follows a trip through the trips that carry
// on the same vehicle's run (tripNext, built from the GTFS block by tools/build_planner.py), and the service screen
// takes its stop list from it with the feed's live times laid on. Also the outage fallback for a trip that ends at a
// service's last stop, answered by our own planner. Runs offline on a small cut of the 23 Oct NSW GTFS bundle
// (test/fixtures/gtfs-runs: trains on several lines, a ferry, light rail, metro and buses).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\n" +
  fs.readFileSync(root + "src/engine.js", "utf8").replace(/\nexport \{ BoardEngine[^}]*\};\s*$/, "\n") + "\n" +
  fs.readFileSync(root + "src/ttplan.js", "utf8") + "\n" +
  fs.readFileSync(root + "src/raptor.js", "utf8").replace(/\nexport \{ TripPlanner \};\s*$/, "\n") +
  "\nexport { __default, rpOpen, rpRun, TripPlanner, runStops, runDest, ownRun, ownTimetableTrip };\n";
const tmp = `/tmp/service-runs-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

// The pack, built by the real tool from the fixture bundle.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "g24-runs-"));
const packFile = path.join(dir, "pack.bin");
execFileSync("python3", [root + "tools/build_planner.py", root + "test/fixtures/gtfs-runs", packFile, "20261026"], { stdio: "pipe" });
const bin = new Uint8Array(fs.readFileSync(packFile));
fs.rmSync(dir, { recursive: true, force: true });
const pk = W.rpOpen(bin);
const DAY = pk.dayStart;
const at = (hhmm) => Number(hhmm.slice(0, 2)) * 3600 + Number(hhmm.slice(2)) * 60;
const names = (r) => r.stops.map((s) => s.name.replace(/ Station$/, ""));

test("the pack carries tripNext: a split train run is linked, a bus or a ferry is not", () => {
  assert.ok(pk.tripNext && pk.tripNext.length === pk.T);
  const linked = [...pk.tripNext].filter((x) => x >= 0).length;
  assert.ok(linked >= 4, "split train runs linked: " + linked);
  const i = pk.tripId.find("ML0850-OUT-WD.261026.1.0850")[0];
  assert.equal(pk.tripNext[i], -1);
});

test("a T9 to Hornsby via Central from Gordon runs on past Central to Hornsby (two trip ids, one train)", () => {
  const r = W.rpRun(pk, { trip: "206E.1324.165.4.H.8.92003872", stop: "207210" });
  assert.equal(r.reached, true);
  assert.equal(r.trips.length, 2);
  const n = names(r);
  assert.equal(n[r.mine], "Gordon");
  assert.equal(n[n.length - 1], "Hornsby");
  assert.ok(n.includes("Central") && n.includes("Chatswood"));
  // The station where one trip hands over to the next is listed once.
  assert.equal(n.filter((x) => x === "Central").length, 1);
  // Times only go forward.
  for (let i = 1; i < r.stops.length; i++) assert.ok(r.stops[i].dep >= r.stops[i - 1].dep, n[i]);
});

test("asked from a stop on the second trip, the run reaches back through the first (where the train is now)", () => {
  const r = W.rpRun(pk, { trip: "206F.1324.165.4.H.8.92003365", stop: "213510" });
  assert.equal(r.trips[0], "206E.1324.165.4.H.8.92003872");
  assert.equal(names(r)[r.mine], "Strathfield");
  assert.equal(names(r)[0], "Gordon");
});

test("a T5 to Blacktown keeps every stop of its own trip, Parramatta included", () => {
  const r = W.rpRun(pk, { trip: "564F.1324.165.124.M.8.92004199" });
  const n = names(r);
  assert.equal(n[0], "Leppington");
  assert.equal(n[n.length - 1], "Blacktown");
  assert.ok(n.includes("Parramatta") && n.includes("Harris Park"), n.join(","));
  assert.equal(r.trips.length, 1);
});

test("a T1 via Gordon from Penrith follows the run to Hornsby, and an Emu Plains run is not cut at the wrong station", () => {
  const r = W.rpRun(pk, { trip: "163B.1324.165.12.A.8.92003304" });
  const n = names(r);
  assert.equal(r.reached, true);
  assert.equal(n[0], "Penrith");
  assert.equal(n[n.length - 1], "Hornsby");
  assert.ok(n.includes("Gordon"));
  const e = W.rpRun(pk, { trip: "236E.1324.165.124.H.8.92003080" });
  assert.ok(e.stops.length >= 2);
  // The block carries on as a Schofields run: another destination, so not followed.
  assert.ok(!e.trips.includes("236F.1324.165.124.H.8.92003081") || names(e).includes("Emu Plains"));
});

test("a City Circle run that becomes another service is not followed (reached false: a train keeps the old way)", () => {
  const r = W.rpRun(pk, { trip: "8--F.1324.165.60.B.8.92002110" });
  assert.equal(r.reached, false);
  assert.equal(r.trips.length, 1);
});

test("light rail, metro, bus and ferry trips give their own whole list", () => {
  for (const t of ["50186-85018:1000", "0273-001-001-002:1000", "2151413", "2029052", "2732600", "ML0850-OUT-WD.261026.1.0850"]) {
    const r = W.rpRun(pk, { trip: t });
    assert.ok(r && r.stops.length >= 2 && r.reached, t);
  }
});

test("the instance nearest the asked time, an unknown trip or stop gives null", () => {
  assert.equal(W.rpRun(pk, { trip: "nope" }), null);
  assert.equal(W.rpRun(pk, { trip: "564F.1324.165.124.M.8.92004199", stop: "209573" }), null);
  assert.equal(W.rpRun(pk, { trip: "564F.1324.165.124.M.8.92004199", stop: "no-such-stop" }), null);
});

test("a pack built before tripNext: a split train is not followed and stays reached false, so the screen keeps the old way", () => {
  const old = { ...pk, tripNext: undefined };
  const r = W.rpRun(old, { trip: "206E.1324.165.4.H.8.92003872", stop: "207210" });
  assert.equal(r.trips.length, 1);
  assert.equal(r.reached, false);
  assert.equal(W.rpRun(old, { trip: "564F.1324.165.124.M.8.92004199" }).reached, true);
});

test("runDest: a via station already passed is dropped", () => {
  const stops = [{ name: "Chatswood Station" }, { name: "Rhodes Station" }, { name: "Hornsby Station" }];
  assert.equal(W.runDest("Hornsby via Chatswood", stops, 0), "Hornsby");
  assert.equal(W.runDest("Hornsby via Chatswood", [{ name: "Epping Station" }, ...stops], 0), "Hornsby via Chatswood");
  assert.equal(W.runDest("Blacktown", stops, 0), "Blacktown");
});

test("runStops lays each trip's live feed on its own stops; a changed trip falls back", () => {
  const r = W.rpRun(pk, { trip: "206E.1324.165.4.H.8.92003872", stop: "207210" });
  const [a, b] = r.trips;
  const centralIdx = r.stops.findIndex((s) => /^Central/.test(s.name));
  const firstGordon = r.stops[0];
  const lastStop = r.stops[r.stops.length - 1];
  const tu = {
    [a]: { ts: 1, rel: 0, stus: [{ stopId: firstGordon.id, dep: { delay: 120 } }] },
    [b]: { ts: 1, rel: 0, stus: [{ stopId: lastStop.id, arr: { delay: 300 } }] },
  };
  const st = W.runStops(r, (t) => tu[t], a, true);
  assert.equal(st.length, r.stops.length);
  assert.equal(new Date(st[0].estimated).getTime() - new Date(st[0].planned).getTime(), 120000);
  assert.equal(new Date(st[st.length - 1].estimated).getTime() - new Date(st[st.length - 1].planned).getTime(), 300000);
  assert.ok(centralIdx > 0);
  // The asked trip's feed names a stop the run does not have: null, so the caller keeps the old way.
  const bad = { [a]: { ts: 1, rel: 0, stus: [{ stopId: "999999", dep: { delay: 0 } }] } };
  assert.equal(W.runStops(r, (t) => bad[t], a, true), null);
});

// ---- the planner object, the service screen and the outage fallback ----
function fakeState() {
  const db = new DatabaseSync(":memory:");
  return { storage: { sql: { exec: (q, ...a) => { const st = db.prepare(q); if (/^\s*(SELECT)/i.test(q)) { const rows = st.all(...a.map((x) => (x instanceof ArrayBuffer ? new Uint8Array(x) : x))); return { toArray: () => rows.map((r) => ({ ...r, ...(r.data ? { data: r.data.buffer.slice(r.data.byteOffset, r.data.byteOffset + r.data.byteLength) } : {}) })) }; } st.run(...a.map((x) => (x instanceof ArrayBuffer ? new Uint8Array(x) : x))); return { toArray: () => [] }; } } } };
}
async function loaded() {
  const obj = new W.TripPlanner(fakeState(), {});
  const hl = new DataView(bin.buffer, bin.byteOffset, 8).getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(bin.subarray(8, 8 + hl)));
  const base = 8 + hl;
  const post = (p, body) => obj.fetch(new Request("https://planner" + p, { method: "POST", body }));
  await post("/load/begin?ver=3", "");
  await post("/load/part?ver=3&part=head&i=0", new TextEncoder().encode(JSON.stringify(header)));
  for (const a of header.arrays) {
    const size = a.type === "u8" ? 1 : 4;
    await post(`/load/part?ver=3&part=${a.name}&i=0`, bin.slice(base + a.offset, base + a.offset + a.length * size));
  }
  const c = await (await post("/load/commit?ver=3", "")).json();
  assert.equal(c.ok, true, JSON.stringify(c));
  return obj;
}
const edge = new Map();
globalThis.caches = { default: { match: async (q) => (edge.has(String(q.url || q)) ? new Response(edge.get(String(q.url || q))) : undefined), put: async (q, r) => { edge.set(String(q.url || q), await r.text()); }, delete: async () => true } };

test("the planner object answers /run, and ownRun keeps the answer at the edge", async () => {
  const obj = await loaded();
  let calls = 0;
  const planner = { idFromName: (n) => n, get: () => ({ fetch: (u, init) => { calls++; return obj.fetch(new Request(u, init)); } }) };
  const env = { PLANNER: planner };
  edge.clear();
  const planned = (DAY + at("0801")) * 1000;
  const d = await W.ownRun(env, "206E.1324.165.4.H.8.92003872", "207210", planned);
  assert.ok(d && d.reached && d.stops.length > 20);
  const again = await W.ownRun(env, "206E.1324.165.4.H.8.92003872", "207210", planned);
  assert.equal(again.stops.length, d.stops.length);
  assert.equal(calls, 1, "the second ask is the edge copy");
  assert.equal(await W.ownRun({ ...env, OWN_RUNS: "off" }, "206E.1324.165.4.H.8.92003872", "207210", planned), null);
  assert.equal(await W.ownRun(env, "bad id with spaces", "207210", planned), null);
  const far = await obj.fetch(new Request("https://planner/run?trip=206E.1324.165.4.H.8.92003872&at=" + (DAY + 5 * 86400) * 1000));
  assert.equal((await far.json()).error, "day");
});

test("the service screen takes a T9's stop list from the run, with no Trip Planner search", async () => {
  const obj = await loaded();
  const planner = { idFromName: (n) => n, get: () => ({ fetch: (u, init) => obj.fetch(new Request(u, init)) }) };
  let tpCalls = 0;
  const realFetch = globalThis.fetch;
  // Line alerts (add_info) are asked as before; the stop list makes no trip search.
  globalThis.fetch = async (u) => { if (/\/tp\/trip/.test(String(u.url || u))) tpCalls++; return new Response("{}", { status: 503 }); };
  edge.clear();
  try {
    const planned = new Date((DAY + at("0801")) * 1000).toISOString();
    const qs = new URLSearchParams({ trip: "206E.1324.165.4.H.8.92003872", mode: "train", line: "T9", stop: "207210", planned, dest: "Hornsby via Central", destId: "207310" });
    const res = await W.__default.fetch(new Request("https://api.transportsydney.app/api/service?" + qs), { PLANNER: planner, API_ONLY: "1" }, { waitUntil: () => {} });
    const d = await res.json();
    assert.equal(res.status, 200, JSON.stringify(d).slice(0, 300));
    assert.equal(d.source, "own");
    assert.equal(d.stops[d.mineIndex].name.replace(/ Station$/, ""), "Gordon");
    assert.equal(d.stops[d.stops.length - 1].name.replace(/ Station$/, ""), "Hornsby");
    assert.equal(tpCalls, 0);
  } finally { globalThis.fetch = realFetch; }
});

test("outage fallback: Circular Quay to Manly on the F1 (the service's last stop) is answered from our planner, labelled", async () => {
  const obj = await loaded();
  const planner = { idFromName: (n) => n, get: () => ({ fetch: (u, init) => obj.fetch(new Request(u, init)) }) };
  const d = await W.ownTimetableTrip({ PLANNER: planner }, "200020", "209573", { date: "20261026", time: "0840", count: 3 });
  assert.ok(d && d.journeys.length >= 1, "a journey to the last stop");
  const j = d.journeys[0];
  const t = j.legs.filter((l) => l.kind === "transit");
  assert.equal(t[0].tripId, "ML0850-OUT-WD.261026.1.0850");
  assert.equal(d.source, "timetable");
  assert.equal(t[0].alerts[0].title, d.alerts[0].title);
  assert.equal(t[0].status.key, "scheduled");
  // A trip that leaves out a mode is not answered here.
  assert.equal(await W.ownTimetableTrip({ PLANNER: planner }, "200020", "209573", { date: "20261026", time: "0840", exclude: { ferry: 1 } }), null);
  assert.equal(await W.ownTimetableTrip({}, "200020", "209573", { date: "20261026", time: "0840" }), null);
});
