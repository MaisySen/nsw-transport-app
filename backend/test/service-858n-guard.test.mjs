// 858N follow-on guard (3 Nov 2026, live check of server-858n-2nov on the day's full timetable). The 858N fix follows a
// train run that stops short of its headsign's station on to the trip the feed names next by Sydney Trains' naming. On
// the 3 Nov timetable 62 of 86 short runs were followed; 5 of them were wrong: "Penrith via Gordon" 120G runs on as 120H
// ("Emu Plains via Parramatta"), whose run in our pack ends at Penrith, and the next trip by its naming, 120J, is the
// Emu Plains to Berowra run back through Penrith 17 minutes later (another block). The list then went Penrith, Kingswood,
// Werrington ... back to Central. A followed trip must start at the hand-over station and must not run back over the
// stations already listed. Offline, on a cut of the 3 Nov GTFS (the three trips as published).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const worker = fs.readFileSync(root + "src/worker.js", "utf8");
const src = worker.replace(/export default\s*\{/, "const __default = {") + "\n" +
  fs.readFileSync(root + "src/engine.js", "utf8").replace(/\nexport \{ BoardEngine[^}]*\};\s*$/, "\n") + "\n" +
  fs.readFileSync(root + "src/ttplan.js", "utf8") + "\n" +
  fs.readFileSync(root + "src/raptor.js", "utf8").replace(/\nexport \{ TripPlanner \};\s*$/, "\n") +
  "\nexport { rpOpen, rpRun, svcRunOn, svcRunShort };\n";
const tmp = `/tmp/service-858n-guard-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "858n-guard-"));
const packFile = path.join(dir, "pack.bin");
execFileSync("python3", [root + "tools/build_planner.py", root + "test/fixtures/gtfs-120g", packFile, "20261103"], { stdio: "pipe" });
const pk = W.rpOpen(new Uint8Array(fs.readFileSync(packFile)));
fs.rmSync(dir, { recursive: true, force: true });

const G = "120G.1419.157.8.A.8.92059146", H = "120H.1419.157.8.A.8.92059145", J = "120J.1419.157.8.A.8.92061995";
const names = (r) => r.stops.map((s) => s.name.replace(/ Station.*$/, ""));
const runOf = async (trip, stop, atMs) => W.rpRun(pk, { trip, stop, at: Math.round(atMs / 1000) - pk.dayStart });
const feedHas = (...ids) => (prefix) => ids.filter((t) => t.startsWith(prefix));

test("the 3 Nov shape: 120G runs on as 120H, the run ends at Penrith short of Emu Plains", () => {
  const r = W.rpRun(pk, { trip: G });
  assert.ok(r, "run");
  assert.deepEqual(r.trips, [G, H]);
  assert.equal(names(r).at(-1), "Penrith");
  assert.match(r.lastHead, /Emu Plains/i);
  assert.equal(W.svcRunShort(r), true);
});

test("never followed on to a train that passes the hand-over station later going back (120J from Emu Plains)", async () => {
  const r = W.rpRun(pk, { trip: G });
  const j = W.rpRun(pk, { trip: J });
  assert.ok(j && names(j)[0] === "Emu Plains" && names(j).includes("Penrith"), "120J starts at Emu Plains and passes Penrith");
  const on = await W.svcRunOn(r, feedHas(J), runOf);
  assert.equal(on, null, on ? "followed back: " + names(on).slice(-8).join(", ") : "");
});

test("a trip that starts at the hand-over station but turns back over listed stations is not followed either", async () => {
  // 120J asked from its own first stop is a trip that starts where it is asked; offered as the run on from a run that
  // ended at Emu Plains it would list Penrith, Kingswood ... again.
  const r = W.rpRun(pk, { trip: G });
  const lastIsEmu = { ...r, stops: [...r.stops, { ...r.stops.at(-1), id: W.rpRun(pk, { trip: J }).stops[0].id, parent: W.rpRun(pk, { trip: J }).stops[0].parent, name: "Emu Plains Station", arr: W.rpRun(pk, { trip: J }).stops[0].dep - 60000 }], lastHead: "Berowra via Gordon" };
  assert.equal(W.svcRunShort(lastIsEmu), true);
  const on = await W.svcRunOn(lastIsEmu, feedHas(J), runOf);
  assert.equal(on, null, on ? "turned back: " + names(on).slice(-8).join(", ") : "");
});
