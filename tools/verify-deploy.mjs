#!/usr/bin/env node
// Checks api.transportsydney.app after a server deploy. Every line must say ok; it exits 1 if any does not.
//
//   node tools/verify-deploy.mjs          no Transport for NSW call (safe while the daily quota is out)
//   node tools/verify-deploy.mjs --live   also asks a live board and a trip (a few NSW calls; skip when the
//                                         quota is out, the server then answers from the timetable)
//
// It makes and ends one shared live trip link (a throwaway, deleted at once). It prints no secret.
const API = process.env.API || "https://api.transportsydney.app";
const LIVE = process.argv.includes("--live");
let bad = 0;
async function call(path, init = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(API + path, { ...init, signal: AbortSignal.timeout(20000) });
    const text = await r.text();
    let body = null; try { body = JSON.parse(text); } catch {}
    return { status: r.status, body, text, ms: Date.now() - t0 };
  } catch (e) { return { status: 0, body: null, text: String(e.message || e), ms: Date.now() - t0 }; }
}
function check(name, ok, detail) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(34)} ${detail}`);
}
const lines = await call("/api/lines");
check("/api/lines", lines.status === 200 && lines.body && "items" in lines.body, `${lines.status} ${lines.ms} ms`);
const tw = await call("/api/trackwork");
check("/api/trackwork", tw.status === 200 && tw.body && tw.body.enabled !== undefined, `${tw.status} ${tw.ms} ms`);
const h = await call("/api/health");
check("/api/health without key is 403", h.status === 403, `${h.status}`);
const us = await call("/api/usual?s=T1~200060");
check("/api/usual", us.status === 200 && us.body && Array.isArray(us.body.items), `${us.status} ${us.ms} ms`);
const st = await call("/api/stations?mode=train");
check("/api/stations?mode=train", st.status === 200 && Array.isArray(st.body) && st.body.length > 100, `${st.status} ${Array.isArray(st.body) ? st.body.length : 0} stations`);
const pk = await call("/api/parking?live=0");
check("/api/parking?live=0", pk.status === 200 && pk.body && Array.isArray(pk.body.carparks) && pk.body.carparks.length > 10, `${pk.status} ${pk.body && pk.body.carparks ? pk.body.carparks.length : 0} car parks`);
const cfg = await call("/api/app/config?platform=ios");
check("/api/app/config", cfg.status === 200 && cfg.body && cfg.body.flags, `${cfg.status}`);
const page = await call("/live/");
check("/live/ page", page.status === 200 && /<html/i.test(page.text), `${page.status}`);
const nf = await call("/no-such-page");
check("unknown path is 404", nf.status === 404, `${nf.status}`);
// Shared live trip link: make, open, end.
const legs = [{ stopId: "200060", planned: Date.now() + 600000, line: "T1", mode: "train", dest: "Strathfield" }];
const mk = await call("/api/share", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ device: "deploy-check", title: "Deploy check", from: { id: "200060", name: "Central" }, to: { id: "213510", name: "Strathfield" }, legs }) });
const id = mk.body && mk.body.id, key = mk.body && mk.body.key;
check("shared link made", mk.status === 200 && !!id, `${mk.status}`);
if (id) {
  const g = await call("/api/share?id=" + encodeURIComponent(id));
  check("shared link opens", g.status === 200 && g.body && g.body.title === "Deploy check", `${g.status}`);
  const d = await call("/api/share?id=" + encodeURIComponent(id), { method: "DELETE", headers: { "x-share-key": key } });
  const g2 = await call("/api/share?id=" + encodeURIComponent(id));
  check("shared link ended", d.status === 200 && g2.status === 404, `${d.status} then ${g2.status}`);
}
if (LIVE) {
  const dep = await call("/api/departures?stop=200060&mode=train");
  const firstList = (b) => (Array.isArray(b) ? b : Object.values(b || {}).find(Array.isArray)) || [];
  const n = firstList(dep.body).length;
  check("/api/departures Central (live)", dep.status === 200 && n > 0, `${dep.status} ${n} rows ${dep.ms} ms `);
  const tr = await call("/api/trip?from=200060&to=213510");
  const j = firstList(tr.body).length;
  check("/api/trip Central to Strathfield", tr.status === 200 && j > 0, `${tr.status} ${j} items ${tr.ms} ms`);
}
console.log(bad ? `${bad} check(s) failed: roll back (RUNBOOK section 2) unless you know why` : "all checks passed");
process.exit(bad ? 1 : 0);
