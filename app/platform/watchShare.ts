// What the iPhone sends to the Apple Watch app (WatchConnectivity application context). Pure, so it is unit tested
// (test/watchshare.test.mjs). Field names must match WatchContext in targets/watch/WatchCore.swift.
//
// The watch loads live times itself from the server named here (base), so a move of the app's server reaches the
// watch the next time the phone sends a context. Only the person's own places go: Home, Work, starred stops and
// the card of a trip in progress.
import type { HomeWork, LiveCardShare, SharedStop } from './widgetShare';

export const WATCH_CONTEXT_VERSION = 1;
/** The watch lists this many starred stops at most, in the order the app keeps them. */
export const WATCH_MAX_STARRED = 8;

/** The trip card as the watch gets it: no progress bar fraction (it changes every few seconds and the watch does not
 * draw it) and the load time to the minute, so the context only changes when something on the watch would. */
export type WatchLiveCard = Omit<LiveCardShare, 'progress'>;

export type WatchContext = {
  v: number;
  base: string;
  profile: string | null;
  home: SharedStop | null;
  work: SharedStop | null;
  flip: string | null;
  starred: SharedStop[];
  live: WatchLiveCard | null;
};

const okBase = (b: unknown): string | null => {
  const s = typeof b === 'string' ? b.trim().replace(/\/+$/, '') : '';
  return /^https:\/\/[a-z0-9.-]+(\/[^\s?#]*)?$/i.test(s) ? s : null;
};

/** The context for the watch, or null when there is no usable server address. */
export function watchContextFor(
  base: string,
  profile: string | null,
  hw: HomeWork,
  starred: SharedStop[],
  live: LiveCardShare | null,
): WatchContext | null {
  const b = okBase(base);
  if (!b) return null;
  const seen = new Set<string>();
  const stars: SharedStop[] = [];
  for (const s of starred || []) {
    if (!s || !s.id || seen.has(s.id)) continue;
    seen.add(s.id);
    stars.push({ id: String(s.id), name: String(s.name || '') });
    if (stars.length >= WATCH_MAX_STARRED) break;
  }
  return {
    v: WATCH_CONTEXT_VERSION,
    base: b,
    profile: profile || null,
    home: hw.home,
    work: hw.work,
    flip: hw.flip,
    starred: stars,
    live: live && live.phase !== 'arrived' ? watchCard(live) : null,
  };
}

function watchCard(c: LiveCardShare): WatchLiveCard {
  const { progress: _progress, ...rest } = c;
  const updated = typeof rest.updated === 'number' && rest.updated > 0 ? Math.floor(rest.updated / 60000) * 60000 : null;
  return { ...rest, updated };
}

/** The same context as JSON, the form the native call takes. Equal contexts give equal strings. */
export const watchContextJSON = (c: WatchContext) => JSON.stringify(c);
