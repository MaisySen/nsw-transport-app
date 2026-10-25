// Simple mode (More > Simple mode, off by default): one screen, TripView Lite style. "Here" (the nearest stop or
// stand) and a page per saved trip, each a plain list of the next services. Pure logic, unit tested in Node.

export type SimpleStop = { id: string; name: string; distance?: number | null };
export type HereChoice = { id: string; place: string; stand: string; distance: number | null };

/** "Strathfield Station, Everton Rd, Stand D, Strathfield": the place, and the stand or platform part. */
export function splitStopName(name: string): { place: string; stand: string } {
  const parts = String(name || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length <= 1) return { place: parts[0] || '', stand: '' };
  // The last part is the suburb when there are three or more parts.
  const mid = parts.length >= 3 ? parts.slice(1, -1) : parts.slice(1);
  const stand = mid.join(', ');
  return { place: parts[0], stand: stand === parts[0] ? '' : stand };
}

/** The stops near you as chips: nearest first, each once, at most `max`. */
export function hereChoices(stops: SimpleStop[] | null | undefined, max = 8): HereChoice[] {
  const seen = new Set<string>();
  const out: HereChoice[] = [];
  const list = [...(stops || [])].sort((a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9));
  for (const s of list) {
    if (!s?.id || seen.has(String(s.id))) continue;
    seen.add(String(s.id));
    const { place, stand } = splitStopName(s.name);
    out.push({ id: String(s.id), place, stand, distance: s.distance ?? null });
    if (out.length >= max) break;
  }
  return out;
}

/** The chip's words: "Stand D", "Platform 4", or "All stops" for a stop with no stand part. */
export function chipLabel(c: HereChoice): string {
  if (!c.stand) return 'All stops';
  const m = /(Stand|Platform|Wharf|Side)\s+\S+$/i.exec(c.stand);
  return m ? m[0] : c.stand;
}

const pad = (n: number) => String(n).padStart(2, '0');
export function sydneyHour(t: number): number {
  try { return Number(new Date(t).toLocaleString('en-AU', { hour: 'numeric', hour12: false, timeZone: 'Australia/Sydney' })) % 24; } catch { return new Date(t).getHours(); }
}

export type SimplePage = { kind: 'here' } | { kind: 'trip'; key: string; from: { id: string; name: string }; to: { id: string; name: string }; title: string; tag?: 'toWork' | 'toHome' };

/**
 * The page Simple mode opens on. In the morning (5am to 11am) the trip to work, in the afternoon and evening (2pm to
 * 9pm) the trip home, when Home and Work are set. Otherwise the saved trip opened most often around this hour on
 * this phone (recent trips, within two hours either side), else Here.
 */
export function defaultPage(pages: SimplePage[], now: number, recent: { from: { id: string }; to: { id: string }; at: number }[] = []): number {
  const h = sydneyHour(now);
  const find = (tag: 'toWork' | 'toHome') => pages.findIndex((p) => p.kind === 'trip' && p.tag === tag);
  if (h >= 5 && h < 11 && find('toWork') >= 0) return find('toWork');
  if (h >= 14 && h < 21 && find('toHome') >= 0) return find('toHome');
  // Hours apart on the clock face (11pm and 1am are 2 hours apart).
  const near = recent.filter((r) => Math.abs(((sydneyHour(r.at) - h + 36) % 24) - 12) <= 2);
  for (const r of near) {
    const i = pages.findIndex((p) => p.kind === 'trip' && p.from.id === r.from.id && p.to.id === r.to.id);
    if (i >= 0) return i;
  }
  return 0;
}

/** "3 min late" as said: "3 minutes late", "1 minute late". */
export const sayStatus = (status: string) => status.replace(/^(\d+) min /, (_, n) => `${n} minute${n === '1' ? '' : 's'} `).toLowerCase();

const ms = (s?: string | null) => (s ? new Date(s).getTime() : NaN);
export function clock(t: number): string {
  if (!Number.isFinite(t)) return '';
  try { return new Date(t).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Australia/Sydney' }).replace(/\s?(am|pm)/i, (m) => m.trim().toLowerCase()); }
  catch { const d = new Date(t); return `${((d.getHours() + 11) % 12) + 1}:${pad(d.getMinutes())}${d.getHours() < 12 ? 'am' : 'pm'}`; }
}

/** Whole minutes to go, as the row shows them: "Now" in the last minute, then "4 min". */
export function countdownWords(t: number, now: number): { big: string; unit: string; spoken: string } {
  const d = t - now;
  if (!Number.isFinite(d)) return { big: '', unit: '', spoken: '' };
  if (d < 60000) return { big: 'Now', unit: '', spoken: 'now' };
  const m = Math.floor(d / 60000);
  if (m >= 60) { const h = Math.floor(m / 60), r = m % 60; return { big: `${h} hr`, unit: `${r} min`, spoken: `${h} hour${h === 1 ? '' : 's'} ${r} minute${r === 1 ? '' : 's'}` }; }
  return { big: String(m), unit: 'min', spoken: `${m} minute${m === 1 ? '' : 's'}` };
}

export type DepLike = { line?: string; mode?: string; color?: string; dest?: string; planned?: string; estimated?: string | null; realtime?: boolean;
  delayMin?: number | null; cancelled?: boolean; tripId?: string; departed?: boolean };
export type SimpleDepRow = { key: string; line: string; mode: string; color?: string; dest: string; sched: string; at: number; status: string; tone: 'live' | 'late' | 'red' | 'plain'; a11y: string };

/** One departure row: line, destination, scheduled time, the status (on time, late, cancelled) and the time it leaves. */
export function depRow(d: DepLike, now: number): SimpleDepRow {
  const planned = ms(d.planned);
  const at = d.realtime && d.estimated ? ms(d.estimated) : planned;
  const late = d.realtime ? Math.round(d.delayMin ?? (at - planned) / 60000) : 0;
  const status = d.cancelled ? 'Cancelled' : !d.realtime ? 'Scheduled' : late >= 1 ? `${late} min late` : late <= -1 ? `${-late} min early` : 'On time';
  const tone = d.cancelled ? 'red' : !d.realtime ? 'plain' : late >= 2 ? 'late' : 'live';
  const dest = String(d.dest || '').split(',')[0].replace(/ Station$/, '');
  const cd = countdownWords(at, now);
  const a11y = d.cancelled ? `${d.line || ''} to ${dest}, scheduled ${clock(planned)}, cancelled`
    : `${d.line || ''} to ${dest}, scheduled ${clock(planned)}, ${sayStatus(status)}, leaves ${cd.spoken === 'now' ? 'now' : 'in ' + cd.spoken}`;
  return { key: `${d.tripId || d.line}|${d.planned}`, line: String(d.line || ''), mode: String(d.mode || ''), color: d.color, dest, sched: clock(planned), at, status, tone, a11y };
}

/** The departures still to come (and the ones in the last minute), soonest first, at most `max`. */
export function depRows(items: DepLike[] | null | undefined, now: number, max = 30): SimpleDepRow[] {
  return (items || []).filter((d) => !d.departed).map((d) => depRow(d, now)).filter((r) => Number.isFinite(r.at) && r.at > now - 60000)
    .sort((a, b) => a.at - b.at).slice(0, max);
}

export type LegLike = { kind?: string; line?: string; mode?: string; color?: string; planned?: string; estimated?: string; realtime?: boolean; fromPlatform?: string; cancelled?: boolean; delayMin?: number | null };
export type JourneyLike = { leave?: string; arrive?: string; durationMin?: number; changes?: number; legs: LegLike[] };
export type SimpleTripRow = { key: string; dep: number; arr: number; times: string; sub: string; lines: { line: string; mode: string; color?: string }[]; status: string; tone: 'live' | 'late' | 'red' | 'plain'; a11y: string };

/** One trip row: depart and arrive times, duration and changes, the platform where known, and its lines. */
export function tripRow(j: JourneyLike, now: number): SimpleTripRow {
  const rides = (j.legs || []).filter((l) => l.kind !== 'walk' && l.line);
  const f = rides[0];
  const planned = ms(f?.planned || j.leave);
  const dep = f?.realtime && f.estimated ? ms(f.estimated) : f ? ms(f.planned) : ms(j.leave);
  const arr = ms(j.arrive);
  const changes = Math.max(0, j.changes ?? rides.length - 1);
  const dur = Number.isFinite(j.durationMin) ? Math.round(j.durationMin!) : Math.round((arr - dep) / 60000);
  const plat = String(f?.fromPlatform || '').replace(/^Plat(form)?\.?\s*/i, 'Platform ').trim();
  const changeWords = changes ? `${changes} change${changes === 1 ? '' : 's'}` : 'Direct';
  const sub = [`${dur} min`, changeWords, plat].filter(Boolean).join(' \u00b7 ');
  const cancelled = rides.some((l) => l.cancelled);
  const late = f?.realtime ? Math.round(f.delayMin ?? (dep - planned) / 60000) : 0;
  const status = cancelled ? 'Cancelled' : !f?.realtime ? 'Scheduled' : late >= 1 ? `${late} min late` : 'On time';
  const tone = cancelled ? 'red' : !f?.realtime ? 'plain' : late >= 2 ? 'late' : 'live';
  const cd = countdownWords(dep, now);
  const a11y = `Leaves ${clock(dep)}, arrives ${clock(arr)}, ${dur} minutes, ${changes ? changeWords : 'no changes'}${plat ? `, ${plat}` : ''}, ${rides.map((l) => l.line).join(' then ')}, ${sayStatus(status)}${cancelled ? '' : `, leaves ${cd.spoken === 'now' ? 'now' : 'in ' + cd.spoken}`}`;
  return { key: `${j.leave}|${rides.map((l) => l.line).join('.')}`, dep, arr, times: `${clock(dep)} to ${clock(arr)}`, sub, lines: rides.map((l) => ({ line: String(l.line), mode: String(l.mode || ''), color: l.color })), status, tone, a11y };
}

/** Trips still to come, soonest first, at most `max`. */
export function tripRows(js: JourneyLike[] | null | undefined, now: number, max = 12): SimpleTripRow[] {
  return (js || []).map((j) => tripRow(j, now)).filter((r) => Number.isFinite(r.dep) && r.dep > now - 60000).sort((a, b) => a.dep - b.dep).slice(0, max);
}
