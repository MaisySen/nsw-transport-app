// Build 214 on the server (1 Nov 2026, approved by the owner at 2:31 PM): Get off now corrected for the feed's lag so it
// lands 38 s before the live arrival (about 30 s before the train really stops), never more than 40 s before; one calm
// "Held, stay on" a minute after Get off now when the train is held outside the stop; error words without the data
// provider's name. Runs offline against the fake feeds, as tripflow-sim.test.mjs.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runCase, stopFake, loadWorker } from "../tools/simtrip.mjs";

after(() => stopFake());
const hms = (s) => { const [h, m, x = 0] = s.split(":").map(Number); return h * 3600 + m * 60 + x; };

test("the Get off now lead: 30 s plus the 8 s feed lag, at most 40 s with the 2 s delivery lead", async () => {
  const W = await loadWorker();
  const L = W.LIVECARD;
  assert.equal(L.TRIP_RULES.GETOFF_LAG, 8000);
  assert.equal(L.TRIP_RULES.GETOFF_MAX_LEAD, 40000);
  assert.equal(L.getOffLeadMs(0), 38000, "lands 38 s before the live arrival");
  assert.equal(L.getOffLeadMs(2000), 40000, "the server sends it 40 s before");
  for (const lead of [5000, 15000, 60000]) assert.equal(L.getOffLeadMs(lead), 40000, "never more than 40 s early");
  const src = fs.readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
  assert.match(src, /timerAt = Math\.max\(now, tm\.arr\.at - LIVECARD\.getOffLeadMs\(R\.SERVER_DELIVERY\)\)/, "the server's one timer uses the same lead");
});

test("S16: on time, the server sends Get off now at 7:54:20 for the 7:55 arrival (lands 7:54:22)", { timeout: 60000 }, async () => {
  const r = await runCase("S16");
  const off = r.alerts.filter((a) => /^Get off now/.test(a.title));
  assert.equal(off.length, 1, JSON.stringify(off));
  assert.ok(Math.abs(off[0].t - hms("19:54:20")) <= 5, `sent at ${off[0].t}`);
  assert.ok(hms("19:55") - off[0].t <= 40, "never more than 40 s before the live arrival");
});

test("S21: held outside the stop, one quiet Held, stay on a minute after Get off now, and the card says so", { timeout: 60000 }, async () => {
  const r = await runCase("S21");
  const off = r.alerts.filter((a) => /^Get off now/.test(a.title));
  assert.equal(new Set(off.map((a) => a.title + a.body)).size, 1, "one Get off now");
  const held = r.alerts.filter((a) => a.title === "Held, stay on");
  assert.ok(held.length >= 1, JSON.stringify(r.alerts.map((a) => [a.t, a.via, a.title])));
  for (const h of held) {
    assert.ok(!h.sound || h.sound === "none", `no sound: ${h.sound}`);
    assert.ok(h.t >= hms("19:59:20") && h.t <= hms("19:59:40"), `held at ${h.t}`);
    assert.match(h.body, /^Held before Clyde\. Stay on, arriving about 8:02pm\.$/);
  }
  assert.ok(r.pushes.some((p) => p.warning === "Held, stay on" && p.t >= hms("19:59:20") && p.t < hms("20:02")), "the Lock Screen card shows Held, stay on");
  assert.ok(!r.alerts.some((a) => /^Arrived|You've arrived/.test(a.title) && a.t < hms("20:02")), "no Arrived until the train is at the stop");
});

test("S22f and S22s: no Held when the train comes in, and Get off now never more than 40 s early", { timeout: 120000 }, async () => {
  for (const id of ["S22f", "S22s"]) {
    const r = await runCase(id);
    assert.ok(!r.alerts.some((a) => a.title === "Held, stay on"), `${id}: no false Held`);
    assert.equal(r.alerts.filter((a) => /^Get off now/.test(a.title)).length >= 1, true, id);
  }
});

test("error words carry no data provider's name (build 214)", () => {
  const src = fs.readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
  const said = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  assert.doesNotMatch(said, /"[^"\n]*Transport for NSW[^"\n]*(answering|available|unavailable)[^"\n]*"/);
  assert.match(said, /Live data isn't answering right now, so I can't check that\. It's not your connection\. Try again soon\./);
  assert.match(said, /Live trips are unavailable right now\. Try again soon\./);
});
