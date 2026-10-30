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
    // No code runs on the site. The only script element allowed is JSON-LD data (never executed).
    assert.doesNotMatch(h.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, ""), /<script|<iframe|on(click|load)=/i, p);
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

test("SEO: every page has its own title, description, canonical and Open Graph, plus the manifest and theme colours", () => {
  const indexed = { "index.html": "/", "support/index.html": "/support/", "privacy/index.html": "/privacy/", "terms/index.html": "/terms/" };
  const seen = { title: new Set(), description: new Set() };
  for (const p of pages) {
    const h = read(p);
    assert.match(h, /<link rel="manifest" href="\/site.webmanifest">/, p);
    assert.match(h, /name="theme-color" content="#[0-9a-f]{6}" media="\(prefers-color-scheme: light\)"/, p);
    assert.match(h, /name="theme-color" content="#[0-9a-f]{6}" media="\(prefers-color-scheme: dark\)"/, p);
    for (const img of h.matchAll(/<img [^>]*>/g)) {
      assert.match(img[0], / width="\d+"/, p + " " + img[0]);
      assert.match(img[0], / height="\d+"/, p + " " + img[0]);
      assert.match(img[0], / alt="/, p + " " + img[0]);
    }
  }
  for (const [p, u] of Object.entries(indexed)) {
    const h = read(p);
    const title = h.match(/<title>([^<]+)<\/title>/)[1];
    const desc = h.match(/<meta name="description" content="([^"]+)">/)[1];
    assert.ok(!seen.title.has(title), p + " title is unique");
    assert.ok(!seen.description.has(desc) || p === "index.html", p + " description is unique");
    seen.title.add(title); seen.description.add(desc);
    const url = "https://transportsydney.app" + u;
    assert.ok(h.includes(`<link rel="canonical" href="${url}">`), p + " canonical");
    assert.ok(h.includes(`<meta property="og:url" content="${url}">`), p + " og:url");
    assert.ok(h.includes(`<meta property="og:title" content="${title}">`), p + " og:title");
    assert.ok(h.includes(`<meta property="og:description" content="${desc}">`), p + " og:description");
    assert.doesNotMatch(h, /name="robots" content="noindex/, p);
  }
});

test("SEO: home page hero, h1 and JSON-LD (SoftwareApplication and Organization, no ratings)", () => {
  const h = read("index.html");
  assert.match(h, /<img class="app-icon" src="\/icon-512.png" alt="Transport: Sydney Live app icon"/);
  const h1 = h.match(/<h1>([\s\S]*?)<\/h1>/)[1].replace(/<br[^>]*>/g, " ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  assert.equal(h1, "Transport: Sydney Live");
  const blocks = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.equal(blocks.length, 1);
  const ld = JSON.parse(blocks[0][1]);
  assert.equal(ld["@context"], "https://schema.org");
  const app = ld["@graph"].find((n) => n["@type"] === "SoftwareApplication");
  const org = ld["@graph"].find((n) => n["@type"] === "Organization");
  assert.equal(app.name, "Transport: Sydney Live");
  assert.equal(app.operatingSystem, "iOS, Android");
  assert.equal(app.applicationCategory, "TravelApplication");
  assert.equal(app.url, "https://transportsydney.app/");
  assert.match(app.image, /^https:\/\/transportsydney\.app\/.+\.png$/);
  assert.equal(app.offers["@type"], "Offer");
  assert.equal(app.offers.price, "0");
  assert.equal(app.offers.priceCurrency, "AUD");
  assert.equal(app.publisher["@id"], org["@id"]);
  assert.equal(org.name, "Fintex Australia Pty Ltd");
  assert.equal(org.url, "https://fintex.au");
  assert.match(org.logo, /^https:\/\//);
  assert.doesNotMatch(blocks[0][1], /aggregateRating|"review"|ratingValue/i);
});

test("SEO: manifest, sitemap with lastmod (no redirects in it), robots, CSP lets the manifest load", () => {
  const m = JSON.parse(read("site.webmanifest"));
  assert.equal(m.name, "Transport: Sydney Live");
  assert.equal(m.short_name, "Sydney Live");
  assert.equal(m.display, "standalone");
  assert.match(m.theme_color, /^#[0-9a-f]{6}$/);
  assert.match(m.background_color, /^#[0-9a-f]{6}$/);
  for (const s of ["192x192", "512x512"]) {
    const i = m.icons.find((x) => x.sizes === s);
    assert.ok(i && fs.existsSync(path.join(site, i.src)), "icon " + s);
  }
  const sm = read("sitemap.xml");
  const urls = [...sm.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod><\/url>/g)].map((x) => x[1]);
  assert.deepEqual(urls, ["https://transportsydney.app/", "https://transportsydney.app/support/", "https://transportsydney.app/privacy/", "https://transportsydney.app/terms/"]);
  assert.equal((sm.match(/<url>/g) || []).length, urls.length);
  assert.match(read("robots.txt"), /Sitemap: https:\/\/transportsydney\.app\/sitemap\.xml/);
  const hd = read("_headers");
  assert.match(hd, /manifest-src 'self'/);
  assert.match(hd, /\/site\.webmanifest\n\s+Content-Type: application\/manifest\+json/);
  assert.match(hd, /^\/\n\s+Cache-Control: [^\n]*no-transform/m);
  assert.match(read("404.html"), /href="\/"/);
});

test("privacy: where each service processes data (item 12, 30 Oct), as categories, no service names", () => {
  const strip = (s) => s.replace(/<[^>]+>/g, "").replace(/\*\*/g, "").replace(/&#39;|&rsquo;/g, "'");
  const store = fs.readFileSync(new URL("../../store/privacy-policy.md", import.meta.url), "utf8");
  for (const [name, text] of [["site", strip(read("privacy/index.html"))], ["store", strip(store)]]) {
    for (const want of [
      "Our hosting provider, a company in the United States,",
      "keeps the server's database in its Oceania region",
      "including this log, in the United States and Europe",
      "the relay service, in the United States, passes them on",
      "Apple's push service, run from the United States,",
      "in any country where Google has data centres",
      "open map tile service run by a company in Hungary",
      "Our app update service, in the United States:",
      "Transport for NSW",
    ]) assert.ok(text.includes(want), name + " says: " + want);
    assert.doesNotMatch(text, /cloudflare|expo\b|sentry|firebase|openfreemap|hyperknot/i, name);
  }
  assert.match(read("terms/index.html"), /CC BY 4\.0[\s\S]*OpenStreetMap contributors, used under the Open Database License/);
});
