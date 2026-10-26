// Plan tab trip rows (27 Oct 2026): the clock the phone uses (12 hour "12:56 pm" or 24 hour "12:56"), the time
// left badge on each row ("Now", "12 min", "1 hr", "2 hrs") and when a row may say On time, late or early.
// No phone dependencies here (unit tested in test/planrows.test.mjs); lib/rowTime.ts reads the phone's setting.

/** A zero delay from the planner this far ahead is its timetable echoed back, not a live reading. */
export const LIVE_HORIZON_MS = 60 * 60000;

export type ClockSignals = {
  /** iPhone Settings, General, Date and Time, 24-Hour Time: true when on, false when forced off, null when unknown. */
  force24?: boolean | null;
  /** The locale's hour cycle as Intl reports it ("h11", "h12", "h23", "h24"), when known. */
  hourCycle?: string | null;
  /** Intl's hour12 for the phone's locale, when known. */
  hour12?: boolean | null;
};

/** True when the phone shows 24 hour time. Unknown signals keep the 12 hour clock the app has always used. */
export function uses24h(sig: ClockSignals | null | undefined): boolean {
  if (!sig) return false;
  if (sig.force24 === true) return true;
  if (sig.force24 === false) return false;
  if (sig.hourCycle === 'h23' || sig.hourCycle === 'h24') return true;
  if (sig.hourCycle === 'h11' || sig.hourCycle === 'h12') return false;
  if (sig.hour12 === false) return true;
  return false;
}

/** Sydney hours and minutes of an instant, whatever zone the phone is in. */
function sydneyHM(t: number): { h: number; m: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Australia/Sydney' }).formatToParts(new Date(t));
    const h = Number(parts.find((p) => p.type === 'hour')?.value);
    const m = Number(parts.find((p) => p.type === 'minute')?.value);
    if (Number.isFinite(h) && Number.isFinite(m)) return { h: h % 24, m };
  } catch {}
  const d = new Date(t);
  return { h: d.getHours(), m: d.getMinutes() };
}

/** "12:56 pm" (lowercase, with a space, as iOS writes it) or "12:56" and "09:05" on a 24 hour phone. Sydney time. */
export function rowClock(t: number, h24: boolean): string {
  if (!Number.isFinite(t)) return '';
  const { h, m } = sydneyHM(t);
  const mm = String(m).padStart(2, '0');
  if (h24) return `${String(h).padStart(2, '0')}:${mm}`;
  return `${((h + 11) % 12) + 1}:${mm} ${h < 12 ? 'am' : 'pm'}`;
}

export type Badge = {
  /** The big part: "Now", "Left", "12", "2". */
  big: string;
  /** Under it: "min", "hr", "hrs", "day", "days", or "". */
  unit: string;
  /** For VoiceOver and TalkBack: "now", "in 12 minutes", "in 2 hours". */
  a11y: string;
  /** Minutes to go (floored), for the colour; negative once gone. */
  mins: number;
};

/**
 * Time to departure on the row's badge: "Now" under a minute, "N min" under an hour, then whole hours rounded down
 * ("1 hr", "2 hrs", "3 hrs"), and whole days from 24 hours (a trip tomorrow on the endless list). "Left" once more
 * than a minute gone. Changes once a minute at most, so the existing countdown tick redraws it rarely.
 */
export function timeLeftBadge(t: number, now: number): Badge {
  const diff = t - now;
  if (!Number.isFinite(diff)) return { big: '', unit: '', a11y: '', mins: NaN };
  if (diff < -60000) return { big: 'Left', unit: '', a11y: 'already left', mins: Math.ceil(diff / 60000) };
  if (diff < 60000) return { big: 'Now', unit: '', a11y: 'leaving now', mins: 0 };
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return { big: String(mins), unit: 'min', a11y: `in ${mins} minute${mins === 1 ? '' : 's'}`, mins };
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return { big: String(hrs), unit: hrs === 1 ? 'hr' : 'hrs', a11y: `in ${hrs} hour${hrs === 1 ? '' : 's'}`, mins };
  const days = Math.floor(hrs / 24);
  return { big: String(days), unit: days === 1 ? 'day' : 'days', a11y: `in ${days} day${days === 1 ? '' : 's'}`, mins };
}

/** "12 min", "2 hrs", "Now": the badge as one short string (tests, labels). */
export const badgeText = (b: Badge) => (b.unit ? `${b.big} ${b.unit}` : b.big);

export type LiveLeg = {
  planned?: string | null;
  estimated?: string | null;
  realtime?: boolean | null;
  delayMin?: number | null;
  vehicle?: unknown;
  stopsAway?: number | null;
};

const msOf = (s?: string | null) => (s ? new Date(s).getTime() : NaN);

/**
 * Whether a trip row may say On time, N min late or N min early. The trip planner marks some services hours away as
 * live and echoes the timetable as the "estimate" (delay 0), so a 1:29 pm trip read at 10:16 am said On time. A row
 * carries live data when the leg is live with an estimate and either the estimate moved (a real delay or early
 * running), the vehicle is placed (position or stops away), or the service leaves within LIVE_HORIZON_MS. Otherwise
 * the row says Scheduled.
 */
export function hasLiveData(l: LiveLeg | null | undefined, now: number): boolean {
  if (!l || !l.realtime) return false;
  const est = msOf(l.estimated);
  if (!Number.isFinite(est)) return false;
  const plan = msOf(l.planned);
  const moved = (l.delayMin != null && l.delayMin !== 0) || (Number.isFinite(plan) && Math.abs(est - plan) >= 60000);
  if (moved) return true;
  if (l.vehicle || (l.stopsAway != null && Number.isFinite(l.stopsAway))) return true;
  return est - now <= LIVE_HORIZON_MS;
}

/** "Flemington Platform 3", "Strathfield Stand G" or just the stop: where you get on, with its platform. */
export function boardText(name?: string | null, platform?: string | null): string {
  const n = String(name || '').replace(/, (Sydney|NSW)$/, '').replace(/ Station(, .*)?$/, '').trim();
  const p = String(platform || '').trim();
  if (!n) return p;
  if (!p || n.toLowerCase().includes(p.toLowerCase())) return n;
  return `${n} ${p}`;
}

/** The same as boardText in two parts, so a long stop name shortens and its platform always shows. */
export function boardParts(name?: string | null, platform?: string | null): { name: string; platform: string } {
  const all = boardText(name, platform);
  const p = String(platform || '').trim();
  if (p && all !== p && all.endsWith(` ${p}`)) return { name: all.slice(0, -p.length - 1), platform: p };
  return { name: all, platform: '' };
}

/** The place name over the arrival time: "Campsie". */
export function placeText(name?: string | null): string {
  return String(name || '').replace(/, (Sydney|NSW)$/, '').replace(/ Station(, .*)?$/, '').replace(/,\s*(Platform|Stand|Wharf)\s+\w+.*$/i, '').trim();
}

/** The lines a trip rides, once each and in order ("T9", "M20"), for the badges under the arrival time. */
export function tripLines<L extends { kind?: string; line?: string | null }>(legs: L[]): L[] {
  const out: L[] = [];
  for (const x of legs) if (x.kind === 'transit' && x.line && !out.some((b) => b.line === x.line)) out.push(x);
  return out;
}

/**
 * Whether a trip row's get off column goes under the get on column instead of beside it: when two columns of
 * "12:56 pm" at the current text size do not fit beside the badge (big Dynamic Type, narrow phones).
 * `width` is the window width in points; row padding and the badge take 136.
 */
export function stackColumns(width: number, fontScale: number): boolean {
  const scale = Math.min(Math.max(Number(fontScale) || 1, 1), 1.4);
  const col = (Math.max(0, Number(width) || 0) - 136) / 2 - 4;
  return 88 * scale > col;
}
