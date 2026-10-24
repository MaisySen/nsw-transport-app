// Status of my lines: which lines to ask about and how each reads. No React here (test/linestatus.test.mjs).
import type { TripLines } from './trackworkCore';

export type LineStatus = { line: string; status: 'good' | 'delays' | 'trackwork' | 'suspended'; label: string; title: string | null; url: string | null; more: number };
export type LinesResp = { enabled?: boolean; at?: number | null; items?: LineStatus[]; stale?: boolean };
export type LineRow = LineStatus & { mode?: string; color?: string };

/** The lines on the trips on Home, in Home order, each once, at most max. */
export function myLines(trips: TripLines[], max = 12): { line: string; mode?: string; color?: string }[] {
  const out: { line: string; mode?: string; color?: string }[] = [];
  for (const tr of trips) for (const l of tr.lines) {
    if (out.some((x) => x.line === l) || out.length >= max) continue;
    out.push({ line: l, ...(tr.marks?.[l] || {}) });
  }
  return out;
}

/** Rows to show: problems first (suspended, delays, trackwork), then good service, in Home order within each. */
export function lineRows(resp: LinesResp | null, mine: { line: string; mode?: string; color?: string }[]): LineRow[] {
  if (!resp || resp.enabled === false || resp.stale || !resp.items?.length) return [];
  const rank = { suspended: 0, delays: 1, trackwork: 2, good: 3 } as const;
  const rows: LineRow[] = [];
  mine.forEach((m) => { const s = resp.items!.find((x) => x.line === m.line); if (s) rows.push({ ...s, mode: m.mode, color: m.color }); });
  return rows.map((r, i) => ({ r, i })).sort((a, b) => (rank[a.r.status] - rank[b.r.status]) || a.i - b.i).map((x) => x.r);
}

/** One line under the Home chips: "All good on your lines" or the count with problems. */
export function summaryText(rows: LineRow[]): string {
  const bad = rows.filter((r) => r.status !== 'good').length;
  if (!rows.length) return '';
  if (!bad) return rows.length === 1 ? 'Good service on your line' : `Good service on all ${rows.length} of your lines`;
  if (rows.length === 1) return 'Your line has an issue';
  return `${bad} of your ${rows.length} lines ${bad === 1 ? 'has an issue' : 'have issues'}`;
}
