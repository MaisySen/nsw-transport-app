// A trip's registrations with the server, sent until the server has them (1 Nov 2026, real-time harness #2 to #4:
// files/day-1nov/rt-harness.md). Start trip registers the trip watch (the server's alerts, Get off now among them) and
// the Lock Screen card's push token; both went once, from JavaScript, and a phone locked or with no signal at that
// moment kept a frozen card and no server alerts for the whole trip. Now each registration has a key the phone makes,
// is asked again with backoff until a 2xx says the server has it (the server keeps one watch per key), and on iPhone a
// copy waits in the app's native queue (TripOutbox.swift, a background upload Apple runs while the phone is locked and
// the app suspended, and the widgets' timeline) in case JavaScript is suspended first. End trip sends its stop the same
// way. Pure: no React Native, so the real-time harness runs this same code (tools/rt-harness).

/** Seconds between tries: 5 s, 15 s, 30 s, 1 min, 2 min, then every 5 min (battery first: one request each). */
export const REG_BACKOFF_S = [5, 15, 30, 60, 120, 300];
/** A try that timed out may have reached the server: asked again soon with the same key, the server says which. */
export const REG_UNKNOWN_S = 5;
/** The native copy waits this long for JavaScript's own try (which normally lands first and takes it back). */
export const REG_NATIVE_DELAY_S = 20;
/** Never past this after Start trip (a trip watch lives 3 h past its planned arrival on the server anyway). */
export const REG_MAX_MS = 4 * 3600000;

export type RegOutcome = 'ok' | 'retry' | 'unknown' | 'gone';

/**
 * What an answer means. 2xx: the server has it. A time out: unknown (the server may have it and still be working).
 * No connection, 408, 429 or 5xx: try again. Any other 4xx: the server will never take this body, so stop.
 */
export function regOutcome(status: number | 'timeout' | 'offline' | null | undefined): RegOutcome {
  if (status === 'timeout') return 'unknown';
  if (typeof status !== 'number' || !Number.isFinite(status) || status <= 0) return 'retry';
  if (status >= 200 && status < 300) return 'ok';
  if (status === 408 || status === 429 || status >= 500) return 'retry';
  return 'gone';
}

/** Milliseconds to wait before try number `tries + 1` (tries already made, from 1). */
export function regBackoffMs(tries: number): number {
  const i = Math.max(0, Math.min(REG_BACKOFF_S.length - 1, Math.floor(tries) - 1));
  return REG_BACKOFF_S[i] * 1000;
}

/** When to try again after `tries` tries ending in `outcome`; null: done (ok or gone) or past REG_MAX_MS. */
export function regNextAt(tries: number, outcome: RegOutcome, now: number, startedAt: number): number | null {
  if (outcome === 'ok' || outcome === 'gone') return null;
  if (now - startedAt > REG_MAX_MS) return null;
  return now + (outcome === 'unknown' ? REG_UNKNOWN_S * 1000 : regBackoffMs(tries));
}

/**
 * The phone's key for a trip's registrations: the live trip's id with the end of the install id, letters, digits,
 * - and _ only, 6 to 64 characters (the server's watchKeyOf). The same trip always gives the same key.
 */
export function regKeyFor(tripId: string, device: string): string {
  const d = String(device || '').replace(/[^A-Za-z0-9]/g, '').slice(-12);
  const k = `${String(tripId || '').replace(/[^A-Za-z0-9_-]/g, '')}-${d}`.slice(0, 64);
  return k.length >= 6 ? k : (k + '------').slice(0, 6);
}

/**
 * A server that keeps one watch per key says the key back. Only such a server is asked again after a time out: an
 * older one would make a second watch (two Get off now alerts), so with it a time out is left as it is.
 */
export function serverKeepsKeys(answer: any, key: string): boolean {
  return !!answer && typeof answer === 'object' && !!answer.watch && answer.watch.key === key;
}

/**
 * The phone's own Get off now stays only while the server's is not confirmed: once the server said it sends Get off
 * now for this trip (getOff true), the phone's come off (one voice). A time out is not a no: it is asked again.
 */
export function keepPhoneGetOff(acked: boolean, serverGetOff: boolean): boolean {
  return !(acked && serverGetOff);
}

export type OutboxEntry = {
  /** watch, card or stop: one of each kind at a time; a new one replaces the old. */
  kind: 'watch' | 'card' | 'stop';
  method: 'POST' | 'DELETE';
  /** Path on the API server, with its query. */
  path: string;
  body?: string;
  /** Not before (ms since 1970): the native copy of a JavaScript try waits REG_NATIVE_DELAY_S. */
  after: number;
  /** Given up at (ms). */
  until: number;
  /** Local notifications to take off when the server says yes with getOff true (the phone's Get off now). */
  offNotes?: string[];
};

/** The native queue's copy of the trip watch registration (sent by itself if JavaScript has not heard back first). */
export function watchEntry(body: Record<string, unknown>, now: number, offNotes: string[] = []): OutboxEntry {
  return { kind: 'watch', method: 'POST', path: '/api/watch', body: JSON.stringify(body), after: now + REG_NATIVE_DELAY_S * 1000, until: now + REG_MAX_MS, ...(offNotes.length ? { offNotes } : {}) };
}

/** End trip: stop the server's alerts by the key (and the id when known), sent until the server answers. */
export function stopEntry(device: string, key: string, id: string | null, now: number): OutboxEntry {
  const q = [`device=${encodeURIComponent(device)}`, `key=${encodeURIComponent(key)}`, ...(id ? [`id=${encodeURIComponent(id)}`] : [])].join('&');
  return { kind: 'stop', method: 'DELETE', path: `/api/watch?${q}`, after: now, until: now + 6 * 3600000 };
}
