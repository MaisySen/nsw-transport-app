// The owner's own stations may appear in at most 5% of tests (rule from 30 Oct 2026), so
// the suites test Sydney and NSW at large and not one commute. Counts every test in
// app/test and backend/test with backend/tools/owner-stations.mjs and fails over the limit.
// Run `node backend/tools/owner-stations.mjs --list` to see which tests count.
import { test } from "node:test";
import assert from "node:assert/strict";
import { countOwnerTests, findTests, mentionsOwner, LIMIT, GUARD_MARK, OWNER_NAMES, OWNER_IDS } from "../tools/owner-stations.mjs";

test("at most 5% of all app and backend tests mention the owner's stations", () => {
  const r = countOwnerTests();
  assert.ok(r.total > 1000, `only ${r.total} tests found; the counter missed the suites`);
  const list = r.rows.map((x) => `${x.file}:${x.line} ${x.why}`).join("\n");
  assert.ok(r.share <= LIMIT, `${r.owner} of ${r.total} tests (${(r.share * 100).toFixed(1)}%) mention an owner station, over ${LIMIT * 100}%:\n${list}`);
  assert.ok(r.guards.length <= 5, `${r.guards.length} tests carry the guard mark; it is only for tests that check the names are absent`);
});

test("the counter sees names in any case or spacing, stop ids, and constants a test uses", () => {
  const name = OWNER_NAMES[0], two = OWNER_NAMES.find((n) => n.includes(" "));
  for (const s of [name, name.toLowerCase(), name.toUpperCase(), two.replace(" ", ""), two.replace(" ", "-").toLowerCase(), `id: "${OWNER_IDS[0]}"`]) assert.ok(mentionsOwner(s), s);
  assert.ok(!mentionsOwner(`id: "${OWNER_IDS[0]}7"`), "a longer number is not the stop id");
  assert.ok(!mentionsOwner("Parramatta to Central"));
  const src = `const T = "x";\ntest("a", () => { f("${name}"); });\ntest("b", () => { g(1 / 2); h(/re/g); });\ntest("c", () => { k(\`\${1}\`); });\n`;
  assert.equal(findTests(src).tests.length, 3);
});

test("a guard test that lists the names to check they are absent is not counted", () => {
  const src = `test("no names", () => { // ${GUARD_MARK}\n  x("${OWNER_NAMES[1]}"); });\n`;
  const t = findTests(src).tests;
  assert.equal(t.length, 1);
  assert.ok(t[0].text.includes(GUARD_MARK));
});
