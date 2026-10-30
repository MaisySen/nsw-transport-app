// "Current location" in Plan's From and To (Bidur, 30 Oct, testing build 209: "From should have option to put current
// location as well"). Pure data so test/fromloc.test.mjs can check it without React Native; the location read itself
// is lib/hereLocation.ts. The trip is planned from the phone's position as a planner point ("lon:lat:EPSG:4326", the
// same point Get me home uses), never from a guessed stop.
import { inNsw, isPointId, pointId } from './goHomeCore';

export const HERE_LABEL = 'Current location';

/** A position older than this is read again before a trip is opened from it (the phone may have moved). */
export const HERE_MAX_AGE_MS = 5 * 60000;

export type HerePlace = { id: string; name: string; at: number };

/** True for the Current location end (a point named Current location), not for an address or suburb point. */
export function isHerePlace(p?: { id?: string; name?: string } | null): boolean {
  return !!p && p.name === HERE_LABEL && isPointId(p.id);
}

/**
 * Whether the Current location row shows above the results: trip mode only, on a build with location, when the field
 * is empty (nothing typed and nothing chosen), and not when the other end is already Current location.
 */
export function showHereRow(o: { available: boolean; mode: 'trip' | 'stop'; field: 'from' | 'to' | 'stop'; text: string; chosen: boolean; otherIsHere: boolean }): boolean {
  if (!o.available || o.mode !== 'trip' || o.field === 'stop') return false;
  if (o.chosen || o.otherIsHere) return false;
  return !String(o.text || '').trim();
}

export type HereResult = { pos: { lat: number; lon: number } | null; denied?: boolean; canAskAgain?: boolean };

export type HereStep =
  | { kind: 'place'; place: HerePlace }
  | { kind: 'note'; note: string; settings: boolean };

/** What a tap on Current location gives: the place to plan from, or the short note shown under the row. */
export function hereStep(r: HereResult | null | undefined, now: number): HereStep {
  if (!r || r.denied) {
    return { kind: 'note', note: 'Location is off for this app. Turn it on in Settings, or search for a stop or place.', settings: true };
  }
  const pos = r.pos;
  if (!pos) return { kind: 'note', note: 'Could not find where you are just now. Try again, or search for a stop or place.', settings: false };
  if (!inNsw(pos.lat, pos.lon)) return { kind: 'note', note: 'Trips can only be planned from within NSW.', settings: false };
  const id = pointId(pos.lat, pos.lon);
  if (!id) return { kind: 'note', note: 'Could not find where you are just now. Try again, or search for a stop or place.', settings: false };
  return { kind: 'place', place: { id, name: HERE_LABEL, at: now } };
}

/** True when a Current location end was read too long ago to plan from without reading it again. */
export function hereStale(p: { id?: string; at?: number } | null | undefined, now: number): boolean {
  return !!p && typeof p.at === 'number' && now - p.at > HERE_MAX_AGE_MS;
}
