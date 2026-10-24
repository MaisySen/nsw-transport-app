// The Sydney clock helpers keep one Intl answer per UTC hour. They must give exactly what a fresh
// Intl.DateTimeFormat gives, including the hours around daylight saving changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(root + "src/worker.js", "utf8").replace(/export default\s*\{/, "const __default = {")
  + "\nexport { sydneyNow, sydneyParts, todOfMs, relDayType, clock };\n";
const tmp = `/tmp/sydtime-test-${process.pid}-${Date.now()}.mjs`;
fs.writeFileSync(tmp, src);
const W = await import(tmp); fs.unlinkSync(tmp);

const TZ = "Australia/Sydney";
function intlNow(d) {
  const f = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const dow = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday] || 1;
  const h = p.hour === "24" ? 0 : Number(p.hour);
  return { day: `${p.year}${p.month}${p.day}`, dow, tod: h * 60 + Number(p.minute) };
}
function intlParts(d) {
  const f = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const hh = p.hour === "24" ? "00" : p.hour;
  return { date: `${p.year}${p.month}${p.day}`, time: `${hh}${p.minute}` };
}

test("sydneyNow and sydneyParts match Intl every 7 minutes across both 2026 daylight saving changes", () => {
  // DST ends 5 Apr 2026 3am (16:00 UTC on the 4th), starts 4 Oct 2026 2am (16:00 UTC on the 3rd).
  for (const [a, b] of [[Date.UTC(2026, 3, 4, 10), Date.UTC(2026, 3, 4, 22)], [Date.UTC(2026, 9, 3, 10), Date.UTC(2026, 9, 3, 22)]]) {
    for (let t = a; t < b; t += 7 * 60000 + 13000) {
      assert.deepEqual(W.sydneyNow(new Date(t)), intlNow(new Date(t)), new Date(t).toISOString());
      assert.deepEqual(W.sydneyParts(new Date(t)), intlParts(new Date(t)), new Date(t).toISOString());
    }
  }
});

test("sydneyNow matches Intl at random instants over three years, and at midnight and second edges", () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const start = Date.UTC(2025, 0, 1), span = 3 * 365 * 86400000;
  for (let i = 0; i < 4000; i++) {
    const t = Math.floor(start + rnd() * span);
    assert.deepEqual(W.sydneyNow(new Date(t)), intlNow(new Date(t)));
    assert.deepEqual(W.sydneyParts(new Date(t)), intlParts(new Date(t)));
  }
  for (const t of [Date.UTC(2026, 9, 25, 13, 0, 0), Date.UTC(2026, 9, 25, 12, 59, 59, 999), Date.UTC(2026, 5, 30, 14, 0, 0)]) {
    assert.deepEqual(W.sydneyNow(new Date(t)), intlNow(new Date(t)));
  }
  assert.equal(W.todOfMs(Date.UTC(2026, 9, 24, 20, 30)).tod, 7 * 60 + 30);
  assert.equal(W.relDayType(Date.UTC(2026, 9, 24, 20, 30)), "weekend");
  assert.equal(W.clock(Date.UTC(2026, 9, 24, 20, 30)), "7:30am");
});
