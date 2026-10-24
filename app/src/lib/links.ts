// Incoming links. transportsydney.app/trip/<share id>, /stop/<stop id> and /plan?from=..&to=.. open the app
// once the build carries App Links (Android) and Associated Domains (iPhone); this turns each into the
// app's own route. No imports, so the tests can load it as is.

/** Hosts whose links belong to the app. */
export const LINK_HOSTS: readonly string[] = ['transportsydney.app', 'www.transportsydney.app'];

const SHARE_ID = /^[A-Za-z0-9_-]{12,40}$/;
const STOP_ID = /^[A-Za-z0-9:_.-]{1,40}$/;
const PLACE_ID = /^[A-Za-z0-9:_.-]{1,40}$/;

export type LinkTarget =
  | { kind: 'trip'; id: string }
  | { kind: 'stop'; id: string }
  | { kind: 'plan'; from?: string; to?: string; fromName?: string; toName?: string }
  | { kind: 'home' };

function dec(s: string): string | null {
  try { return decodeURIComponent(s); } catch { return null; }
}

function query(q: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of q.replace(/^\?/, '').split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    const k = dec((i < 0 ? part : part.slice(0, i)).replace(/\+/g, ' '));
    const v = dec((i < 0 ? '' : part.slice(i + 1)).replace(/\+/g, ' '));
    if (k !== null && v !== null && !(k in out)) out[k] = v;
  }
  return out;
}

/**
 * What a transportsydney.app link points at, or null when the URL is not one of ours (another host, the
 * app's own scheme, or not a URL). Paths on our host that the app has no screen for give home.
 */
export function parseLink(url: unknown): LinkTarget | null {
  if (typeof url !== 'string') return null;
  const m = /^https:\/\/([^/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(url.trim());
  if (!m) return null;
  const host = m[1].toLowerCase().replace(/:443$/, '').replace(/\.$/, '');
  if (!LINK_HOSTS.includes(host)) return null;
  const parts = m[2].split('/').filter(Boolean);
  const q = query(m[3] || '');
  const head = (parts[0] || '').toLowerCase();
  if (head === 'trip' && parts.length === 2) {
    const id = dec(parts[1]);
    return id && SHARE_ID.test(id) ? { kind: 'trip', id } : { kind: 'home' };
  }
  if (head === 'stop' && parts.length === 2) {
    const id = dec(parts[1]);
    return id && STOP_ID.test(id) ? { kind: 'stop', id } : { kind: 'home' };
  }
  if (head === 'plan' && parts.length === 1) {
    const from = q.from && PLACE_ID.test(q.from) ? q.from : undefined;
    const to = q.to && PLACE_ID.test(q.to) ? q.to : undefined;
    const name = (v?: string) => {
      const n = (v || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80);
      return n || undefined;
    };
    const fromName = from ? name(q.fromName) : undefined;
    const toName = to ? name(q.toName) : undefined;
    return { kind: 'plan', ...(from ? { from } : {}), ...(to ? { to } : {}), ...(fromName ? { fromName } : {}), ...(toName ? { toName } : {}) };
  }
  return { kind: 'home' };
}

/** The app route for a link target. */
export function routeFor(t: LinkTarget): string {
  switch (t.kind) {
    case 'trip': return `/shared/${encodeURIComponent(t.id)}`;
    case 'stop': return `/stop/${encodeURIComponent(t.id)}`;
    case 'plan': {
      const pairs: [string, string | undefined][] = [['from', t.from], ['to', t.to], ['fromName', t.fromName], ['toName', t.toName]];
      const q = pairs.filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&');
      return q ? `/plan?${q}` : '/plan';
    }
    default: return '/';
  }
}

/**
 * The path the router should open for an incoming URL or path: our https links become app routes, and
 * everything else (the app's own scheme, notification paths) is passed on unchanged.
 */
export function systemPath(path: string): string {
  const t = parseLink(path);
  return t ? routeFor(t) : path;
}
