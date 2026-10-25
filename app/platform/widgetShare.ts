// What the iPhone widgets read from the app group, built from the app's own store. Pure, so it is unit tested.
//
// homeWork: Home and Work, the commute swap for this half day and the trips saved on this phone. The Next trip
// widget's Home and Work (auto) shows Home to Work before 12pm and Work to Home after, like the commute card.
// liveCard: the trip card of a trip in progress, so the Next trip widget can follow it until you arrive.
import type { TripCardState } from './tripCard';

export type SharedStop = { id: string; name: string };
/** A starred stop for the widgets. Bus stops add the number on the sign (code), the mode and the routes there. */
export type SharedStarred = SharedStop & { code?: string; mode?: string; lines?: string[] };
/** A saved trip; modes when known ("bus"), so the widget can show a bus trip as a bus trip. */
export type SharedTrip = { name: string; from: SharedStop; to: SharedStop; modes?: string[] };
export type HomeWork = { home: SharedStop | null; work: SharedStop | null; flip: string | null; trips: SharedTrip[] };
export type LiveCardShare = TripCardState & { title: string; until: number };

const stop = (p: any): SharedStop | null =>
  p && p.id !== undefined && p.id !== null && String(p.id) ? { id: String(p.id), name: String(p.name || '') } : null;

export function homeWorkFor(st: any): HomeWork {
  const places = (st && st.places) || {};
  const trips: SharedTrip[] = [];
  for (const t of Array.isArray(st?.myTrips) ? st.myTrips : []) {
    const from = stop(t?.from), to = stop(t?.to);
    const modes = Array.isArray(t?.modes) ? t.modes.filter((m: any) => typeof m === 'string' && m) : [];
    if (from && to && from.id !== to.id) trips.push({ name: String(t.name || ''), from, to, ...(modes.length ? { modes } : {}) });
  }
  return { home: stop(places.home), work: stop(places.work), flip: typeof st?.commuteFlip === 'string' ? st.commuteFlip : null, trips };
}

/** The card plus the moment the widget should stop showing it: 2 minutes after arrival. */
export function liveCardFor(title: string, card: TripCardState, keepMs = 120000): LiveCardShare {
  return { ...card, title, until: card.arrival + keepMs };
}

const BUSLIKE = new Set(['bus', 'coach', 'school']);

/**
 * Starred stops for the widgets (and the watch): id and name as before, plus for a bus stop the number printed on
 * its sign, the mode and up to 6 routes. Older widgets read id and name only and ignore the rest.
 */
export function starredFor(st: any): SharedStarred[] {
  const out: SharedStarred[] = [];
  for (const p of Array.isArray(st?.starred) ? st.starred : []) {
    const s = stop(p);
    if (!s) continue;
    const mode = typeof p.mode === 'string' ? p.mode : '';
    const lines = Array.isArray(p.lines) ? p.lines.filter((l: any) => typeof l === 'string' && l).slice(0, 6) : [];
    const code = /^\d{5,8}$/.test(s.id) && BUSLIKE.has(mode) ? s.id : '';
    out.push({ ...s, ...(code ? { code } : {}), ...(mode ? { mode } : {}), ...(lines.length ? { lines } : {}) });
  }
  return out;
}
