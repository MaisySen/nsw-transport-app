// Search as you type from the stop lists kept on the phone (item g10, 26 Oct): every train, metro, light rail and
// ferry stop (the lists Ask keeps, askPlaces.ts) and every bus and coach stop (busStops.ts). Pure: no network, no
// timers. The search box shows these at once, then merges in the server's answer when it adds anything.
import { norm, PLACE_ALIAS, edits } from './askBrain';
import type { SearchItem } from './types';

/** The pause after a keystroke before the server is asked (the local answer needs none). */
export const SEARCH_DEBOUNCE_MS = 280;

/** Mode codes as the Trip Planner numbers them (format.ts MODE_BY_CODE). */
const CODE: Record<string, number> = { train: 1, metro: 2, lightrail: 4, bus: 5, coach: 7, ferry: 9 };
const RANK: Record<number, number> = { 1: 0, 2: 1, 4: 2, 9: 3, 7: 4, 5: 5 };
const SUFFIX = /\s+(railway station|train station|metro station|light rail station|light rail stop|light rail|ferry wharf|wharf|station|stn|interchange)$/;
const WORD_ABBR: Record<string, string> = { nth: 'north', sth: 'south', pt: 'point', jn: 'junction', jct: 'junction', jnct: 'junction', junc: 'junction', hts: 'heights', pk: 'park', hosp: 'hospital', bch: 'beach', hbr: 'harbour', sq: 'square', uni: 'university', ctr: 'centre', center: 'centre', stn: 'station' };

export type LocalStop = { id: string; name: string; modes: number[]; key: string; base: string; rank: number; lat?: number; lon?: number };
export type LocalIndex = { stations: LocalStop[]; bus: LocalStop[]; byId: Map<string, LocalStop> };

const baseOf = (k: string) => { let b = k; for (let i = 0; i < 2; i++) b = b.replace(SUFFIX, '').trim(); return b.replace(/^the\s+/, ''); };

/**
 * The index from the kept lists: stations by mode as [id, name, lat, lon] rows (one stop id can be under several
 * modes: Central is train, metro and light rail), and bus and coach stops as [id, name] rows.
 */
export function buildLocalIndex(lists: Record<string, any[]> | null | undefined, busRows?: any[] | null): LocalIndex {
  const byId = new Map<string, LocalStop>();
  const stations: LocalStop[] = [];
  for (const m of ['train', 'metro', 'lightrail', 'ferry']) {
    for (const row of Array.isArray(lists?.[m]) ? (lists as any)[m] : []) {
      if (!Array.isArray(row) || !row[0] || !row[1]) continue;
      const id = String(row[0]);
      const had = byId.get(id);
      if (had) { if (!had.modes.includes(CODE[m])) { had.modes.push(CODE[m]); had.rank = Math.min(had.rank, RANK[CODE[m]]); } continue; }
      const key = norm(String(row[1]));
      const s: LocalStop = { id, name: String(row[1]), modes: [CODE[m]], key, base: baseOf(key), rank: RANK[CODE[m]],
        lat: typeof row[2] === 'number' ? row[2] : undefined, lon: typeof row[3] === 'number' ? row[3] : undefined };
      byId.set(id, s); stations.push(s);
    }
  }
  const bus: LocalStop[] = [];
  for (const row of Array.isArray(busRows) ? busRows : []) {
    if (!Array.isArray(row) || !row[0] || !row[1]) continue;
    const id = String(row[0]);
    if (byId.has(id)) continue;
    const key = norm(String(row[1]));
    const s: LocalStop = { id, name: String(row[1]), modes: [CODE.bus], key, base: baseOf(key), rank: RANK[CODE.bus] };
    byId.set(id, s); bus.push(s);
  }
  return { stations, bus, byId };
}

/** What was typed, as a key: lower case, short forms spelt out ("parra", "kings x", "bondi jnct"). */
export function searchKey(q: string): string {
  let k = norm(q).replace(/:/g, ' ').replace(/\s+/g, ' ').trim();
  if (Object.prototype.hasOwnProperty.call(PLACE_ALIAS, k)) return PLACE_ALIAS[k];
  k = k.split(' ').map((w) => (Object.prototype.hasOwnProperty.call(WORD_ABBR, w) ? WORD_ABBR[w] : w)).join(' ');
  return Object.prototype.hasOwnProperty.call(PLACE_ALIAS, k) ? PLACE_ALIAS[k] : k;
}

function wordScore(s: LocalStop, k: string, words: string[]): number {
  if (s.key === k || s.base === k) return 0;
  if (s.base.startsWith(k) || s.key.startsWith(k)) return 1 + (s.key.length - k.length) / 200;
  if (!s.key.includes(words[0].slice(0, 2))) return Infinity;
  const kw = s.key.split(' ');
  if (!words.every((w) => kw.some((t) => t.startsWith(w)))) return Infinity;
  return (kw[0].startsWith(words[0]) ? 2 : 2.5) + (s.key.length - k.length) / 200;
}

/**
 * Stops matching what is typed, best first: an exact name, then names starting with it, then names with every
 * typed word at the start of one of their words, then (stations only) a slip of one or two letters. A number
 * finds stops by their stop number. Trains before metro, light rail, ferries, coaches and buses on a tie.
 */
export function localSearch(q: string, idx: LocalIndex | null | undefined, max = 10): SearchItem[] {
  if (!idx) return [];
  const raw = String(q || '').trim();
  if (raw.length < 2) return [];
  const out: { s: LocalStop; sc: number }[] = [];
  if (/^\d{3,}$/.test(raw)) {
    for (const s of idx.stations) if (s.id.startsWith(raw)) out.push({ s, sc: s.id.length - raw.length });
    for (const s of idx.bus) if (s.id.startsWith(raw)) out.push({ s, sc: s.id.length - raw.length });
  } else {
    const k = searchKey(raw);
    if (!k) return [];
    const words = k.split(' ').filter(Boolean);
    for (const s of idx.stations) { const sc = wordScore(s, k, words); if (Number.isFinite(sc)) out.push({ s, sc }); }
    let busN = 0;
    for (const s of idx.bus) { const sc = wordScore(s, k, words); if (Number.isFinite(sc)) { out.push({ s, sc: sc + 0.3 }); busN++; } if (busN > 400) break; }
    // A slip ("strathfeild", "wolongong"): stations only, when nothing starts with what was typed.
    if (!out.length && k.length >= 4) {
      const cap = k.length <= 6 ? 1 : 2;
      for (const s of idx.stations) {
        const whole = Math.abs(s.base.length - k.length) <= cap ? edits(k, s.base, cap) : Infinity;
        const head = s.base.length > k.length ? edits(k, s.base.slice(0, k.length), cap) + 0.5 : Infinity;
        const d = Math.min(whole, head);
        if (d <= cap) out.push({ s, sc: 3 + d });
      }
    }
  }
  out.sort((a, b) => a.sc - b.sc || a.s.rank - b.s.rank || a.s.name.length - b.s.name.length);
  // Bus stands crowd out stations: at most max - 2 buses unless nothing else matched.
  const others = out.filter((x) => x.s.rank < RANK[5]).length;
  const res: SearchItem[] = [];
  let buses = 0;
  for (const x of out) {
    if (res.length >= max) break;
    if (x.s.rank === RANK[5]) { if (others && buses >= Math.max(2, max - Math.min(others, max - 2))) continue; buses++; }
    res.push({ id: x.s.id, name: x.s.name, modes: x.s.modes.slice() });
  }
  return res;
}

const stopLike = (x: any) => !x.kind || x.kind === 'stop';
const sameName = (a: string, b: string) => baseOf(norm(a)) === baseOf(norm(b));

/** The local answer first, then anything the server adds (a stop not already shown, by id or by name), up to max. */
export function mergeSearch<T extends { id: string; name: string }>(local: T[], server: T[] | null | undefined, max = 12): T[] {
  const out = local.slice(0, max);
  for (const it of server || []) {
    if (out.length >= max) break;
    if (out.some((o) => o.id === it.id || (stopLike(it) && stopLike(o) && sameName(o.name, it.name)))) continue;
    out.push(it);
  }
  return out;
}

/** Whether to show a spinner in the search box: only while the server is out and nothing is shown yet. */
export const searchBusy = (serverOut: boolean, shown: number) => serverOut && shown === 0;
