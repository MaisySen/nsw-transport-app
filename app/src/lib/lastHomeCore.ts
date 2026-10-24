// Last way home reminder, the parts with no phone dependencies (unit tested). The server finds the last service,
// looks again live and sends one push 15 min before (docs/API.md, Last way home reminder).
export const LAST_HOME_LEAD = 15;
export type LastHomeHint = { from: { id: string; name: string }; to: { id: string; name: string }; mode?: string | null; leave?: string; lead?: number };
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
  if (now >= remindAt || item.status === 'sent') {
    const mins = Math.max(0, Math.round((leave - now) / 60000));
    return { title, line: `${mins >= 1 ? `Leave in ${mins} min` : 'Leave now'}: ${item.leaveText || ''}${what ? ` ${what}` : ''}${plat}.${changed}`, go: true };
  }
  return { title, line: `Leaves ${item.leaveText || ''}${what ? ` ${what}` : ''}${plat}. Reminder at ${item.remindText || ''}.${changed}`, go: false };
}
