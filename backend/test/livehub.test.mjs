// Live push for Trip Planner boards (src/livehub.js, LIVE_PUSH): one LiveHub object per stop and mode sends its phones
// the board the HTTP path serves, on connect and when it changes; socket limits per address and per object, renewal
// after 10 minutes, the route between the hub and the board shards. Runs offline: every data call is refused.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\n" +
  fs.readFileSync(root + "src/engine.js", "utf8").replace(/\nexport \{ BoardEngine[^}]*\};\s*$/, "\n") + "\n" +
  fs.readFileSync(root + "src/livehub.js", "utf8").replace(/\nexport \{ LiveHub \};\s*$/, "\n") +
  "\nexport { __default, LiveHub, liveLimit, liveSweep, liveSig, liveHubWanted, edgeKey };\n";
const tmp = `/tmp/livehub-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

let upstream = 0;
globalThis.fetch = async () => { upstream++; return new Response('{"ErrorDetails":{"Message":"Your API quota or rate limit has been exceeded"}}', { status: 429 }); };
const edge = new Map();
globalThis.caches = { default: { match: async (req) => { const r = edge.get(String(req.url || req)); return r ? r.clone() : undefined; }, put: async (req, res) => { edge.set(String(req.url || req), res); }, delete: async () => true } };
// Node's Response refuses status 101; the worker's upgrade answers are kept as they are.
const R0 = globalThis.Response;
globalThis.Response = class extends R0 {
  constructor(body, init = {}) {
    super(body, init && init.status === 101 ? { ...init, status: 200 } : init);
    if (init && init.status === 101) { Object.defineProperty(this, "status", { value: 101 }); this.webSocket = init.webSocket; }
  }
};
class FakeSocket {
  constructor() { this.sent = []; this.closed = null; this.att = null; }
  send(m) { if (this.closed) throw new Error("closed"); this.sent.push(m); }
  close(code) { this.closed = code; }
  serializeAttachment(a) { this.att = a; }
  deserializeAttachment() { return this.att; }
}
globalThis.WebSocketPair = class { constructor() { this[0] = new FakeSocket(); this[1] = new FakeSocket(); } };
function fakeState() {
  const socks = [], data = new Map();
  return {
    socks, alarm: null,
    acceptWebSocket(ws, tags) { socks.push({ ws, tags }); },
    getWebSockets(tag) { return socks.filter((s) => !s.ws.closed && (!tag || s.tags.includes(tag))).map((s) => s.ws); },
    getTags(ws) { const s = socks.find((x) => x.ws === ws); return s ? s.tags : []; },
    waitUntil() {},
    storage: { async put(k, v) { data.set(k, v); }, async get(k) { return data.get(k); }, async setAlarm(t) { this.owner.alarm = t; } },
  };
}
const stmt = (q, args = []) => ({ bind: (...a) => stmt(q, a), run: async () => ({ meta: { changes: 0 } }), all: async () => ({ results: [] }), first: async () => null });
const env = { TFNSW_API_KEY: "t", API_HOST: "api.transportsydney.app", LIVE_PUSH: "on", DB: { prepare: (q) => stmt(q), batch: async (l) => l.map(() => ({})) } };
const soon = (m) => new Date(Date.now() + m * 60000).toISOString();
const boardBody = (delay) => JSON.stringify({ kind: "departures", now: Date.now(), stop: { id: "200060", name: "Central Station" }, modes: ["train"], alerts: [],
  items: [{ mode: "train", line: "T1", dest: "Hornsby", planned: soon(5), estimated: soon(5 + delay), realtime: true, delayMin: delay, stopId: "2000336", tripId: "A", liveAt: Date.now() - 4000 }] });
function putCopy(stop, body, age) {
  const key = W.edgeKey(new URL("https://api.transportsydney.app/api/departures?stop=" + stop + "&refresh=1"));
  edge.set(key.url, new Response(body, { headers: { "content-type": "application/json", "x-stored-at": String(Date.now() - age) } }));
}
function hub() { const st = fakeState(); st.storage.owner = st; return { st, h: new W.LiveHub(st, env) }; }
const open = (h, ip = "10.1.0.1", stop = "200060") => h.fetch(new Request("https://live/ws?stop=" + stop + "&mode=", { headers: { upgrade: "websocket", "cf-connecting-ip": ip } }));

test("a phone gets the board the HTTP path has, with when it was made, and no data call", async () => {
  putCopy("200060", boardBody(2), 1000);
  const n = upstream;
  const { st, h } = hub();
  const r = await open(h);
  assert.equal(r.status, 101);
  assert.equal(upstream, n, "the copy under 5 s old served it");
  const ws = st.socks[0].ws;
  const m = JSON.parse(ws.sent[0]);
  assert.equal(m.type, "board");
  assert.equal(m.board.items[0].delayMin, 2);
  assert.ok(m.board.dataAt <= Date.now() - 900, "dataAt is the copy's time");
  assert.ok(m.board.items[0].liveAt, "rows keep liveAt");
  assert.ok(st.alarm >= Date.now() + 13000 && st.alarm <= Date.now() + 16000, "next ask just after the copy is 15 s old");
});

test("a changed board goes to every phone; the same rows at a new moment go to nobody", async () => {
  const body1 = boardBody(1);
  putCopy("200061", body1, 500);
  const { st, h } = hub();
  await open(h, "10.1.0.2", "200061");
  await open(h, "10.1.0.3", "200061");
  const [a, b] = st.socks.map((s) => s.ws);
  assert.equal(a.sent.length, 1); assert.equal(b.sent.length, 1);
  const same = JSON.parse(body1); same.now += 5000;
  assert.equal(h.publish({ body: JSON.stringify(same), at: Date.now() }), 0);
  assert.equal(h.publish({ body: boardBody(3), at: Date.now() }), 2);
  assert.equal(JSON.parse(a.sent.at(-1)).board.items[0].delayMin, 3);
  assert.equal(b.sent.length, 2);
});

test("limits: 4 sockets per address on a stop, then 429; another address still gets one", async () => {
  putCopy("200062", boardBody(0), 500);
  const { h } = hub();
  for (let i = 0; i < 4; i++) assert.equal((await open(h, "10.2.0.1", "200062")).status, 101);
  const r = await open(h, "10.2.0.1", "200062");
  assert.equal(r.status, 429);
  assert.match((await r.json()).error, /Too many live connections/);
  assert.equal((await open(h, "10.2.0.2", "200062")).status, 101);
  const st = fakeState();
  for (let i = 0; i < 3; i++) st.acceptWebSocket(new FakeSocket(), ["ip:10.3.0." + i]);
  assert.equal(W.liveLimit(st, new Request("https://x", { headers: { "cf-connecting-ip": "10.3.0.9" } }), { total: 3 }).res.status, 503);
});

test("a socket open over 10 minutes is closed for renewal; a newer one stays", () => {
  const st = fakeState();
  const old = new FakeSocket(), young = new FakeSocket();
  old.att = { at: Date.now() - 11 * 60000 }; young.att = { at: Date.now() - 60000 };
  st.acceptWebSocket(old, ["ip:a"]); st.acceptWebSocket(young, ["ip:b"]);
  assert.equal(W.liveSweep(st), 1);
  assert.equal(old.closed, 4000);
  assert.equal(young.closed, null);
});

test("with nobody left on the stop the alarm asks for nothing and sets no next alarm", async () => {
  const { st, h } = hub();
  await st.storage.put("stop", { stop: "200063", mode: "" });
  st.alarm = null;
  const n = upstream;
  await h.alarm();
  assert.equal(upstream, n);
  assert.equal(st.alarm, null);
});

test("no copy and the Trip Planner refused: no socket (the phone polls), one shared call for two hubs", async () => {
  let n = upstream;
  const z = hub();
  assert.equal((await open(z.h, "10.4.0.3", "200066")).status, 503);
  const one = upstream - n;
  n = upstream;
  const x = hub(), y = hub();
  const [r1, r2] = await Promise.all([open(x.h, "10.4.0.1", "200064"), open(y.h, "10.4.0.2", "200064")]);
  assert.equal(r1.status, 503); assert.equal(r2.status, 503);
  assert.ok(upstream - n <= one, "two hubs on one stop cost what one does (" + one + " calls)");
});

test("full is answered at most once in 10 s per socket", async () => {
  putCopy("200065", boardBody(0), 500);
  const { st, h } = hub();
  await open(h, "10.5.0.1", "200065");
  const ws = st.socks[0].ws;
  await h.webSocketMessage(ws, "full");
  await h.webSocketMessage(ws, "full");
  assert.equal(ws.sent.length, 2, "connect board plus one full");
});

test("route: LIVE_PUSH off or no LIVE binding goes to the shards' socket; on goes to the hub unless the engine pushes the stop", () => {
  const u = new URL("https://api.transportsydney.app/api/live?stop=200060");
  assert.equal(W.liveHubWanted({ LIVE_PUSH: "off", LIVE: {} }, u), false);
  assert.equal(W.liveHubWanted({ LIVE_PUSH: "on" }, u), false);
  assert.equal(W.liveHubWanted({ LIVE_PUSH: "on", LIVE: {} }, u), true);
  assert.equal(W.liveHubWanted({ LIVE_PUSH: "on", LIVE: {}, ENGINE_PUSH: "on", ENGINE_BOARDS: "on", ENGINE: {} }, u), false);
  assert.equal(W.liveHubWanted({ LIVE_PUSH: "on", LIVE: {}, ENGINE_PUSH: "on", ENGINE_BOARDS: "off", ENGINE: {} }, u), true);
});

test("/api/live: 404 with both pushes off, 30 opens a minute per address", async () => {
  const call = (ip) => W.__default.fetch(new Request("https://api.transportsydney.app/api/live?stop=200060", { headers: { upgrade: "websocket", "cf-connecting-ip": ip } }), { ...env, LIVE_PUSH: "off" }, { waitUntil() {} });
  assert.equal((await call("10.6.0.1")).status, 404);
  let last = null;
  for (let i = 0; i < 30; i++) last = await call("10.6.0.2");
  assert.equal(last.status, 404);
  assert.equal((await call("10.6.0.2")).status, 429);
});

test("the shards share the limits and renewal, and their board keys skip the address tag", () => {
  const e = fs.readFileSync(root + "src/engine.js", "utf8");
  assert.match(e, /liveLimit\(this\.state, req\)/);
  assert.match(e, /liveSweep\(this\.state, t0\)/);
  assert.match(e, /filter\(\(x\) => !x\.startsWith\("ip:"\)\)/);
  const b = fs.readFileSync(root + "build.mjs", "utf8");
  assert.match(b, /src\/livehub\.js/);
  const t = fs.readFileSync(root + "wrangler.toml.template", "utf8");
  assert.match(t, /LIVE_PUSH = "off"/);
  assert.match(t, /class_name = "LiveHub"/);
  assert.match(t, /tag = "live-v1"\nnew_sqlite_classes = \["LiveHub"\]/);
});
