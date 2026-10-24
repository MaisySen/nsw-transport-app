// Moving installs off the old shared test profile, and making profile ids.
// No imports, so the unit tests can load it on its own (test/profile.test.mjs).

/**
 * The first test installs, built before each install got its own profile, all used this one
 * shared profile. Its id is public, so anyone could read or change its trips. Installs still on
 * it move to a fresh private id on their next launch (initProfile in device.ts).
 */
export const SHARED_PROFILE = 'bid' + 'ur';

export const isSharedProfile = (p: string | null | undefined) => String(p || '').trim().toLowerCase() === SHARED_PROFILE;

/** An id from 12 or more random bytes: the prefix plus 24 base 36 characters. */
export function idFromBytes(prefix: string, bytes: ArrayLike<number>): string {
  if (!bytes || bytes.length < 12) throw new Error('need 12 random bytes');
  let s = '';
  for (let i = 0; i < 12; i++) s += (bytes[i] & 0xff).toString(36).padStart(2, '0');
  return prefix + s;
}

/** The 15 random bytes of a version 4 UUID (the version and variant nibbles left out). */
export function bytesFromUuid(u: string): number[] {
  const h = String(u || '').replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(h)) throw new Error('not a uuid');
  const nib = h.split('').filter((_, i) => i !== 12 && i !== 16);
  const out: number[] = [];
  for (let i = 0; i + 1 < nib.length; i += 2) out.push(parseInt(nib[i] + nib[i + 1], 16));
  return out;
}

type P = { id: string; name: string };
type StoredTrip = { name?: string; from?: P; to?: P; via?: P; conn?: number; modes?: string[]; legs?: { mode?: string; from: P; to: P; conn?: number; any?: boolean; walk?: number }[] };
export type Upload = { name: string; from: P; to: P } | { name: string; legs: { f: string; fn: string; t: string; tn: string; m: string; c: number; a: number; w: number }[] };

/** The legs of a stored trip, for the multi leg form and the older via form. */
function legsOf(t: StoredTrip) {
  if (t.legs && t.legs.length) return t.legs;
  if (t.via && t.from && t.to) return [{ mode: t.modes?.[0] || '', from: t.from, to: t.via }, { mode: t.modes?.[1] || '', from: t.via, to: t.to, conn: t.conn }];
  return t.from && t.to ? [{ mode: t.modes?.[0] || '', from: t.from, to: t.to }] : [];
}

/**
 * The saved trips kept on this phone (the "store" value in AsyncStorage), in the shape POST /api/saved
 * takes, so they can be saved again under the new profile. Trips with no name or no stops are skipped.
 */
export function tripsToUpload(storeJson: string | null): Upload[] {
  let st: any = null;
  try { st = storeJson ? JSON.parse(storeJson) : null; } catch { st = null; }
  const list: StoredTrip[] = Array.isArray(st?.myTrips) ? st.myTrips : [];
  const out: Upload[] = [];
  const seen = new Set<string>();
  for (const t of list) {
    const name = String(t?.name || '').trim().slice(0, 24);
    const L = legsOf(t || {}).filter((l) => l?.from?.id && l?.to?.id);
    if (!name || !L.length || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    if (L.length > 1) out.push({ name, legs: L.map((l) => ({ f: l.from.id, fn: l.from.name, t: l.to.id, tn: l.to.name, m: l.mode || '', c: l.conn ?? 5, a: l.any ? 1 : 0, w: l.walk ?? 5 })) });
    else out.push({ name, from: { id: L[0].from.id, name: L[0].from.name }, to: { id: L[0].to.id, name: L[0].to.name } });
  }
  return out;
}
