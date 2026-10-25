// Morning check, the parts without a screen: time steps, labels, what the preview means, and when to ask for
// notifications. The server does the checking (docs/API.md, Morning check).
import type { MorningCheck, MorningMode, MorningPreview, Place, PushCount } from './types';

export const LEADS = [5, 10, 15, 20, 30] as const;
export const DEFAULT_LEAD = 15;
export const MODES: { key: MorningMode | null; label: string }[] = [
  { key: null, label: 'Any' }, { key: 'train', label: 'Train' }, { key: 'metro', label: 'Metro' }, { key: 'bus', label: 'Bus' },
  { key: 'ferry', label: 'Ferry' }, { key: 'lightrail', label: 'Light rail' },
];
export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "08:00" from minutes after midnight, wrapping round the day. */
export function hhmm(min: number) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
/** Minutes after midnight from "08:00", "8:00" or "0800"; NaN when it is not a time. */
export function minutesOf(t: string) {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(String(t || '').trim());
  if (!m) return NaN;
  const h = Number(m[1]), mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : NaN;
}
/** Moves a time by delta minutes, snapping to the step first (8:03 plus 5 is 8:05, minus 5 is 8:00). */
export function stepTime(t: string, delta: number, step = 5) {
  const m = minutesOf(t);
  const base = Number.isFinite(m) ? m : 8 * 60;
  if (base % step === 0) return hhmm(base + delta);
  return hhmm(delta > 0 ? Math.ceil(base / step) * step : Math.floor(base / step) * step);
}
/** "8:00am" from "08:00". */
export function timeText(t: string) {
  const m = minutesOf(t);
  if (!Number.isFinite(m)) return t;
  const h = Math.floor(m / 60), mi = m % 60;
  return `${h % 12 || 12}:${String(mi).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
}
/** "Mon to Fri", "Every day", "Sat and Sun", or "Mon, Wed, Fri". Days are 1 (Monday) to 7. */
export function daysLabel(days: number[]) {
  const d = [...new Set(days)].filter((x) => x >= 1 && x <= 7).sort((a, b) => a - b);
  const k = d.join('');
  if (k === '1234567') return 'Every day';
  if (k === '12345') return 'Mon to Fri';
  if (k === '67') return 'Sat and Sun';
  if (!d.length) return 'No days';
  return d.map((x) => DAY_SHORT[x - 1]).join(', ');
}
export function toggleDay(days: number[], day: number) {
  return days.includes(day) ? days.filter((x) => x !== day) : [...days, day].sort((a, b) => a - b);
}
const short = (n?: string) => String(n || '').replace(/ Station$/, '').replace(/,.*$/, '');
export function checkTitle(c: { name?: string | null; from: Place; to: Place }) {
  return c.name || `${short(c.from.name)} to ${short(c.to.name)}`;
}
/** "8:00am, Mon to Fri. Checks 15 min before." */
export function checkSubtitle(c: Pick<MorningCheck, 'time' | 'days' | 'lead' | 'mode'> & { timeText?: string }) {
  const mode = c.mode ? MODES.find((m) => m.key === c.mode)?.label.toLowerCase() : null;
  return `${c.timeText || timeText(c.time)}${mode ? ` ${mode}` : ''}, ${daysLabel(c.days)}. Checks ${c.lead} min before.`;
}
/** No push target on the server: an alert would reach nobody, so ask for notifications first. */
export const noTargets = (p?: PushCount | null) => !p || (Number(p.web) || 0) + (Number(p.expo) || 0) === 0;

/** What "Check now" found, as short sentences for the screen. tone: ok, issue or none. */
export function previewWords(p: MorningPreview, clock: (t: number) => string): { tone: 'ok' | 'issue' | 'none'; title: string; lines: string[] } {
  const at = p.item?.timeText || timeText(p.item?.time || '');
  if (!p.found) return { tone: 'none', title: `No service found near ${at}`, lines: ['Nothing would be sent. Try a time closer to when your service runs.'] };
  const issues = (p.issues || []).map((i) => i.text).filter(Boolean);
  if (issues.length) return { tone: 'issue', title: issues.length === 1 ? 'One problem right now' : `${issues.length} problems right now`, lines: issues };
  const s = p.service || {};
  const t = s.planned ? Date.parse(s.planned) : NaN;
  const what = [Number.isFinite(t) ? clock(t) : '', s.line || ''].filter(Boolean).join(' ');
  const plat = s.platform ? ` from ${s.platform}` : '';
  const est = s.estimated ? Date.parse(s.estimated) : NaN;
  const late = s.realtime && Number.isFinite(est) && Number.isFinite(t) ? Math.round((est - t) / 60000) : 0;
  const live = !s.realtime ? 'with no live data yet' : late >= 1 ? `${late} min late` : 'on time';
  return { tone: 'ok', title: 'All fine right now', lines: [`The ${what || 'service'} runs ${live}${plat}. Nothing would be sent.`] };
}

/**
 * A tapped morning check alert (push tag m<id>) opens that check's trip, where the trip screen shows the live times
 * and Plan B (docs/PLAN-B.md). Null when the check is not on the phone, and the alert opens the checks instead.
 */
export function morningTripParams(tag: unknown, list: MorningCheck[] | null | undefined): Record<string, string> | null {
  if (typeof tag !== 'string' || !/^m[A-Za-z0-9]/.test(tag)) return null;
  const c = (list || []).find((x) => x && x.id === tag.slice(1));
  if (!c || !c.from?.id || !c.to?.id) return null;
  return { from: c.from.id, fromName: c.from.name || '', to: c.to.id, toName: c.to.name || '', ...(c.name ? { name: c.name } : {}) };
}
