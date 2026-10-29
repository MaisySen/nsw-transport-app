import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const pub = path.join(root, "src/public");
const pages = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.name.endsWith(".html")) pages.push(f); } };
walk(pub);

test("no public page or server message shows the internal mailbox", () => {
  for (const f of [...pages, path.join(root, "src/worker.js"), path.join(pub, "app.js"), path.join(pub, "live/live.js")]) {
    const t = fs.readFileSync(f, "utf8");
    assert.doesNotMatch(t, new RegExp(["mail", "tab", "bot"].join("\\.") + "|wildgamingbk|MaisySen", "i"), f);
  }
});

test("terms, support and every footer name the publisher and contact", () => {
  // The old privacy copy here was deleted (30 Oct); the policy is site/privacy/ (public-site.test.mjs).
  for (const rel of ["terms/index.html", "support/index.html"]) {
    const t = fs.readFileSync(path.join(pub, rel), "utf8");
    assert.match(t, /Transport: Sydney Live is provided by Fintex Australia Pty Ltd \(ABN 60 688 406 108\), New South Wales, Australia\./, rel);
    assert.match(t, /contact@fintex\.au/, rel);
  }
  for (const f of pages) {
    const t = fs.readFileSync(f, "utf8");
    if (!/<footer/.test(t)) continue;
    const foot = t.slice(t.lastIndexOf("<footer"));
    assert.match(foot, /&copy; 2026 <a href="https:\/\/fintex\.au">Fintex Australia Pty Ltd<\/a>/, f);
  }
});
