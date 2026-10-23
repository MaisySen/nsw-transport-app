import type { StyleProp, ViewStyle } from 'react-native';

export type MapStop = { id: string; name: string; lat?: number; lon?: number; passed?: boolean; mine?: boolean };
export type TransitMapProps = {
  path?: [number, number][];
  stops?: MapStop[];
  vehicle?: { lat: number; lon: number; bearing?: number | null } | null;
  color: string;
  dark: boolean;
  bottomInset?: number;
  style?: StyleProp<ViewStyle>;
};

export function boundsOf(p: TransitMapProps): [number, number, number, number] | null {
  const pts: [number, number][] = [];
  (p.path || []).forEach((x) => pts.push(x));
  (p.stops || []).forEach((s) => { if (s.lat != null && s.lon != null) pts.push([s.lat, s.lon]); });
  if (p.vehicle) pts.push([p.vehicle.lat, p.vehicle.lon]);
  if (!pts.length) return null;
  let s = 90, w = 180, n = -90, e = -180;
  for (const [la, lo] of pts) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }
  return [w, s, e, n];
}
