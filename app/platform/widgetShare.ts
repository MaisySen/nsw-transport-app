// What the iPhone widgets read from the app group, built from the app's own store. Pure, so it is unit tested.
//
// homeWork: Home and Work, the commute swap for this half day and the trips saved on this phone. The Next trip
// widget's Home and Work (auto) shows Home to Work before 12pm and Work to Home after, like the commute card.
// liveCard: the trip card of a trip in progress, so the Next trip widget can follow it until you arrive.
import type { TripCardState } from './tripCard';
import type { LiveState } from '../src/lib/liveCalc';
import type { WatchLeg } from '../src/lib/types';

export type SharedStop = { id: string; name: string };
/** A starred stop for the widgets. Bus stops add the number on the sign (code), the mode and the routes there. */
export type SharedStarred = SharedStop & { code?: string; mode?: string; lines?: string[] };
/** A saved trip; modes when known ("bus"), so the widget can show a bus trip as a bus trip. */
export type SharedTrip = { name: string; from: SharedStop; to: SharedStop; modes?: string[] };
export type HomeWork = { home: SharedStop | null; work: SharedStop | null; flip: string | null; trips: SharedTrip[] };
/**
 * The next leg of a trip in progress (2 Nov 2026, the owner's first real trip on 214: the widget sat on "Change here ·
 * Now" for 7 min with no word of the 4:52 T4, because the saved card described one leg only). Times in ms. Must match
 * SharedNextLeg in targets/widget/TripMoments.swift.
 */
export type SharedNextLeg = {
  line: string; lineColorHex: string; mode: string; from: string | null; to: string | null; platform: string | null;
  departs: number | null; arrives: number | null; departsLive: boolean; arrivesLive: boolean;
};
export type LiveCardShare = TripCardState & { title: string; until: number; next?: SharedNextLeg };

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

/**
 * The card plus the moment the widget should stop showing it: 2 minutes after arrival. With `next` (2 Nov), the next
 * leg, so the widget moves on to it after "Change here" by itself, even with the phone locked and no network.
 */
export function liveCardFor(title: string, card: TripCardState, keepMs = 120000, next?: SharedNextLeg | null): LiveCardShare {
  return { ...card, title, until: card.arrival + keepMs, ...(next && card.phase !== 'arrived' ? { next } : {}) };
}

const shortStop = (n?: string | null) => String(n || '').split(',')[0].replace(/ Station$/, '').trim();
const platWords = (p?: string | null) => (p ? p.replace(/^Platform\s*/i, 'Platform ').replace(/^Stand\s*/i, 'Stand ') : null);

/**
 * The leg after the one the trip is on, from the same trip state the card is drawn from: its line, live departure and
 * arrival, and platform. Null on the last leg, once arrived, and for a change the live times say is missed (the card
 * then counts to the next service found, and the widget follows the card).
 */
export function nextLegFor(legs: WatchLeg[], s: LiveState): SharedNextLeg | null {
  if (s.done) return null;
  const i = s.cur + 1;
  const l = legs[i], x = s.L2[i];
  if (!l || !x || x.missed || !Number.isFinite(x.dep)) return null;
  return {
    line: l.line || '', lineColorHex: l.color || '#0A84FF', mode: l.mode || '',
    from: shortStop(l.from) || null, to: shortStop(l.to) || null, platform: platWords(l.fromPlatform),
    departs: x.dep, arrives: Number.isFinite(x.arr) ? x.arr : null, departsLive: !!x.live, arrivesLive: !!x.arrLive,
  };
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
