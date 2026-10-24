// Copies every table of the current deploy's database into a SQL file that `wrangler d1 execute`
// loads into the new D1 database. Reads GET /api/admin/export on the source with the admin key.
// Usage: SOURCE=https://old.example ADMIN_KEY=... node tools/export-d1.mjs [out.sql]
// Optional: SKIP=obs,ip_rate (tables to leave out). The output holds user data: never commit it.
import fs from "node:fs";

const SOURCE = (process.env.SOURCE || "").replace(/\/+$/, "");
const KEY = process.env.ADMIN_KEY || "";
const out = process.argv[2] || "export.sql";
if (!/^https:\/\//.test(SOURCE) || !KEY) { console.error("Set SOURCE (https origin) and ADMIN_KEY"); process.exit(1); }
const skip = new Set((process.env.SKIP || "ip_rate").split(",").map((s) => s.trim()).filter(Boolean));

async function get(path) {
  for (let i = 0; ; i++) {
    const r = await fetch(SOURCE + path, { headers: { "x-admin-key": KEY } });
    if (r.ok) return r.json();
    if (i >= 4 || r.status === 403 || r.status === 404) throw new Error(path + " answered " + r.status);
    await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
  }
}
const lit = (v) => v == null ? "NULL" : typeof v === "number" ? (Number.isFinite(v) ? String(v) : "NULL") : typeof v === "boolean" ? (v ? "1" : "0") : "'" + String(v).replace(/'/g, "''") + "'";

const list = await get("/api/admin/export");
const lines = ["-- Transport: Sydney Live data export from the previous deploy. Load after migrations/0001_init.sql."];
let total = 0;
for (const t of list.tables) {
  if (skip.has(t.name)) { console.log(`skip ${t.name}`); continue; }
  let after = 0, n = 0, cols = null;
  lines.push(`DELETE FROM "${t.name}";`);
  while (after != null) {
    const page = await get(`/api/admin/export?table=${encodeURIComponent(t.name)}&after=${after}&limit=500`);
    // D1 limits one statement to 100 KB, so rows go in small batches.
    let batch = [];
    const flush = () => { if (batch.length) lines.push(`INSERT OR REPLACE INTO "${t.name}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES\n${batch.join(",\n")};`); batch = []; };
    let size = 0;
    for (const row of page.rows) {
      const { __rowid, ...rest } = row;
      cols = cols || Object.keys(rest);
      const v = "(" + cols.map((c) => lit(rest[c])).join(", ") + ")";
      if (size + v.length > 90000) { flush(); size = 0; }
      batch.push(v); size += v.length; n++;
    }
    flush();
    after = page.next;
  }
  total += n;
  console.log(`${t.name}: ${n} rows`);
}
fs.writeFileSync(out, lines.join("\n") + "\n");
console.log(`Wrote ${out}: ${total} rows from ${list.tables.length - skip.size} tables`);
