// Live board pushes (server /api/live, ENGINE_PUSH): what the app does with each message, with no phone dependencies so
// the unit tests can load it. The server sends the whole board first ({ type: 'board' }), then a diff each time the
// board's shard rebuilds it ({ type: 'diff' }, engPushDiff in backend/src/engine.js).

export type PushDiff = { type: 'diff'; base: number; builtAt: number; head: any; rows: Record<string, any>; gone: string[]; order?: string[] };
export type PushMsg = { type: 'board'; board: any } | PushDiff;

/** A row's key, the same as the server's (trip, stop, planned time). */
export const pushKey = (it: any) => `${it?.tripId || it?.line}|${it?.stopId}|${it?.planned}`;

/** Fields the HTTP board adds that a pushed row may not carry (the usual delay line): kept from the row on screen. */
function carry(prev: any[] | undefined, items: any[]): any[] {
  if (!prev || !prev.length) return items;
  const old = new Map(prev.map((i) => [pushKey(i), i]));
  return items.map((i) => {
    const o = old.get(pushKey(i));
    return o && o.pred && !i.pred ? { ...i, pred: o.pred } : i;
  });
}

/** The board answer a pushed board stands for: the same shape as /api/departures. */
function asAnswer(board: any, now: number): any {
  // A Trip Planner board from the live hub (backend/src/livehub.js) says when its copy was made (dataAt).
  const dataAt = Number(board.dataAt) || (board.live && board.live.feedAt) || (board.engine && board.engine.builtAt) || now;
  return { kind: 'departures', ...board, dataAt, now, pushed: true };
}

/**
 * The board after a message: a whole board, or the board on screen with the diff applied. needFull when the diff is
 * not for the board on screen (the phone then sends "full"); null board for a message it cannot read.
 */
export function applyPush(cur: any | null, msg: any, now: number = Date.now()): { board: any | null; needFull: boolean } {
  if (!msg || typeof msg !== 'object') return { board: null, needFull: false };
  if (msg.type === 'board' && msg.board && Array.isArray(msg.board.items)) {
    return { board: asAnswer({ ...msg.board, items: carry(cur?.items, msg.board.items) }, now), needFull: false };
  }
  if (msg.type !== 'diff') return { board: null, needFull: false };
  const builtAt = cur && cur.pushed && cur.engine ? cur.engine.builtAt : null;
  if (builtAt == null || builtAt !== msg.base || !Array.isArray(cur.items)) return { board: null, needFull: true };
  const rows = new Map<string, any>(cur.items.map((i: any) => [pushKey(i), i]));
  for (const k of msg.gone || []) rows.delete(k);
  for (const [k, row] of Object.entries(msg.rows || {})) rows.set(k, row);
  const order: string[] = Array.isArray(msg.order) ? msg.order : cur.items.map(pushKey);
  const items = order.map((k) => rows.get(k)).filter(Boolean);
  return { board: asAnswer({ ...(msg.head || {}), items: carry(cur.items, items) }, now), needFull: false };
}

/** The socket address for a stop's board on this server (https becomes wss). */
export function pushUrl(base: string, stop: string, mode?: string | null): string {
  return `${base.replace(/^http/, 'ws')}/api/live?stop=${encodeURIComponent(stop)}${mode ? `&mode=${encodeURIComponent(mode)}` : ''}`;
}

/** Waits before opening the socket again after it closed; null: stop trying for this screen (polling carries on). */
export const PUSH_RETRY_MS = [2000, 10000, 30000];
export const retryDelay = (n: number): number | null => (n < PUSH_RETRY_MS.length ? PUSH_RETRY_MS[n] : null);

/** The push is off unless the server's remote config says livePush: true (unknown flags are on elsewhere, not here). */
export const pushFlagOn = (c: { flags?: Record<string, boolean>; kill?: Record<string, string> } | null | undefined) => !!c && !!c.flags && c.flags.livePush === true && !(c.kill && c.kill.livePush);

/** With a socket open the HTTP board is a safety net: asked at most once a minute. */
export const PUSH_POLL_MS = 60000;
export const pollGapWithPush = (gap: number, live: boolean) => (live ? Math.max(gap, PUSH_POLL_MS) : gap);
