// Small pure helpers for Home, Plan and the trip screens, kept apart from React so tests can run them in Node.

/** "1 stop", "2 stops". */
export function plural(n: number, one: string, many = one + 's') {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Countdown chip parts for a service row: "4" + "min", "Now" within a minute either way, "Left" once it has
 * gone (rows from Earlier services), or the clock time (from `hm`) an hour or more ahead.
 */
export function chipTime(t: number, now: number, hm: (t: number) => string): { big: string; unit: string } {
  const diff = t - now;
  if (!Number.isFinite(diff)) return { big: '', unit: '' };
  if (diff < -60000) return { big: 'Left', unit: '' };
  if (diff < 60000) return { big: 'Now', unit: '' };
  const m = Math.floor(diff / 60000);
  if (m < 60) return { big: String(m), unit: 'min' };
  return { big: hm(t), unit: '' };
}

/**
 * Saved trips deleted on this phone, kept until the server list no longer has them, so a deleted trip leaves
 * Home at once instead of when the server answers. Entries expire after `ttlMs` either way.
 */
export function makeDeletedNames(ttlMs = 120000) {
  const gone = new Map<string, number>();
  const key = (n: string) => n.trim().toLowerCase();
  return {
    add(name: string, now = Date.now()) { if (name) gone.set(key(name), now); },
    has(name: string, now = Date.now()) {
      const t = gone.get(key(name || ''));
      if (t == null) return false;
      if (now - t > ttlMs) { gone.delete(key(name)); return false; }
      return true;
    },
    /** Undo of a delete: the name shows again. */
    remove(name: string) { gone.delete(key(name || '')); },
    /** The server list without the names deleted here; names the server no longer has are forgotten. */
    filter<T extends { name: string }>(items: T[], now = Date.now()): T[] {
      const names = new Set(items.map((i) => key(i.name || '')));
      for (const k of [...gone.keys()]) if (!names.has(k)) gone.delete(k);
      return items.filter((i) => !this.has(i.name, now));
    },
  };
}

/** Same two ends, either way round (a saved trip that is the Home and Work commute). */
export function sameEnds(a: { from: { id: string }; to: { id: string } }, b: { from: { id: string }; to: { id: string } }) {
  return (a.from.id === b.from.id && a.to.id === b.to.id) || (a.from.id === b.to.id && a.to.id === b.from.id);
}

/**
 * Plan: the search results to show. While a field already holds a chosen stop its text is that stop's name,
 * so no results show (Recent trips stay in view); results show while the person types.
 */
export function planResults<T>(items: T[], text: string, chosen: boolean): T[] {
  return !chosen && text.trim().length >= 2 ? items : [];
}

/** The line under a Plan or setup search that found nothing: no match, or no connection. */
export function noMatchText(text: string, loading: boolean, count: number, failed: boolean): string | null {
  if (text.trim().length < 2 || loading || count) return null;
  return failed ? "Can't search right now. Check your connection." : 'No stops match that';
}

// ---------- Home (Next trip card and compact rows) ----------

/**
 * Where to board, short, for a Home row or the Next trip card. A train says "Plat 2" ("Platform 2" on the card).
 * A bus says the stop number from the sign ("Stop 213723"), and on the card the stand too ("Stand X1, Stop 213723").
 * Stop numbers are 5 to 8 digit stop ids of buses and coaches, as in busCore.stopNumber.
 */
export function whereText(platform?: string | null, stopId?: string | null, mode?: string | null, long = false): string {
  const p = String(platform || '').trim();
  const id = String(stopId || '').trim();
  const bus = /^\d{5,8}$/.test(id) && (!mode || mode === 'bus' || mode === 'coach' || mode === 'school');
  if (bus) {
    const stand = p && !/^platform/i.test(p) ? p : '';
    return long && stand ? `${stand}, Stop ${id}` : `Stop ${id}`;
  }
  if (!p) return '';
  return long ? p.replace(/^Plat(?:form)?\.?\s*/i, 'Platform ') : p.replace(/^Platform\s*/i, 'Plat ');
}

/** "Next 12 min, 19 min" under the next service: the later countdowns, each with its unit (Bidur, 25 Oct 7:45 PM). */
export function thenText(later: { big: string; unit: string }[]): string {
  const xs = later.filter((x) => x.big);
  if (!xs.length) return '';
  return `Next ${xs.map((x) => (x.unit ? `${x.big} ${x.unit}` : x.big === 'Now' ? 'now' : x.big)).join(', ')}`;
}

/** A countdown as VoiceOver and TalkBack read it: "1 minute", "6 minutes", "Now", "5:12". */
export function spokenTime(x: { big: string; unit: string }): string {
  if (!x.unit) return x.big;
  if (x.unit !== 'min') return `${x.big} ${x.unit}`;
  return `${x.big} ${x.big === '1' ? 'minute' : 'minutes'}`;
}

/**
 * The big countdown on the Next trip card: the normal text colour, red only when the service has gone (Left) or
 * cannot be taken (cancelled). A late service keeps its own orange status line; a short wait is not an alarm.
 */
export function heroCountTone(o: { gone: boolean; cancelled: boolean }): 'text' | 'red' {
  return o.gone || o.cancelled ? 'red' : 'text';
}

/**
 * The Next trip card: your commute when Home and Work are set (the one for this half of the day), otherwise the
 * first trip in your order. The rest are the rows below, in your order.
 */
export function splitNext<T>(commute: T | null, sorted: T[]): { next: T | null; rest: T[] } {
  if (commute) return { next: commute, rest: sorted };
  return { next: sorted[0] ?? null, rest: sorted.slice(1) };
}

/**
 * The saved trip order after dragging the row at `from` to `to`. `lead` is what stays above the rows (the Next
 * trip card when it is a trip of yours), so a drag never moves it. Keys are order keys: Home and Work share one,
 * and the moved one keeps the place it was dropped at.
 */
export function dragOrder(lead: string[], keys: string[], from: number, to: number): string[] {
  const arr = keys.slice();
  if (from < 0 || from >= arr.length) return [...new Set([...lead, ...arr])];
  const [m] = arr.splice(from, 1);
  const at = Math.max(0, Math.min(to, arr.length));
  arr.splice(at, 0, m);
  const kept = arr.filter((k, i) => i === at || k !== m);
  return [...new Set([...lead, ...kept])];
}

/** "Show first": the order with this trip on top, so it becomes the Next trip card. */
export function toFront(order: string[], all: string[], key: string): string[] {
  const rest = (order.length ? [...order, ...all.filter((k) => !order.includes(k))] : all).filter((k) => k !== key);
  return [...new Set([key, ...rest])];
}

/**
 * A delete that can be undone: `local` happens now and returns how to put it back; `remote` (the server copy) waits
 * until the Undo bar has gone (`graceMs`). Undo cancels the wait and restores. Each runs at most once. One shot
 * timers only (docs/PERFORMANCE.md); `timers` is injectable for tests.
 */
export function undoableDelete(local: () => () => void, remote: (() => void) | null, graceMs: number,
  timers: { set: (fn: () => void, ms: number) => any; clear: (id: any) => void } = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) }) {
  const restore = local();
  let state: 'pending' | 'done' | 'undone' = 'pending';
  const commit = () => { if (state !== 'pending') return; state = 'done'; if (remote) remote(); };
  const id = timers.set(commit, graceMs);
  return {
    undo() { if (state !== 'pending') return false; state = 'undone'; timers.clear(id); restore(); return true; },
    /** Sends the server delete now (the app is going to the background). */
    commit() { timers.clear(id); commit(); },
    state: () => state,
  };
}
