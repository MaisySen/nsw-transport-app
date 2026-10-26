// The one place the server addresses are written. Remote config can move the app to another address
// (copy.api_base, or a top level api_base) without a new build, but only to https on an allowed domain.

/** The server the app reads from: api.transportsydney.app (Cloudflare, with a 15 s shared cache). */
export const NEW_API_BASE = 'https://api.transportsydney.app';
export const DEFAULT_HOST = 'api.transportsydney.app';
export const DEFAULT_BASE = NEW_API_BASE;
/**
 * The first server, used until 26 Oct 2026. It keeps running for builds that have not taken the update, and a read
 * that the new server cannot answer (no connection to it, or a 5xx) is asked there once (readFallback below).
 */
export const LEGACY_HOST = 'nsw-transport-bot.sites.tab.bot';
export const LEGACY_BASE = `https://${LEGACY_HOST}`;
/** The new home: public pages (privacy, support). */
export const SITE = 'https://transportsydney.app';
export const PRIVACY_URL = `${SITE}/privacy`;
export const SUPPORT_URL = `${SITE}/support`;
/** The link sent by Share trip: transportsydney.app/trip/<share id> (the site shows the live trip). */
export const shareLink = (id: string) => `${SITE}/trip/${encodeURIComponent(id)}`;
/** Hosts the app may move to (each, or a subdomain of it): the new API host and the first server. */
export const ALLOWED_DOMAINS: readonly string[] = [DEFAULT_HOST, LEGACY_HOST];

const hostOf = (base: string) => base.replace(/^https:\/\//, '');

/**
 * "https://api.example.com" from a remote value, or null when it is not allowed: https only, a bare host
 * (no user name, port, path, query or fragment), and the host is the one in use now or on an allowed domain.
 */
export function validBase(v: unknown, current: string = DEFAULT_BASE): string | null {
  if (typeof v !== 'string') return null;
  const m = /^https:\/\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)\/?$/.exec(v.trim().toLowerCase());
  if (!m) return null;
  const host = m[1];
  if (host.length > 253) return null;
  const now = hostOf(current);
  const ok = host === now || ALLOWED_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
  return ok ? `https://${host}` : null;
}

/** The api_base a config carries: copy.api_base first, then a top level api_base. undefined when neither is set. */
export function baseInConfig(cfg: any): unknown {
  if (!cfg || typeof cfg !== 'object') return undefined;
  const c = cfg.copy && typeof cfg.copy === 'object' ? cfg.copy.api_base : undefined;
  if (c !== undefined && c !== null && c !== '') return c;
  const t = cfg.api_base;
  return t !== undefined && t !== null && t !== '' ? t : undefined;
}

/**
 * The address to use after a config answer: its api_base when valid, the default when the config no longer
 * sets one, and the current address when the value is not allowed (the last good value stays).
 */
export function nextBase(cfg: any, current: string = DEFAULT_BASE): string {
  const v = baseInConfig(cfg);
  if (v === undefined) return DEFAULT_BASE;
  return validBase(v, current) || current;
}

let base = DEFAULT_BASE;
/** The address every request goes to. */
export const apiBase = () => base;
/** Sets the address; anything not allowed is ignored. Returns the address in use. */
export function setApiBase(v: unknown): string {
  const ok = validBase(v, base);
  if (ok) base = ok;
  return base;
}

/**
 * A phone that ran a build from before the move has the first server stored as its address (config.ts keeps the
 * address in use). The first launch on this update starts on the new server instead; after that a stored address is
 * used as it is, so remote config can still move the app back (docs/DEPLOY_CLOUDFLARE.md, Undo).
 */
export function startBase(stored: string | null | undefined, movedBefore: boolean): string {
  if (!stored) return DEFAULT_BASE;
  if (!movedBefore && validBase(stored, DEFAULT_BASE) === LEGACY_BASE) return DEFAULT_BASE;
  return validBase(stored, DEFAULT_BASE) || DEFAULT_BASE;
}

// Fallback for reads (docs/DIAGNOSIS_LAG.md item 5, 26 Oct): only when the new server cannot be reached at all (no
// route, DNS, TLS) is the same read asked of the first server, once. Never after a time out or an error answer: those
// come from Transport for NSW's live data, which the first server waits on too, so a fallback only doubled the wait.
// No hold: the next read asks the new server again. Writes never fall back: saves stay in one place.
export const FALLBACK_HOLD_MS = 0;
let newDownUntil = 0;

/** True only for a failure to reach the new server at all. Never an answer (any status) and never a time out. */
export function fallbackWorthy(e: any): boolean {
  if (!e || e.http || e.name === 'AbortError') return false;
  const m = String(e.message || '');
  if (/timed? ?out|cancel/i.test(m)) return false;
  return /network request failed|failed to fetch|fetch failed/i.test(m);
}

// How getJson words a failure: api.ts passes netErrCore.ts's (setErrorWords), so this file stays free of imports for
// the tests that load it alone. The defaults never show a status code either.
let words: { http: (status: number, body: any) => Error; noAnswer: (e: any) => Error; reach: () => void } = {
  http: (status, body) => Object.assign(new Error((body && (body.error || body.text)) || "Live data isn't available right now. Try again soon."), { http: status }),
  noAnswer: (e) => e,
  reach: () => {},
};
export function setErrorWords(w: typeof words) { words = w; }

/** Where a read goes first: the first server while a recent fallback holds, else the address in use. */
export function readBase(now: number = Date.now()): string {
  return base === NEW_API_BASE && now < newDownUntil ? LEGACY_BASE : base;
}

/** The address to ask again after `failedBase` failed, or null when there is none (the app is not on the new server). */
export function fallbackFor(failedBase: string): string | null {
  return base === NEW_API_BASE && failedBase === NEW_API_BASE ? LEGACY_BASE : null;
}

/** Records how a fallback went: worked holds reads on the first server for FALLBACK_HOLD_MS; a new server answer ends the hold. */
export function noteFallback(worked: boolean, now: number = Date.now()) {
  newDownUntil = worked ? now + FALLBACK_HOLD_MS : 0;
}
export function noteNewServerOk() { newDownUntil = 0; }
export const fallbackHeld = (now: number = Date.now()) => base === NEW_API_BASE && now < newDownUntil;

/**
 * GET `path` from the server in use, with the same fallback as api.ts reads. For the few screens that fetch on their
 * own (trip lists, Ask). Throws the first server's error when both fail.
 */
/** getJson's answer when the phone sent a version tag (If-None-Match) and the server said its copy is the same (304). */
export const NOT_MODIFIED: any = Object.freeze({ notModified: true });

export async function getJson<T = any>(path: string, timeoutMs = 15000, signal?: AbortSignal, cond?: { tag?: string | null; onTag?: (etag: string | null) => void }): Promise<T> {
  const ask = async (b: string): Promise<T> => {
    const ctl = new AbortController();
    const stop = () => ctl.abort();
    signal?.addEventListener('abort', stop);
    const t = setTimeout(stop, timeoutMs);
    try {
      // Static data (etag.ts): the kept copy's version tag rides along, and 304 means keep using it.
      const r = await fetch(b + path, cond?.tag ? { signal: ctl.signal, headers: { 'if-none-match': cond.tag } } : { signal: ctl.signal });
      if (r.status === 304 && cond?.tag) { words.reach(); return NOT_MODIFIED as T; }
      const body = await r.json().catch(() => ({}));
      words.reach();
      if (!r.ok) throw words.http(r.status, body);
      try { cond?.onTag?.(r.headers?.get?.('etag') ?? null); } catch { /* no headers */ }
      return body as T;
    } finally { clearTimeout(t); signal?.removeEventListener('abort', stop); }
  };
  const first = readBase();
  try {
    try {
      const v = await ask(first);
      if (first === NEW_API_BASE) noteNewServerOk();
      return v;
    } catch (e: any) {
      const alt = fallbackFor(first);
      if (!alt || signal?.aborted || !fallbackWorthy(e)) throw e;
      try { const v = await ask(alt); noteFallback(true); return v; } catch (e2) { noteFallback(false); throw e2; }
    }
  } catch (e: any) {
    // No answer: offline or slow, in words that say which (netErrCore.ts). A cancel by the caller stays as it is.
    if (!signal?.aborted && !e?.http) throw words.noAnswer(e);
    throw e;
  }
}
