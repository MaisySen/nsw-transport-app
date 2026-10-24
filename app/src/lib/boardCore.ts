// Departure board: the next services at a stop as large rows. Pure logic; the screen is app/board.tsx.

export type BoardRow = { key: string; line: string; mode: string; color?: string; dest: string; platform: string; when: string; unit: string;
  live: boolean; cancelled: boolean; at: number; a11y: string };

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

/** Rows for the board: services not yet gone (a cancelled one stays until its time), soonest first, at most `max`. */
export function boardRows(items: any[], now: number, max = 8, mode: string | null = null): BoardRow[] {
  const rows: BoardRow[] = [];
  for (const d of items || []) {
    if (mode && d.mode !== mode) continue;
    const est = d.realtime ? t(d.estimated) : NaN;
    const at = Number.isFinite(est) ? est : t(d.planned);
    if (!Number.isFinite(at) || at <= now - 30000) continue;
    const live = !!d.realtime && !d.cancelled;
    const { when, unit } = boardTime(at, now);
    const platform = platformLabel(d.platform);
    const dest = String(d.dest || '').replace(/ Station$/, '');
    const cancelled = !!d.cancelled;
    const a11y = [`${d.line} to ${dest}`, platform ? platform.replace(/^Plat /, 'platform ') : '', cancelled ? 'cancelled' : when === 'Now' ? 'now' : unit ? `${when} minutes` : `at ${when}`, cancelled ? '' : live ? 'live' : 'scheduled'].filter(Boolean).join(', ');
    rows.push({ key: `${d.tripId || d.line}|${d.planned}`, line: String(d.line || ''), mode: String(d.mode || ''), color: d.color, dest, platform, when, unit, live, cancelled, at, a11y });
  }
  rows.sort((a, b) => a.at - b.at);
  return rows.slice(0, max);
}

/** How many rows fit: the space under the header over the row height, at least 3 and at most 12. */
export function rowsThatFit(height: number, rowHeight: number, header: number): number {
  if (!(height > 0) || !(rowHeight > 0)) return 6;
  return Math.max(3, Math.min(12, Math.floor((height - header) / rowHeight)));
}
