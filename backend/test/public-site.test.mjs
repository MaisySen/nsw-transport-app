// The public site in site/ (transportsydney.app): plain files, no scripts, the domain's email
// addresses, publisher, app link files, and none of the old address or names.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const site = new URL("../../site/", import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(site, p), "utf8");
const pages = ["index.html", "support/index.html", "privacy/index.html", "terms/index.html", "404.html", "open/index.html"];

test("every page: no scripts, local styles only, footer with publisher and links, light and dark", () => {
  for (const p of pages) {
    const h = read(p);
    assert.doesNotMatch(h, /<script|<iframe|on(click|load)=/i, p);
    assert.match(h, /<html lang="en-AU">/, p);
    assert.match(h, /name="viewport" content="width=device-width/, p);
    assert.match(h, /<link rel="stylesheet" href="\/site.css">/, p);
    assert.match(h, /Fintex Australia Pty Ltd<\/a>, ABN 60 688 406 108/, p);
    for (const l of ["/support/", "/privacy/", "/terms/"]) assert.ok(h.includes(`href="${l}"`), p + " links " + l);
    assert.match(h, /class="skip" href="#main"/, p);
    for (const ref of h.matchAll(/(?:src|href)="(\/[^"#?]+)"/g)) if (!ref[1].endsWith("/")) assert.ok(fs.existsSync(path.join(site, ref[1])), p + " missing " + ref[1]);
  }
  assert.match(read("site.css"), /prefers-color-scheme: dark/);
});

test("email addresses on the domain: support, privacy, hello", () => {
  assert.match(read("support/index.html"), /mailto:support@transportsydney\.app/);
  assert.match(read("privacy/index.html"), /mailto:privacy@transportsydney\.app/);
  for (const p of pages) assert.match(read(p), /mailto:hello@transportsydney\.app/, p);
  for (const p of pages) assert.doesNotMatch(read(p), /contact@fintex\.au/, p);
});

test("app link files are valid JSON for the right app and served as JSON", () => {
  const a = JSON.parse(read(".well-known/apple-app-site-association"));
  const d = a.applinks.details[0];
  assert.deepEqual(d.appIDs, ["B85KQRQZW7.com.maisysen.nswtransport"]);
  for (const p of ["/trip/*", "/stop/*", "/plan*", "/open/*"]) assert.ok(d.components.some((c) => c["/"] === p) && d.paths.includes(p), p);
  const l = JSON.parse(read(".well-known/assetlinks.json"));
  assert.equal(l[0].target.package_name, "com.maisysen.nswtransport");
  assert.ok(l[0].target.sha256_cert_fingerprints.every((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f)));
  const h = read("_headers");
  assert.match(h, /\/\.well-known\/apple-app-site-association\n\s+Content-Type: application\/json/);
  assert.match(h, /Content-Security-Policy: default-src 'none'/);
  const r = read("_redirects");
  for (const p of ["/stop/*", "/plan"]) assert.match(r, new RegExp(p.replace(/[*/]/g, "\\$&") + "\\s+/open/\\s+200"));
  // A shared trip in a browser goes to the live trip page through the Pages function, not a rule.
  assert.doesNotMatch(r, /^\/trip\/\*\s/m);
  assert.match(read("functions/trip/[id].js"), /302/);
  assert.equal(read("CNAME").trim(), "transportsydney.app");
});

test("no old address, old names, dashes or tracking anywhere in site/", () => {
  const bad = new RegExp(["tab\\.bot", "nsw-transport-" + "bot", "Transport " + "Bot", "\\bRITA\\b", "[\\u2013\\u2014]", "google-analytics", "gtag", "plausible"].join("|"), "i");
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of walk(site).filter((f) => !/\.(png|ico)$/.test(f))) assert.doesNotMatch(fs.readFileSync(f, "utf8"), bad, f);
});
