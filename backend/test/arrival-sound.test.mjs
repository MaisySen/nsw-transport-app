// The arrival clip (1 Nov, build 212): iPhone build 212 (runtime 1.3.0) bundles arrival.wav, Kylie saying "You've arrived
// at your stop." The trip flow's arrival alert, and the trip card push that carries it, name that sound only for a watch
// that build 212 or later started (the build comes from the app's User-Agent, which the app never sets itself, so iOS
// sends "<name>/<build> CFNetwork/<v> Darwin/<v>"). Build 211 and older, Android and a body that claims a build keep the
// default sound, because they do not have the file. The heads-up and Get off now clips are unchanged. No NSW call.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

const root = new URL("..", import.meta.url).pathname;
const raw = fs.readFileSync(root + "src/worker.js", "utf8");
const src = raw.replace(/export default\s*\{/, "const __default = {")
  + "\nconst __has = (n) => { try { return eval(n); } catch { return undefined; } };\n"
  + "export const X = { reqLine, createWatch, tfSendAlert, sendApnsAlert, expoSound, serverCfg, iosBuildOf: __has('iosBuildOf'), tfSound: __has('tfSound') };\n";
const tmp = `/tmp/arrival-sound-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const { X } = await import(tmp); fs.unlinkSync(tmp);

const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" });
const BUNDLE = ["com", "maisy" + "sen", "nswtransport"].join(".");
const TOKEN = "4d944fb2d231498b310dba1fe400a7171683e0bf9defff14228de63856464c2a";
const DEVICE = "app11493p230x136d1h241h5b6r";

const apple = [];
let nsw = 0;
globalThis.fetch = async (u, init) => {
  u = String(u);
  if (u.startsWith("https://api.push.apple.com/")) { apple.push(JSON.parse(init.body)); return new Response("", { status: 200, headers: { "apns-id": "x" } }); }
  if (u.startsWith("https://exp.host/")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
  nsw++;
  return new Response("{}", { status: 503 });
};

function fakeDB({ flags = { apnsAlerts: true } } = {}) {
  const inserts = [];
  let id = 300;
  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a),
    run: async () => {
      if (/INSERT INTO watches/.test(q)) inserts.push(args);
      if (/INSERT OR IGNORE INTO watch_sent/.test(q)) return { meta: { changes: 1 } };
      return { meta: { changes: 1, last_row_id: ++id } };
    },
    all: async () => {
      if (/FROM apns_devices WHERE device/.test(q)) return { results: /COUNT/.test(q) ? [{ n: 1 }] : [{ token: TOKEN }] };
      return { results: [] };
    },
    first: async () => (/FROM app_config WHERE platform = 'server'/.test(q) && flags ? { body: JSON.stringify({ flags }) } : null),
  });
  return { inserts, DB: { prepare: (q) => stmt(q), batch: async (l) => l.map(() => ({ meta: { changes: 1 } })) } };
}
const envOf = (f) => ({ TFNSW_API_KEY: "t", DB: f.DB, APNS_KEY: PEM, APNS_BUNDLE: BUNDLE });
const ua = (s) => ({ headers: new Headers(s == null ? {} : { "user-agent": s }) });

const AT = Date.parse("2026-11-01T07:59:00+11:00");
const ring = (kind, clip) => ({ kind, clip, title: kind === "arrived" ? "Arrived at Clyde" : "Get off now", body: "x", moment: `${kind}:0`, level: "normal", expires: AT + 120000, arrAt: AT });
const watchOf = (spec) => ({ id: "Wq1arrival1", device: DEVICE, spec: JSON.stringify({ legs: [], tripFlow: 2, ...spec }) });

async function soundFor(spec, kind, clip) {
  X.serverCfg.at = 0;
  apple.length = 0;
  const f = fakeDB();
  const s = await X.tfSendAlert(envOf(f), watchOf(spec), ring(kind, clip), AT);
  assert.equal(apple.length, 1, "one alert straight to Apple");
  return { aps: apple[0].aps.sound, said: s.sound };
}

test("the build comes from the iPhone's own User-Agent, and only from there", () => {
  assert.equal(typeof X.iosBuildOf, "function", "iosBuildOf exists");
  assert.equal(X.iosBuildOf(ua("Transport/212 CFNetwork/3826.500.131 Darwin/24.5.0")), 212);
  assert.equal(X.iosBuildOf(ua("Transport/211 CFNetwork/3826.500.131 Darwin/24.5.0")), 211);
  assert.equal(X.iosBuildOf(ua("Transport%20Sydney/213 CFNetwork/1568.100.1 Darwin/24.0.0")), 213);
  assert.equal(X.iosBuildOf(ua("okhttp/4.12.0")), null, "Android");
  assert.equal(X.iosBuildOf(ua("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15")), null, "a browser");
  assert.equal(X.iosBuildOf(ua("Transport/1.0.0 CFNetwork/3826.500.131 Darwin/24.5.0")), null, "a version, not a build");
  assert.equal(X.iosBuildOf(ua(null)), null);
});

test("Start trip stores the build from the User-Agent, never from the body", async () => {
  const leg = { mode: "train", line: "T1", tripId: "1", stopId: "2000001", toStopId: "2000002", planned: new Date(AT - 600000).toISOString(), arrPlanned: new Date(AT).toISOString() };
  for (const [meta, want] of [[{ iosBuild: 212 }, 212], [{ iosBuild: 211 }, 211], [{ iosBuild: null }, undefined], [{}, undefined]]) {
    const f = fakeDB({ flags: {} });
    try { await X.createWatch(envOf(f), { device: DEVICE, kind: "trip", legs: [leg], track: true, tripFlow: 2, iosBuild: 999 }, AT - 900000, meta); } catch {}
    assert.equal(f.inserts.length, 1, "the watch row is written");
    assert.equal(JSON.parse(f.inserts[0][5]).iosBuild, want, JSON.stringify(meta));
  }
});

test("build 212 and later: the arrival alert rings with arrival.wav", async () => {
  assert.deepEqual(await soundFor({ iosBuild: 212 }, "arrived", "arrived"), { aps: "arrival.wav", said: "arrival" });
  assert.deepEqual(await soundFor({ iosBuild: 230 }, "arrived", "arrived"), { aps: "arrival.wav", said: "arrival" });
});

test("build 211 and older, Android and an unknown build keep the default sound for arrival", async () => {
  for (const spec of [{ iosBuild: 211 }, { iosBuild: 205 }, {}, { iosBuild: "212" }]) {
    assert.deepEqual(await soundFor(spec, "arrived", "arrived"), { aps: "default", said: "default" }, JSON.stringify(spec));
  }
});

test("heads-up and Get off now keep their clips on every build; a change (no clip) keeps the default", async () => {
  for (const spec of [{ iosBuild: 212 }, { iosBuild: 211 }, {}]) {
    assert.equal((await soundFor(spec, "headsup", "headsup")).aps, "getoff_soon.wav");
    assert.equal((await soundFor(spec, "getoff", "getoff")).aps, "getoff_now.wav");
    assert.equal((await soundFor(spec, "arrived", null)).aps, "default");
  }
});

test("both allowed-sound lists take arrival; Android gets no arrival channel", async () => {
  assert.deepEqual(X.expoSound({ sound: "arrival" }), { sound: "arrival.wav", channelId: "default" });
  assert.deepEqual(X.expoSound({ sound: "getoff_now" }), { sound: "getoff_now.wav", channelId: "getoff_now" });
  assert.deepEqual(X.expoSound({ sound: "nope" }), { sound: "default", channelId: "default" });
  X.serverCfg.at = 0; apple.length = 0;
  await X.sendApnsAlert(envOf(fakeDB()), { device: DEVICE }, { title: "Arrived at Clyde", body: "x", sound: "arrival" });
  assert.equal(apple[0].aps.sound, "arrival.wav");
  apple.length = 0;
  await X.sendApnsAlert(envOf(fakeDB()), { device: DEVICE }, { title: "x", body: "x", sound: "nope" });
  assert.equal(apple[0].aps.sound, "default");
  assert.equal(nsw, 0, "no NSW call");
});

test("the request log line carries the iPhone build (ib) so the logs show the User-Agent reads as expected", () => {
  const r = (h) => new Request("https://api.example/api/status", { headers: h });
  assert.equal(X.reqLine(r({ "user-agent": "Transport/212 CFNetwork/3826.500.131 Darwin/24.5.0" }), {}, null, 5, { up: 0, n: 0 }).ib, 212);
  assert.equal("ib" in X.reqLine(r({ "user-agent": "okhttp/4.12.0" }), {}, null, 5, { up: 0, n: 0 }), false);
});
