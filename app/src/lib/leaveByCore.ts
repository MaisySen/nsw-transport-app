// The calendar event for "Add to Calendar" on a trip: leave by the trip's leave time, with an alert 10 minutes
// before. Pure, so it is unit tested. No imports.

// The phone's 24-Hour Time setting (iPhone Settings, General, Date and Time): lib/rowTime.ts installs the reader
// at start (installPhoneClock). Until then, and in tests, the 12 hour clock the app has always used.
const PHONE24 = (): boolean => { try { return (globalThis as any).__tslPhone24h?.() === true; } catch { return false; } };
/** "07:55" (or "07:55:30"), Sydney time, for a phone set to 24 hour time. */
const C24 = (t: number, sec = false): string => {
  try { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', ...(sec ? { second: '2-digit' } : {}), hourCycle: 'h23', timeZone: 'Australia/Sydney' } as Intl.DateTimeFormatOptions).format(new Date(t)); }
  catch { const d = new Date(t); return [d.getHours(), d.getMinutes(), ...(sec ? [d.getSeconds()] : [])].map((n) => String(n).padStart(2, '0')).join(':'); }
};

export type LeaveByEvent = {
  title: string;
  startDate: Date;
  endDate: Date;
  location?: string;
  notes: string;
  alarms: { relativeOffset: number }[];
};

type LegLike = { kind?: string; line?: string; mode?: string; from?: string; fromPlatform?: string | null };
type JourneyLike = { leave?: string | number; arrive?: string | number; legs?: LegLike[] };

const ms = (v: string | number | undefined) => (typeof v === 'number' ? v : v ? Date.parse(v) : NaN);

/** "8:12am" in Sydney time. */
export function sydClock(t: number): string {
  if (PHONE24() && Number.isFinite(t)) return C24(t);
  return new Date(t).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' })
    .replace(/\s/g, '').toLowerCase();
}

/** "Strathfield" from "Strathfield Station, Strathfield". */
export function shortPlace(s: string | undefined | null): string {
  return String(s || '').split(',')[0].replace(/ Station$/, '').trim();
}

export function leaveByEvent(j: JourneyLike, toName: string): LeaveByEvent | null {
  const leave = ms(j.leave), arrive = ms(j.arrive);
  if (!Number.isFinite(leave)) return null;
  const end = Number.isFinite(arrive) && arrive > leave ? arrive : leave + 30 * 60000;
  const t = (j.legs || []).find((l) => l.kind === 'transit');
  const to = shortPlace(toName);
  const from = shortPlace(t?.from);
  const parts: string[] = [];
  if (t) {
    const what = t.line ? t.line : (t.mode || 'service');
    parts.push(`${what}${from ? ` from ${from}` : ''}${t.fromPlatform ? `, ${t.fromPlatform}` : ''}.`);
  }
  if (Number.isFinite(arrive)) parts.push(`Arrive ${sydClock(arrive)}.`);
  parts.push('Live times can change, so check Transport before you go.');
  return {
    title: to ? `Leave for ${to}` : 'Leave for your trip',
    startDate: new Date(leave),
    endDate: new Date(end),
    ...(t?.from ? { location: String(t.from) } : {}),
    notes: parts.join(' '),
    alarms: [{ relativeOffset: -10 }],
  };
}

/** Whether to post the plain trip notification: not on an iPhone that is showing the trip's Live Activity. */
export function wantOngoing(os: string, activitiesEnabled: boolean, activityCount: number): boolean {
  return !(os === 'ios' && activitiesEnabled && activityCount > 0);
}
