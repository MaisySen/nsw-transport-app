// The one place the server address is written. Remote config can move the app to another address
// (copy.api_base, or a top level api_base) without a new build, but only to https on an allowed domain.

/** The server address in use today, until remote config moves the app (the only place it is written). */
export const DEFAULT_HOST = 'nsw-transport-bot.sites.tab.bot';
export const DEFAULT_BASE = `https://${DEFAULT_HOST}`;
/** The new home: public pages (privacy, support) and, once it answers, the API at api.transportsydney.app. */
export const SITE = 'https://transportsydney.app';
export const PRIVACY_URL = `${SITE}/privacy`;
export const SUPPORT_URL = `${SITE}/support`;
/** The link sent by Share trip: transportsydney.app/trip/<share id> (the site shows the live trip). */
export const shareLink = (id: string) => `${SITE}/trip/${encodeURIComponent(id)}`;
/** The new API host. Plan's place search (addresses, streets, landmarks) asks it even before the app moves there. */
export const NEW_API_BASE = 'https://api.transportsydney.app';
/** Hosts the app may move to (each, or a subdomain of it): the one in use today and the new API host. */
export const ALLOWED_DOMAINS: readonly string[] = [DEFAULT_HOST, 'api.transportsydney.app'];

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
