// Recently departed, the parts with no phone dependencies (unit tested in test/recent.test.mjs).
// A board lists services from now on; once a service leaves it drops off. This keeps what each board showed on the
// last read and, when a service drops off on the next read, records it. It only says a service LEFT when a live time
// tracked it right up to its departure (read at most CONFIRM_MS before it, GPS not stale). A timetable only service,
// or one whose live time had gone stale, is listed as "not tracked": no ghost "left 1 min ago".
// Memory only, on this phone, for this app session. No server, no storage.

import { STALE_GPS_S } from './liveLabelCore';

export type RowLike = {
  line?: string; mode?: string; color?: string; dest?: string; stopId?: string; platform?: string; tripId?: string | null; feed?: string;
  planned?: string; estimated?: string | null; realtime?: boolean; delayMin?: number | null; cancelled?: boolean;
  vehicle?: { ageS?: number } | null; destId?: string | null;
};

export type Departed = {
  key: string; line: string; mode: string; color?: string; dest: string; stopId: string; platform?: string; tripId?: string | null; feed?: string; destId?: string | null;
  planned: string;
  /** When it left by the live time that tracked it (ms), or null when nothing live confirmed it. */
  left: number | null;
  delayMin: number | null;
  confirmed: boolean;
};

type Kept = { row: RowLike; at: number };
type Board = { lastAt: number; rows: Map<string, Kept>; gone: Departed[] };

/** A live time read this close to its departure (or closer) counts as tracking it to the stop. */
export const CONFIRM_MS = 2 * 60000;
/** Two reads further apart than this are not one look at the board: nothing is recorded across the gap. */
export const GAP_MS = 3 * 60000;
/** How long a departed service stays listed. */
export const KEEP_MS = 10 * 60000;

const msOf = (s?: string | null) => (s ? new Date(s).getTime() : NaN);
export const rowKey = (r: RowLike) => `${r.tripId || ''}|${r.line || ''}|${r.planned || ''}`;

export function createRecent(opts: { confirmMs?: number; gapMs?: number; keepMs?: number; max?: number } = {}) {
  const confirmMs = opts.confirmMs ?? CONFIRM_MS, gapMs = opts.gapMs ?? GAP_MS, keepMs = opts.keepMs ?? KEEP_MS, max = opts.max ?? 8;
  const boards = new Map<string, Board>();

  function departedOf(k: Kept, key: string, at: number): Departed | null {
    const r = k.row;
    if (r.cancelled || !r.planned) return null;
    const est = msOf(r.estimated);
    const live = !!r.realtime && Number.isFinite(est);
    const t = live ? est : msOf(r.planned);
    if (!Number.isFinite(t)) return null;
    // Dropped off long before its time: the board changed (cancelled, a long list cut short). Not a departure.
    if (t > at + 90000) return null;
    const gpsOk = r.vehicle?.ageS == null || r.vehicle.ageS <= STALE_GPS_S;
    const confirmed = live && gpsOk && t - k.at <= confirmMs;
    return {
      key, line: String(r.line || ''), mode: String(r.mode || ''), color: r.color, dest: String(r.dest || ''), stopId: String(r.stopId || ''),
      platform: r.platform, tripId: r.tripId ?? null, feed: r.feed, destId: r.destId ?? null, planned: r.planned,
      left: confirmed ? t : null, delayMin: confirmed && r.delayMin != null ? r.delayMin : null, confirmed,
    };
  }

  return {
    /** Record one read of a board (every row it listed) at `at`. */
    note(stopId: string, items: RowLike[] | undefined, at: number) {
      if (!stopId || !Array.isArray(items)) return;
      let b = boards.get(stopId);
      if (!b) { b = { lastAt: 0, rows: new Map(), gone: [] }; boards.set(stopId, b); }
      if (at < b.lastAt) return; // an older answer arriving late
      const now = new Map<string, Kept>();
      for (const r of items) if (r && r.planned) now.set(rowKey(r), { row: r, at });
      if (b.lastAt && at - b.lastAt <= gapMs) {
        for (const [key, k] of b.rows) {
          if (now.has(key) || b.gone.some((g) => g.key === key)) continue;
          const d = departedOf(k, key, at);
          if (d) b.gone.push(d);
        }
      }
      b.rows = now;
      b.lastAt = at;
      b.gone = b.gone.filter((g) => (g.left ?? msOf(g.planned)) >= at - keepMs).slice(-max * 2);
    },
    /** Services that left this board in the last KEEP_MS, newest first. */
    list(stopId: string, now: number): Departed[] {
      const b = boards.get(stopId);
      if (!b) return [];
      return b.gone.filter((g) => (g.left ?? msOf(g.planned)) >= now - keepMs)
        .sort((x, y) => (y.left ?? msOf(y.planned)) - (x.left ?? msOf(x.planned))).slice(0, max);
    },
    clear() { boards.clear(); },
  };
}

/** "Left 8:42am, 2 min late" for a confirmed one, "Due 8:40am, not tracked" for the rest. `hm` formats a time. */
export function departedWords(d: Departed, hm: (t: number) => string): { main: string; sub: string } {
  if (d.confirmed && d.left != null) {
    const late = d.delayMin != null && d.delayMin >= 2 ? `${d.delayMin} min late` : d.delayMin != null && d.delayMin <= -2 ? `${-d.delayMin} min early` : 'on time';
    return { main: `Left ${hm(d.left)}`, sub: `Live, ${late}` };
  }
  return { main: `Due ${hm(msOf(d.planned))}`, sub: 'Not tracked, no live time' };
}
