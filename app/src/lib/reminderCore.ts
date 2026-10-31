// Trip reminders, the parts with no phone dependencies (unit tested): several reminders per saved trip, each
// on chosen weekdays at a clock time, scheduled on the phone as weekly local notifications (no polling, no server).

// The phone's 24-Hour Time setting (iPhone Settings, General, Date and Time): lib/rowTime.ts installs the reader
// at start (installPhoneClock). Until then, and in tests, the 12 hour clock the app has always used.
const PHONE24 = (): boolean => { try { return (globalThis as any).__tslPhone24h?.() === true; } catch { return false; } };
const HM24 = (h: number, m: number): string => `${String(((h % 24) + 24) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
export type Reminder = { id: string; hour: number; minute: number; days: number[] };
/** Weekdays as expo-notifications counts them: 1 Sunday ... 7 Saturday. */
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAYS = [2, 3, 4, 5, 6];
export const MAX_PER_TRIP = 6;

/** A clean reminder, or null: whole hour 0 to 23, minute 0 to 59, at least one day from 1 to 7 (sorted, no repeats). */
export function cleanReminder(r: any): Reminder | null {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id) return null;
  const hour = Number(r.hour), minute = Number(r.minute);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  const days = [...new Set((Array.isArray(r.days) ? r.days : []).map(Number).filter((d: number) => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a: any, b: any) => a - b) as number[];
  if (!days.length) return null;
  return { id: r.id, hour, minute, days };
}

/** "7:30am" */
export function clockText(hour: number, minute: number) {
  if (PHONE24()) return HM24(hour, minute);
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, '0')}${hour < 12 ? 'am' : 'pm'}`;
}

/** "Weekdays", "Weekends", "Every day", "Mon, Wed, Fri", "Tuesday" */
export function daysText(days: number[]) {
  const d = [...new Set(days)].sort((a, b) => a - b);
  if (d.length === 7) return 'Every day';
  if (d.length === 5 && WEEKDAYS.every((x) => d.includes(x))) return 'Weekdays';
  if (d.length === 2 && d[0] === 1 && d[1] === 7) return 'Weekends';
  if (d.length === 1) return DAY_LONG[d[0] - 1];
  return d.map((x) => DAY_NAMES[x - 1]).join(', ');
}

export const reminderText = (r: Reminder) => `${clockText(r.hour, r.minute)}, ${daysText(r.days)}`;

/** One weekly notification per day of each reminder: its identifier and weekly trigger parts. */
export function schedulePlan(tripKey: string, list: Reminder[]) {
  const out: { id: string; weekday: number; hour: number; minute: number }[] = [];
  for (const r of list) for (const d of r.days) out.push({ id: notifId(tripKey, r.id, d), weekday: d, hour: r.hour, minute: r.minute });
  return out;
}
export const notifId = (tripKey: string, rid: string, day: number) => `trip-rem|${tripKey}|${rid}|${day}`;
export const isTripReminderId = (id: string) => id.startsWith('trip-rem|');

/** The next time a reminder rings after now (local time of the phone), in ms. */
export function nextRing(r: Reminder, now: number) {
  const base = new Date(now);
  for (let add = 0; add <= 7; add++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + add, r.hour, r.minute, 0, 0);
    if (r.days.includes(d.getDay() + 1) && d.getTime() > now) return d.getTime();
  }
  return null;
}

/** The words on the notification. Static: nothing is fetched to make them, so it never shows a stale time. */
export function ringWords(tripName: string) {
  return { title: tripName || 'Your trip', body: 'Time to check your trip. Tap for live times.' };
}

/** A new reminder: the time given (the next service's leave time), else 7:30am, on weekdays. */
export function newReminder(id: string, from?: { hour: number; minute: number } | null): Reminder {
  return { id, hour: from?.hour ?? 7, minute: from?.minute ?? 30, days: [...WEEKDAYS] };
}
