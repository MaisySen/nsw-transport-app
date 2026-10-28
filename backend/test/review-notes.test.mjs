// App Review notes guard (28 Oct): every feature switch the server or the app reads is named in
// docs/APP_REVIEW_NOTES.md (guidelines 2.5.2 and 2.5.19: no hidden or undocumented features), and the Notes text
// fits the App Store Connect field. Reads files only: no server, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repo = new URL("../..", import.meta.url).pathname;
const doc = fs.readFileSync(repo + "docs/APP_REVIEW_NOTES.md", "utf8");
const notes = doc.split("\n## Notes\n\n")[1] || "";

function files(dir, re) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") out.push(...files(p, re)); } else if (re.test(e.name)) out.push(p);
  }
  return out;
}
const found = (srcs, re) => { const s = new Set(); for (const f of srcs) for (const m of fs.readFileSync(f, "utf8").matchAll(re)) s.add(m[1]); return [...s].sort(); };

test("every server switch read with serverOn is in the review notes table", () => {
  const flags = found(files(repo + "backend/src", /\.js$/), /serverOn\(env, "(\w+)"\)/g);
  assert.ok(flags.length >= 10, "found the server switches");
  const missing = flags.filter((f) => !doc.includes("`" + f + "`"));
  assert.deepEqual(missing, [], "add these to docs/APP_REVIEW_NOTES.md (and the Notes text if a rider can see them)");
});

test("every remote config flag the app reads is in the review notes table", () => {
  const srcs = files(repo + "app/src", /\.(ts|tsx)$/);
  const flags = [...new Set([
    ...found(srcs, /useFlag\(\s*'(\w+)'/g), ...found(srcs, /isOn\(\s*'(\w+)'/g), ...found(srcs, /flags\.(\w+)/g),
  ])].sort();
  assert.ok(flags.length >= 5, "found the app flags");
  const missing = flags.filter((f) => !doc.includes("`" + f + "`"));
  assert.deepEqual(missing, [], "add these to docs/APP_REVIEW_NOTES.md (and the Notes text if a rider can see them)");
});

test("the Notes text fits App Store Connect and is plain", () => {
  assert.ok(notes.length > 1000, "Notes section present");
  assert.ok(notes.trim().length <= 4000, `Notes is ${notes.trim().length} characters; App Store Connect takes 4000`);
  assert.ok(!/[\u2013\u2014]/.test(notes), "no en or em dashes");
  assert.ok(/2\.5\.19/.test(notes) && /api\.transportsydney\.app/.test(notes), "names the guideline and the server");
});
