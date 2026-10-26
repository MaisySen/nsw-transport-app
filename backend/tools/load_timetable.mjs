// Loads a timetable built by tools/build_timetable.py into the board engine (docs/ENGINE.md).
//   ENGINE_LOAD_KEY=... node tools/load_timetable.mjs <out dir of build_timetable.py> [https://api.transportsydney.app] [--if-needed]
// Sends the new version in parts (begin, stops, days, trips) and switches to it with commit; the old version keeps
// answering until then. Each part is retried up to 4 times.
import fs from "node:fs";
import zlib from "node:zlib";

const [dir, base = "https://api.transportsydney.app"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const key = process.env.ENGINE_LOAD_KEY;
if (!dir || !key) { console.error("usage: ENGINE_LOAD_KEY=... node tools/load_timetable.mjs <dir> [base url]"); process.exit(2); }
const meta = JSON.parse(fs.readFileSync(dir + "/meta.json", "utf8"));
async function post(path, body) {
  for (let a = 1; ; a++) {
    try {
      const r = await fetch(base + "/api/engine/load/" + path, { method: "POST", headers: { "x-admin-key": key, "content-type": "application/octet-stream" }, body });
      const t = await r.text();
      if (r.ok) return JSON.parse(t);
      if (a >= 4 || r.status === 403 || r.status === 409) throw new Error(path + " " + r.status + " " + t.slice(0, 200));
    } catch (e) { if (a >= 4) throw e; }
    await new Promise((r) => setTimeout(r, 1500 * a));
  }
}
// --if-needed (the daily workflow): no load while the engine's timetable already holds today and tomorrow (Sydney).
// Each load writes about 1.3 million rows into the engine's storage, a billed amount (50 million a month included,
// docs/COSTS.md), so the workflow builds 4 days (yesterday to 2 days ahead) and loads every second day.
if (process.argv.includes("--if-needed")) {
  const ymd = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(d).replace(/-/g, "");
  const today = ymd(new Date()), tomorrow = ymd(new Date(Date.now() + 86400000));
  const st = await fetch(base + "/api/engine/status").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const have = (st && Array.isArray(st.days)) ? st.days : [];
  if (have.includes(today) && have.includes(tomorrow)) { console.log("engine already holds", have.join(", "), "- no load needed"); process.exit(0); }
  console.log("engine holds", have.join(", ") || "nothing", "- loading");
}
const t0 = Date.now();
const { stops, ...head } = meta;
console.log("begin", await post("begin", JSON.stringify(head)));
const sl = Object.entries(stops).map(([id, s]) => [id, s[0], s[1], s[2], s[3], s[4]]);
for (let i = 0; i < sl.length; i += 4000) await post("stops", JSON.stringify(sl.slice(i, i + 4000)));
console.log("stops", sl.length);
async function lines(file, path, maxBytes) {
  const all = zlib.gunzipSync(fs.readFileSync(dir + "/" + file)).toString().split("\n").filter(Boolean);
  let part = [], size = 0, n = 0, sent = 0;
  const flush = async () => { if (!part.length) return; const r = await post(path, part.join("\n")); n += r.n; sent++; part = []; size = 0; };
  for (const l of all) { part.push(l); size += l.length + 1; if (size >= maxBytes) await flush(); }
  await flush();
  console.log(path, n, "rows in", sent, "parts");
}
await lines("days.ndjson.gz", "days", 3_000_000);
await lines("trips.ndjson.gz", "trips", 3_000_000);
console.log("commit", await post("commit", "{}"), "in", Math.round((Date.now() - t0) / 1000), "s");
