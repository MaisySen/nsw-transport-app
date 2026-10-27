// Tags on polled answers (network pass, 27 Oct, 9 PM): boards, services, live trip legs, trips, alerts, car parks, line
// status and trackwork are asked again every few seconds while on screen, and most asks bring back what the phone
// already holds. When the server says poll-tags (x-serves), the phone keeps the last answer per address with its tag
// (in memory only), sends the tag back as If-None-Match, and a 304 hands back the kept answer with the server clock
// from x-now. The server leaves only "now" out of its tag, so "dataAt" and every time in the answer are the same as
// the kept copy's: a 304 never makes kept times look newer. No phone dependencies, so the unit tests can load it.

/** Stop and place search ask with this: their answers are the same for everyone, so the server lets the phone's own
 * HTTP cache keep them for an hour (a word typed again is answered on the phone). No device or profile id rides along. */
export const PUBLIC_OK: Record<string, string> = { 'x-public-ok': '1' };

/** The x-serves word. */
export const POLL_TAGS = 'poll-tags';
/** Addresses asked again while on screen (the server's POLL_TAG_API). */
export const POLL_TAG_PATH = /^\/api\/(departures|service|status|trip|trip\/live|alerts|parking|lines|trackwork)(\?|$)/;
/** At most this many answers kept, this many characters each, this many in all. */
export const POLL_TAG_MAX_ENTRIES = 24;
export const POLL_TAG_MAX_CHARS = 256 * 1024;
export const POLL_TAG_MAX_TOTAL = 1024 * 1024;
/** A kept answer older than this is not offered (a screen left long ago gets a full answer). */
export const POLL_TAG_MAX_AGE_MS = 10 * 60000;

type Entry = { tag: string; text: string; at: number };

/** A usable tag from an ETag header, strong or weak, as sent. */
export function pollTag(v: string | null | undefined): string | null {
  if (!v || typeof v !== 'string') return null;
  const t = v.trim();
  return t.length <= 80 && /^(W\/)?"[^"]+"$/.test(t) ? t : null;
}

export function pollTagWorthy(path: string): boolean {
  return POLL_TAG_PATH.test(path);
}

/** The kept answer with the server clock of the 304 (x-now), or the phone's clock when the header is missing. */
export function withNow(text: string, xNow: string | null | undefined, fallback: number): any {
  const body = JSON.parse(text);
  const n = Number(xNow);
  if (body && typeof body === 'object' && !Array.isArray(body) && 'now' in body) body.now = Number.isFinite(n) && n > 0 ? n : fallback;
  return body;
}

/** The phone's kept polled answers, newest last; oldest dropped past the limits. */
export function createPollTags(maxEntries = POLL_TAG_MAX_ENTRIES, maxChars = POLL_TAG_MAX_CHARS, maxTotal = POLL_TAG_MAX_TOTAL) {
  const m = new Map<string, Entry>();
  let total = 0;
  const drop = (k: string) => { const e = m.get(k); if (e) { total -= e.text.length; m.delete(k); } };
  return {
    /** The tag to send for this address, or null. */
    tagFor(key: string, now: number): string | null {
      const e = m.get(key);
      if (!e) return null;
      if (now - e.at > POLL_TAG_MAX_AGE_MS || e.at > now + 60000) { drop(key); return null; }
      return e.tag;
    },
    /** The kept text for a 304, when its tag is the one sent. */
    textFor(key: string, sent: string | null): string | null {
      const e = m.get(key);
      return e && sent && e.tag === sent ? e.text : null;
    },
    /** A 304 counts as a fresh check. */
    touch(key: string, now: number) { const e = m.get(key); if (e) { m.delete(key); m.set(key, { ...e, at: now }); } },
    keep(key: string, tag: string | null, text: string, now: number) {
      drop(key);
      if (!tag || typeof text !== 'string' || text.length > maxChars) return;
      m.set(key, { tag, text, at: now });
      total += text.length;
      while (m.size > maxEntries || total > maxTotal) drop(m.keys().next().value as string);
    },
    forget(key: string) { drop(key); },
    clear() { m.clear(); total = 0; },
    size() { return m.size; },
    chars() { return total; },
  };
}

/** The one store the app's reads use (api.ts); Delete all my data clears it (offline.forgetOffline). */
export const pollTags = createPollTags();
