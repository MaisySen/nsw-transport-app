// Exact stand pin: where you board, as the point the trip planner gives for the leg's first stop (the stand or
// platform itself, not the station), the stand's name ("Stand G"), and a hint when the stand is on the other side of
// the road from where your walk to it starts. No React here (test/standpin.test.mjs).

type Pt = [number, number]; // [lat, lon], as the server sends leg paths
type LegIn = { kind?: string; mode?: string | null; from?: string | null; fromPlatform?: string | null; path?: ReadonlyArray<ReadonlyArray<number>> | null };

const BUSLIKE = new Set(['bus', 'coach', 'school']);
const okPt = (p: unknown): p is Pt => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0] as number) <= 90 && Math.abs(p[1] as number) <= 180 && !(p[0] === 0 && p[1] === 0);

/** The boarding point of a ride leg: the first point of its path. Null with no path (timetable answers have none). */
export function standPoint(l: LegIn | null | undefined): Pt | null {
  if (!l || l.kind === 'walk') return null;
  const p = l.path && l.path[0];
  return okPt(p) ? [p[0], p[1]] : null;
}

/** "Stand G", "Platform 3", "Wharf 2": the platform word from the leg, else from the stop's name. '' when none. */
export function standName(l: LegIn | null | undefined): string {
  if (!l) return '';
  const p = String(l.fromPlatform || '').trim();
  if (p) return /^\d+[A-Z]?$/i.test(p) ? `Platform ${p}` : p;
  const m = /(?:^|,\s*)((?:Stand|Platform|Wharf|Bay|Stop)\s+[A-Z0-9]{1,4})(?=,|$)/i.exec(String(l.from || ''));
  return m ? m[1] : '';
}

/** Metres between two points (small distances, flat earth is fine). */
export function metres(a: Pt, b: Pt): number {
  const k = Math.PI / 180;
  const x = (b[1] - a[1]) * Math.cos(((a[0] + b[0]) / 2) * k) * 111320;
  const y = (b[0] - a[0]) * 110540;
  return Math.hypot(x, y);
}

/** Within this many metres of the stand, the walk's start is near enough for the road side to mean something. */
export const CROSS_NEAR_M = 300;
/** And at least this far to the side of the bus's road (half a road's width plus a kerb). */
export const CROSS_SIDE_M = 12;
/** The bus's direction is read over its first stretch, at least this long. */
export const DIR_MIN_M = 40;

/**
 * Is the stand on the other side of the road from where you start walking to it? Buses in NSW stop at the left kerb in
 * their direction of travel, so a start point clearly to the right of the bus's first stretch of road means crossing
 * it. Only for buses and coaches, only with a start within CROSS_NEAR_M, the bus's path at least DIR_MIN_M long, and
 * the start at least CROSS_SIDE_M to the side; null when the data cannot say.
 */
export function acrossRoad(l: LegIn | null | undefined, start: Pt | null | undefined): boolean | null {
  if (!l || !BUSLIKE.has(String(l.mode || '')) || !okPt(start)) return null;
  const path = (l.path || []).filter(okPt) as Pt[];
  if (path.length < 2) return null;
  const s = path[0];
  const near = metres(s, start);
  if (near > CROSS_NEAR_M || near < CROSS_SIDE_M) return null;
  const ahead = path.find((p) => metres(s, p) >= DIR_MIN_M);
  if (!ahead) return null;
  const k = Math.PI / 180, c = Math.cos(s[0] * k);
  const dx = (ahead[1] - s[1]) * c, dy = ahead[0] - s[0];
  const px = (start[1] - s[1]) * c, py = start[0] - s[0];
  const len = Math.hypot(dx, dy);
  if (!len) return null;
  // Positive cross: the start is to the left of the direction of travel (the kerb side); negative: to the right.
  const cross = (dx * py - dy * px) / len;
  const sideM = Math.abs(cross) * 110540;
  if (sideM < CROSS_SIDE_M) return null;
  return cross < 0;
}

/** Where your walk to this leg starts: the previous walk leg's first point. Null when there is no walk before it. */
export function walkStart(prev: LegIn | null | undefined): Pt | null {
  if (!prev || prev.kind !== 'walk') return null;
  const p = prev.path && prev.path[0];
  return okPt(p) ? [p[0], p[1]] : null;
}

/** A maps link to the exact point, for walking there: Apple Maps on iPhone, a geo link on Android, a web map else. */
export function mapsUrl(p: Pt, label: string, os: string): string {
  const q = encodeURIComponent(label || 'Stand');
  const ll = `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  if (os === 'ios') return `https://maps.apple.com/?ll=${ll}&q=${q}&dirflg=w`;
  if (os === 'android') return `geo:${ll}?q=${ll}(${q})`;
  return `https://www.openstreetmap.org/?mlat=${p[0].toFixed(6)}&mlon=${p[1].toFixed(6)}#map=19/${ll.replace(',', '/')}`;
}
