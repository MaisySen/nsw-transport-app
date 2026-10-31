// Live trip freshness (29 Oct): two small rules the live trip engine and the iPhone trip card follow. Pure, so they are
// unit tested (test/livefresh.test.mjs). Both run on every build (201 and later): no native code is involved.

/**
 * The /api/service ask for one leg of the trip you are on. The first ask for a leg takes the server's copy at once (the
 * screen has something to show); every ask after it, while the app holds an answer for that leg, is a refresh
 * (refresh=1): the server answers from the live feed, or a copy at most 5 seconds old, and waits at most 0.7 s for it.
 * Before 29 Oct every ask was a plain open, which takes a copy up to a minute old at once, so the trip screen, the
 * get off alert and the trip card ran 15 to 45 seconds behind the live feed.
 */
export function liveServiceQuery<T extends Record<string, string | undefined>>(q: T, held: boolean, o: { board?: boolean } = {}): T & { refresh?: string; board?: string } {
  const r: T & { refresh?: string; board?: string } = held ? { ...q, refresh: '1' } : { ...q };
  if (o.board) r.board = '1';
  return r;
}

/**
 * Trip flow 2 (31 Oct): whether the ask for a leg also asks for the boarding stop's departure board row (board=1), so
 * the open app counts to the same board live time and shows the same live platform as the server's card (G19, G21,
 * I6). Only before the train has left (not ridden yet) and inside the server's board window (planned under 45 min
 * ahead, under 30 min past), so it costs one shared board read per stop per 14 s and only while waiting.
 */
export function wantsBoard(planned: string | undefined | null, ridden: boolean, now: number): boolean {
  if (ridden || !planned) return false;
  const p = new Date(planned).getTime();
  return Number.isFinite(p) && p - now < 45 * 60000 && p > now - 30 * 60000;
}

/** How recent the app's own live times must be for it to write the trip card when it comes back to the front. */
export const CARD_FRONT_FRESH_MS = 20000;

/**
 * Whether the app may write the trip card now. Going to the background it always may (its last word on the card).
 * While the server is updating the card by push (a push token was sent), the app writes it only from live times it got
 * in the last 20 seconds: back in front after a while, its own times are older than what the server last pushed, and
 * writing them made the card jump back (and often show "Updated" at once) until the engine's next answer, a moment
 * later. Without push (builds 201 to 204, or no token yet) the app is the only writer and always may.
 */
export function appMayWriteCard(o: { background: boolean; pushing: boolean; lastSvcAt: number; now: number }): boolean {
  if (o.background || !o.pushing) return true;
  return o.lastSvcAt > 0 && o.now - o.lastSvcAt >= 0 && o.now - o.lastSvcAt <= CARD_FRONT_FRESH_MS;
}
