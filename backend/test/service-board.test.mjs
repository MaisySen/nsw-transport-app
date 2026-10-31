// /api/service board=1 (trip flow 2 apps before the train leaves): the boarding stop's board row rides the answer, so
// the open app counts to the same board live time and shows the same live platform as the server's card (G19, G21,
// I6). Old apps (no board=1) get the answer exactly as before. Cases from app/sim/cases.mjs through tools/fake-nsw.mjs
// mode "case"; no Transport for NSW call. Integrator, 31 Oct 2026.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { serviceAt, stopFake } from "../tools/simtrip.mjs";

after(() => stopFake());
const hms = (h, m, s = 0) => h * 3600 + m * 60 + s;
const local = (iso) => new Date(iso).toLocaleTimeString("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", minute: "2-digit", hour12: true });

test("S2 at 7:48pm: board=1 carries the board's live 7:54 departure for this trip", async () => {
  const r = await serviceAt("S2", hms(19, 48), { board: "1" });
  assert.equal(r.status, 200);
  assert.ok(r.body.board, "board row present");
  assert.equal(r.body.board.realtime, true);
  assert.equal(local(r.body.board.estimated), "7:54 pm");
  assert.equal(r.body.board.platform, "Platform 7");
});

test("S6 platform change: board=1 carries the live platform, the planned one stays on the leg", async () => {
  const r = await serviceAt("S6", hms(19, 47, 30), { board: "1" });
  assert.equal(r.status, 200);
  assert.ok(r.body.board && /^Platform \d+$/.test(r.body.board.platform), JSON.stringify(r.body.board));
  assert.notEqual(r.body.board.platform, "Platform " + r.leg.fromPlatform.replace(/^Platform /, ""));
});

test("old app (no board=1): no board field, and no board read", async () => {
  const r = await serviceAt("S2", hms(19, 48));
  assert.equal(r.status, 200);
  assert.equal("board" in r.body, false);
  assert.equal(Object.keys(r.nsw).some((k) => /departure_mon/.test(k)), false, JSON.stringify(r.nsw));
});

test("board=1 long before the board window: board null, no board read", async () => {
  const r = await serviceAt("S2", hms(18, 30), { board: "1" });
  assert.equal(r.status, 200);
  assert.equal(r.body.board, null);
});
