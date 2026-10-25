// Platform view: the parts with no phone dependencies (unit tested in test/platform.test.mjs).
// One train or metro at a station, full screen: its platform, carriages (only when live data reports them), the
// stops it calls at after this station, and the next two services. Every value comes from the departures and
// service answers the server already sends; nothing is guessed and no station is written in here.

export type PlatformDep = {
  mode?: string | null; line?: string | null; color?: string | null; dest?: string | null; description?: string | null;
  platform?: string | null; stopId?: string | null; tripId?: string | null; planned?: string | null; estimated?: string | null;
  realtime?: boolean | null; cancelled?: boolean | null; departed?: boolean | null; vehicle?: { cars?: number | null } | null;
};
export type ServiceStop = { id?: string | null; name?: string | null; lat?: number | null; lon?: number | null; skipped?: boolean | null; mine?: boolean | null };
/** A station from the lists the server publishes: [id, name, lat, lon]. */
export type StationRow = [string, string, number, number];

export const isRail = (mode?: string | null) => mode === 'train' || mode === 'metro';

const t = (s?: string | null) => (s ? new Date(s).getTime() : NaN);
/** The time a row stands for: the live estimate when there is one, else the timetable time. */
export function depTime(d: PlatformDep): number {
  const e = t(d.estimated);
  return d.realtime && Number.isFinite(e) ? e : t(d.planned);
}

/** Train and metro rows still to come (a minute's grace), soonest first. Cancelled and departed rows are left out. */
export function railRows<T extends PlatformDep>(items: T[] | null | undefined, now: number): T[] {
  return (items || [])
    .filter((d) => d && isRail(d.mode) && !d.cancelled && !d.departed && Number.isFinite(depTime(d)) && depTime(d) >= now - 60000)
    .sort((a, b) => depTime(a) - depTime(b));
}

export type Pick = { trip?: string | null; planned?: string | null; line?: string | null };

/**
 * The service to show and the two after it. With a pick (from a held row), that service when it is still on the
 * board; otherwise, or once it has gone, the next train or metro. The next two are the services after it at this
 * station, on any platform.
 */
export function pickService<T extends PlatformDep>(items: T[] | null | undefined, now: number, pick?: Pick | null): { main: T | null; next: T[]; picked: boolean } {
  const rows = railRows(items, now);
  let i = -1;
  if (pick && pick.trip) i = rows.findIndex((d) => d.tripId === pick.trip && (!pick.planned || d.planned === pick.planned));
  if (i < 0 && pick && pick.planned && pick.line) i = rows.findIndex((d) => d.planned === pick.planned && d.line === pick.line);
  const picked = i >= 0;
  if (i < 0) i = rows.length ? 0 : -1;
  if (i < 0) return { main: null, next: [], picked: false };
  return { main: rows[i], next: rows.slice(i + 1, i + 3), picked };
}

/** "23" from "Platform 23", "1A" from "Platform 1A"; null when the data gives no platform. */
export function platformNo(p?: string | null): string | null {
  const s = String(p || '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const m = /^(?:platform|plat\.?|pl\.?)\s*(.+)$/i.exec(s);
  const v = (m ? m[1] : s).trim();
  return v || null;
}

/** Carriages, only when the live data reports a sensible count; never a guess. */
export function carsOf(d: PlatformDep | null | undefined): number | null {
  const n = d && d.vehicle ? d.vehicle.cars : null;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 16 ? n : null;
}

/** "Limited Stops" or "All stops" only when the service's own description says so; otherwise null. */
export function stoppingTag(d: PlatformDep | null | undefined): 'Limited Stops' | 'All stops' | null {
  const s = String((d && d.description) || '');
  if (/\blimited stops\b/i.test(s)) return 'Limited Stops';
  if (/\ball (stations|stops)\b/i.test(s)) return 'All stops';
  return null;
}

/** A stop's plain name: "Green Square" from "Green Square Station, Platform 2". Empty when the name is missing. */
export function plainStop(n?: string | null): string {
  return String(n || '')
    .replace(/,\s*(platform|stand|wharf)\b.*$/i, '')
    .replace(/^,.*$/, '')
    .replace(/,.*$/, '')
    .replace(/\s+(Station|Light Rail|Wharf)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Metres between two points (equirectangular; plenty for stations a few hundred metres apart). */
export function metres(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const k = Math.PI / 180;
  const x = (bLon - aLon) * k * Math.cos(((aLat + bLat) / 2) * k);
  const y = (bLat - aLat) * k;
  return Math.sqrt(x * x + y * y) * 6371000;
}

/** The station a stop belongs to: the nearest one in the published list, within `maxM` metres. */
export function nearestStation(lat: number | null | undefined, lon: number | null | undefined, list: StationRow[] | null | undefined, maxM = 600): StationRow | null {
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best: StationRow | null = null, bestM = Infinity;
  for (const s of list || []) {
    if (!s || typeof s[2] !== 'number' || typeof s[3] !== 'number') continue;
    const m = metres(lat, lon, s[2], s[3]);
    if (m < bestM) { bestM = m; best = s; }
  }
  return best && bestM <= maxM ? best : null;
}

/** A stop's name, or when the stop list sent none, the name of the station it sits at (by place). Empty when unknown. */
export function stopName(s: ServiceStop, stations?: StationRow[] | null): string {
  const own = plainStop(s.name);
  if (own) return own;
  const st = nearestStation(s.lat, s.lon, stations);
  return st ? plainStop(st[1]) : '';
}

/** Where this station sits in the service's stop list: the server's index, else the row's own stop, else the station's name. */
export function stationIndex(stops: ServiceStop[] | null | undefined, o: { mineIndex?: number | null; stopId?: string | null; station?: string | null }): number {
  const list = stops || [];
  if (typeof o.mineIndex === 'number' && o.mineIndex >= 0 && o.mineIndex < list.length) return o.mineIndex;
  let i = list.findIndex((s) => !!s && !!s.mine);
  if (i >= 0) return i;
  if (o.stopId) { i = list.findIndex((s) => !!s && s.id === o.stopId); if (i >= 0) return i; }
  const want = plainStop(o.station).toLowerCase();
  if (want) { i = list.findIndex((s) => !!s && plainStop(s.name).toLowerCase() === want); if (i >= 0) return i; }
  return -1;
}

/** names: the stops it calls at; unnamed: stops with no name we could find; skipped: named stops the service passes. */
export type StopsAfter = { names: string[]; unnamed: number; skipped?: string[] } | null;

/**
 * The stops after this station, in order, skipped stops taken out. null when the list does not include this
 * station (a mismatched or missing list), so the screen says the stops are not known rather than showing wrong ones.
 */
export function stopsAfter(stops: ServiceStop[] | null | undefined, o: { mineIndex?: number | null; stopId?: string | null; station?: string | null }, stations?: StationRow[] | null): StopsAfter {
  const list = stops || [];
  const i = stationIndex(list, o);
  if (i < 0) return null;
  const names: string[] = [];
  const skipped: string[] = [];
  let unnamed = 0;
  for (const s of list.slice(i + 1)) {
    if (!s) continue;
    if (s.skipped) { const n = stopName(s, stations); if (n && !skipped.includes(n)) skipped.push(n); continue; }
    const n = stopName(s, stations);
    if (!n) { unnamed++; continue; }
    if (names[names.length - 1] !== n) names.push(n);
  }
  return skipped.length ? { names, unnamed, skipped } : { names, unnamed };
}

/** "Green Square, Mascot and Macarthur". */
export function listWords(names: string[]): string {
  if (!names.length) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The destination without the state suffix: "Macarthur via Airport". */
export function destName(d?: string | null): string {
  return String(d || '').split(',')[0].replace(/\s+Station$/i, '').trim();
}

/** True when the destination or the stops ahead include an airport station (the plane mark beside the destination). */
export function viaAirport(dest?: string | null, names?: string[] | null): boolean {
  return /\bairport\b/i.test(String(dest || '')) || (names || []).some((n) => /\bairport\b/i.test(n));
}

/**
 * One line for VoiceOver and TalkBack, and the words the Speak button says:
 * "Platform 23, 8 cars, departs in 4 minutes, stops at Green Square, Mascot and Macarthur".
 * `when` is the time part as words ("departs in 4 minutes", "not tracking, timetable 10:55pm").
 */
export function platformSentence(o: { platform?: string | null; cars?: number | null; when: string; stops?: StopsAfter; tag?: string | null }): string {
  const p = platformNo(o.platform);
  const parts = [p ? `Platform ${p}` : 'Platform not given yet'];
  if (o.cars) parts.push(`${o.cars} cars`);
  if (o.when) parts.push(o.when);
  if (o.tag) parts.push(o.tag.toLowerCase());
  if (o.stops && o.stops.names.length) parts.push(`stops at ${listWords(o.stops.names)}`);
  if (o.stops && o.stops.skipped && o.stops.skipped.length) parts.push(`not stopping at ${listWords(o.stops.skipped)}`);
  return parts.join(', ');
}

/** What Speak says: the service first, then the same facts as the screen reader line. */
export function speakSentence(o: { line?: string | null; mode?: string | null; dest?: string | null; platform?: string | null; cars?: number | null; when: string; stops?: StopsAfter; tag?: string | null }): string {
  const what = [String(o.line || '').trim() || (o.mode === 'metro' ? 'Metro' : 'Train'), 'to', destName(o.dest)].filter(Boolean).join(' ');
  return `${what}. ${platformSentence(o)}.`;
}

/** Two columns (board left, next services and stops right) once the window is wide enough; by width, never by device. */
export const WIDE_MIN = 720;
export function platformLayout(width: number, fontScale = 1): { wide: boolean; big: number; stopCols: number } {
  const w = Number.isFinite(width) && width > 0 ? width : 390;
  const wide = w >= WIDE_MIN;
  const fs = Math.min(Math.max(fontScale || 1, 0.8), 2.2);
  // The minutes figure: large on a phone, larger on a wide window, growing with the text size within reason.
  const base = wide ? 92 : 76;
  const big = Math.round(Math.min(base * Math.min(fs, 1.5), wide ? 132 : 112));
  // The stop list runs in two columns unless the text is very large or the column is narrow.
  const colW = wide ? w / 2 - 48 : w - 40;
  const stopCols = fs >= 1.6 || colW < 300 ? 1 : 2;
  return { wide, big, stopCols };
}

/** How many stop names to show before "and N more": all of them up to `max`. */
export function stopsShown(names: string[], max: number): { shown: string[]; more: number } {
  if (names.length <= max) return { shown: names, more: 0 };
  // Keep the last stop (the destination) visible at the end.
  const head = names.slice(0, Math.max(1, max - 1));
  return { shown: [...head, names[names.length - 1]], more: names.length - head.length - 1 };
}

/** The time part of the spoken line, from the shared live label (liveLabelCore.liveState). */
export function whenWords(s: { kind: string; big: string; unit: string; counting: boolean } | null | undefined): string {
  if (!s || !s.big) return '';
  if (s.kind === 'cancelled') return 'cancelled';
  if (s.kind === 'stale') return `not tracking, timetable ${s.big}`;
  if (!s.counting) return `departs at ${s.big}`;
  if (s.big === 'Now') return 'departs now';
  const hm = /^(\d+)h (\d+)$/.exec(s.big);
  if (hm) return `departs in ${hm[1]} hour${hm[1] === '1' ? '' : 's'} ${hm[2]} minute${hm[2] === '1' ? '' : 's'}`;
  if (/^\d+$/.test(s.big)) return `departs in ${s.big} minute${s.big === '1' ? '' : 's'}`;
  return `departs ${s.big}`;
}
