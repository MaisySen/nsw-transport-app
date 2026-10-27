// Network pass (27 Oct, 9 PM): poll-tags (a content tag with the server clock left out, and a 304 with x-now for the
// newer app), board rows without the fields the app never reads, and an hour of phone caching on stop and place search.
// Builds 201 to 208 (no x-device or x-profile) get the same bytes and headers as before. Runs offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {") + "\n" +
  fs.readFileSync(root + "src/engine.js", "utf8").replace(/\nexport \{ BoardEngine[^}]*\};\s*$/, "\n") + "\n" +
  fs.readFileSync(root + "src/raptor.js", "utf8") +
  "\nexport { finishAnswer, trimBoard, pollTagOf, serverCfg, servesWords };\n";
const tmp = `/tmp/net-pass-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const NEW = { "x-device": "dev-test-1" };
const board = (now, extra = {}) => JSON.stringify({ kind: "departures", stop: { id: "1" }, items: [{ mode: "train", modeName: "Train", line: "T1", wheelchair: false, planned: "2026-10-27T10:00:00.000Z", estimated: null, ...extra }], alerts: [], live: true, now });
const ans = (body, headers = {}) => new Response(body, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
const req = (path, headers = {}, method = "GET") => new Request("https://api.transportsydney.app" + path, { method, headers });

test("newer app: board rows lose modeName and wheelchair, keep the rest", async () => {
  const r = await W.finishAnswer(req("/api/departures?stop=1", NEW), {}, ans(board(1)));
  const d = await r.json();
  assert.equal(d.items[0].modeName, undefined);
  assert.equal(d.items[0].wheelchair, undefined);
  assert.equal(d.items[0].line, "T1");
  assert.equal(d.items[0].estimated, null, "nulls stay");
  assert.equal(d.now, 1);
});

test("old app: the same bytes and no tag", async () => {
  const body = board(1);
  const r = await W.finishAnswer(req("/api/departures?stop=1"), {}, ans(body));
  assert.equal(await r.text(), body);
  assert.equal(r.headers.get("etag"), null);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const s = await W.finishAnswer(req("/api/search?q=strath"), {}, ans('{"items":[]}'));
  assert.equal(s.headers.get("cache-control"), "no-store");
  // An old app sending a tag it never got still gets the full answer.
  const t = await W.finishAnswer(req("/api/departures?stop=1", { "if-none-match": '"x"' }), {}, ans(body));
  assert.equal(t.status, 200);
});

test("newer app: the tag leaves out only the server clock", async () => {
  const a = await W.finishAnswer(req("/api/departures?stop=1", NEW), {}, ans(board(1000)));
  const b = await W.finishAnswer(req("/api/departures?stop=1", NEW), {}, ans(board(2000)));
  const c = await W.finishAnswer(req("/api/departures?stop=1", NEW), {}, ans(board(2000, { estimated: "2026-10-27T10:01:00.000Z" })));
  const d = await W.finishAnswer(req("/api/departures?stop=1", NEW), {}, ans('{"dataAt":5,' + board(2000).slice(1)));
  assert.ok(a.headers.get("etag"));
  assert.equal(a.headers.get("etag"), b.headers.get("etag"));
  assert.notEqual(a.headers.get("etag"), c.headers.get("etag"), "a moved time changes the tag");
  assert.notEqual(a.headers.get("etag"), d.headers.get("etag"), "dataAt is in the tag");
  assert.match(W.servesWords({}), /poll-tags/);
});

test("newer app: a matching tag gets a 304 with x-now and no body", async () => {
  const a = await W.finishAnswer(req("/api/alerts?q=T1", NEW), {}, ans('{"kind":"alerts","items":[1],"now":1}', { "x-edge-cache": "hit" }));
  const tag = a.headers.get("etag");
  const before = Date.now();
  const r = await W.finishAnswer(req("/api/alerts?q=T1", { ...NEW, "if-none-match": "W/" + tag }), {}, ans('{"kind":"alerts","items":[1],"now":2}', { "x-edge-cache": "hit" }));
  assert.equal(r.status, 304);
  assert.equal(await r.text(), "");
  assert.ok(Number(r.headers.get("x-now")) >= before);
  assert.equal(r.headers.get("x-edge-cache"), "hit");
  assert.match(r.headers.get("x-serves"), /poll-tags/);
  assert.match(r.headers.get("access-control-expose-headers"), /x-now/);
  const changed = await W.finishAnswer(req("/api/alerts?q=T1", { ...NEW, "if-none-match": tag }), {}, ans('{"kind":"alerts","items":[2],"now":2}'));
  assert.equal(changed.status, 200);
});

test("every polled path is tagged; per person and static paths are not", async () => {
  for (const p of ["/api/service?trip=a", "/api/trip/live?legs=a", "/api/trip?from=1&to=2", "/api/parking", "/api/lines?l=T1", "/api/trackwork?t=a", "/api/status?trip=a"]) {
    const r = await W.finishAnswer(req(p, NEW), {}, ans('{"now":1}'));
    assert.ok(r.headers.get("etag"), p);
  }
  for (const p of ["/api/saved", "/api/watches", "/api/home?p=x", "/api/search?q=ab"]) {
    const r = await W.finishAnswer(req(p, NEW), {}, ans('{"now":1}'));
    assert.equal(r.headers.get("etag"), null, p);
  }
  const err = await W.finishAnswer(req("/api/departures?stop=1", NEW), {}, new Response('{"error":"x"}', { status: 502, headers: { "content-type": "application/json" } }));
  assert.equal(err.headers.get("etag"), null);
});

test("POLL_TAGS off and kill.pollTags turn it off; trimming stays", async () => {
  const r = await W.finishAnswer(req("/api/departures?stop=1", NEW), { POLL_TAGS: "off" }, ans(board(1)));
  assert.equal(r.headers.get("etag"), null);
  assert.equal((await r.json()).items[0].modeName, undefined);
  assert.doesNotMatch(W.servesWords({ POLL_TAGS: "off" }), /poll-tags/);
  W.serverCfg.cfg = { kill: { pollTags: true } };
  try {
    const k = await W.finishAnswer(req("/api/alerts", NEW), {}, ans('{"now":1}'));
    assert.equal(k.headers.get("etag"), null);
  } finally { W.serverCfg.cfg = null; }
});

test("stop and place search may be kept on the phone for an hour; stand ins never", async () => {
  const s = await W.finishAnswer(req("/api/search?q=strath", NEW), {}, ans('{"items":[]}', { "x-edge-cache": "hit" }));
  assert.equal(s.headers.get("cache-control"), "public, max-age=3600");
  const pl = await W.finishAnswer(req("/api/places?q=strath", { "x-public-ok": "1" }), {}, ans('{"items":[]}'));
  assert.equal(pl.headers.get("cache-control"), "public, max-age=3600");
  const si = await W.finishAnswer(req("/api/places?q=strath", NEW), {}, ans('{"items":[]}', { "x-stand-in": "timetable" }));
  assert.equal(si.headers.get("cache-control"), "no-store");
  const e = await W.finishAnswer(req("/api/search?q=strath", NEW), {}, new Response('{"error":"x"}', { status: 502, headers: { "content-type": "application/json", "cache-control": "no-store" } }));
  assert.equal(e.headers.get("cache-control"), "no-store");
});

test("trimBoard leaves anything that is not a board as it was", () => {
  assert.equal(W.trimBoard("not json modeName"), "not json modeName");
  assert.equal(W.trimBoard('{"modeName":"x"}'), '{"modeName":"x"}');
  assert.equal(W.trimBoard('{"items":[]}'), '{"items":[]}');
});
