// Plan B inside the morning check alert: the best other way when the usual service is cancelled, late, or the
// line has trackwork; nothing for a platform change or a lift.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {")
  + "\nexport { morningPlanB, morningMessage, journeyOk };\n";
const tmp = `/tmp/morning-planb-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const NOW = Date.parse("2026-10-26T21:30:00Z"); // 8:30am Tuesday in Sydney
const at = (m) => new Date(NOW + m * 60000).toISOString();
const leg = (line, mode, dep, arr, extra = {}) => ({ kind: "transit", line, mode, tripId: `${line}-${dep}`, from: "Epping Station, Platform 1", planned: at(dep), arrPlanned: at(arr), realtime: true, delayMin: 0, ...extra });
const J = (legs) => ({ legs, board: legs[0].planned, leave: legs[0].planned, arrive: legs[legs.length - 1].arrPlanned, changes: legs.length - 1 });
const C = { from_id: "212110", to_id: "200060", from_name: "Epping Station", to_name: "Central Station" };

test("a cancelled service: the next good journey from the ones already planned", async () => {
  const usual = J([leg("T9", "train", 10, 40, { cancelled: true })]);
  const later = J([leg("T9", "train", 20, 50)]);
  const metro = J([leg("M1", "metro", 14, 41)]);
  const p = await W.morningPlanB({}, C, usual, [{ kind: "cancelled", text: "The 8:40am T9 is cancelled." }], [usual, later, metro], NOW, async () => { throw new Error("no planner call expected"); });
  assert.equal(p.line, "M1");
  assert.match(p.text, /^Plan B: the \d{1,2}:\d{2}[ap]m M1 from Epping, arrives \d{1,2}:\d{2}[ap]m\.$/);
});

test("a late journey is not offered as Plan B", async () => {
  const usual = J([leg("T9", "train", 10, 40, { delayMin: 12 })]);
  const alsoLate = J([leg("T9", "train", 20, 50, { delayMin: 9 })]);
  const p = await W.morningPlanB({}, C, usual, [{ kind: "delay", minutes: 12, text: "The 8:40am T9 is 12 min late." }], [usual, alsoLate], NOW, async () => ({ journeys: [] }));
  assert.equal(p, null);
});

test("trackwork on the line: plans again without trains and avoids that line", async () => {
  const usual = J([leg("T9", "train", 10, 40)]);
  const sameLine = J([leg("T9", "train", 20, 50)]);
  let asked = null;
  const planner = async (env, f, t, opts) => { asked = opts; return { journeys: [J([leg("M1", "metro", 12, 44)])] }; };
  const p = await W.morningPlanB({}, C, usual, [{ kind: "trackwork", text: "T9: Buses replace trains between Epping and Hornsby." }], [usual, sameLine], NOW, planner);
  assert.equal(asked.exclude.exclMOT_1, "1");
  assert.equal(asked.exclude.excludedMeans, "checkbox");
  assert.equal(p.line, "M1");
});

test("no Plan B for a platform change or a lift", async () => {
  const usual = J([leg("T9", "train", 10, 40)]);
  const p = await W.morningPlanB({}, C, usual, [{ kind: "platform", text: "The 8:40am T9 now leaves from Platform 3, not Platform 1." }], [usual, J([leg("M1", "metro", 12, 44)])], NOW);
  assert.equal(p, null);
});

test("the alert keeps the Plan B sentence whole", () => {
  const issues = [{ kind: "cancelled", text: "x".repeat(280) }];
  const m = W.morningMessage(C, null, issues, { text: "Plan B: the 8:44am M1 from Epping, arrives 9:11am." });
  assert.ok(m.body.endsWith("Plan B: the 8:44am M1 from Epping, arrives 9:11am."));
  assert.ok(m.body.length <= 301);
  assert.equal(W.morningMessage(C, null, [{ kind: "cancelled", text: "The 8:40am T9 is cancelled." }]).body, "The 8:40am T9 is cancelled.");
});
