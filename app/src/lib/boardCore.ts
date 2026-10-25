// Departure board: the next services at a stop as large rows. Pure logic; the screen is app/board.tsx.
// Each row carries the shared live label (docs/LIVE-LABELS.md): Live with its age, Timetable, or Not tracking.

import { liveState, type LiveKind } from './liveLabelCore';

export type BoardRow = { key: string; line: string; mode: string; color?: string; dest: string; platform: string; when: string; unit: string;
  live: boolean; cancelled: boolean; at: number; a11y: string;
  /** The shared live label: live, timetable, stale (Not tracking) or cancelled, with its words and age. */
  kind: LiveKind; label: string; age: string | null;
  /** Stopping pattern from the service's own description ("Strathfield, then all stations to Central"), when it has one. */
  pattern: string; tripId?: string };

const t = (s?: string | null) => (s ? new Date(s).getTime() : NaN);

/** "Plat 3" from "Platform 3"; stands and wharves keep their own words. Empty when there is none. */
export function platformLabel(p?: string | null): string {
  if (!p) return '';
  const s = String(p).trim();
  const m = /^platform\s*(.+)$/i.exec(s);
  return m ? `Plat ${m[1]}` : s;
}

/** Big time for a row: "Now" under a minute, minutes under an hour, else the clock time (Sydney). */
export function boardTime(at: number, now: number): { when: string; unit: string } {
  const diff = at - now;
  if (!Number.isFinite(diff)) return { when: '', unit: '' };
  if (diff < 60000) return { when: 'Now', unit: '' };
  const m = Math.floor(diff / 60000);
  if (m < 60) return { when: String(m), unit: 'min' };
  let s: string;
  try { s = new Date(at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Australia/Sydney' }).replace(/\s?(am|pm)/i, (x) => x.trim().toLowerCase()); }
  catch { const d = new Date(at), h = d.getHours(); s = `${((h + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`; }
  return { when: s, unit: '' };
}

/** A service description that reads as a stopping pattern; a plain "A to B" route name is not one. */
export function patternOf(desc?: string | null): string {
  const s = String(desc || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return /\b(all stations|all stops|limited stops|express|stops at|non ?stop)\b/i.test(s) || /,\s*then\b/i.test(s) ? s : '';
}

/**
 * Where a service stops after this one, from its stop list (/api/service: stops in order, `mineIndex` is this stop).
 * "Burwood, Redfern, Central" up to `max` names; longer lists say the first few and how many more. Empty when unknown.
 */
export function stopsSummary(stops: { name?: string; skipped?: boolean }[] | null | undefined, mineIndex: number | null | undefined, max = 5): string {
  const list = stops || [];
  const from = mineIndex != null && mineIndex >= 0 ? mineIndex + 1 : -1;
  if (from < 1) return '';
  const names = list.slice(from).filter((s) => s && s.name && !s.skipped).map((s) => String(s.name).replace(/,.*$/, '').replace(/ (Station|Light Rail|Wharf)$/, '').trim());
  if (!names.length) return '';
  if (names.length === 1) return `${names[0]} only`;
  if (names.length <= max) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const head = names.slice(0, max - 2);
  return `${head.join(', ')}, then ${names.length - head.length} more to ${names[names.length - 1]}`;
}

/** Rows for the board: services not yet gone (a cancelled one stays until its time), soonest first, at most `max`. */
export function boardRows(items: any[], now: number, max = 8, mode: string | null = null): BoardRow[] {
  const rows: BoardRow[] = [];
  for (const d of items || []) {
    if (mode && d.mode !== mode) continue;
    const est = d.realtime ? t(d.estimated) : NaN;
    const at = Number.isFinite(est) ? est : t(d.planned);
    if (!Number.isFinite(at) || at <= now - 30000) continue;
    const st = liveState({ planned: d.planned, estimated: d.estimated, realtime: d.realtime, cancelled: d.cancelled, seenAt: d.seenAt, vehicleAgeS: d.vehicle?.ageS }, now);
    const live = st.kind === 'live';
    // A live or timetable time counts down; Not tracking shows its timetable clock time instead (never "Now").
    const { when, unit } = st.kind === 'stale' ? { when: st.big, unit: '' } : boardTime(st.kind === 'live' ? at : t(d.planned), now);
    const platform = platformLabel(d.platform);
    const dest = String(d.dest || '').replace(/ Station$/, '');
    const cancelled = !!d.cancelled;
    const pattern = patternOf(d.description);
    const words = cancelled ? 'cancelled' : st.kind === 'stale' ? `not tracking, timetable ${when}` : when === 'Now' ? 'now' : unit ? `${when} minutes` : `at ${when}`;
    const a11y = [`${d.line} to ${dest}`, platform ? platform.replace(/^Plat /, 'platform ') : '', words,
      cancelled || st.kind === 'stale' ? '' : live ? `live${st.age ? `, updated ${st.age}` : ''}` : 'timetable', pattern ? `stops: ${pattern}` : ''].filter(Boolean).join(', ');
    rows.push({ key: `${d.tripId || d.line}|${d.planned}`, line: String(d.line || ''), mode: String(d.mode || ''), color: d.color, dest, platform, when, unit, live, cancelled, at,
      a11y, kind: st.kind, label: st.label, age: st.age, pattern, tripId: d.tripId });
  }
  rows.sort((a, b) => a.at - b.at);
  return rows.slice(0, max);
}

/**
 * The board's base type size in points: from the window (landscape uses the height, portrait the width) and the
 * phone's text size setting (Dynamic Type, fontScale), capped so at least three rows still fit.
 */
export function boardScale(width: number, height: number, fontScale = 1): number {
  const wide = width > height;
  const base = wide ? Math.min(64, Math.max(30, height / 10)) : Math.min(52, Math.max(30, width / 10));
  const scale = Math.min(1.6, Math.max(1, Number.isFinite(fontScale) ? fontScale : 1));
  const room = Math.max(30, (height > 0 ? height : 600) / 7.5);
  return Math.round(Math.min(base * scale, Math.max(base, room)));
}

/** How many rows fit: the space under the header over the row height, at least 3 and at most 12. */
export function rowsThatFit(height: number, rowHeight: number, header: number): number {
  if (!(height > 0) || !(rowHeight > 0)) return 6;
  return Math.max(3, Math.min(12, Math.floor((height - header) / rowHeight)));
}
