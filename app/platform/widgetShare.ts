// What the iPhone widgets read from the app group, built from the app's own store. Pure, so it is unit tested.
//
// homeWork: Home and Work, the commute swap for this half day and the trips saved on this phone. The Next trip
// widget's Home and Work (auto) shows Home to Work before 12pm and Work to Home after, like the commute card.
// liveCard: the trip card of a trip in progress, so the Next trip widget can follow it until you arrive.
import type { TripCardState } from './tripCard';

export type SharedStop = { id: string; name: string };
export type SharedTrip = { name: string; from: SharedStop; to: SharedStop };
export type HomeWork = { home: SharedStop | null; work: SharedStop | null; flip: string | null; trips: SharedTrip[] };
export type LiveCardShare = TripCardState & { title: string; until: number };

const stop = (p: any): SharedStop | null =>
  p && p.id !== undefined && p.id !== null && String(p.id) ? { id: String(p.id), name: String(p.name || '') } : null;

export function homeWorkFor(st: any): HomeWork {
  const places = (st && st.places) || {};
  const trips: SharedTrip[] = [];
  for (const t of Array.isArray(st?.myTrips) ? st.myTrips : []) {
    const from = stop(t?.from), to = stop(t?.to);
    if (from && to && from.id !== to.id) trips.push({ name: String(t.name || ''), from, to });
  }
  return { home: stop(places.home), work: stop(places.work), flip: typeof st?.commuteFlip === 'string' ? st.commuteFlip : null, trips };
}

/** The card plus the moment the widget should stop showing it: 2 minutes after arrival. */
export function liveCardFor(title: string, card: TripCardState, keepMs = 120000): LiveCardShare {
  return { ...card, title, until: card.arrival + keepMs };
}
