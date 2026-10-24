export const ms = (s?: string | null) => (s ? new Date(s).getTime() : NaN);

export function bestTime(planned?: string | null, estimated?: string | null) {
  const e = ms(estimated);
  return Number.isFinite(e) ? e : ms(planned);
}

export function clock(t: number) {
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  // Always Sydney time, whatever the phone is set to.
  try {
    return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Australia/Sydney' }).replace(/\s?(am|pm)/i, (m) => m.trim().toLowerCase());
  } catch {
    const h = d.getHours(), m = d.getMinutes();
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
  }
}

/** Home's header stamp, "Live 9:52am": the same 12 hour clock as the rows. */
export const liveStamp = (t: number) => `Live ${clock(t)}`;

export function clockSec(t: number) {
  try {
    return new Date(t).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Australia/Sydney' }).replace(/\s?(am|pm)/i, (m) => m.trim().toLowerCase());
  } catch {
    return clock(t);
  }
}

/** Countdown parts for the big number on a row. */
export function countdown(t: number, now: number): { big: string; unit: string; soon: boolean; past: boolean } {
  const diff = t - now;
  if (!Number.isFinite(diff)) return { big: '', unit: '', soon: false, past: false };
  if (diff < -60000) return { big: 'Gone', unit: '', soon: false, past: true };
  if (diff < 60000) return { big: 'Now', unit: '', soon: true, past: false };
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return { big: String(mins), unit: 'min', soon: mins <= 3, past: false };
  if (mins < 120) return { big: `${Math.floor(mins / 60)}h ${mins % 60}`, unit: 'min', soon: false, past: false };
  return { big: clock(t), unit: '', soon: false, past: false };
}

/**
 * What a departure row's countdown shows at `now`, as one string. Rows redraw only when this changes (or their
 * data does), so a 5 second tick redraws a row about once a minute instead of every tick.
 */
export function countdownKey(planned: string | undefined, estimated: string | null | undefined, realtime: boolean | undefined, now: number): string {
  const cd = countdown(bestTime(planned, realtime ? estimated : null), now);
  return `${cd.big}|${cd.unit}|${cd.soon ? 1 : 0}|${cd.past ? 1 : 0}`;
}

export function minsText(t: number, now: number) {
  const m = Math.round((t - now) / 60000);
  if (m <= 0) return 'now';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function shortName(n?: string | null) {
  if (!n) return '';
  return n.replace(/, (Sydney|NSW)$/, '').replace(/ Station, .*$/, ' Station');
}

export function delayWords(d?: number | null, realtime?: boolean, cancelled?: boolean) {
  if (cancelled) return { text: 'Cancelled', tone: 'red' as const };
  if (!realtime) return { text: 'Scheduled', tone: 'grey' as const };
  if (d == null || d === 0) return { text: 'On time', tone: 'green' as const };
  if (d > 0) return { text: `${d} min late`, tone: d >= 5 ? ('red' as const) : ('orange' as const) };
  return { text: `${-d} min early`, tone: 'green' as const };
}

export const todText = (tod: number) => {
  const h = Math.floor(tod / 60), m = tod % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
};

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export function daysText(days: string) {
  if (days === '12345') return 'Weekdays';
  if (days === '67') return 'Weekends';
  if (days === '1234567') return 'Every day';
  return days.split('').map((d) => DAY_NAMES[Number(d) - 1]).join(', ');
}

export function modeIcon(mode?: string): { sf: string; md: string } {
  switch (mode) {
    case 'train': return { sf: 'tram.fill', md: 'train' };
    case 'metro': return { sf: 'lightrail.fill', md: 'subway' };
    case 'lightrail': return { sf: 'tram', md: 'tram' };
    case 'ferry': return { sf: 'ferry.fill', md: 'directions-boat' };
    case 'coach': return { sf: 'bus.doubledecker.fill', md: 'airport-shuttle' };
    case 'walk': return { sf: 'figure.walk', md: 'directions-walk' };
    default: return { sf: 'bus.fill', md: 'directions-bus' };
  }
}

export const MODE_BY_CODE: Record<number, string> = { 1: 'train', 2: 'metro', 4: 'lightrail', 5: 'bus', 7: 'coach', 9: 'ferry', 11: 'school' };

/** The one alert worth showing on a departure row: resolves alert ids against the board's alerts and skips low priority ones (lifts and the like). */
export function rowAlert(alerts: any[] | undefined, board: any[] | undefined): string | null {
  for (const a of alerts || []) {
    const al = typeof a === 'string' ? (board || []).find((b) => b.id === a) : a;
    if (al && al.title && al.priority !== 'low' && al.priority !== 'veryLow') return al.title;
  }
  return null;
}

/** The Version row: "1.0.0 (204) · update 01a16ff7" (build and update only when known; the update is the code over the air). */
export function versionLine(version?: string | null, build?: string | null, updateId?: string | null): string {
  const v = (version || '1.0.0').trim();
  const b = build && String(build).trim() && String(build).trim() !== v ? ` (${String(build).trim()})` : '';
  const u = updateId && /^[0-9a-f-]{8,}$/i.test(updateId) ? ` \u00b7 update ${updateId.replace(/-/g, '').slice(0, 8)}` : '';
  return v + b + u;
}
