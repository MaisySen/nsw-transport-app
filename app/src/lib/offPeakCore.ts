// Off peak hint (28 Oct): on trip results in an Opal peak (Monday to Thursday 6:30am to 10am and 3pm to 7pm, not public
// holidays, worked out by the server per journey from the Opal fare tables), one quiet line "Leave after 10:00am and pay
// about $1.30 less" when a trip after the peak is in the list. The amount is the server's own off peak price for the
// same journey (fare.offPeak.save, an estimate, never the card's charge). Nothing is guessed on the phone: a server or
// journey without fare.offPeak shows nothing. Never hides or moves a trip. No React here (test/offpeak.test.mjs).

// The phone's 24-Hour Time setting (iPhone Settings, General, Date and Time): lib/rowTime.ts installs the reader
// at start (installPhoneClock). Until then, and in tests, the 12 hour clock the app has always used.
const PHONE24 = (): boolean => { try { return (globalThis as any).__tslPhone24h?.() === true; } catch { return false; } };
const HM24 = (h: number, m: number): string => `${String(((h % 24) + 24) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

type F = { total?: number | null; peak?: boolean | null; offPeak?: { from?: string | null; save?: number | null } | null } | null | undefined;
type J = { fare?: F };

export type OffPeakHint = {
  /** "Leave after 10:00am and pay about $1.30 less" */
  text: string;
  /** What a screen reader says, including that it is an estimate and what a tap does. */
  a11y: string;
  /** When off peak starts (ms) and the Sydney day and clock time for a Leave at choice. */
  at: number;
  day: string;
  h: number;
  m: number;
  save: number;
};

/** Off peak starts at most this long after a peak trip: the longest peak runs 3.5 hours (6:30am to 10am). */
export const PEAK_SPAN_MS = 4 * 3600000;
/** A trip counts as after the peak only on the same evening or morning stretch, not tomorrow's. */
export const AFTER_SPAN_MS = 6 * 3600000;

function parts(t: number) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(t))) p[x.type] = x.value;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, m: +p.minute };
}

/** The moment of a Sydney clock time on the Sydney day of `t`. */
function atSydney(t: number, h: number, m: number): number {
  const s = parts(t);
  const want = Date.UTC(s.y, s.mo - 1, s.d, h, m);
  let x = want - 10 * 3600000;
  for (let i = 0; i < 3; i++) {
    const p = parts(x);
    const diff = (Date.UTC(p.y, p.mo - 1, p.d, p.h, p.m) - want) / 60000;
    if (!diff) break;
    x -= diff * 60000;
  }
  return x;
}

/** "10am", "7pm", "9:30am", "10:00" or "19:00" from the server, as hour and minute; null when it is not a time. */
export function parseFrom(from?: string | null): { h: number; m: number } | null {
  const v = String(from || '').trim().toLowerCase().replace(/\s+/g, '');
  const r = /^(\d{1,2})(?:[:.](\d{2}))?(am|pm)?$/.exec(v);
  if (!r) return null;
  let h = +r[1];
  const m = r[2] ? +r[2] : 0;
  if (m > 59) return null;
  if (r[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (r[3] === 'pm' ? 12 : 0);
  } else if (h > 23 || !r[2]) return null;
  return { h, m };
}

/** "10:00am", the app's 12 hour clock. */
export function clockWords(h: number, m: number): string {
  if (PHONE24()) return HM24(h, m);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
}

/** The fare's off peak saving, or 0 when there is none to show (no fare, not peak, broken or bigger than the fare). */
export function saveOf(f: F): number {
  if (!f || f.peak !== true || !f.offPeak) return 0;
  const s = Number(f.offPeak.save);
  const total = Number(f.total);
  if (!Number.isFinite(s) || s < 0.01) return 0;
  if (Number.isFinite(total) && s > total) return 0;
  return Math.round(s * 100) / 100;
}

/**
 * The hint for a trip list, or null. `shown` is the list in screen order (the first trip still to leave is the one the
 * amount is for); `pool` is every trip the screen has loaded (shown, waiting above, later pages), already filtered by
 * the chosen modes and walking, to find one leaving after the peak with an off peak fare. `arriveBy` lists never get
 * it: a trip that must arrive by a time cannot leave later.
 */
export function offPeakHint<X extends J>(shown: ReadonlyArray<X>, pool: ReadonlyArray<X>, depOf: (j: X) => number, now: number, arriveBy = false): OffPeakHint | null {
  if (arriveBy) return null;
  const first = shown.find((j) => { const d = depOf(j); return Number.isFinite(d) && d >= now - 60000; });
  if (!first) return null;
  const save = saveOf(first.fare);
  if (!save) return null;
  const hm = parseFrom(first.fare!.offPeak!.from);
  if (!hm) return null;
  const dep = depOf(first);
  const at = atSydney(dep, hm.h, hm.m);
  if (!(at > dep) || at - dep > PEAK_SPAN_MS) return null;
  const after = pool.some((j) => {
    const d = depOf(j);
    const f = j.fare;
    return Number.isFinite(d) && d >= at && d < at + AFTER_SPAN_MS && !!f && f.total != null && f.peak === false;
  });
  if (!after) return null;
  const p = parts(at);
  const day = `${p.y}${String(p.mo).padStart(2, '0')}${String(p.d).padStart(2, '0')}`;
  const t = clockWords(hm.h, hm.m);
  const amount = '$' + save.toFixed(2);
  return {
    text: `Leave after ${t} and pay about ${amount} less`,
    a11y: `Opal fare estimate. Leave after ${t} and pay about ${amount} less. Shows trips from ${t}.`,
    at, day, h: hm.h, m: hm.m, save,
  };
}
