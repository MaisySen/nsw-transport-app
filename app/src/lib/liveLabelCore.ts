// Honest live labels, the parts with no phone dependencies (unit tested in test/livelabel.test.mjs).
// Every countdown in the app says where its time comes from: "Live" with the age of the live time, "Timetable"
// when there is no live time, or "Not tracking" when the live time has gone stale. A row never counts down to 0
// and then says the service left: that is only said where a live time confirmed it (recentCore.ts).

export type LiveKind = 'live' | 'timetable' | 'stale' | 'cancelled';

export type LiveInput = {
  planned?: string | null;
  estimated?: string | null;
  realtime?: boolean | null;
  cancelled?: boolean | null;
  /** When this phone received the answer that carried the time (ms). Unknown: the age is not shown. */
  seenAt?: number | null;
  /** Age of the vehicle's GPS position in that answer, in seconds, when the feed gave one. */
  vehicleAgeS?: number | null;
};

export type LiveState = {
  kind: LiveKind;
  /** "Live", "Timetable", "Not tracking", "Cancelled". */
  label: string;
  /** "just now", "20 s ago", "3 min ago" for live times, else null. */
  age: string | null;
  /** The time the row stands for: the live estimate, or the timetable time when there is no live one or it is stale. */
  t: number;
  /** Big countdown parts. Never "Gone" or "Left". */
  big: string;
  unit: string;
  soon: boolean;
  /** False when the row shows a clock time instead of a countdown (not tracking, timetable time passed). */
  counting: boolean;
  /** One line for VoiceOver and TalkBack. */
  a11y: string;
};

/** Our copy of the live times is older than this: close services stop counting down. */
export const STALE_DATA_MS = 120000;
/** The vehicle's own position (or our copy of it) older than this: the live time is not tracking the vehicle. */
export const STALE_GPS_S = 180;
/** A live time this far in the past while the service is still listed: the feed lost it. */
export const DUE_GRACE_MS = 60000;
/** Old data only matters for services this close; further out the age is shown instead. */
export const STALE_NEAR_MS = 10 * 60000;

const ms = (s?: string | null) => (s ? new Date(s).getTime() : NaN);

function clockText(t: number) {
  if (!Number.isFinite(t)) return '';
  try {
    return new Date(t).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Australia/Sydney' }).replace(/\s?(am|pm)/i, (m) => m.trim().toLowerCase());
  } catch {
    const d = new Date(t);
    const h = d.getHours(), m = d.getMinutes();
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
  }
}

/** "just now" under 15 s, then 15 s steps to a minute, then whole minutes. Steps keep rows from redrawing every tick. */
export function ageText(ageMs: number | null | undefined): string | null {
  if (ageMs == null || !Number.isFinite(ageMs)) return null;
  const s = Math.max(0, Math.floor(ageMs / 1000));
  if (s < 15) return 'just now';
  if (s < 60) return `${Math.floor(s / 15) * 15} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)} h ago`;
}

/** Age of the live time in ms: our copy's age plus the GPS position's own age when the feed gave one. */
export function liveAgeMs(x: LiveInput, now: number): number | null {
  if (x.seenAt == null || !Number.isFinite(x.seenAt)) return x.vehicleAgeS != null && Number.isFinite(x.vehicleAgeS) ? Math.max(0, x.vehicleAgeS) * 1000 : null;
  const data = Math.max(0, now - x.seenAt);
  const gps = x.vehicleAgeS != null && Number.isFinite(x.vehicleAgeS) ? Math.max(0, x.vehicleAgeS) * 1000 : 0;
  return data + gps;
}

function counter(t: number, now: number) {
  const diff = t - now;
  if (!Number.isFinite(diff)) return { big: '', unit: '', soon: false, counting: false };
  if (diff < 60000) return { big: 'Now', unit: '', soon: true, counting: true };
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return { big: String(mins), unit: 'min', soon: mins <= 3, counting: true };
  if (mins < 120) return { big: `${Math.floor(mins / 60)}h ${mins % 60}`, unit: 'min', soon: false, counting: true };
  return { big: clockText(t), unit: '', soon: false, counting: false };
}

/** Which label a time gets, and what its countdown shows at `now`. */
export function liveState(x: LiveInput, now: number): LiveState {
  const planned = ms(x.planned);
  const est = ms(x.estimated);
  const rt = !!x.realtime && Number.isFinite(est);
  if (x.cancelled) {
    const t = Number.isFinite(planned) ? planned : est;
    const k = counter(t, now);
    const past = t < now - DUE_GRACE_MS;
    return { kind: 'cancelled', label: 'Cancelled', age: null, t, big: past ? clockText(t) : k.big, unit: past ? '' : k.unit, soon: false, counting: !past && k.counting,
      a11y: `Cancelled, was due ${clockText(t)}` };
  }
  if (!rt) {
    const t = planned;
    if (t < now - DUE_GRACE_MS) {
      // A timetable time that has passed: no live data says whether it came. Show the time, not "left".
      return { kind: 'timetable', label: 'Timetable', age: null, t, big: clockText(t), unit: '', soon: false, counting: false,
        a11y: `Timetable ${clockText(t)}, not tracked` };
    }
    const k = counter(t, now);
    return { kind: 'timetable', label: 'Timetable', age: null, t, ...k, soon: false,
      a11y: `${k.unit ? `${k.big} ${k.unit === 'min' ? 'minutes' : k.unit}` : k.big}, timetable time ${clockText(t)}, no live data` };
  }
  const age = liveAgeMs(x, now);
  const dataAge = x.seenAt != null && Number.isFinite(x.seenAt) ? Math.max(0, now - x.seenAt) : 0;
  const gpsAgeS = x.vehicleAgeS != null && Number.isFinite(x.vehicleAgeS) ? x.vehicleAgeS + dataAge / 1000 : null;
  const near = est - now < STALE_NEAR_MS;
  const stale = (gpsAgeS != null && gpsAgeS > STALE_GPS_S)
    || (near && dataAge > STALE_DATA_MS)
    || est < now - DUE_GRACE_MS;
  if (stale) {
    const t = Number.isFinite(planned) ? planned : est;
    return { kind: 'stale', label: 'Not tracking', age: ageText(age), t, big: clockText(t), unit: '', soon: false, counting: false,
      a11y: `Not tracking. Timetable ${clockText(t)}${age != null ? `, last live time ${ageText(age)}` : ''}` };
  }
  const k = counter(est, now);
  const ageW = ageText(age);
  return { kind: 'live', label: 'Live', age: ageW, t: est, ...k,
    a11y: `${k.unit ? `${k.big} ${k.unit === 'min' ? 'minutes' : k.unit}` : k.big}, live${ageW ? `, updated ${ageW}` : ''}, ${clockText(est)}` };
}

/** What a row shows, as one string: rows redraw only when this changes. */
export function liveKey(x: LiveInput, now: number): string {
  const s = liveState(x, now);
  return `${s.kind}|${s.big}|${s.unit}|${s.soon ? 1 : 0}|${s.age || ''}`;
}

/** "Live, updated 20 s ago" / "Live" / "Timetable" / "Not tracking" / "Cancelled". */
export function liveWords(s: LiveState): string {
  if (s.kind === 'live') return s.age ? `Live, ${s.age === 'just now' ? 'updated just now' : `updated ${s.age}`}` : 'Live';
  return s.label;
}

/**
 * Marks an answer with the moment this phone received it: `seenAt` on each departure row and each trip leg (set once;
 * a copy kept for offline use keeps its first time, so its age stays true). Returns the same object.
 */
/** When an answer's times were read: its seenAt (api.ts sets it from the server's dataAt or the arrival), else now. */
export function answerTime(d: any, now: number): number {
  const t = d && typeof d === 'object' ? Number(d.seenAt) : NaN;
  return Number.isFinite(t) && t <= now && now - t < 120000 ? t : now;
}

export function stampSeen<T>(resp: T, at: number): T {
  const r: any = resp;
  if (!r || typeof r !== 'object') return resp;
  if (r.seenAt == null) r.seenAt = at;
  const t = r.seenAt;
  for (const it of Array.isArray(r.items) ? r.items : []) if (it && typeof it === 'object' && it.seenAt == null) it.seenAt = t;
  for (const j of Array.isArray(r.journeys) ? r.journeys : []) {
    if (!j || typeof j !== 'object') continue;
    if (j.seenAt == null) j.seenAt = t;
    for (const l of Array.isArray(j.legs) ? j.legs : []) if (l && typeof l === 'object' && l.seenAt == null) l.seenAt = t;
  }
  return resp;
}
