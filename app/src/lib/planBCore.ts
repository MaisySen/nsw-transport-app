// Plan B on the trip screen and on Home: when the chosen trip has a cancelled service, a suspended line, a change the
// live times say you will miss, or buses replacing trains (trackwork), the best other way from the planner results.
// Pure logic; the cards are in app/trip.tsx and components/Home.tsx (docs/PLAN-B.md).

// The phone's 24-Hour Time setting (iPhone Settings, General, Date and Time): lib/rowTime.ts installs the reader
// at start (installPhoneClock). Until then, and in tests, the 12 hour clock the app has always used.
const PHONE24 = (): boolean => { try { return (globalThis as any).__tslPhone24h?.() === true; } catch { return false; } };
/** "07:55" (or "07:55:30"), Sydney time, for a phone set to 24 hour time. */
const C24 = (t: number, sec = false): string => {
  try { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', ...(sec ? { second: '2-digit' } : {}), hourCycle: 'h23', timeZone: 'Australia/Sydney' } as Intl.DateTimeFormatOptions).format(new Date(t)); }
  catch { const d = new Date(t); return [d.getHours(), d.getMinutes(), ...(sec ? [d.getSeconds()] : [])].map((n) => String(n).padStart(2, '0')).join(':'); }
};

export type Problem = { kind: 'cancelled' | 'suspended' | 'missed' | 'trackwork'; line?: string; mode?: string; tripId?: string; text: string };

const t = (s?: string | null) => (s ? new Date(s).getTime() : NaN);
const best = (p?: string | null, e?: string | null, live?: boolean) => { const x = live === false ? NaN : t(e); return Number.isFinite(x) ? x : t(p); };
const transit = (j: any): any[] => (j?.legs || []).filter((l: any) => l && l.kind !== 'walk' && l.line);
const clock = (ms: number) => {
  if (PHONE24() && Number.isFinite(ms)) return C24(ms);
  try { return new Date(ms).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Australia/Sydney' }).replace(/\s?(am|pm)/i, (m) => m.trim().toLowerCase()); }
  catch { const d = new Date(ms), h = d.getHours(); return `${((h + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`; }
};

/** Alert words that mean the line is not running, as opposed to trackwork with buses for some trains. */
export const SUSPENDED = /\bsuspended\b|\bnot running\b|\bno (?:train|metro|ferry|light rail|bus)s? (?:services|running|between|are running)\b|\bno services\b/i;

/**
 * A rail replacement bus: the route carries the line it replaces after the number (45T1, 2AT9, 1L1, 10HU, 3SH), the
 * same rule as the bus picker's Trackwork section (busCore.ts busGroup).
 */
export function isReplacement(l: any): boolean {
  if (!l || l.mode !== 'bus') return false;
  const c = String(l.line || '').toUpperCase();
  return /^\d+[A-Z]?(T\d|L\d|HU|SH|CN|SCO|BMT)$/.test(c) || /^\d+A(T\d|HU)$/.test(c);
}
/** The line a replacement bus stands in for: "T1" from "45T1", "CCN" from "2CN" (CN is the Central Coast and Newcastle Line). */
export function replacedLine(code: string): string {
  const m = /(T\d|L\d|HU|SH|CN|SCO|BMT)$/.exec(String(code || '').toUpperCase());
  if (!m) return '';
  return m[1] === 'CN' ? 'CCN' : m[1];
}
const stopShort = (n?: string | null) => String(n || '').replace(/,.*$/, '').replace(/ (Station|Wharf|Light Rail)$/, '').trim();

/** When a journey leaves: first leg, live time first. */
export function leavesAt(j: any): number {
  const l = j?.legs?.[0];
  const v = l ? best(l.planned, l.estimated, l.realtime) : NaN;
  return Number.isFinite(v) ? v : t(j?.leave);
}
/** When a journey arrives: last leg, live time first. */
export function arrivesAt(j: any): number {
  const ls = j?.legs || [];
  const l = ls[ls.length - 1];
  const v = l ? best(l.arrPlanned, l.arrEstimated, l.realtime) : NaN;
  return Number.isFinite(v) ? v : t(j?.arrive);
}

/** What is wrong with this journey, if anything: a cancelled service, a suspended line, or a change you will miss. */
export function problemOf(j: any): Problem | null {
  if (!j) return null;
  for (const l of transit(j)) {
    if (l.cancelled) return { kind: 'cancelled', line: l.line, mode: l.mode, tripId: l.tripId, text: `The ${clock(t(l.planned))} ${l.line} is cancelled` };
  }
  for (const l of transit(j)) {
    const a = (l.alerts || []).find((x: any) => x && typeof x !== 'string' && SUSPENDED.test(String(x.title || '')));
    if (a) return { kind: 'suspended', line: l.line, mode: l.mode, text: String(a.title) };
  }
  const legs = j.legs || [];
  const miss = legs.find((l: any) => l?.transfer?.risk === 'miss');
  if (j.risk === 'miss' || miss) {
    const at = miss?.transfer?.at || miss?.from;
    const next = miss && miss.line ? `the ${clock(best(miss.planned, miss.estimated, miss.realtime))} ${miss.line}` : 'the next service';
    return { kind: 'missed', line: miss?.line, mode: miss?.mode, text: `Delays mean you will likely miss ${next}${at ? ` at ${String(at).replace(/ Station$/, '')}` : ''}` };
  }
  const rep = (j.legs || []).find(isReplacement);
  if (rep) {
    const line = replacedLine(rep.line);
    const span = rep.from && rep.to ? ` from ${stopShort(rep.from)} to ${stopShort(rep.to)}` : '';
    return { kind: 'trackwork', line, mode: 'bus', text: `Buses replace ${line ? line + ' ' : ''}trains${span}` };
  }
  return null;
}

/** How much later than the replacement bus trip a Plan B may arrive and still be worth offering. */
export const TRACKWORK_SLACK_MIN = 10;

/** True when this journey avoids the problem: not the cancelled service, not the suspended line, and its own changes work. */
export function avoids(j: any, p: Problem): boolean {
  if (!j || j.anyCancelled) return false;
  // Replacement buses are a fine way round a cancelled or suspended service; only other problems rule a way out.
  const own = problemOf(j);
  if (own && own.kind !== 'trackwork') return false;
  const ls = transit(j);
  if (p.kind === 'cancelled') return !ls.some((l) => (p.tripId && l.tripId === p.tripId) || l.cancelled);
  if (p.kind === 'suspended') return !ls.some((l) => l.line === p.line);
  if (p.kind === 'trackwork') return !ls.some(isReplacement);
  return true;
}

export type PlanB = { j: any; leaves: number; arrives: number; label: string; why: string };

/** Short words for a journey: "T2 then M1". */
export const linesOf = (j: any) => transit(j).map((l) => l.line).join(' then ') || 'Walk';

/**
 * The best other way: among journeys leaving at least 1 minute from now that avoid the problem, the earliest
 * arrival (then the earliest departure). Null when none of them does.
 */
export function planB(journeys: any[], chosen: any, now: number): PlanB | null {
  const p = problemOf(chosen);
  if (!p) return null;
  const key = (j: any) => JSON.stringify(transit(j).map((l) => [l.tripId || l.line, l.planned]));
  const ck = key(chosen);
  // Around trackwork the replacement bus trip still runs, so another way counts only when it is not much slower.
  const latest = p.kind === 'trackwork' ? arrivesAt(chosen) + TRACKWORK_SLACK_MIN * 60000 : Infinity;
  const pool = (journeys || []).filter((j) => j && key(j) !== ck && leavesAt(j) >= now + 60000 && Number.isFinite(arrivesAt(j)) && arrivesAt(j) <= latest && avoids(j, p));
  pool.sort((a, b) => arrivesAt(a) - arrivesAt(b) || leavesAt(a) - leavesAt(b));
  const j = pool[0];
  if (!j) return null;
  const why = p.kind === 'suspended' ? `Avoids the ${p.line}` : p.kind === 'cancelled' ? 'Next way that is running' : p.kind === 'trackwork' ? 'No replacement buses' : 'Next way you can make';
  return { j, leaves: leavesAt(j), arrives: arrivesAt(j), label: `${linesOf(j)}, leave ${clock(leavesAt(j))}, arrive ${clock(arrivesAt(j))}`, why };
}

/** The problem in a few words, for Home: "T1 suspended", "The 8:04am T1 is cancelled", "Buses replace T1 trains from Pymble to Gordon". */
export function problemShort(p: Problem): string {
  if (p.kind === 'suspended') return p.line ? `${p.line} suspended` : 'Line suspended';
  return p.text;
}

/**
 * One sentence for Home and alerts: "T1 suspended. Try the 8:04am M1 from Epping, arrives 8:41am." Without a Plan B
 * in the services already fetched it points to the trip screen, which asks the planner once more.
 */
export function planBLine(p: Problem, pb: PlanB | null): string {
  const head = problemShort(p).replace(/\.$/, '');
  if (!pb) return p.kind === 'trackwork' ? `${head}.` : `${head}. Open the trip for Plan B.`;
  const first = transit(pb.j)[0];
  const from = first?.from ? ` from ${stopShort(first.from)}` : '';
  const dep = first ? best(first.planned, first.estimated, first.realtime) : pb.leaves;
  return `${head}. Try the ${clock(Number.isFinite(dep) ? dep : pb.leaves)} ${first?.line || linesOf(pb.j)}${from}, arrives ${clock(pb.arrives)}.`;
}
