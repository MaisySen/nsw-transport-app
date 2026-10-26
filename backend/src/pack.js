// ---------- On phone timetable packs (docs/TIMETABLE_PACKS.md) ----------
// One stop's timetable for today and tomorrow, small enough to keep on the phone, so a saved stop shows its departures
// the moment it opens, with no signal too, and live times are laid on top when the board answer lands. Built in the
// board engine's Durable Object from the timetable it already holds (engine.js), shared through Cloudflare's cache per
// stop and timetable version. This file is appended to worker.js after engine.js by build.mjs (same module) and adds
// the object's /pack path without changing engine.js.
//
// Pack format (v 1), all times in seconds:
//   { v, stop: { id, name }, ver, builtAt, generatedAt, base, until,
//     lines: [[line, mode, color, modeName, description]], heads: [headsign], plats: [[stopId, platform, stopName]],
//     rows: [dt, line index, head index, plat index, ...] }
// rows is flat, four numbers per departure in time order; dt is seconds after the previous departure (the first after
// base, epoch seconds). until is the end of the last service day covered. Trip ids are left out: a row on the phone is
// a timetable time until the live board names the service.

const PACK_DAYS = 2;
const PACK_EDGE_S = 6 * 3600;
const PACK_NOT_IN_SERVICE = /^(empty train|not in service)$/i;

function packBuild(src, m, stopId, now, ndays) {
  const me = src.stop(stopId);
  if (!me) return null;
  const kids = [stopId, ...src.children(stopId)];
  const all = Object.keys(m.days).sort();
  const today = engDayKey(now);
  const keys = all.filter((d) => d >= today).slice(0, Math.max(1, Math.min(3, ndays || PACK_DAYS)));
  if (!keys.length) return null;
  const prev = all.filter((d) => d < today).pop();
  const lines = [], lineIx = new Map(), heads = [], headIx = new Map(), plats = [], platIx = new Map();
  const li = (ri) => {
    if (lineIx.has(ri)) return lineIx.get(ri);
    const r = src.route(ri) || ["", 5, "", "", "", ""];
    const mode = modeOf(r[1]);
    lineIx.set(ri, lines.length);
    lines.push([r[0], mode.key, lineColor(r[0], r[1]) || r[2] || mode.color, mode.name, r[5] || ""]);
    return lines.length - 1;
  };
  const hi = (h) => { if (!headIx.has(h)) { headIx.set(h, heads.length); heads.push(src.head(h) || ""); } return headIx.get(h); };
  const pi = (sid, cls) => {
    const k = sid + "|" + (cls === 5 || cls === 11 || cls === 7 ? "s" : "p");
    if (platIx.has(k)) return platIx.get(k);
    const st = src.stop(sid) || ["", "", ""];
    platIx.set(k, plats.length);
    plats.push([sid, (src.plat && src.plat(sid)) || engPlatform(st[0], st[2], cls), st[0] || ""]);
    return plats.length - 1;
  };
  const out = [];
  let covered = false;
  for (const d of prev ? [prev, ...keys] : keys) {
    const start = m.days[d];
    for (const k of kids) {
      const rs = src.rows(k, d);
      if (rs === null) continue;
      covered = true;
      for (const r of rs) {
        // Yesterday's service day only for the rows after midnight (they are today's departures).
        if (d === prev && r[0] < 86400) continue;
        const route = src.route(r[2]);
        if (!route) continue;
        // Trains run with no passengers ("Empty Train") are in the timetable but on no planner board.
        if (PACK_NOT_IN_SERVICE.test(src.head(r[3]) || "")) continue;
        out.push([start + r[0], li(r[2]), hi(r[3]), pi(k, route[1])]);
      }
    }
  }
  if (!covered) return null;
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const base = out.length ? out[0][0] : m.days[keys[0]];
  const rows = [];
  let last = base;
  for (const r of out) { rows.push(r[0] - last, r[1], r[2], r[3]); last = r[0]; }
  const lastKey = keys[keys.length - 1];
  return {
    v: 1, stop: { id: stopId, name: me[1] ? engPlaceName(me[0]) : me[0] }, ver: m.ver, builtAt: m.builtAt || null,
    generatedAt: now, base, until: m.days[lastKey] + 86400 + 4 * 3600, days: [prev, ...keys].filter(Boolean),
    lines, heads, plats, rows,
  };
}

if (typeof BoardEngine === "function") {
  BoardEngine.prototype.pack = function (stopId, ndays) {
    const m = this.loadMeta();
    if (!m) return { error: "no timetable" };
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(stopId || "")) return { error: "bad stop" };
    const p = packBuild(this.source(), m, stopId, Date.now(), ndays);
    return p || { error: "no timetable for this stop" };
  };
  const engineFetch = BoardEngine.prototype.fetch;
  BoardEngine.prototype.fetch = async function (req) {
    const u = new URL(req.url);
    if (u.pathname === "/pack") {
      try {
        const body = this.pack(u.searchParams.get("stop") || "", Number(u.searchParams.get("days")) || PACK_DAYS);
        return Response.json(body, { status: body.error ? (body.error === "no timetable" ? 503 : 404) : 200 });
      } catch (e) {
        return Response.json({ error: String((e && e.message) || e) }, { status: 500 });
      }
    }
    return engineFetch.call(this, req);
  };
}

// GET /api/pack?stop=ID: one stop's pack. Cached at the edge per stop, Sydney day and timetable version for 6 hours,
// and on the phone for the day (cache-control 1 hour; the app keeps its own copy until the pack runs out).
async function packAnswer(env, ctx, url, headers) {
  const hdr = { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", ...(headers || {}) };
  const stop = String(url.searchParams.get("stop") || "").trim();
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(stop)) return new Response('{"error":"Give stop=id"}', { status: 400, headers: hdr });
  if (typeof engineCall !== "function") return new Response('{"error":"No timetable right now."}', { status: 503, headers: hdr });
  const ck = new Request("https://engine-cache.transportsydney.app/pack?stop=" + encodeURIComponent(stop) + "&day=" + engDayKey(Date.now()));
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache) {
    const hit = await cache.match(ck).catch(() => null);
    // Only good packs are kept (27 Oct); an older kept 404 is passed over and asked again.
    if (hit && hit.status === 200) {
      const text = await hit.text();
      const etag = hit.headers.get("etag") || (await packTag(text));
      return new Response(text, { status: 200, headers: { ...hdr, "cache-control": "public, max-age=3600", etag, "x-edge-cache": "hit" } });
    }
  }
  const r = await engineCall(env, "/pack?stop=" + encodeURIComponent(stop) + "&days=" + PACK_DAYS);
  const body = await r.text();
  // No timetable for this stop (a private ferry, some coaches): the phone keeps no pack and uses the live board. An
  // answer that is not a pack is never kept, so a stop that gains a timetable gets it on the next ask.
  if (r.status === 404) return new Response(body, { status: 404, headers: { ...hdr, "cache-control": "no-store" } });
  if (r.status !== 200) return new Response('{"error":"No timetable right now."}', { status: 503, headers: { ...hdr, "cache-control": "no-store" } });
  // A strong ETag (a hash of the bytes): a phone that sends it back as If-None-Match gets a 304 (worker.js finishAnswer).
  const etag = await packTag(body);
  if (cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(ck, new Response(body, { headers: { "content-type": "application/json", "cache-control": "public, max-age=" + PACK_EDGE_S, etag } })).catch(() => {}));
  return new Response(body, { headers: { ...hdr, "cache-control": "public, max-age=3600", etag } });
}
async function packTag(text) {
  if (typeof etagOf === "function") return etagOf(text);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text)));
  return '"' + [...h.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("") + '"';
}
