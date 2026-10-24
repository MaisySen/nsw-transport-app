// Plan B on the trip screen: when the chosen trip has a cancelled service, a suspended line or a change the live
// times say you will miss, the best other way from the planner results. Pure logic; the card is in app/trip.tsx.

export type Problem = { kind: 'cancelled' | 'suspended' | 'missed'; line?: string; mode?: string; tripId?: string; text: string };

const t = (s?: string | null) => (s ? new Date(s).getTime() : NaN);
const best = (p?: string | null, e?: string | null, live?: boolean) => { const x = live === false ? NaN : t(e); return Number.isFinite(x) ? x : t(p); };
const transit = (j: any): any[] => (j?.legs || []).filter((l: any) => l && l.kind !== 'walk' && l.line);
const clock = (ms: number) => {
  try { return new Date(ms).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Australia/Sydney' }).replace(/\s?(am|pm)/i, (m) => m.trim().toLowerCase()); }
  catch { const d = new Date(ms), h = d.getHours(); return `${((h + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`; }
};

/** Alert words that mean the line is not running, as opposed to trackwork with buses for some trains. */
export const SUSPENDED = /\bsuspended\b|\bnot running\b|\bno (?:train|metro|ferry|light rail|bus)s? (?:services|running|between|are running)\b|\bno services\b/i;

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
  return null;
}

/** True when this journey avoids the problem: not the cancelled service, not the suspended line, and its own changes work. */
export function avoids(j: any, p: Problem): boolean {
  if (!j || j.anyCancelled || problemOf(j)) return false;
  const ls = transit(j);
  if (p.kind === 'cancelled') return !ls.some((l) => (p.tripId && l.tripId === p.tripId) || l.cancelled);
  if (p.kind === 'suspended') return !ls.some((l) => l.line === p.line);
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
  const pool = (journeys || []).filter((j) => j && key(j) !== ck && leavesAt(j) >= now + 60000 && Number.isFinite(arrivesAt(j)) && avoids(j, p));
  pool.sort((a, b) => arrivesAt(a) - arrivesAt(b) || leavesAt(a) - leavesAt(b));
  const j = pool[0];
  if (!j) return null;
  const why = p.kind === 'suspended' ? `Avoids the ${p.line}` : p.kind === 'cancelled' ? 'Next way that is running' : 'Next way you can make';
  return { j, leaves: leavesAt(j), arrives: arrivesAt(j), label: `${linesOf(j)}, leave ${clock(leavesAt(j))}, arrive ${clock(arrivesAt(j))}`, why };
}
