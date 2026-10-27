/**
 * Home in one request (27 Oct, home-bundle in x-serves, docs/API.md "GET /api/home"). Home's reads (the lists, each
 * trip and stop card, the config) used to go out as separate requests. The phone now notes which reads Home made in the
 * first seconds of the last start (or the last return to the front), and next time asks for all of them at once as
 * GET /api/home?p=<read>&p=<read>. Each read that is still the same is answered from that one request; anything new
 * or changed goes out on its own as before, and becomes part of the next bundle. A server without home-bundle, a
 * failed bundle or a part the server could not answer in time: the read goes out on its own, as before.
 * Pure: no React Native imports, so the tests can run it.
 */

/** Most reads in one bundle (the server takes at most 10). */
export const HOME_BUNDLE_MAX = 10;
/** How long after a start (or a return to the front) the reads Home makes are noted for the next bundle. */
export const HOME_WINDOW_MS = 6000;
/** The phone's deadline for the bundle; a read waiting on it then goes out on its own. The server answers a slow part
 * as late after 2.5 s, so a bundle normally lands well inside this. */
export const HOME_BUNDLE_MS = 4000;
/** A bundle's answer to a read is used at most this long after it arrived, once. */
export const HOME_PART_KEEP_MS = 10000;

export type HomeOccasion = 'start' | 'front';
/** A read Home made: the path as api.ts asks it (device and profile not placed yet), and whether it carries them. */
export type HomeRead = { p: string; ids: boolean };
export type HomePart = { p?: string; status: number; body?: unknown; late?: boolean };
export type HomeLists = Partial<Record<HomeOccasion, HomeRead[]>>;

const READ_RE = /^\/api\/(trip|departures|commutes|saved|watches|app\/config)\?[^#]*$/;

/**
 * A read that may go into the bundle: one of Home's own reads, not a text answer. Trip reads that page (the trip
 * screen's read ahead) or refresh (the phone re-times kept trips instead when it can, tripLiveCore.ts) are left out,
 * so a bundle never asks the planner for something the phone would not have asked this time.
 */
export function homeReadOk(path: string): boolean {
  if (typeof path !== 'string' || path.length > 1200 || !READ_RE.test(path)) return false;
  const q = '&' + path.slice(path.indexOf('?') + 1) + '&';
  if (/&format=/.test(q)) return false;
  if (path.startsWith('/api/trip?') && /&(refresh=1|page=|after=|before=)/.test(q)) return false;
  return true;
}

/** The bundle's address: one p= per read, each already placed (device and profile in it, when they go in addresses). */
export function homeBundlePath(placed: string[]): string {
  return '/api/home?' + placed.map((p) => 'p=' + encodeURIComponent(p)).join('&');
}

/** A kept list read back from the phone: only well formed reads, at most HOME_BUNDLE_MAX each. */
export function cleanLists(raw: unknown): HomeLists {
  const out: HomeLists = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const occ of ['start', 'front'] as HomeOccasion[]) {
    const v = (raw as any)[occ];
    if (!Array.isArray(v)) continue;
    const list = v.filter((r: any) => r && typeof r.p === 'string' && homeReadOk(r.p)).map((r: any) => ({ p: r.p, ids: !!r.ids }));
    if (list.length) out[occ] = list.slice(0, HOME_BUNDLE_MAX);
  }
  return out;
}

type Timers = { now: () => number; set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void };
/** Sends a bundle for these reads and gives the parts in the same order, or null (no bundle, an error, a timeout). */
export type BundleSend = (reads: HomeRead[]) => Promise<HomePart[] | null>;

export function createHomeBundle(t: Timers, onSave?: (lists: HomeLists) => void) {
  let lists: HomeLists = {};
  let rec: { occ: HomeOccasion; seen: HomeRead[]; handle: unknown } | null = null;
  let flight: { base: string; paths: Set<string>; done: Promise<void> } | null = null;
  const parts = new Map<string, { at: number; part: HomePart }>();
  const stats = { sent: 0, used: 0, missed: 0 };

  const close = () => {
    if (!rec) return;
    const r = rec;
    rec = null;
    t.clear(r.handle);
    // Nothing asked in the window (Home was not on view): the list from before stays.
    if (!r.seen.length) return;
    lists = { ...lists, [r.occ]: r.seen.slice(0, HOME_BUNDLE_MAX) };
    onSave?.(lists);
  };

  return {
    load(raw: unknown) { const l = cleanLists(raw); lists = { ...l, ...lists }; },
    lists: (): HomeLists => ({ ...lists }),
    stats: () => ({ ...stats }),
    recording: () => !!rec,
    /**
     * A start or a return to the front: notes Home's reads for the next HOME_WINDOW_MS, and sends the bundle for
     * the reads noted last time (plus `extra`, minus what `drop` says no to) when `send` is given. True when one went.
     */
    begin(occ: HomeOccasion, base: string, send?: BundleSend | null, o: { extra?: HomeRead[]; drop?: (r: HomeRead) => boolean } = {}): boolean {
      close();
      rec = { occ, seen: [], handle: t.set(close, HOME_WINDOW_MS) };
      if (!send || flight) return false;
      const reads: HomeRead[] = [];
      for (const r of [...(lists[occ] || []), ...(o.extra || [])]) {
        if (o.drop && o.drop(r)) continue;
        if (!reads.some((x) => x.p === r.p)) reads.push(r);
      }
      if (reads.length < 2) return false; // one read on its own is one request either way
      const list = reads.slice(0, HOME_BUNDLE_MAX);
      stats.sent += 1;
      const done = send(list).then((got) => {
        if (!got || got.length !== list.length) return;
        const at = t.now();
        list.forEach((r, i) => parts.set(base + '|' + r.p, { at, part: got[i] }));
      }, () => {}).finally(() => { if (flight && flight.done === done) flight = null; });
      flight = { base, paths: new Set(list.map((r) => r.p)), done };
      return true;
    },
    /** A read api.ts is about to make: noted for the next bundle while the window is open. */
    note(path: string, ids: boolean) {
      if (!rec || !homeReadOk(path) || rec.seen.some((r) => r.p === path)) return;
      rec.seen.push({ p: path, ids });
    },
    /** True while a bundle that has this read is on its way. */
    covers(base: string, path: string): boolean { return !!flight && flight.base === base && flight.paths.has(path); },
    /**
     * The bundle's answer to this read (waiting for the bundle when it is on its way), used once: the body and when
     * it arrived, or null when the read should go out on its own (no bundle, not in it, an error or late part, old).
     */
    async take(base: string, path: string): Promise<{ at: number; body: any } | null> {
      const f = flight;
      if (f && f.base === base && f.paths.has(path)) await f.done;
      const k = base + '|' + path;
      const e = parts.get(k);
      if (!e) return null;
      parts.delete(k);
      const ok = e.part && e.part.status === 200 && !!e.part.body && typeof e.part.body === 'object' && t.now() - e.at <= HOME_PART_KEEP_MS;
      if (ok) stats.used += 1; else stats.missed += 1;
      return ok ? { at: e.at, body: e.part.body } : null;
    },
    /** Drops what a bundle brought (a write to the server: lists may have changed). */
    clear() { parts.clear(); },
  };
}
