// Simple mode (More > Simple mode, off by default). Bidur, 25 Oct 9:37 PM: "User come. Look this to that place. They get
// the list like this. Thats it. For someone minimalistic, slowpace, less tech friendly users." One screen: From and
// To, your places as big rows, a plain list of trips, and big simple steps for the one you tap.
// Pure logic, no imports, unit tested in Node (test/simple.test.mjs).

export type SimplePlace = { id: string; name: string };

/** "Strathfield Station, Everton Rd, Stand D, Strathfield": the place, and the stand or platform part. */
export function splitStopName(name: string): { place: string; stand: string } {
  const parts = String(name || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length <= 1) return { place: parts[0] || '', stand: '' };
  // The last part is the suburb when there are three or more parts.
  const mid = parts.length >= 3 ? parts.slice(1, -1) : parts.slice(1);
  const stand = mid.join(', ');
  return { place: parts[0], stand: stand === parts[0] ? '' : stand };
}

/** A stop as the screen shows it: "Strathfield Station, Platform 2, Strathfield" is "Strathfield". */
export const shortPlace = (n?: string | null) => splitStopName(String(n || '')).place.replace(/ Station$/, '').trim();

// ---------- your places ----------

export type PlaceRow = { key: string; kind: 'home' | 'work' | 'recent' | 'star'; place: SimplePlace; title: string; sub: string; a11y: string };

/**
 * The big rows under From and To: Home, Work, then the places you went to most recently (newest first), then your
 * starred stops. Each place once, at most `max`. Only what this phone has saved: nothing is made up.
 */
export function simplePlaces(st: { home?: SimplePlace | null; work?: SimplePlace | null; recentTrips?: { from: SimplePlace; to: SimplePlace; at: number }[] | null; starred?: SimplePlace[] | null; recents?: SimplePlace[] | null }, max = 8): PlaceRow[] {
  const out: PlaceRow[] = [];
  const seen = new Set<string>();
  const add = (kind: PlaceRow['kind'], p: SimplePlace | null | undefined) => {
    if (!p?.id || seen.has(String(p.id)) || out.length >= max) return;
    seen.add(String(p.id));
    const { place, stand } = splitStopName(p.name);
    const short = shortPlace(p.name) || place;
    const title = kind === 'home' ? 'Home' : kind === 'work' ? 'Work' : short;
    const sub = kind === 'home' || kind === 'work' ? short : stand;
    const a11y = kind === 'home' || kind === 'work' ? `${title}, ${short}` : stand ? `${short}, ${stand}` : short;
    out.push({ key: `${kind}:${p.id}`, kind, place: { id: String(p.id), name: p.name }, title, sub, a11y });
  };
  add('home', st.home);
  add('work', st.work);
  const trips = [...(st.recentTrips || [])].sort((a, b) => (b.at || 0) - (a.at || 0));
  for (const t of trips) add('recent', t.to);
  for (const p of st.starred || []) add('star', p);
  return out;
}

/** Which field a tapped place fills: To first; From when To is already filled and From is empty; else To again. */
export function fillTarget(from: unknown, to: unknown): 'from' | 'to' {
  if (!to) return 'to';
  if (!from) return 'from';
  return 'to';
}

/**
 * "Current location" as a stop the planner takes: the station or stop named like the nearest one (search finds
 * "Strathfield Station" for the nearest "Strathfield Station, Platform 4"), else the nearest stop itself.
 */
export function nearPlace(nearest: SimplePlace | null | undefined, found: SimplePlace[] | null | undefined): SimplePlace | null {
  if (!nearest?.id) return null;
  const place = splitStopName(nearest.name).place;
  const hit = (found || []).find((x) => x?.id && splitStopName(x.name).place === place && !splitStopName(x.name).stand);
  return hit ? { id: String(hit.id), name: hit.name } : { id: String(nearest.id), name: nearest.name };
}

// ---------- times ----------

const ms = (s?: string | null) => (s ? new Date(s).getTime() : NaN);
const pad = (n: number) => String(n).padStart(2, '0');

/** "9:42pm", Sydney time. */
export function clock(t: number): string {
  if (!Number.isFinite(t)) return '';
  try { return new Date(t).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Australia/Sydney' }).replace(/\s?(am|pm)/i, (m) => m.trim().toLowerCase()); }
  catch { const d = new Date(t); return `${((d.getHours() + 11) % 12) + 1}:${pad(d.getMinutes())}${d.getHours() < 12 ? 'am' : 'pm'}`; }
}

/** "2145" for the planner's time parameter, Sydney time. */
export function hhmm(t: number): string {
  try {
    const p = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Australia/Sydney' }).formatToParts(new Date(t));
    return pad(Number(p.find((x) => x.type === 'hour')?.value || 0) % 24) + pad(Number(p.find((x) => x.type === 'minute')?.value || 0));
  } catch { const d = new Date(t); return pad(d.getHours()) + pad(d.getMinutes()); }
}

const minutesWord = (m: number) => `${m} minute${m === 1 ? '' : 's'}`;

/** Whole minutes to go: "Leaves in 4 min", "Leaves now" in the last minute, "Left" once gone. Hours past 60. */
export function leavesIn(t: number, now: number): { text: string; spoken: string } {
  const d = t - now;
  if (!Number.isFinite(d)) return { text: '', spoken: '' };
  if (d < -60000) return { text: 'Left', spoken: 'already left' };
  if (d < 60000) return { text: 'Leaves now', spoken: 'leaves now' };
  const m = Math.floor(d / 60000);
  if (m >= 60) {
    const h = Math.floor(m / 60), r = m % 60;
    return { text: `Leaves in ${h} hr${r ? ` ${r} min` : ''}`, spoken: `leaves in ${h} hour${h === 1 ? '' : 's'}${r ? ` ${minutesWord(r)}` : ''}` };
  }
  return { text: `Leaves in ${m} min`, spoken: `leaves in ${minutesWord(m)}` };
}

// ---------- the list of trips ----------

export type LegLike = { kind?: string; line?: string; mode?: string; color?: string; towards?: string; from?: string; to?: string; fromPlatform?: string; toPlatform?: string;
  fromParent?: string; toParent?: string; planned?: string; estimated?: string; arrPlanned?: string; arrEstimated?: string; realtime?: boolean; cancelled?: boolean;
  delayMin?: number | null; durationMin?: number; stops?: number; tripId?: string };
export type JourneyLike = { leave?: string; arrive?: string; durationMin?: number; changes?: number; legs: LegLike[] };
export type Tone = 'live' | 'late' | 'red' | 'plain' | 'gone';
export type TripRow = { key: string; dep: number; arr: number; leave: string; arrive: string; dur: string; changes: string; lines: { line: string; mode: string; color?: string }[];
  status: string; tone: Tone; inText: string; gone: boolean; a11y: string };

const rides = (j: JourneyLike) => (j.legs || []).filter((l) => l.kind !== 'walk');

/** The key a trip keeps across refreshes: its first service and when it was planned to leave. */
export function journeyKey(j: JourneyLike): string {
  const r = rides(j);
  return r.length ? r.map((l) => `${l.tripId || l.line || ''}@${l.planned || ''}`).join('|') : `${j.leave}|${j.arrive}`;
}

function arriveOf(j: JourneyLike): number {
  const r = rides(j);
  const last = r[r.length - 1];
  let a = ms(j.arrive);
  // The planner's arrival is the timetable one: move it by the last service's live delay.
  if (last?.realtime && last.arrEstimated && last.arrPlanned) {
    const shift = ms(last.arrEstimated) - ms(last.arrPlanned);
    if (Number.isFinite(shift)) a = Number.isFinite(a) ? a + shift : ms(last.arrEstimated);
  }
  return Number.isFinite(a) ? a : ms(last?.arrEstimated || last?.arrPlanned);
}

/** One row of the list: leave, arrive, how long, changes, lines, live status and "Leaves in N min". */
export function tripRow(j: JourneyLike, now: number): TripRow {
  const r = rides(j);
  const f = r[0];
  const planned = ms(f?.planned || j.leave);
  const dep = f ? (f.realtime && f.estimated ? ms(f.estimated) : ms(f.planned)) : ms(j.leave);
  const arr = arriveOf(j);
  const n = Math.max(0, j.changes ?? r.length - 1);
  const mins = Number.isFinite(j.durationMin) ? Math.round(j.durationMin as number) : Math.round((arr - dep) / 60000);
  const dur = mins >= 60 ? `${Math.floor(mins / 60)} hr ${mins % 60} min` : `${mins} min`;
  const changes = n ? `${n} change${n === 1 ? '' : 's'}` : 'No changes';
  const cancelled = r.some((l) => l.cancelled);
  const late = f?.realtime ? Math.round(f.delayMin ?? (dep - planned) / 60000) : 0;
  const lin = leavesIn(dep, now);
  const gone = !cancelled && lin.text === 'Left';
  const status = cancelled ? 'Cancelled' : gone ? 'Left' : !f?.realtime ? 'Timetable' : late >= 1 ? `${late} min late` : 'On time';
  const tone: Tone = cancelled ? 'red' : gone ? 'gone' : !f?.realtime ? 'plain' : late >= 2 ? 'late' : 'live';
  const said = status === 'Timetable' ? 'timetable time, no live data' : status.replace(/^(\d+) min /, (_, m) => `${minutesWord(Number(m))} `).toLowerCase();
  const lines = r.filter((l) => l.line).map((l) => ({ line: String(l.line), mode: String(l.mode || ''), color: l.color }));
  const a11y = `Leaves ${clock(dep)}, arrives ${clock(arr)}, ${mins} minutes, ${n ? changes : 'no changes'}${lines.length ? `, ${lines.map((l) => l.line).join(' then ')}` : ''}, ${said}${cancelled || gone ? '' : `, ${lin.spoken}`}.`;
  return { key: journeyKey(j), dep, arr, leave: clock(dep), arrive: clock(arr), dur, changes, lines, status, tone, inText: cancelled || gone ? '' : lin.text, gone, a11y };
}

/**
 * The trips to show, soonest first, each once. Trips that already left are dropped unless `keepGone` (the person
 * tapped Earlier); then they stay, marked Left.
 */
export function tripRows(js: JourneyLike[] | null | undefined, now: number, opts: { keepGone?: boolean; max?: number } = {}): { rows: TripRow[]; byKey: Map<string, JourneyLike> } {
  const byKey = new Map<string, JourneyLike>();
  for (const j of js || []) if (j && Array.isArray(j.legs)) { const k = journeyKey(j); if (!byKey.has(k)) byKey.set(k, j); }
  const rows = [...byKey.values()].map((j) => tripRow(j, now)).filter((r) => Number.isFinite(r.dep) && (opts.keepGone || !r.gone))
    .sort((a, b) => a.dep - b.dep).slice(0, opts.max ?? 40);
  return { rows, byKey };
}

/** The time the Earlier button asks the planner for: 30 minutes before the first trip shown. */
export const earlierAt = (firstDep: number) => firstDep - 30 * 60000;
/** The time the Later button asks for: one minute after the last trip shown. */
export const laterAt = (lastDep: number) => lastDep + 60000;

// ---------- the steps ----------

export type Step = { key: string; icon: 'walk' | 'ride' | 'end'; text: string; sub: string; mode?: string; line?: string; color?: string; say: string };

const NOUN: Record<string, string> = { bus: 'bus', school: 'bus', coach: 'coach', ferry: 'ferry', lightrail: 'light rail' };
/** "T1", "bus 410", "ferry F1", "light rail L1". */
export function lineWords(l: LegLike): string {
  const line = String(l.line || '').trim();
  const noun = NOUN[String(l.mode || '')] || (l.mode === 'metro' ? 'metro' : l.mode === 'train' ? 'train' : '');
  if (!line) return noun ? `the ${noun}` : 'the service';
  if (l.mode === 'train' || l.mode === 'metro') return line;
  return noun ? `${noun} ${line}` : line;
}

/** "Platform 2", "Stand D" from what the planner sends ("Plat 2", "2", "Stand D"). */
export function platformWords(p?: string | null): string {
  const v = String(p || '').trim();
  if (!v) return '';
  if (/^plat(form)?\.?\s*/i.test(v)) return 'Platform ' + v.replace(/^plat(form)?\.?\s*/i, '');
  if (/^\d+[a-z]?$/i.test(v)) return `Platform ${v}`;
  return v.charAt(0).toUpperCase() + v.slice(1);
}

const samePlace = (a: LegLike, b: LegLike) => (a.toParent && b.fromParent ? a.toParent === b.fromParent : shortPlace(a.to) === shortPlace(b.from));
const stopsWords = (n?: number) => (n && n > 0 ? `${n} stop${n === 1 ? '' : 's'}` : '');
const legDep = (l: LegLike) => (l.realtime && l.estimated ? ms(l.estimated) : ms(l.planned));
const legArr = (l: LegLike) => (l.realtime && l.arrEstimated ? ms(l.arrEstimated) : ms(l.arrPlanned));

/**
 * The trip as plain steps from its legs: "Walk to Platform 1", "Take T1 to Redfern, 4 stops", "Change to T4 at
 * Redfern, Platform 6", "Get off at Kings Cross". `name` shortens a stop name (the speech uses one that spells out
 * Rd and St). `say` is the step as one spoken sentence.
 */
export function buildSteps(j: JourneyLike, opts: { name?: (n?: string | null) => string } = {}): Step[] {
  const name = opts.name || shortPlace;
  const legs = j.legs || [];
  const steps: Step[] = [];
  let prev: LegLike | null = null;
  let walkMin = 0;
  let walkTo = '';
  const push = (s: Omit<Step, 'key' | 'say'> & { say?: string }) => steps.push({ ...s, key: String(steps.length), say: s.say || [s.text, s.sub].filter(Boolean).join('. ') + '.' });
  for (let i = 0; i < legs.length; i++) {
    const l = legs[i];
    if (l.kind === 'walk') { walkMin += Math.round(l.durationMin || 0); walkTo = l.to || ''; continue; }
    const plat = platformWords(l.fromPlatform);
    const dep = legDep(l);
    const leaves = Number.isFinite(dep) ? `Leaves ${clock(dep)}` : '';
    const towards = l.towards ? `towards ${name(l.towards)}` : '';
    const cancelled = l.cancelled ? 'Cancelled' : '';
    const late = !l.cancelled && l.realtime && (l.delayMin || 0) >= 1 ? `${l.delayMin} min late` : '';
    const walkSub = walkMin ? `${walkMin} min walk` : '';
    if (!prev) {
      // Getting to the first service: the platform or stand when the planner names it, else the stop.
      if (plat || walkMin) push({ icon: 'walk', text: `Walk to ${plat || name(l.from)}`, sub: [plat ? name(l.from) : '', walkSub].filter(Boolean).join(', ') });
      push({ icon: 'ride', text: `Take ${lineWords(l)} to ${name(l.to)}${stopsWords(l.stops) ? `, ${stopsWords(l.stops)}` : ''}`, sub: [leaves, towards, late, cancelled].filter(Boolean).join(', '), mode: l.mode, line: l.line, color: l.color });
    } else if (samePlace(prev, l)) {
      push({ icon: 'ride', text: `Change to ${lineWords(l)} at ${name(l.from)}${plat ? `, ${plat}` : ''}`,
        sub: [leaves, stopsWords(l.stops) ? `${stopsWords(l.stops)} to ${name(l.to)}` : `to ${name(l.to)}`, walkSub, late, cancelled].filter(Boolean).join(', '), mode: l.mode, line: l.line, color: l.color });
    } else {
      push({ icon: 'walk', text: `Walk to ${name(l.from)}${plat ? `, ${plat}` : ''}`, sub: walkSub });
      push({ icon: 'ride', text: `Take ${lineWords(l)} to ${name(l.to)}${stopsWords(l.stops) ? `, ${stopsWords(l.stops)}` : ''}`, sub: [leaves, towards, late, cancelled].filter(Boolean).join(', '), mode: l.mode, line: l.line, color: l.color });
    }
    prev = l;
    walkMin = 0;
  }
  if (prev) {
    const a = legArr(prev);
    push({ icon: 'end', text: `Get off at ${name(prev.to)}`, sub: Number.isFinite(a) ? `Arrive ${clock(a)}` : '' });
    if (walkMin) {
      const end = arriveOf(j);
      push({ icon: 'walk', text: walkTo && name(walkTo) && name(walkTo) !== name(prev.to) ? `Walk to ${name(walkTo)}` : 'Walk to where you are going', sub: [`${walkMin} min walk`, Number.isFinite(end) ? `there by ${clock(end)}` : ''].filter(Boolean).join(', ') });
    }
  } else if (walkMin) {
    push({ icon: 'walk', text: `Walk all the way`, sub: `${walkMin} min walk` });
  }
  return steps;
}

/** The steps read out loud as one passage, in order. */
export const spokenSteps = (steps: Step[]) => steps.map((s) => s.say).join(' ');
