// Mode chips and the endless list on the trip screen. Pure logic, no imports, so tests load it on their own.

// The phone's 24-Hour Time setting (iPhone Settings, General, Date and Time): lib/rowTime.ts installs the reader
// at start (installPhoneClock). Until then, and in tests, the 12 hour clock the app has always used.
const PHONE24 = (): boolean => { try { return (globalThis as any).__tslPhone24h?.() === true; } catch { return false; } };
const HM24 = (h: number, m: number): string => `${String(((h % 24) + 24) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

export type ModeK = 'train' | 'metro' | 'bus' | 'lightrail' | 'ferry';
/** The chips, in the order they show. "Any" is the empty choice. */
export const MODE_CHIPS: { k: ModeK; name: string }[] = [
  { k: 'train', name: 'Train' },
  { k: 'metro', name: 'Metro' },
  { k: 'bus', name: 'Bus' },
  { k: 'lightrail', name: 'Light rail' },
  { k: 'ferry', name: 'Ferry' },
];
const ORDER = MODE_CHIPS.map((c) => c.k);

/** A leg's mode as a chip: coaches and school buses count as Bus. */
export function chipOf(mode?: string | null): ModeK | null {
  if (mode === 'coach' || mode === 'school') return 'bus';
  return (ORDER as string[]).includes(String(mode)) ? (mode as ModeK) : null;
}

/** Known chips only, no repeats, in chip order (stored choices and links pass through here). */
export function normModes(x: unknown): ModeK[] {
  const a = Array.isArray(x) ? x : typeof x === 'string' ? x.split(',') : [];
  return ORDER.filter((k) => a.includes(k));
}

/** Tap on a chip: Any (null) clears, a mode toggles. Every chip on means Any. */
export function toggleMode(cur: ModeK[], k: ModeK | null, shown: ModeK[] = ORDER): ModeK[] {
  if (!k) return [];
  const next = cur.includes(k) ? cur.filter((x) => x !== k) : normModes([...cur, k]);
  return shown.length > 1 && shown.every((s) => next.includes(s)) ? [] : next;
}

/** Which chips make sense: Train and Bus always (every Sydney trip has one or the other nearby), the others only
 * when a result used them or they are chosen. */
export function chipsToShow(seen: (string | null | undefined)[], chosen: ModeK[]): ModeK[] {
  const have = new Set<string>(['train', 'bus', ...chosen]);
  for (const m of seen) { const c = chipOf(m); if (c) have.add(c); }
  return ORDER.filter((k) => have.has(k));
}

type LegLike = { kind?: string; mode?: string | null };
type JLike = { legs: LegLike[] };

/** The chips a journey uses (walks left out). */
export function journeyChips(j: JLike): ModeK[] {
  return normModes(j.legs.filter((l) => l.kind !== 'walk').map((l) => chipOf(l.mode)).filter(Boolean));
}

/** A journey fits when it has a service and every service is one of the chosen modes. Any fits everything. */
export function fitsModes(j: JLike, modes: ModeK[]): boolean {
  if (!modes.length) return true;
  const tl = j.legs.filter((l) => l.kind !== 'walk');
  return tl.length > 0 && tl.every((l) => { const c = chipOf(l.mode); return !!c && modes.includes(c); });
}
export const filterModes = <T extends JLike>(js: T[], modes: ModeK[]) => (modes.length ? js.filter((j) => fitsModes(j, modes)) : js);

/** "Bus", "Train and bus", "Train, metro and bus". */
export function modesWords(modes: ModeK[]): string {
  const n = modes.map((k) => MODE_CHIPS.find((c) => c.k === k)!.name.toLowerCase());
  const s = n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}` : n[0] || 'any';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The empty state. `byServer`: the planner was asked for these modes only, so none means none at this time.
 * Otherwise (the older server) the phone filtered the planner's usual answer, which proves nothing. */
export function emptyModes(modes: ModeK[], byServer: boolean): { title: string; body: string } {
  const w = modesWords(modes).toLowerCase();
  if (byServer) return { title: `No ${w} only trips`, body: `No ${w}-only trips at this time. Try Any.` };
  return { title: `No ${w} only trips in these results`, body: 'The planner suggested other ways for this trip. Try again in a moment, or tap Any.' };
}

/** Accessibility label of a chip. */
export const chipLabel = (name: string, on: boolean) => `${name}${on ? ', selected' : ''}`;

// ---- Endless list ----

/** Caps so the list never loops on the network: batches each way per screen visit, and a stop at the end of the
 * service day (4am Sydney after the first service shown). */
export const PAGING = { maxLater: 8, maxEarlier: 30, nearEndPx: 700, earlierBackMs: 40 * 60000, earliestBeforeNowMs: 30 * 60000 };

/** The next 4:00am in Sydney after `t` (the service day ends there). */
export function serviceDayEnd(t: number): number {
  const p = sydney(t);
  const mins = p.h * 60 + p.m;
  const toFour = (mins < 240 ? 240 - mins : 24 * 60 - mins + 240) * 60000;
  return t + toFour - p.s * 1000;
}

export type PageState = { pages: number; done: boolean; busy: boolean };
export const PAGE0: PageState = { pages: 0, done: false, busy: false };

/** Whether to ask for the next batch of later services now. */
export function canLoadLater(st: PageState, lastDep: number | null, dayEnd: number, visible: boolean): boolean {
  return visible && !st.busy && !st.done && st.pages < PAGING.maxLater && lastDep != null && lastDep < dayEnd;
}
/** Whether Earlier services (the row at the top of the list, or a pull at the top) can ask for more: not before the floor
 * (earlierFloor: the start of the service day). Each batch is one tap or pull, so the cap is only a guard. */
export function canLoadEarlier(st: PageState, firstDep: number | null, floor: number, visible: boolean): boolean {
  return visible && !st.busy && !st.done && st.pages < PAGING.maxEarlier && firstDep != null && firstDep - 60000 > floor;
}
/** Where an earlier batch starts. */
export const earlierFrom = (firstDep: number, floor: number) => Math.max(floor, firstDep - PAGING.earlierBackMs);

/** After a batch: done when it brought nothing new (the planner has nothing more that day) or passed the day's end. */
export function afterBatch(st: PageState, added: number, lastDep: number | null, dayEnd: number): PageState {
  return { pages: st.pages + 1, busy: false, done: added === 0 || (lastDep != null && lastDep >= dayEnd) };
}

/** Near the end of the scroll view: the next batch should load. */
export function nearEnd(e: { layoutH: number; offsetY: number; contentH: number }, px = PAGING.nearEndPx): boolean {
  return e.contentH > 0 && e.offsetY + e.layoutH >= e.contentH - px;
}

// ---- Leave at / Arrive by on any day ----

/** Sydney wall clock parts of a moment. */
export function sydney(t: number): { y: number; mo: number; d: number; h: number; m: number; s: number; dow: number } {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(t))) p[x.type] = x.value;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, m: +p.minute, s: +p.second, dow };
}
/** "20261027" for a moment, Sydney. */
export const ymd = (t: number) => { const p = sydney(t); return `${p.y}${String(p.mo).padStart(2, '0')}${String(p.d).padStart(2, '0')}`; };

/** The moment for a Sydney day and clock time. */
export function sydneyTime(day: string, h: number, m: number): number {
  const y = +day.slice(0, 4), mo = +day.slice(4, 6), d = +day.slice(6, 8);
  let t = Date.UTC(y, mo - 1, d, h, m) - 10 * 3600000;
  for (let i = 0; i < 3; i++) {
    const p = sydney(t);
    const diff = (Date.UTC(p.y, p.mo - 1, p.d, p.h, p.m) - Date.UTC(y, mo - 1, d, h, m)) / 60000;
    if (!diff) break;
    t -= diff * 60000;
  }
  return t;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** The days the picker offers: today and the next `n - 1` (the server plans up to 14 days ahead). */
export function pickerDays(now: number, n = 8): { day: string; label: string; a11y: string }[] {
  const out: { day: string; label: string; a11y: string }[] = [];
  const p0 = sydney(now);
  for (let i = 0; i < n; i++) {
    const t = sydneyTime(`${p0.y}${String(p0.mo).padStart(2, '0')}${String(p0.d).padStart(2, '0')}`, 12, 0) + i * 86400000;
    const p = sydney(t);
    const dm = `${p.d} ${MON[p.mo - 1]}`;
    out.push({ day: ymd(t), label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : `${DOW[p.dow]} ${dm}`, a11y: i === 0 ? `Today, ${dm}` : i === 1 ? `Tomorrow, ${dm}` : `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][p.dow]} ${dm}` });
  }
  return out;
}

/** The planner's date for a chosen day and time, or null when the time alone says it (today, or tomorrow for a
 * time more than 30 min before now: the rule every server uses). Only a date that is needed goes to the server. */
export function dateNeeded(day: string | null | undefined, h: number, m: number, now: number): string | null {
  if (!day) return null;
  const today = ymd(now);
  const c = sydney(now);
  const implicitTomorrow = h * 60 + m < c.h * 60 + c.m - 30;
  if (day === today && !implicitTomorrow) return null;
  if (day === ymd(sydneyTime(today, 12, 0) + 86400000) && implicitTomorrow) return null;
  return day;
}

/** "Tue 27 Oct" for a date the picker sent, "tomorrow" for tomorrow. */
export function dayWords(day: string, now: number): string {
  const d = pickerDays(now, 15).find((x) => x.day === day);
  if (!d) return `${+day.slice(6, 8)} ${MON[+day.slice(4, 6) - 1]}`;
  return d.label === 'Tomorrow' ? 'tomorrow' : d.label === 'Today' ? '' : d.label;
}

// ---- A chosen time in the past (Leave 6:15pm picked at 6:27pm) ----

type WhenLike = { kind: 'now' } | { kind: 'leave' | 'arrive'; h: number; m: number; day?: string };

/** Gone: left over a minute ago, the same moment the countdown chip says Left. */
export const hasLeft = (dep: number, now: number) => Number.isFinite(dep) && dep < now - 60000;

/** The words on a service that has gone: "Left 6:21 · 3 min late" with a live time (the time it really left),
 * "Left 6:18 · Scheduled" with only the timetable, "Cancelled" when it did not run. */
export function leftWords(dep: number, l: { realtime?: boolean; delayMin?: number | null; cancelled?: boolean } | null | undefined, hm: (t: number) => string): string {
  if (l?.cancelled) return `Cancelled ${hm(dep)}`;
  if (!l?.realtime) return `Left ${hm(dep)} \u00b7 Scheduled`;
  const d = l.delayMin || 0;
  return `Left ${hm(dep)} \u00b7 ${d > 0 ? `${d} min late` : d < 0 ? `${-d} min early` : 'On time'}`;
}

/** The 4:00am Sydney that starts the service day `t` is in (the planner's day runs 4am to 4am). */
export function serviceDayStart(t: number): number {
  const p = sydney(t);
  const day = p.h >= 4 ? ymd(t) : ymd(sydneyTime(ymd(t), 12, 0) - 86400000);
  return sydneyTime(day, 4, 0);
}

/** How far back Earlier services may go: the start of the service day of now, or of the chosen time (past or not), so
 * Now at 7pm can go back to this morning's first services. */
export function earlierFloor(w: WhenLike, anchor: number, now: number): number {
  return serviceDayStart(w.kind === 'now' ? now : anchor);
}

/** Where one Earlier tap asks, in turn, until a batch brings something earlier: 40 min, then 90 min, then 3 hours
 * before the first service shown, never before the floor (a quiet stretch with no service does not end the list). */
export function earlierSteps(firstDep: number, floor: number): number[] {
  const out: number[] = [];
  for (const back of [PAGING.earlierBackMs, 90 * 60000, 180 * 60000]) {
    const t = Math.max(floor, firstDep - back);
    if (!out.includes(t)) out.push(t);
    if (t === floor) break;
  }
  return out;
}

/** The Earlier services row at the top of the list: shown while another batch can load, with its words. */
export function earlierRow(st: PageState, firstDep: number | null, floor: number): { show: boolean; label: string } {
  const show = !st.busy && canLoadEarlier(st, firstDep, floor, true);
  return { show, label: 'Earlier services' };
}

/** The earliest departure the list keeps. Now: the planner's answer drops services gone over 2 min ago (as before);
 * services loaded with Earlier stay, down to the start of the service day, shown as Left. A chosen time keeps the planner's whole answer
 * for it, gone or not, so Leave 6:15 at 6:27 shows the 6:18 and the 6:24, and Earlier batches down to the floor. */
export function keepFrom(w: WhenLike, anchor: number, now: number): { main: number; extra: number } {
  if (w.kind === 'now') return { main: now - 120000, extra: earlierFloor(w, anchor, now) };
  return { main: -Infinity, extra: earlierFloor(w, anchor, now) };
}

/** The day a chosen time means, written in when it is picked: a time with no day is today, or tomorrow when it is
 * over 30 min before now (the rule every server uses). Pinned, Leave 6:15pm picked at 6:27pm is still today's
 * 6:15pm at 7pm, instead of turning into tomorrow's half an hour later. */
export function pinDay<W extends WhenLike>(w: W, now: number): W {
  if (w.kind === 'now' || w.day) return w;
  const c = sydney(now);
  const tomorrow = w.h * 60 + w.m < c.h * 60 + c.m - 30;
  return { ...w, day: tomorrow ? ymd(sydneyTime(ymd(now), 12, 0) + 86400000) : ymd(now) };
}

/** The trip request for a chosen time, worked out when it is sent: the date goes only when the time alone would
 * mean another day (dateNeeded), so a time up to 30 min ago still goes to the older server as a plain time, and an
 * older time today goes with today's date (the new server; the older one plans those for tomorrow). */
export function queryAt(w: WhenLike, now: number): { time?: string; arriveBy?: boolean; date?: string } {
  if (w.kind === 'now') return {};
  const date = dateNeeded(w.day, w.h, w.m, now);
  return { time: `${String(w.h).padStart(2, '0')}${String(w.m).padStart(2, '0')}`, ...(w.kind === 'arrive' ? { arriveBy: true } : {}), ...(date ? { date } : {}) };
}

/** A key that stays the same for one chosen time (the request itself can gain a date as the clock moves on). */
export const whenKeyOf = (w: WhenLike) => (w.kind === 'now' ? '' : `${String(w.h).padStart(2, '0')}${String(w.m).padStart(2, '0')}${w.kind === 'arrive' ? 'a' : 'l'}${w.day || ''}`);

/** The moment a chosen time stands for, or now. */
export function whenAt(w: WhenLike, now: number): number {
  if (w.kind === 'now') return now;
  return sydneyTime(pinDay(w, now).day as string, w.h, w.m);
}

/** True when the chosen moment has passed: the list then starts with services that have gone. */
export const isPastWhen = (w: WhenLike, now: number) => w.kind !== 'now' && whenAt(w, now) < now - 60000;

/** "Leave 6:15pm", "Arrive by 9:00am tomorrow", "Leave 8:15am Tue 27 Oct" for a chosen time (today's needs no day). */
export function whenWords(w: WhenLike, now: number): string {
  if (w.kind === 'now') return 'Leave now';
  const p = pinDay(w, now);
  const t = PHONE24() ? HM24(w.h, w.m) : `${w.h % 12 || 12}:${String(w.m).padStart(2, '0')}${w.h < 12 ? 'am' : 'pm'}`;
  const today = ymd(now);
  const tomorrow = ymd(sydneyTime(today, 12, 0) + 86400000);
  const d = p.day === today ? '' : p.day === tomorrow ? ' tomorrow' : ` ${dayShortOf(p.day as string)}`;
  return w.kind === 'arrive' ? `Arrive by ${t}${d}` : `Leave ${t}${d}`;
}
function dayShortOf(day: string): string {
  const y = +day.slice(0, 4), mo = +day.slice(4, 6), d = +day.slice(6, 8);
  return `${DOW[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]} ${d} ${MON[mo - 1]}`;
}

/** What a pull at the top says when an earlier batch could not be planned: times over 30 min ago need the newer
 * server (the older one plans them for tomorrow), so that is said plainly instead of showing nothing. */
export const EARLIER_NEEDS_NEW = 'Earlier trips need a newer server, which did not answer just now. Pull down to try again.';
