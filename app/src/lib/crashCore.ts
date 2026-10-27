// Pure parts of the crash safety net (crash.ts): the report text, its page tag and which phone keys are kept answers.
export const MAX_REPORTS = 3;
const STACK_CHARS = 2400;

export type CrashCtx = { where: string; fatal?: boolean; os?: string; build?: string | null; update?: string | null; recent?: string[] };

// The last few server paths this run asked for (no query values), so a report says which answers came just before.
const recentPaths: string[] = [];
export function noteRequest(url: string, status: number | string): void {
  try {
    const u = String(url).replace(/^https?:\/\/[^/]+/, '');
    const pathOnly = u.split('?')[0];
    const keys = (u.split('?')[1] || '').split('&').map((kv) => kv.split('=')[0]).filter(Boolean).join(',');
    recentPaths.push(`${pathOnly}${keys ? '?' + keys : ''} ${status}`);
    if (recentPaths.length > 8) recentPaths.shift();
  } catch { /* never in the way */ }
}
export const recentRequests = () => recentPaths.slice();

/** The report as the feedback inbox stores it (at most 4000 characters, at least 10). */
export function crashMessage(error: unknown, c: CrashCtx): string {
  const e: any = error;
  const name = (e && typeof e === 'object' && e.name) || 'Error';
  const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e);
  const stack = e && typeof e === 'object' && e.stack ? String(e.stack) : '';
  const comp = e && typeof e === 'object' && e.componentStack ? String(e.componentStack) : '';
  const head = `Automatic crash report (${c.fatal ? 'fatal' : 'caught'}, ${c.where}). ${c.os || '?'} build ${c.build || '?'} update ${(c.update || '?').slice(0, 8)}.`;
  const first = `${name}: ${msg}`;
  const body = stack.startsWith(first) ? stack : `${first}\n${stack}`;
  const recent = c.recent && c.recent.length ? `\nRecent: ${c.recent.join(' | ')}` : '';
  const text = `${head}${recent}\n${body.slice(0, STACK_CHARS)}${comp ? '\nComponents:' + comp.slice(0, 800) : ''}`;
  return text.slice(0, 3990);
}

/** The page tag: "crash:" and the screen path, at most 80 characters. */
export function crashPage(where: string): string {
  return ('crash:' + String(where || '').replace(/[^\w/:\-().[\]]/g, '')).slice(0, 80);
}

/** Phone keys that hold kept answers and lists, never settings, places, starred stops or trips on Home. */
export function keptKeys(all: string[], listed: string[]): string[] {
  const keep = new Set(['store', 'profile', 'device']);
  const out = new Set<string>();
  for (const k of listed) if (!keep.has(k)) out.add(k);
  for (const k of all) {
    if (keep.has(k)) continue;
    if (k === 'offline:index' || k.startsWith('tt:') || k.startsWith('ask:places') || k.startsWith('search:bus') || k === 'liveTrip') out.add(k);
  }
  return [...out];
}
