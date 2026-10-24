// Ask tab: checks the chat files, the tab bar entry, the route and the /api/ask v2 block.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const root = new URL("..", import.meta.url).pathname;
const read = (p) => fs.readFileSync(root + p, "utf8");

test("Ask tab is wired into the web app", () => {
  const html = read("src/public/index.html");
  assert.ok(html.includes('data-tab="ask"') && html.includes('href="#/chat"'), "tab bar entry");
  assert.ok(html.includes("/ask.js") && html.includes("/ask.css"), "assets linked");
  assert.ok(read("src/public/app.js").includes('path === "/chat"'), "route");
  const js = read("src/public/ask.js");
  for (const s of ["Next train Burwood to Central", "Is the T1 late", "Last train home", "/api/ask?"]) assert.ok(js.includes(s), s);
});

test("ask v2 answers with reply, cards and links", () => {
  const w = read("src/worker.js");
  for (const s of ["async function askV2", "d.reply = reply; d.cards = cards; d.links = links", "lineStatus", "routeAt", "lastService"]) assert.ok(w.includes(s), s);
});

test("no em or en dashes in the Ask files", () => {
  for (const p of ["src/public/ask.js", "src/public/ask.css"]) assert.ok(!/[\u2013\u2014]/.test(read(p)), p);
  const w = read("src/worker.js");
  const block = w.slice(w.indexOf("// ---- ask v2 start"), w.indexOf("// ---- ask v2 end"));
  assert.ok(block.length > 1000 && !/[\u2013\u2014]/.test(block));
});
