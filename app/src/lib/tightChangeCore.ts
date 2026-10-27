// Tight change hint (27 Oct 2026): a change between two services that leaves less time than a sensible minimum.
// Rule based, from the legs' times, modes, stops and platforms only (no station lists). Pure, so
// test/tightchange.test.mjs runs it in Node; the trip rows (components/Home.tsx ServiceRow) and the trip detail
// (app/trip.tsx Transfer) show the label.

/** Least time for a change on the same mode at the same stop or platform. */
export const SAME_MODE_MIN = 3;
/** Least time for a change to another mode (train to bus) or to another platform or stop. */
export const OTHER_MIN = 5;
/** Spare minutes wanted on top of a walk the planner put in the change. */
export const WALK_SPARE_MIN = 2;

export type ChangeLeg = {
  kind?: string;
  mode?: string | null;
  stopId?: string | null;
  toStopId?: string | null;
  fromPlatform?: string | null;
  toPlatform?: string | null;
  fromParent?: string | null;
  toParent?: string | null;
  planned?: string | null;
  estimated?: string | null;
  arrPlanned?: string | null;
  arrEstimated?: string | null;
  durationMin?: number | null;
  cancelled?: boolean | null;
};

export type TightChange = {
  /** Index in the legs of the service you change onto. */
  index: number;
  /** Index of the service you get off. */
  fromIndex: number;
  /** Whole minutes between getting off and the next departure (can be 0 or less when a delay broke it). */
  gapMin: number;
  /** The least the rule wants for this change. */
  needMin: number;
  /** Why the rule wants that much: same mode and stop, another mode, another platform or stop. */
  why: 'same' | 'mode' | 'platform';
  /** Minutes of walking the planner put between the two services. */
  walkMin: number;
};

const ms = (s?: string | null) => (s ? new Date(s).getTime() : NaN);
const best = (p?: string | null, e?: string | null) => { const x = ms(e); return Number.isFinite(x) ? x : ms(p); };
const norm = (s?: string | null) => String(s ?? '').trim().toLowerCase().replace(/^(platform|stand|wharf)\s+/, '');

/** Bus, coach and school bus count as one mode for a change. */
function modeOf(m?: string | null): string {
  const x = String(m || '').toLowerCase();
  if (/bus|coach/.test(x)) return 'bus';
  return x;
}

/** Whether you stay on the same platform or stop between the two services. Unknown counts as the same. */
function samePlace(a: ChangeLeg, b: ChangeLeg): boolean {
  const ap = norm(a.toPlatform), bp = norm(b.fromPlatform);
  if (a.toStopId && b.stopId && a.toStopId === b.stopId) return true;
  if (ap && bp) return ap === bp && (!a.toParent || !b.fromParent || a.toParent === b.fromParent);
  if (a.toStopId && b.stopId) return false;
  return true;
}

/** The change onto leg `i` (a transit leg after another one), or null when it is not tight or cannot be told. */
export function changeAt(legs: ChangeLeg[], i: number): TightChange | null {
  const b = legs[i];
  if (!b || b.kind !== 'transit' || b.cancelled) return null;
  let k = i - 1, walkMin = 0;
  while (k >= 0 && legs[k].kind !== 'transit') { walkMin += Math.max(0, Number(legs[k].durationMin) || 0); k--; }
  if (k < 0) return null;
  const a = legs[k];
  if (a.cancelled) return null;
  const off = best(a.arrPlanned, a.arrEstimated), on = best(b.planned, b.estimated);
  if (!Number.isFinite(off) || !Number.isFinite(on)) return null;
  const gapMin = Math.floor((on - off) / 60000);
  const why: TightChange['why'] = modeOf(a.mode) !== modeOf(b.mode) ? 'mode' : samePlace(a, b) && walkMin === 0 ? 'same' : 'platform';
  const base = why === 'same' ? SAME_MODE_MIN : OTHER_MIN;
  const needMin = Math.max(base, walkMin > 0 ? walkMin + WALK_SPARE_MIN : 0);
  if (gapMin >= needMin) return null;
  return { index: i, fromIndex: k, gapMin, needMin, why, walkMin };
}

/** Every tight change on a trip, in order. */
export function tightChanges(legs: ChangeLeg[] | null | undefined): TightChange[] {
  const out: TightChange[] = [];
  if (!legs) return out;
  for (let i = 1; i < legs.length; i++) { const t = changeAt(legs, i); if (t) out.push(t); }
  return out;
}

/** The first tight change on a trip, or null: what a trip row needs. */
export function tightChange(legs: ChangeLeg[] | null | undefined): TightChange | null {
  return tightChanges(legs)[0] || null;
}

/** A change the person gave their own time for (a via trip joined on the phone): tight when it is under their own
 * minutes or under the rule, whichever is longer, the same as the server's chains (tightChangeAt in worker.js).
 * `gapMin` and `ownMin` are the join's own minutes to change and the person's change time. */
export function tightOrOwn(legs: ChangeLeg[] | null | undefined, i: number, gapMin: number, ownMin: number): boolean {
  if (Number.isFinite(gapMin) && Number.isFinite(ownMin) && gapMin < ownMin) return true;
  return !!(legs && changeAt(legs, i));
}

/** VoiceOver and TalkBack words: "tight change, 2 minutes to change". */
export function tightA11y(t: TightChange): string {
  const g = Math.max(0, t.gapMin);
  return `tight change, ${g} minute${g === 1 ? '' : 's'} to change`;
}
