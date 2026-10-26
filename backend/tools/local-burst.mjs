// Burst of identical first opens against a local API (tools/local-dev.mjs), the check that found the cross request
// 500s of 26 Oct (g28, docs/REVERSE_ENGINEERING.md, test/cross-request.test.mjs). Local only: refuses any other host.
//   node backend/tools/local-burst.mjs [http://127.0.0.1:8787] [n 10]
const base = process.argv[2] || "http://127.0.0.1:8787";
const n = +(process.argv[3] || 10);
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) { console.error("local API only"); process.exit(2); }
const stops = ["2000441", "2067141", "200070", "10101100", "213510"];
const paths = [
  `/api/departures?stop=${stops[Date.now() % stops.length]}&mode=train&b=${Date.now()}`,
  `/api/trip?from=2150106&to=2022100&b=${Date.now()}`,
  `/api/nearby?lat=-33.8688&lon=151.2093&b=${Date.now()}`,
  `/api/alerts?b=${Date.now()}`,
];
let bad = 0;
for (const p of paths) {
  const res = await Promise.all(Array.from({ length: n }, (_, i) =>
    fetch(base + p, { headers: { "cf-connecting-ip": `10.30.${i}.${(Date.now() / 1000) & 255}` } }).then((r) => r.status, () => "fetch failed")));
  const counts = {};
  for (const s of res) counts[s] = (counts[s] || 0) + 1;
  const fails = res.filter((s) => s !== 200).length;
  bad += fails;
  console.log(p.split("?")[0], JSON.stringify(counts));
}
process.exit(bad ? 1 : 0);
