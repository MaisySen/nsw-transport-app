/**
 * What a failed request means, in words that put the fault where it is (g16, 26 Oct 2026, after Bidur's screenshots:
 * Ask said "Check your signal" on 5G while Transport for NSW was refusing our key, Nearby showed "Something went
 * wrong (502)"). Pure: no React Native imports, so the tests can run it.
 *
 * - The server answered with an error: its own words (the server says what failed), never a bare status code. A 5xx
 *   or 429 is the live data's fault (`server`), and screens show the copy or timetable the phone holds.
 * - No answer in time while the phone reached our server in the last 2 minutes: live times are slow, not the phone.
 * - No connection at all: the phone is offline.
 */
export const MSG = {
  upstream: "Live data from Transport for NSW isn't available right now. Try again soon.",
  slow: 'Live times are slow right now. Try again in a moment.',
  offline: "You're offline. Check your connection.",
  noAnswer: 'No answer from the server. Check your connection.',
  failed: "That didn't work. Try again in a moment.",
} as const;

/**
 * Words for an alert after a failed action (1 Nov polish): the app's own message when the error carries one written
 * for people (api.ts builds them from MSG and the server's words), never a raw "TypeError: ..." or a JSON body.
 */
export function friendlyErr(e: any): string {
  const m = typeof e === 'string' ? e : typeof e?.message === 'string' ? e.message : '';
  const t = m.trim();
  if (!t || t.length > 200 || /^[A-Z][A-Za-z]*Error\b|\bundefined\b|\bnull\b|[{}<>\[\]]|\bstatus\s*\d{3}\b|^\d{3}\b|is not a function|Cannot read prop/.test(t)) return MSG.failed;
  return t;
}

/** Read deadlines (docs/DIAGNOSIS_LAG.md item 6): shorter with a kept copy or pack on screen. Trips have one deadline. */
export const READ_MS_WITH_COPY = 8000;
export const READ_MS_EMPTY = 15000;
/**
 * The trip deadline. From 27 Oct the server answers a plain trip within its quick wait (TRIP_QUICK_MS, 6.5 s) plus at
 * most 2 s to build timetable trips, so 13 s leaves room for a slow mobile network on top. It was 10 s, which a slow
 * Trip Planner morning beat (27 Oct 8:35 AM: the phone gave up at 9.9 s).
 */
export const TRIP_MS = 13000;
/** The server's own longest wait for a plain trip before it answers (its quick wait plus building timetable trips). */
export const SERVER_TRIP_ANSWER_MS = 6500 + 2000;
/** A server answer this recent means the phone is online. */
export const REACH_FRESH_MS = 120000;

let reachAt = 0;
let whyNow: 'phone' | 'server' = 'phone';
let whyListener: ((w: 'phone' | 'server') => void) | null = null;
/** Told whenever a failure is put down to the phone or to the live data (api.ts passes it to the kept times labels). */
export function onFailWhy(fn: ((w: 'phone' | 'server') => void) | null) { whyListener = fn; }
const why = {
  set(w: 'phone' | 'server') { whyNow = w; if (whyListener) whyListener(w); },
};
/** Any answer from our server (even an error) proves the phone is online. */
export function noteReach(now: number = Date.now()) { reachAt = now; }
export function reachedRecently(now: number = Date.now()): boolean { return reachAt > 0 && now - reachAt < REACH_FRESH_MS; }
/** Why the last failed read failed, for the labels on kept times: the phone's connection or the live data. */
export function failWhy(): 'phone' | 'server' { return whyNow; }
export function setFailWhy(w: 'phone' | 'server') { why.set(w); }

/** No status code ever reaches a person: the server's own words, else plain ones. */
export function httpMessage(status: number, body: any): string {
  const own = body && typeof body === 'object' ? (typeof body.error === 'string' && body.error) || (typeof body.text === 'string' && body.text) : '';
  if (own && !/^Something went wrong \(\d+\)$/.test(own)) return own;
  return status >= 500 || status === 429 ? MSG.upstream : MSG.failed;
}

/** The error a read throws for an error answer: `server` for a 5xx or 429 (the copy on the phone stands in). */
export function httpError(status: number, body: any): Error & { http: number; server?: boolean } {
  const server = status >= 500 || status === 429;
  if (server) why.set('server');
  return Object.assign(new Error(httpMessage(status, body)), { http: status, ...(server ? { server: true } : {}) });
}

/** A network or timeout failure (no answer from the server). */
export function isNetErr(e: any): boolean {
  const m = String(e?.message || '');
  return !e?.http && (e?.name === 'AbortError' || /cancel|network request failed|timed? ?out|fetch failed|failed to fetch/i.test(m));
}
export function isTimeout(e: any): boolean {
  return !e?.http && (e?.name === 'AbortError' || /timed? ?out|cancel/i.test(String(e?.message || '')));
}

/**
 * The error a read throws when no answer came: `slow` (server reached recently, live data slow) or `offline` (the
 * phone has no connection). Both let screens fall back to the copy on the phone.
 */
export function noAnswerError(e: any, now: number = Date.now()): Error & { offline?: boolean; slow?: boolean; server?: boolean } {
  if (isTimeout(e) && reachedRecently(now)) {
    why.set('server');
    return Object.assign(new Error(MSG.slow), { slow: true, server: true });
  }
  why.set('phone');
  const net = /network request failed|failed to fetch/i.test(String(e?.message || ''));
  return Object.assign(new Error(net ? MSG.offline : MSG.noAnswer), { offline: true });
}

/** Whether screens should show the copy or timetable held on the phone instead of an error. */
export function showsKept(e: any): boolean {
  return !!(e && (e.offline || e.server || e.slow || e.http === 429 || (Number(e.http) >= 500 && Number(e.http) <= 599)));
}

/** The old server is asked again only when the new one cannot be reached at all: never after a timeout or an answer. */
export function legacyWorthy(e: any): boolean {
  if (!e || e.http || isTimeout(e)) return false;
  return /network request failed|failed to fetch|fetch failed/i.test(String(e?.message || ''));
}

/** Ask's words for a failed question: honest about where the fault is. */
export function askFailText(e: any): string {
  if (e?.offline && !e?.slow) return 'No connection right now. Check your signal and try again.';
  if (e?.slow) return "Live data is slow right now, so Ask couldn't answer in time. It's not your connection. Try again in a moment.";
  return "Transport for NSW's live data isn't answering right now, so Ask can't check that. It's not your connection. Try again soon.";
}

/** Under a Home trip card that shows timetable trips (the server's stand in while the Trip Planner is refused). */
export const TIMETABLE_TRIPS_NOTE = 'Timetable times. Live trips are unavailable right now.';
/** Under a Home stop card that shows the server's timetable board. */
export const TIMETABLE_BOARD_NOTE = 'Timetable times. Live times are unavailable right now.';

/**
 * The line on a Home trip card with nothing to show. "No more services today" only when a live answer truly had none:
 * a kept copy whose trips have all left, while the live answer failed or is still on its way, never says it (g16,
 * Bidur's 2:52 PM screenshot: "No more services today" while the Trip Planner refused us).
 */
export function tripNote(o: { data: boolean; error: string | null; offlineAt: number | null; staleAt: number | null; count: number; serverNote?: string | null; why: 'phone' | 'server' }): string {
  if (!o.data) return o.error ? 'Live trips unavailable right now, trying again' : 'Loading live times';
  if (o.count) return '';
  if (o.offlineAt) return o.why === 'server' ? 'Live trips unavailable right now' : 'No kept times left for today';
  if (o.error) return o.why === 'phone' ? 'No connection, no kept times left' : 'Live trips unavailable right now';
  if (o.staleAt) return 'Loading live times';
  return o.serverNote || 'No more services today';
}

/** The line on a stop board with no rows: "No more services right now" only from a live answer. */
export function boardNote(o: { offlineAt: number | null; error: string | null; staleAt: number | null; why: 'phone' | 'server' }): string {
  if (o.offlineAt) return o.why === 'server' ? 'Live times unavailable right now' : 'No kept times left';
  if (o.error) return o.why === 'phone' ? 'No connection, no kept times left' : 'Live times unavailable right now';
  if (o.staleAt) return 'Loading live times';
  return 'No more services right now';
}
