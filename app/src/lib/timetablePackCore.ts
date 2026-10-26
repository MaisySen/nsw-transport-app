// On phone timetable packs (docs/TIMETABLE_PACKS.md), the parts with no phone dependencies (tested in
// test/timetablepack.test.mjs). A pack is one stop's timetable for today and tomorrow from api.transportsydney.app
// (/api/pack, built from the board engine's timetable). A stop that has one shows its departures on the first frame,
// with no signal too, as timetable times, and the live board replaces them when it lands.
import type { Departure, DeparturesResp } from './types';

export type Pack = {
  v: 1;
  stop: { id: string; name: string };
  ver?: number; builtAt?: string | null; generatedAt: number;
  /** Epoch seconds: the first departure; `until` is the end of the last service day covered. */
  base: number; until: number; days?: string[];
  /** [line, mode, color, mode name, description] */
  lines: [string, string, string, string, string][];
  heads: string[];
  /** [stop id, platform, stop name] */
  plats: [string, string, string][];
  /** Four numbers per departure: seconds after the previous one, line, headsign and platform indexes. */
  rows: number[];
};

/** A kept pack: the pack and when this phone fetched it. */
export type KeptPack = { at: number; pack: Pack };

/** How many stops keep a pack, and the largest pack kept (characters of JSON). Central, the biggest, is about 90k. */
export const PACK_MAX_STOPS = 24;
export const PACK_MAX_CHARS = 160000;
/** A pack is fetched again once a day: when it is this old, or covers less than this much more time. */
export const PACK_REFRESH_MS = 20 * 3600 * 1000;
export const PACK_MIN_AHEAD_MS = 20 * 3600 * 1000;
/** A copy of the live board younger than this is shown before a pack (its live times are still close to right). */
export const KEPT_BEATS_PACK_MS = 10 * 60 * 1000;
/** Rows a pack board shows, like a live board answer. */
export const PACK_BOARD_ROWS = 40;

const STOP_ID = /^[A-Za-z0-9_-]{1,20}$/;

/** True when this looks like a pack this app can read and it still covers time after `now`. */
export function packValid(p: any, now: number): p is Pack {
  if (!p || typeof p !== 'object' || p.v !== 1 || !p.stop || typeof p.stop.id !== 'string') return false;
  if (!Array.isArray(p.rows) || p.rows.length % 4 !== 0 || !Array.isArray(p.lines) || !Array.isArray(p.heads) || !Array.isArray(p.plats)) return false;
  if (typeof p.base !== 'number' || typeof p.until !== 'number') return false;
  return p.until * 1000 > now;
}

/** True when a kept pack should be fetched again (missing, a day old, or running out). Never blocks showing it. */
export function packDue(kept: KeptPack | null | undefined, now: number): boolean {
  if (!kept || !packValid(kept.pack, now)) return true;
  if (now - kept.at > PACK_REFRESH_MS || kept.at > now + 60000) return true;
  return kept.pack.until * 1000 - now < PACK_MIN_AHEAD_MS;
}

const sameMode = (rowMode: string, mode: string) => rowMode === mode || (mode === 'bus' && (rowMode === 'coach' || rowMode === 'school'));

/**
 * The pack's departures from `now` on, as live board rows with no live data: realtime false, status Scheduled, no trip
 * id. `mode` keeps one mode (bus includes coach and school bus, as the server does). At most `max` rows.
 */
export function packDepartures(p: Pack, now: number, opts: { mode?: string | null; max?: number; stopId?: string } = {}): Departure[] {
  const out: Departure[] = [];
  const max = opts.max ?? PACK_BOARD_ROWS;
  const from = now - 45000;
  const r = p.rows;
  let t = p.base;
  for (let i = 0; i < r.length && out.length < max; i += 4) {
    t += r[i];
    const ms = t * 1000;
    if (ms < from) continue;
    const l = p.lines[r[i + 1]], pl = p.plats[r[i + 3]];
    if (!l || !pl) continue;
    if (opts.mode && !sameMode(l[1], opts.mode)) continue;
    out.push({
      mode: l[1], modeName: l[3], line: l[0], color: l[2], dest: p.heads[r[i + 2]] || '', description: l[4] || '',
      platform: pl[1] || '', platformChangedFrom: null, stopId: pl[0], stopName: pl[2] || '', tripId: '',
      planned: new Date(ms).toISOString(), estimated: null, realtime: false, delayMin: null, cancelled: false,
      alerts: [], status: { key: 'scheduled', text: 'Scheduled' },
    });
  }
  return out;
}

/** A board answer made from a pack, marked `fromPack` with the pack's time, so screens label it as timetable times. */
export type PackBoard = DeparturesResp & { fromPack: number };
export function packBoard(p: Pack, now: number, mode?: string | null): PackBoard {
  const items = packDepartures(p, now, { mode });
  return {
    kind: 'departures', stop: { id: p.stop.id, name: p.stop.name, fullName: p.stop.name }, items, alerts: [], now,
    ...(mode ? { askedMode: mode } : {}), fromPack: p.generatedAt || now,
  };
}

/** True for a board made from a pack (not from the server). */
export const isPackBoard = (d: any): d is PackBoard => !!d && typeof d === 'object' && typeof d.fromPack === 'number';

/** The stop and mode in a departures cache key ("offline:dep:213510|bus"), or null for any other key. */
export function packTarget(cacheKey: string | undefined | null): { stop: string; mode: string | null } | null {
  const m = /^offline:dep:([^|]+)(?:\|(.+))?$/.exec(String(cacheKey || ''));
  return m && STOP_ID.test(m[1]) ? { stop: m[1], mode: m[2] || null } : null;
}

/**
 * Which first paint wins on a screen that opens: a copy of the live board kept less than KEPT_BEATS_PACK_MS ago, else a
 * pack board with services still to come, else the kept copy (older), else nothing.
 */
export function firstPaint<T>(kept: { at: number; data: T } | null, pack: PackBoard | null, now: number): { kind: 'kept' | 'pack' | 'none'; data: T | PackBoard | null; at: number | null } {
  if (kept && now - kept.at < KEPT_BEATS_PACK_MS) return { kind: 'kept', data: kept.data, at: kept.at };
  if (pack && pack.items.length) return { kind: 'pack', data: pack, at: pack.fromPack };
  if (kept) return { kind: 'kept', data: kept.data, at: kept.at };
  return { kind: 'none', data: null, at: null };
}

type PlaceLike = { id?: string | null } | null | undefined;
type StoreLike = {
  starred?: PlaceLike[]; recents?: PlaceLike[]; places?: { home?: PlaceLike; work?: PlaceLike };
  myTrips?: { from?: PlaceLike; to?: PlaceLike; via?: PlaceLike; legs?: { from?: PlaceLike; to?: PlaceLike }[] }[];
  recentTrips?: { from?: PlaceLike; to?: PlaceLike }[];
};

/**
 * The stops that keep a pack, most wanted first: starred stops, saved trips' stops (every leg's start), home and work
 * when they are stops, recent stops, then recent trips' starts. Ids that are not stop ids (an address) are left out.
 */
export function packStops(s: StoreLike, max = PACK_MAX_STOPS): string[] {
  const out: string[] = [];
  const add = (p: PlaceLike) => { const id = p && p.id ? String(p.id) : ''; if (STOP_ID.test(id) && /\d/.test(id) && !out.includes(id)) out.push(id); };
  (s.starred || []).forEach(add);
  for (const t of s.myTrips || []) {
    add(t.from);
    if (t.via) add(t.via);
    for (const l of t.legs || []) add(l.from);
  }
  add(s.places?.home); add(s.places?.work);
  (s.recents || []).slice(0, 8).forEach(add);
  for (const t of (s.recentTrips || []).slice(0, 4)) add(t.from);
  return out.slice(0, max);
}

/** The line on top while pack times are on screen: "Timetable times, getting live times", or when the live board
 * could not be had (offline, or the server failed) "Live times unavailable, showing timetable times". */
export function packStampText(failed: boolean): string {
  return failed ? 'Live times unavailable, showing timetable times' : 'Timetable times, getting live times';
}
