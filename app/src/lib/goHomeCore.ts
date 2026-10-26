// Get me home: one tap plans from where you are to your saved Home. What the trip screen is opened with, from a
// position and the Home place. No React here (test/gohome.test.mjs).

export type HomePlace = { id: string; name: string };
export const HERE_NAME = 'Your location';

/** The planner's point id for a position: "151.20930:-33.86880:EPSG:4326" (longitude first, 5 decimals). */
export function pointId(lat: number, lon: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return `${lon.toFixed(5)}:${lat.toFixed(5)}:EPSG:4326`;
}

/** A point id, not a stop: "lon:lat:EPSG:4326". */
export function isPointId(id?: string | null): boolean {
  return /^-?\d{1,3}(\.\d+)?:-?\d{1,2}(\.\d+)?:EPSG:4326$/.test(String(id || ''));
}

/** Rough NSW box (with a margin): a position outside it cannot be planned from. */
export function inNsw(lat: number, lon: number): boolean {
  return lat > -38.2 && lat < -27.8 && lon > 140.5 && lon < 154.2;
}

export type GoHome =
  | { kind: 'setHome' }
  | { kind: 'noLocation' }
  | { kind: 'outside' }
  | { kind: 'open'; params: { from: string; fromName: string; to: string; toName: string; here: string } };

/** What the Get me home tap does next, from the saved Home and where you are (null when location is off or refused). */
export function goHomeStep(home: HomePlace | null | undefined, pos: { lat: number; lon: number } | null | undefined): GoHome {
  if (!home || !home.id) return { kind: 'setHome' };
  if (!pos) return { kind: 'noLocation' };
  if (!inNsw(pos.lat, pos.lon)) return { kind: 'outside' };
  const from = pointId(pos.lat, pos.lon);
  if (!from) return { kind: 'noLocation' };
  return { kind: 'open', params: { from, fromName: HERE_NAME, to: home.id, toName: home.name || 'Home', here: '1' } };
}
