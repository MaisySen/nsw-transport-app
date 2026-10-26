// Buses: stop numbers, route numbers and where the buses on a route are. Pure, so it is unit tested.
//
// Stop numbers: Transport for NSW prints a 6 or 7 digit number on every bus stop sign.
// It is the stop's own id in the timetable data, so /api/departures?stop=2046100 answers for it directly.
// Route view: /api/stations?mode=bus&route=410 gives each direction's stops in order. Where the buses are comes
// from the departure boards of a few stops along the route: each upcoming 410 there says how many stops away it
// is, so its place on the route is that stop's position minus the stops away. No new server is needed.

export type RouteStop = { id: string; name: string; lat?: number; lon?: number };
export type RouteDir = { to: string; stops: RouteStop[] };
export type BoardItem = { line: string; dest?: string; tripId?: string; planned: string; estimated?: string | null; realtime?: boolean; delayMin?: number | null;
  stopId?: string; stopsAway?: number | null; vehicle?: { lat: number; lon: number; bearing?: number | null; occupancy?: { level?: number; text?: string } | null; label?: string } | null; cancelled?: boolean };
export type RouteBus = { tripId: string; pos: number; lat: number; lon: number; bearing?: number | null; delayMin: number | null; realtime: boolean; occupancy?: string | null };

const BUSLIKE = new Set(['bus', 'coach', 'school']);

/** The number on the stop sign, for a bus or coach stop id ("2046100"); null for station ids and other modes. */
export function stopNumber(id?: string | null, mode?: string | null): string | null {
  if (!id) return null;
  const v = String(id).trim();
  if (!/^\d{5,8}$/.test(v)) return null;
  if (mode && !BUSLIKE.has(mode)) return null;
  return v;
}

/** "Stop 2046100", or '' when there is no stop number to show. */
export function stopLabel(id?: string | null, mode?: string | null): string {
  const n = stopNumber(id, mode);
  return n ? `Stop ${n}` : '';
}

/** What you typed is a stop number from a sign (6 or 7 digits). */
export function isStopNumber(q: string): boolean {
  return /^\d{6,7}$/.test(q.trim());
}

/** What you typed could be a bus route: 410, 501, M90, B1, D400, 333, 438X, 610X, T80. Not a stop number. */
export function routeQuery(q: string): string | null {
  const v = q.trim().toUpperCase().replace(/^ROUTE\s+/, '').replace(/^BUS\s+/, '');
  if (!v || v.length > 5 || isStopNumber(v)) return null;
  return /^([A-Z]{1,2}\d{1,3}[A-Z]?|\d{1,4}[A-Z]{0,2}\d?)$/.test(v) && /\d/.test(v) ? v : null;
}

/** /api/stations?mode=bus&route= answers [{ to, stops: [[id, name, lat, lon]] }]. */
export function routeDirs(raw: any): RouteDir[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((d) => d && Array.isArray(d.stops) && d.stops.length > 1).map((d) => ({
    to: String(d.to || ''),
    stops: d.stops.map((s: any) => Array.isArray(s) ? { id: String(s[0]), name: String(s[1] || ''), lat: typeof s[2] === 'number' ? s[2] : undefined, lon: typeof s[3] === 'number' ? s[3] : undefined }
      : { id: String(s.id), name: String(s.name || ''), lat: s.lat, lon: s.lon }),
  }));
}

/** Which direction to open: the one that stops at `stopId`, else the one heading to `towards`, else the first. */
export function pickDir(dirs: RouteDir[], stopId?: string | null, towards?: string | null): number {
  if (stopId) { const i = dirs.findIndex((d) => d.stops.some((s) => s.id === String(stopId))); if (i >= 0) return i; }
  if (towards) {
    const t = towards.toLowerCase();
    const i = dirs.findIndex((d) => d.to && (d.to.toLowerCase().includes(t) || t.includes(d.to.toLowerCase())));
    if (i >= 0) return i;
  }
  return 0;
}

/** The stops whose boards are read for live buses: a third of the way, two thirds and the stop before the end. */
export function probeStops(n: number): number[] {
  if (n < 2) return [];
  return Array.from(new Set([Math.floor(n / 3), Math.floor((2 * n) / 3), n - 2])).filter((i) => i >= 0 && i < n - 1).sort((a, b) => a - b);
}

/**
 * The buses on the route now, from the boards of the probe stops. A bus is placed at the probe stop minus its stops
 * away; the nearest probe ahead of it is used (its count is the most exact). Each bus once, in route order.
 */
export function busesOn(line: string, probes: { idx: number; items: BoardItem[] | null | undefined }[]): RouteBus[] {
  const best = new Map<string, { b: RouteBus; away: number }>();
  for (const p of probes) {
    for (const it of p.items || []) {
      if (it.line !== line || it.cancelled || !it.vehicle || it.stopsAway == null || !it.tripId) continue;
      const away = Number(it.stopsAway);
      if (!(away >= 0)) continue;
      const pos = p.idx - away;
      if (pos < 0) continue;
      const prev = best.get(it.tripId);
      if (prev && prev.away <= away) continue;
      best.set(it.tripId, { away, b: { tripId: it.tripId, pos, lat: it.vehicle.lat, lon: it.vehicle.lon, bearing: it.vehicle.bearing ?? null,
        delayMin: it.delayMin ?? null, realtime: !!it.realtime, occupancy: it.vehicle.occupancy?.text || null } });
    }
  }
  return [...best.values()].map((x) => x.b).sort((a, b) => b.pos - a.pos);
}

/** The bus coming next to stop `i`: the nearest one at or before it, and how many stops away it is. */
export function nextBusAt(i: number, buses: RouteBus[]): { bus: RouteBus; away: number } | null {
  let pick: RouteBus | null = null;
  for (const b of buses) if (b.pos <= i && (!pick || b.pos > pick.pos)) pick = b;
  return pick ? { bus: pick, away: i - pick.pos } : null;
}

/** "Arriving", "1 stop away", "5 stops away". */
export function awayWords(n: number): string {
  return n <= 0 ? 'At the stop' : n === 1 ? '1 stop away' : `${n} stops away`;
}

/** The next departures of `line` on one stop's board, soonest first, gone ones dropped. */
export function lineTimes(items: BoardItem[] | null | undefined, line: string, now: number, max = 3): BoardItem[] {
  const t = (d: BoardItem) => Date.parse((d.realtime && d.estimated) || d.planned);
  return (items || []).filter((d) => d.line === line && !d.cancelled && t(d) > now - 30000).sort((a, b) => t(a) - t(b)).slice(0, max);
}

/** The bus lines at a stop, for the "Routes here" row: unique, in number order (410 before 438X before M90). */
export function linesHere(items: { line: string; mode: string; color?: string }[] | null | undefined): { line: string; mode: string; color?: string }[] {
  const seen = new Map<string, { line: string; mode: string; color?: string }>();
  for (const d of items || []) if (d.line && BUSLIKE.has(d.mode) && !seen.has(d.line)) seen.set(d.line, { line: d.line, mode: d.mode, color: d.color });
  const key = (l: string) => { const m = /^([A-Z]*)(\d+)(.*)$/i.exec(l); return m ? [m[1] ? 1 : 0, Number(m[2]), m[1] + m[3]] as const : [2, 0, l] as const; };
  return [...seen.values()].sort((a, b) => { const x = key(a.line), y = key(b.line); return x[0] - y[0] || x[1] - y[1] || String(x[2]).localeCompare(String(y[2])); });
}

/** Where to board, in words: "Concord Oval, Parramatta Rd, Stand X1, Stop 213723". The stand only when the name lacks it. */
export function boardWords(name?: string | null, platform?: string | null, stopId?: string | null, mode?: string | null): string {
  const parts = [String(name || '').trim()].filter(Boolean);
  const p = String(platform || '').trim();
  if (p && !parts[0]?.toLowerCase().includes(p.toLowerCase())) parts.push(p);
  const n = stopNumber(stopId, mode);
  if (n) parts.push(`Stop ${n}`);
  return parts.join(', ');
}


// ---- The bus picker: which routes lead, and how a route reads ----

/** A stop number starts with its postcode; Sydney's are 2000 to 2249, Macarthur 2555 to 2574, and the west 2740 to 2772. */
export function sydneyPostcode(pc: number): boolean {
  return (pc >= 2000 && pc <= 2249) || (pc >= 2555 && pc <= 2574) || (pc >= 2740 && pc <= 2772);
}
/** A stop (by its number) in Sydney. Ids that are not stop numbers count as Sydney. */
export function sydneyStop(id: string): boolean {
  const s = String(id || '');
  return !/^\d{6,7}$/.test(s) || sydneyPostcode(+s.slice(0, 4));
}
/** A route number used in Sydney and elsewhere has directions from both; keep the side of the stop you are at, else Sydney. */
export function regionDirs<D extends { stops: any[] }>(dirs: D[], at?: string | null, idOf: (s: any) => string = (s) => (Array.isArray(s) ? String(s[0]) : String(s?.id))): D[] {
  const syd = (d: D) => { const ids = d.stops.map(idOf).filter((x) => /^\d{6,7}$/.test(x)); return !ids.length || ids.filter(sydneyStop).length * 2 >= ids.length; };
  const want = at && /^\d{6,7}$/.test(String(at)) ? sydneyStop(String(at)) : true;
  const keep = dirs.filter((d) => syd(d) === want);
  return keep.length ? keep : dirs;
}

export type BusGroup = 'sydney' | 'replacement' | 'school' | 'regional';
/**
 * Which list a route belongs in. Trackwork buses carry the line they replace after the number (1T9, 2AT9, 1L1, 10HU,
 * 3SH, 2CN); school routes start with S and three digits or say school; routes whose services all run outside
 * Sydney (from the route data, see busGroups.gen.ts) are regional; the rest are Sydney routes.
 */
export function busGroup(code: string, desc: string, regional: ReadonlySet<string>): BusGroup {
  const c = String(code || '').toUpperCase();
  if (/^\d+[A-Z]?(T\d|L\d|HU|SH|CN|SCO|BMT)$/.test(c) || /^\d+A(T\d|HU)$/.test(c)) return 'replacement';
  if (/^S\d{3}$/.test(c) || /\bschools?\b/i.test(desc || '')) return 'school';
  if (regional.has(code)) return 'regional';
  return 'sydney';
}

/** Natural route order: 400, 410, 438X, then letters (B1, D400, M30, M90, N10), each by its number. */
export function routeCmp(a: string, b: string): number {
  const pa = /^([A-Z]*)(\d*)(.*)$/i.exec(a) || ['', '', '', a], pb = /^([A-Z]*)(\d*)(.*)$/i.exec(b) || ['', '', '', b];
  if (!pa[1] !== !pb[1]) return pa[1] ? 1 : -1;
  if (pa[1] !== pb[1]) return pa[1].localeCompare(pb[1]);
  const na = pa[2] ? +pa[2] : Infinity, nb = pb[2] ? +pb[2] : Infinity;
  if (na !== nb) return na - nb;
  return pa[3].localeCompare(pb[3]);
}

/** "Hurstville to Macquarie Park" as two lines: from and to (the via part goes with to). */
export function routeEnds(desc: string, sydneyTo?: string[]): { from: string; to: string } {
  if (sydneyTo && sydneyTo.length) return { from: '', to: sydneyTo.map((t) => t.replace(/ Via /g, ' via ')).join(', or ') };
  const d = String(desc || '').replace(/\s+/g, ' ').trim();
  if (!d || /^unknown$/i.test(d)) return { from: '', to: '' };
  const i = d.indexOf(' to ');
  return i > 0 ? { from: d.slice(0, i), to: d.slice(i + 4) } : { from: '', to: d };
}

/** Routes matching what was typed: number first (410 finds 410, 410X), then by place name; Sydney before the rest. */
export function matchRoutes(routes: Record<string, string>, q: string, regional: ReadonlySet<string>, limit = 30): string[] {
  const up = String(q || '').trim().toUpperCase().replace(/^ROUTE\s+/, ''), lo = up.toLowerCase();
  if (!up) return [];
  const keys = Object.keys(routes);
  const rank = (r: string) => (busGroup(r, routes[r], regional) === 'sydney' ? 0 : 1);
  const byNum = keys.filter((r) => r.toUpperCase().startsWith(up)).sort((a, b) => rank(a) - rank(b) || (a.toUpperCase() === up ? -1 : b.toUpperCase() === up ? 1 : 0) || routeCmp(a, b));
  const byName = /[a-z]{3}/i.test(up) ? keys.filter((r) => !byNum.includes(r) && routes[r].toLowerCase().includes(lo)).sort((a, b) => rank(a) - rank(b) || routeCmp(a, b)) : [];
  return [...byNum, ...byName].slice(0, limit);
}
