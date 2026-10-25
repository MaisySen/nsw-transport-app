// Last way home reminder, the parts with no phone dependencies (unit tested). Two ways to deliver it: on the iPhone,
// where the new server has /api/last-home, the server finds the last service, looks again live and sends one push
// 15 min before (docs/API.md, Last way home reminder); everywhere else the phone schedules one local notification and
// looks at live times again whenever the app is open (docs/LAST-WAY-HOME.md).
export const LAST_HOME_LEAD = 15;
/** The last service as the phone keeps it: small, so Ask answers saved on the phone stay small. */
export type LastSvc = { leave: string; board: string; line: string | null; mode: string | null; stop: string | null; platform: string | null; tripId: string | null; planned: string | null; cancelled?: boolean };
export type LastHomeHint = { from: { id: string; name: string }; to: { id: string; name: string }; mode?: string | null; leave?: string; lead?: number; svc?: LastSvc | null };
export type LastHomeItem = {
  id: string; from: { id: string; name: string }; to: { id: string; name: string }; mode?: string | null; serviceMode?: string | null; lead: number;
  leave: string | null; board?: string | null; remindAt: string | null; line?: string | null; stop?: string | null; platform?: string | null;
  changedFrom?: string | null; status: 'waiting' | 'sent' | 'none' | 'gone'; sent?: string | null; text?: string | null; leaveText?: string | null; remindText?: string | null;
};

const SYD = 'Australia/Sydney';
function sydHour(t: number) {
  try { return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: SYD }).format(new Date(t))) % 24; } catch { return new Date(t).getHours(); }
}

/**
 * Index of the last service tonight in a list of departure times (any order), or -1. It is the one leaving
 * from 8pm to 3am Sydney time with nothing listed for 3 hours or more after it (the next one listed is
 * tomorrow morning) and at least one later departure listed to prove the gap. Never guessed from one time alone.
 */
export function lastTonightIndex(deps: number[]): number {
  const order = deps.map((t, i) => ({ t, i })).filter((x) => Number.isFinite(x.t)).sort((a, b) => a.t - b.t);
  for (let k = 0; k + 1 < order.length; k++) {
    const h = sydHour(order[k].t);
    const night = h >= 20 || h < 3;
    if (night && order[k + 1].t - order[k].t >= 3 * 3600000) return order[k].i;
  }
  return -1;
}

/** Room for a reminder: the service leaves more than lead + 1 min from now and within 8 hours. */
export function canRemind(leave: number, now: number, lead = LAST_HOME_LEAD) {
  return Number.isFinite(leave) && leave - now > (lead + 1) * 60000 && leave - now < 8 * 3600000;
}

/** The mode to ask for from a trip's transit legs: "train" when every leg is train or metro, else any (null). */
export function modeOfLegs(legs: { kind?: string; mode?: string }[]): string | null {
  const t = legs.filter((l) => l.kind === 'transit');
  if (!t.length) return null;
  if (t.every((l) => l.mode === 'train' || l.mode === 'metro')) return 'train';
  const m = t[0].mode;
  return m && t.every((l) => l.mode === m) ? m : null;
}

const NOUN: Record<string, string> = { train: 'train', metro: 'metro', bus: 'bus', ferry: 'ferry', lightrail: 'light rail', coach: 'coach' };
const short = (n?: string | null) => String(n || '').replace(/,.*$/, '').replace(/ Station$/, '');

/** What was confirmed after Remind me, per platform. Android before versionCode 6 has no server push. */
export function setNote(item: LastHomeItem, os: string, push: { web?: number; expo?: number } | null | undefined) {
  const when = `${item.remindText || ''}, ${item.lead} min before the ${item.leaveText || 'last service'}`;
  if (os === 'android') return `Reminder set for ${when}. This Android version can't get notifications from the server yet, so the reminder shows on Home instead.`;
  const targets = (Number(push?.web) || 0) + (Number(push?.expo) || 0);
  if (!targets) return `Reminder set for ${when}, but notifications are off for Transport, so it can only show on Home.`;
  return `Reminder set. One notification at ${when}. It checks live times first.`;
}

/** The Home card for an active reminder: title, one line, and whether it is time to go. Null when there is nothing to show. */
export function cardWords(item: LastHomeItem | null | undefined, now: number): { title: string; line: string; go: boolean } | null {
  if (!item || item.status === 'gone' || !item.leave) return null;
  const leave = Date.parse(item.leave);
  if (!Number.isFinite(leave) || now > leave + 2 * 60000) return null;
  const noun = NOUN[item.serviceMode || item.mode || ''] || 'service';
  const title = `Last ${noun} to ${short(item.to.name)}`;
  if (item.status === 'none') return { title, line: item.text || 'No service home shows for the rest of tonight. Open Plan for other ways home.', go: true };
  const remindAt = item.remindAt ? Date.parse(item.remindAt) : leave - item.lead * 60000;
  const plat = item.platform ? `, ${item.platform}` : '';
  const what = [item.line, item.stop ? `from ${item.stop}` : ''].filter(Boolean).join(' ');
  const changed = item.changedFrom ? ' Time changed since you set it.' : '';
  // A walk to the stop first: say when to set off and when the service itself leaves, so the two are not mixed up.
  const board = item.board ? Date.parse(item.board) : NaN;
  const walk = Number.isFinite(board) && board - leave >= 60000;
  const svc = walk ? `the ${clock(board)}${what ? ` ${what}` : ''}${plat}` : '';
  if (now >= remindAt || item.status === 'sent') {
    const mins = Math.max(0, Math.round((leave - now) / 60000));
    if (walk) return { title, line: `${mins >= 1 ? `Leave in ${mins} min` : 'Leave now'} for ${svc}.${changed}`, go: true };
    return { title, line: `${mins >= 1 ? `Leave in ${mins} min` : 'Leave now'}: ${item.leaveText || ''}${what ? ` ${what}` : ''}${plat}.${changed}`, go: true };
  }
  if (walk) return { title, line: `Leave by ${item.leaveText || ''} for ${svc}. Reminder at ${item.remindText || ''}.${changed}`, go: false };
  return { title, line: `Leaves ${item.leaveText || ''}${what ? ` ${what}` : ''}${plat}. Reminder at ${item.remindText || ''}.${changed}`, go: false };
}

// ---------- the phone's own reminder (local notification), used where the server push is not ----------

export type LocalLast = LastHomeItem & { local: true; svc: LastSvc; acc?: boolean; checked: number };
export type LastPath = 'server' | 'local';

/**
 * Who delivers Remind me. The server push where it exists and reaches this phone (the new server, iPhone); the
 * phone's own notification otherwise (the current server, and Android until it has server push). Null: neither.
 */
export function chooseLastPath(os: string, server: boolean, local: boolean): LastPath | null {
  if (server && os === 'ios') return 'server';
  if (local) return 'local';
  return server ? 'server' : null;
}

const iso = (t: number) => new Date(t).toISOString();
const msOf = (s?: string | null) => (s ? Date.parse(s) : NaN);
const transitLegs = (j: any): any[] => (j?.legs || []).filter((l: any) => l && l.kind !== 'walk' && (l.line || l.mode));
function clock(t: number) {
  try { return new Date(t).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: SYD }).replace(/\s?(am|pm)/i, (m) => m.trim().toLowerCase()); }
  catch { const d = new Date(t), h = d.getHours(); return `${((h + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`; }
}
export const clockText = clock;

/** A journey cut to what the reminder needs: when to leave, the first service (live time first), where it leaves from. */
export function slimLast(j: any): LastSvc | null {
  const f = transitLegs(j)[0];
  if (!f || !f.planned) return null;
  const board = f.realtime !== false && f.estimated ? f.estimated : f.planned;
  // A walk first keeps its length: leave that much before the service.
  const walk = Number.isFinite(msOf(j.leave)) ? Math.max(0, msOf(f.planned) - msOf(j.leave)) : 0;
  return {
    leave: iso(msOf(board) - walk), board, line: f.line || null, mode: f.mode || null, stop: short(f.from) || null,
    platform: f.fromPlatform || null, tripId: f.tripId || null, planned: f.planned, cancelled: !!(f.cancelled || j.anyCancelled),
  };
}

/** The reminder kept on the phone for this service. */
export function localItem(hint: LastHomeHint, svc: LastSvc, now: number, lead = LAST_HOME_LEAD): LocalLast {
  const leave = msOf(svc.leave);
  const remindAt = leave - lead * 60000;
  return {
    id: 'local', local: true, from: hint.from, to: hint.to, mode: hint.mode || null, serviceMode: svc.mode, lead,
    leave: svc.leave, board: svc.board, remindAt: iso(remindAt), line: svc.line, stop: svc.stop, platform: svc.platform,
    changedFrom: null, status: 'waiting', leaveText: clock(leave), remindText: clock(remindAt), svc, checked: now,
  };
}

const okMode = (j: any, mode?: string | null) => {
  const t = transitLegs(j);
  return t.length > 0 && (!mode || t.every((l) => l.mode === mode || (mode === 'train' && l.mode === 'metro')));
};
const cancelledJ = (j: any) => !!j?.anyCancelled || transitLegs(j).some((l) => l.cancelled);

/**
 * The last service tonight among journeys, as the server picks it: the one before a gap of 3 hours or more (the
 * night), else the latest listed. Cancelled ones are left out. `sure` when the gap or a much later one proves it.
 */
export function pickLastJourney(js: any[], mode?: string | null): { j: any; sure: boolean } | null {
  const s = (js || []).filter((j) => j && okMode(j, mode) && !cancelledJ(j) && Number.isFinite(msOf(j.leave))).sort((a, b) => msOf(a.leave) - msOf(b.leave));
  if (!s.length) return null;
  const gap = s.findIndex((j, i) => i + 1 < s.length && msOf(s[i + 1].leave) - msOf(j.leave) >= 3 * 3600000);
  const j = s[gap >= 0 ? gap : s.length - 1];
  return { j, sure: gap >= 0 || (js || []).some((x) => msOf(x?.leave) > msOf(j.leave) + 60 * 60000) };
}

const sameSvc = (j: any, svc: LastSvc) => {
  const f = transitLegs(j)[0];
  if (!f) return false;
  if (svc.tripId && f.tripId) return f.tripId === svc.tripId;
  return f.line === svc.line && f.planned === svc.planned;
};

/**
 * The live recheck: follows the same service in fresh journeys (a new live time moves the reminder). When it is
 * cancelled or no longer listed, the last one still running takes its place; with none left the reminder says so.
 * An empty list (no answer) changes nothing.
 */
export function followLast(item: LocalLast, js: any[], now: number): LocalLast {
  const list = (js || []).filter(Boolean);
  if (!list.length) return { ...item };
  const was = msOf(item.leave);
  const same = list.find((j) => sameSvc(j, item.svc));
  const moved = (svc: LastSvc, why: string | null): LocalLast => {
    const leave = msOf(svc.leave);
    const remindAt = leave - item.lead * 60000;
    const shift = Math.abs(leave - was) >= 2 * 60000;
    return {
      ...item, svc, leave: svc.leave, board: svc.board, remindAt: iso(remindAt), line: svc.line, stop: svc.stop, platform: svc.platform,
      serviceMode: svc.mode, leaveText: clock(leave), remindText: clock(remindAt), checked: now,
      changedFrom: shift || why ? item.changedFrom || item.leaveText || null : item.changedFrom || null, text: why || item.text || null,
    };
  };
  if (same && !cancelledJ(same)) {
    const svc = slimLast(same);
    return svc ? moved(svc, null) : { ...item, checked: now };
  }
  const gone = `The ${clock(msOf(item.svc.board))} ${item.svc.line || 'service'} ${same ? 'is cancelled' : 'no longer shows'}.`;
  // Tomorrow morning's first service is not tonight's last: only ones within 3 hours of the old time count.
  const pick = pickLastJourney(list.filter((j) => msOf(j.leave) >= now + 60000 && msOf(j.leave) < was + 3 * 3600000), item.mode);
  const svc = pick ? slimLast(pick.j) : null;
  if (!svc) return { ...item, status: 'none', checked: now, text: `${gone} No other service home shows for tonight. Open Plan for other ways home.` };
  return moved(svc, `${gone} Following the ${clock(msOf(svc.board))} ${svc.line || 'service'} instead.`);
}

/** The notification, written when it is scheduled (and again after each recheck that moves it). */
export function localRingWords(item: LocalLast): { title: string; body: string } {
  const noun = NOUN[item.serviceMode || item.mode || ''] || 'service';
  const from = item.stop ? ` from ${item.stop}` : '';
  const plat = item.platform ? `, ${item.platform}` : '';
  const board = clock(msOf(item.board || item.leave || ''));
  const walk = item.board && item.leave && msOf(item.board) - msOf(item.leave) >= 60000 ? `Leave by ${item.leaveText} for the ${board}` : `The ${board}`;
  const tail = walk.startsWith('Leave') ? '' : ` leaves in ${item.lead} min`;
  return { title: `Last ${noun} to ${short(item.to.name)}`, body: `${walk} ${item.line || noun}${from}${plat}${tail}. It's the last one tonight.` };
}

/** What was confirmed after Remind me on the phone's own reminder. */
export function setNoteLocal(item: LocalLast) {
  return `Reminder set for ${item.remindText}, ${item.lead} min before you leave at ${item.leaveText}. Opening the app checks live times again and moves it if the service changes.`;
}

/** How often the open app looks again: every minute in the last 25 min before leaving, else every 5 min. */
export function recheckDue(item: LocalLast | null | undefined, now: number): boolean {
  if (!item || item.status !== 'waiting' || !item.leave) return false;
  const leave = msOf(item.leave);
  if (!Number.isFinite(leave) || now > leave + 2 * 60000) return false;
  const every = leave - now <= 25 * 60000 ? 60000 : 5 * 60000;
  return now - (item.checked || 0) >= every;
}

/**
 * The Remind me hint from an Ask answer: the server's own (new server: it finds the service itself), else one made
 * from the Last train home answer the current server already gives (its last journey, kept small for the phone).
 */
export function askLastHint(d: any): LastHomeHint | null {
  if (!d || typeof d !== 'object') return null;
  if (d.lastHome && d.lastHome.from && d.lastHome.to) return d.lastHome;
  // Only when the answer is sure it is the last one tonight ("Latest I can see" answers get no reminder).
  if (d.kind !== 'lastService' || !d.last || !d.sure || !d.from?.id || !d.to?.id) return null;
  const svc = slimLast(d.last);
  if (!svc || svc.cancelled) return null;
  return { from: { id: String(d.from.id), name: String(d.from.name || '') }, to: { id: String(d.to.id), name: String(d.to.name || '') }, mode: d.mode || null, leave: svc.leave, svc };
}
