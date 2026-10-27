// Commuter car parks (Transport Park and Ride): the one row on a station's screen, the detail, and the Directions
// link. Live counts from /api/parking (Transport for NSW Car Park API, read by the server). Pure logic, no React
// Native imports, so test/carparks.test.mjs runs it in Node. Only numbers the server sent are shown; a car park
// without a live count says so, and a station without a car park shows nothing.

export type ParkLike = { id: string; name: string; spots: number; free: number | null; stale?: boolean; updated?: string | null;
  status?: string; lat?: number; lon?: number; address?: string };

const isLive = (p: ParkLike) => p.free != null && Number.isFinite(p.free) && !p.stale;

/** "9:31pm" in Sydney time. */
export function parkClock(t: number): string {
  if (!Number.isFinite(t)) return '';
  try { return new Date(t).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Australia/Sydney' }).replace(/\s?(am|pm)/i, (m) => m.trim().toLowerCase()); }
  catch { const d = new Date(t); return `${((d.getHours() + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')}${d.getHours() < 12 ? 'am' : 'pm'}`; }
}

/** "Updated 9:31pm" and, from 2 minutes old, "Updated 9:31pm, 12 min ago". Empty without a reading time. */
export function updatedText(updated: string | null | undefined, now: number): string {
  const t = updated ? Date.parse(updated) : NaN;
  if (!Number.isFinite(t)) return '';
  const m = Math.floor((now - t) / 60000);
  const ago = m >= 120 ? `${Math.floor(m / 60)} hr ago` : m >= 2 ? `${m} min ago` : '';
  return `Updated ${parkClock(t)}${ago ? `, ${ago}` : ''}`;
}

export type ParkRow = { title: string; value: string; updated: string; tone: 'green' | 'orange' | 'red' | 'grey'; a11y: string; single: string | null };

/**
 * The one row on a station's screen: "Car park" and "192 free of 213", or for a station with several, "Car parks"
 * and the free spaces across the ones with a live count. Null when the station has no Park and Ride car park.
 */
export function parkRow(list: ParkLike[] | null | undefined, now: number): ParkRow | null {
  const all = (list || []).filter((p) => p && p.id && Number.isFinite(p.spots) && p.spots > 0);
  if (!all.length) return null;
  const live = all.filter(isLive);
  const title = all.length === 1 ? 'Car park' : 'Car parks';
  const single = all.length === 1 ? all[0].id : null;
  let value: string;
  if (!live.length) value = `${all.reduce((n, p) => n + p.spots, 0)} spaces, no live count right now`;
  else {
    const free = live.reduce((n, p) => n + (p.free as number), 0), spots = live.reduce((n, p) => n + p.spots, 0);
    value = `${free} free of ${spots}` + (live.length < all.length ? ` (${live.length} of ${all.length} car parks live)` : '');
  }
  const newest = live.map((p) => (p.updated ? Date.parse(p.updated) : NaN)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  const updated = newest != null ? updatedText(new Date(newest).toISOString(), now) : '';
  const st = live.map((p) => p.status);
  const tone = !live.length ? 'grey' : st.every((s) => s === 'full') ? 'red' : st.some((s) => s === 'full' || s === 'nearly') ? 'orange' : 'green';
  const a11y = `${title}, ${value.replace(/ free of (\d+)/, ' free of $1 spaces')}${updated ? `, ${updated.toLowerCase()}` : ''}`;
  return { title, value, updated, tone, a11y, single };
}

/** Directions to the car park: Apple Maps on iPhone, Google Maps elsewhere. Null without coordinates. */
export function directionsUrl(p: { lat?: number; lon?: number; name?: string } | null | undefined, os: string): string | null {
  if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat as number) > 90 || Math.abs(p.lon as number) > 180) return null;
  const ll = `${(p.lat as number).toFixed(6)},${(p.lon as number).toFixed(6)}`;
  if (os === 'ios') return `https://maps.apple.com/?daddr=${ll}&dirflg=d${p.name ? `&q=${encodeURIComponent(p.name)}` : ''}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving`;
}

/** The car parks list: closest first when a position is known, else A to Z. */
export function sortParks<T extends ParkLike>(list: T[] | null | undefined, me: { lat: number; lon: number } | null, dist: (a: number, b: number, c: number, d: number) => number): (T & { d?: number })[] {
  const all = (list || []).map((p) => ({ ...p, d: me && Number.isFinite(p.lat) && Number.isFinite(p.lon) ? dist(me.lat, me.lon, p.lat as number, p.lon as number) : undefined }));
  return me ? all.sort((a, b) => (a.d ?? 1e12) - (b.d ?? 1e12) || a.name.localeCompare(b.name)) : all.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The car park list while its live counts are read (27 Oct speed pass 4): with no copy from the last 30 minutes,
 * api.transportsydney.app answers at once with the last list it saved (counts over 30 minutes old say No live count)
 * or the car parks with no counts, marked fallback "counts-loading", and reads the live counts behind it (about 10 s
 * for some 40 car parks). The list asks again after these waits, then keeps its normal 2 minute gap.
 */
export const PARK_AGAIN_MS = [8000, 15000, 30000] as const;
export const isParkLoading = (d: unknown): boolean => !!d && typeof d === 'object' && (d as any).fallback === 'counts-loading';
export function parkAgainMs(d: unknown, asked: number): number | null {
  if (!isParkLoading(d) || asked < 0 || asked >= PARK_AGAIN_MS.length) return null;
  return PARK_AGAIN_MS[asked];
}
/** The line over the list meanwhile: when the shown counts were read, if the server said, and that live ones are coming. */
export function parkLoadingNote(d: unknown): string {
  const at = d && typeof d === 'object' ? Number((d as any).dataAt) : NaN;
  const when = Number.isFinite(at) && at > 0 ? parkClock(at) : '';
  return when ? `Counts from ${when}. Getting live counts.` : 'Getting live counts.';
}
