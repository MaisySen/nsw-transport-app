// Every N minutes for frequent lines (30 Oct): on a stop's board, a line that runs often in the next half hour gets
// one short line above the list, "Every 3 to 5 min", worked out on the phone from the rows the board already has.
// No new request, no server change and no hard coded lines: any line and direction that qualifies on this board
// shows, whatever the mode. Plain functions with no React Native imports, unit tested in test/frequent.test.mjs.
import { depKey, depTime } from './boardTimeCore';
import { shortName } from './format';

type Dep = {
  line?: string; mode?: string; color?: string; dest?: string; planned?: string | null; estimated?: string | null;
  realtime?: boolean; cancelled?: boolean; stopId?: string | null; departed?: boolean;
};

export type Frequent = {
  key: string; line: string; mode?: string; color?: string; dest: string;
  /** Shortest and longest gap between the services counted, whole minutes (at least 1). */
  lo: number; hi: number;
  /** "Every 4 min", "Every 3 to 5 min". */
  text: string;
  /** What VoiceOver and TalkBack read: "M1 to Tallawong, every 3 to 5 minutes". */
  label: string;
};

/** The half hour looked at, from now. */
export const FREQ_WINDOW_MS = 30 * 60000;
/** At least this many services of one line and direction in the window. */
export const FREQ_MIN_SERVICES = 4;
/** No gap longer than this between them (Sydney's turn up and go standard is 10 minutes or better). */
export const FREQ_MAX_GAP_MIN = 10;
/** Lines shown at most, soonest first, so the board stays the board. */
export const FREQ_MAX_LINES = 2;

const MIN = 60000;

/** The gap words: "Every 4 min" or "Every 3 to 5 min". */
export function everyText(lo: number, hi: number): string {
  return lo === hi ? `Every ${lo} min` : `Every ${lo} to ${hi} min`;
}

/**
 * The frequent lines on a board for now (`at` null). A board for another time, a cancelled or gone service, and a
 * line with fewer than 4 services in the next 30 minutes or a gap over 10 minutes show nothing. The first service
 * of a line has to leave within 10 minutes too, so a line that only starts running often later is left out.
 * Times are the ones the rows show (the live time when there is one, else the timetable), so the words never say
 * more than the list under them.
 */
export function frequentLines(items: Dep[] | null | undefined, now: number, at: number | null = null, max = FREQ_MAX_LINES): Frequent[] {
  if (at != null || !Array.isArray(items) || items.length < FREQ_MIN_SERVICES || !Number.isFinite(now)) return [];
  const groups = new Map<string, { d: Dep; times: number[]; seen: Set<string> }>();
  for (const d of items) {
    if (!d || !d.line || d.cancelled || d.departed) continue;
    const t = depTime(d);
    if (!Number.isFinite(t) || t < now - MIN || t > now + FREQ_WINDOW_MS) continue;
    const dest = shortName(d.dest || '');
    const key = `${d.line}|${dest.toLowerCase()}`;
    let g = groups.get(key);
    if (!g) { g = { d, times: [], seen: new Set() }; groups.set(key, g); }
    const k = depKey(d);
    if (g.seen.has(k)) continue;
    g.seen.add(k);
    g.times.push(t);
  }
  const out: (Frequent & { next: number })[] = [];
  for (const [key, g] of groups) {
    const ts = g.times.sort((a, b) => a - b);
    // Two rows a few seconds apart are one service seen twice (two stands of one stop), not a 0 minute gap.
    const uniq = ts.filter((t, i) => i === 0 || t - ts[i - 1] >= 30000);
    if (uniq.length < FREQ_MIN_SERVICES) continue;
    if (uniq[0] > now + FREQ_MAX_GAP_MIN * MIN) continue;
    const gaps = uniq.slice(1).map((t, i) => (t - uniq[i]) / MIN);
    const hiRaw = Math.max(...gaps);
    if (hiRaw > FREQ_MAX_GAP_MIN + 0.5) continue;
    const lo = Math.max(1, Math.round(Math.min(...gaps)));
    const hi = Math.max(lo, Math.round(hiRaw));
    const dest = shortName(g.d.dest || '');
    const text = everyText(lo, hi);
    const spoken = lo === hi ? `every ${lo} minute${lo === 1 ? '' : 's'}` : `every ${lo} to ${hi} minutes`;
    out.push({ key, line: String(g.d.line), mode: g.d.mode, color: g.d.color, dest, lo, hi, text,
      label: dest ? `${g.d.line} to ${dest}, ${spoken}` : `${g.d.line}, ${spoken}`, next: uniq[0] });
  }
  return out.sort((a, b) => a.next - b.next || a.key.localeCompare(b.key)).slice(0, Math.max(0, max)).map(({ next, ...f }) => f);
}
