// CPU of the board engine against the local fake Transport for NSW (tools/fake-nsw.mjs mode "trains"): the core
// object's work per train feed copy (fetch, index, decode, and since g14 the lookup of trips the timetable lacks), a
// board build, and a shard's tick with the copy it gets from the core. Local only: no NSW calls, no Cloudflare.
//   TZ=Australia/Sydney node backend/tools/engine-cpu.mjs [fake port 8798] [trips 1500]
// Runs on Node (same V8 as workerd); a Cloudflare machine can be slower or faster, so read the numbers as an order of size.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { trainNetwork } from "./fake-feed.mjs";

const backend = path.resolve(new URL("..", import.meta.url).pathname);
const port = +(process.argv[2] || 8798), trips = +(process.argv[3] || 1500);
const real = '"https://api.transport.nsw.gov.au"';
let code = fs.readFileSync(path.join(backend, "src/worker.js"), "utf8").replace(/export default\s*\{/, "const __default = {") + "\n" +
  fs.readFileSync(path.join(backend, "src/engine.js"), "utf8").replace(/\nexport \{ BoardEngine, BoardShard \};\s*$/, "\n") +
  "\nexport { BoardEngine, BoardShard };\n";
if (!code.includes(real)) throw new Error("Transport for NSW address not found");
code = code.split(real).join(`"http://127.0.0.1:${port}"`);
const tmp = `/tmp/engine-cpu-${process.pid}.mjs`;
fs.writeFileSync(tmp, code);
const W = await import(tmp); fs.unlinkSync(tmp);

const fake = spawn(process.execPath, [path.join(backend, "tools/fake-nsw.mjs"), String(port)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 600));
const setMode = (q) => fetch(`http://127.0.0.1:${port}/__mode?set=trains&${q}`).then((r) => r.text());

function fakeState() {
  const db = new DatabaseSync(":memory:");
  let alarm = null;
  return { storage: {
    sql: { exec(q, ...args) { if (/^\s*(SELECT)/i.test(q)) { const rows = db.prepare(q).all(...args); return { toArray: () => rows }; } if (args.length) db.prepare(q).run(...args); else db.exec(q); return { toArray: () => [] }; } },
    getAlarm: async () => alarm, setAlarm: async (t) => { alarm = t; },
  } };
}
const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[Math.floor(s.length / 2)].toFixed(2) : null; };
const p95 = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[Math.min(s.length - 1, Math.floor(s.length * 0.95))].toFixed(2) : null; };

async function scenario(name, env, opt) {
  await setMode(new URLSearchParams(Object.entries(opt).map(([k, v]) => [k, String(v)])).toString());
  const net = trainNetwork(opt);
  const E = new W.BoardEngine(fakeState(), { TFNSW_API_KEY: "fake", ENGINE_PER_MIN: "100000", ENGINE_BUDGET: "100000000", ...env });
  const post = (p, body) => E.fetch(new Request("https://engine" + p, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
  await post("/load/begin", net.meta);
  await post("/load/stops", Object.entries(net.stops).map(([id, s]) => [id, ...s]));
  await post("/load/days", Object.entries(net.rows).map(([s, r]) => JSON.stringify({ s, d: net.day, r })).join("\n"));
  await post("/load/trips", net.trips.map((t) => JSON.stringify(t)).join("\n"));
  const c = await (await post("/load/commit", {})).json();
  if (!c.ver) throw new Error("load failed " + JSON.stringify(c));
  const stations = Object.keys(net.stops).filter((s) => !/P\d$/.test(s)).slice(0, 50);
  await Promise.all(stations.map((s) => E.fetch(new Request("https://engine/board?stop=" + s))));
  const f = E.feeds.get("train");
  // Feed copies: each forced copy is a new feed body from the fake (a new header time).
  const copy = [], addMs = [];
  for (let i = 0; i < 12; i++) {
    const c0 = cpu();
    await E.refreshFeedNow("train", f, Date.now(), true, "tu");
    copy.push(cpu() - c0); addMs.push(f.addMs || 0);
  }
  // Board builds (the cache cleared, so each read builds).
  const board = [];
  let rowsShown = 0, unkShown = 0;
  for (let r = 0; r < 3; r++) for (const s of stations) {
    E.boards.clear();
    const c0 = cpu();
    const b = await (await E.fetch(new Request("https://engine/board?stop=" + s))).json();
    board.push(cpu() - c0);
    if (r === 0) { rowsShown += b.items.length; unkShown += b.items.filter((i) => /\.165\.8\./.test(i.tripId)).length; }
  }
  // A shard reading 20 boards, then a tick after a new copy: the core's /live answer size and the shard's CPU.
  let liveBytes = 0;
  const core = { fetch: async (u, init) => { const r = await E.fetch(new Request(u, init)); const t = await r.text(); if (String(u).includes("/live")) liveBytes = Math.max(liveBytes, t.length); return new Response(t, { status: r.status, headers: r.headers }); } };
  const S = new W.BoardShard(fakeState(), { ENGINE: { idFromName: () => "core", get: () => core } });
  for (const s of stations.slice(0, 20)) await S.fetch(new Request("https://engine/board?stop=" + s + "&name=nsw-2-b0"));
  const shardTick = [];
  for (let i = 0; i < 6; i++) {
    await E.refreshFeedNow("train", f, Date.now(), true, "tu");
    const c0 = cpu(); await S.tick(); shardTick.push(cpu() - c0);
  }
  const st = E.status().feeds.train;
  return { name, trips: opt.trips, unknownInFeed: opt.unknown || 0, feedKB: Math.round(net.tu.length / 1024), copyCpuMs: { median: median(copy), p95: p95(copy) }, unknownStepMs: { median: median(addMs), max: Math.max(...addMs) },
    boardCpuMs: { median: median(board), p95: p95(board) }, rowsOn50Boards: rowsShown, unknownRowsOn50Boards: unkShown, shardTickCpuMs: { median: median(shardTick), p95: p95(shardTick) }, liveAnswerKB: Math.round(liveBytes / 1024),
    status: { unknown: st.unknown, unknownListed: st.unknownListed, added: st.added } };
}

const out = [];
try {
  out.push(await scenario("before (ENGINE_ADD_UNKNOWN and ENGINE_EMPTY_LIVE off)", { ENGINE_ADD_UNKNOWN: "off", ENGINE_EMPTY_LIVE: "off" }, { trips, unknown: 30 }));
  out.push(await scenario("after, none unknown", {}, { trips, unknown: 0 }));
  out.push(await scenario("after, 2% unknown", {}, { trips, unknown: Math.round(trips * 0.02) }));
  out.push(await scenario("after, 10% unknown", {}, { trips, unknown: Math.round(trips * 0.1) }));
  out.push(await scenario("after, 60% unknown (guard: none listed)", {}, { trips, unknown: Math.round(trips * 0.6) }));
} finally { fake.kill(); }
console.log(JSON.stringify(out, null, 1));
