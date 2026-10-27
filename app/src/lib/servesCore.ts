// What the server in use says it can do (speed pass part 2, 27 Oct). Every /api answer from a server that has the
// newer paths carries an x-serves header, a comma list of words; root can also switch words on through the app
// config (copy.serves). The phone uses a newer path only while one of the two says so, and keeps today's calls
// otherwise. A good /api answer without the header turns the words off again, so a server rolled back is followed.
// No phone dependencies, so the unit tests can load it.

export const SERVES_HEADER = 'x-serves';
/** device and profile ride as x-device and x-profile headers, not in the address (shared edge cache keys). */
export const ID_HEADERS = 'id-headers';
/** GET /api/trip/live?legs= re-times trips the phone holds by trip id, from the feeds, with no planner call. */
export const TRIP_LIVE = 'trip-live';
/** GET /api/home?p=... answers several of Home's reads in one request (homeBundleCore.ts). */
export const HOME_BUNDLE = 'home-bundle';

/** The words in an x-serves header (lower case, at most 24, each at most 32 characters). */
export function parseServes(v: string | null | undefined): string[] {
  if (!v || typeof v !== 'string') return [];
  const out: string[] = [];
  for (const raw of v.split(',')) {
    const w = raw.trim().toLowerCase();
    if (w && w.length <= 32 && /^[a-z0-9._-]+$/.test(w) && !out.includes(w)) out.push(w);
    if (out.length >= 24) break;
  }
  return out;
}

/** The words root turned on in the app config (copy.serves: an array or a comma list). */
export function configServes(cfg: { copy?: Record<string, any> } | null | undefined): string[] {
  const v = cfg?.copy?.serves;
  if (Array.isArray(v)) return parseServes(v.filter((x) => typeof x === 'string').join(','));
  return typeof v === 'string' ? parseServes(v) : [];
}

export type ServesState = Record<string, string[]>;

/**
 * Words per server address. note() reads one answer: only a 2xx answer to an /api path counts (an error, a static file
 * or a 304 says nothing about the server's paths). has() is true when the address said the word last time, or the
 * config has it. changed tells the caller to keep the new state on the phone.
 */
export function createServes(initial: ServesState = {}) {
  let state: ServesState = { ...initial };
  return {
    note(base: string, path: string, status: number, header: string | null | undefined): boolean {
      if (!(status >= 200 && status < 300) || !/^\/api\//.test(path)) return false;
      const words = parseServes(header);
      const old = state[base] || [];
      if (old.length === words.length && old.every((w, i) => w === words[i])) return false;
      state = { ...state, [base]: words };
      return true;
    },
    has(word: string, base: string, cfgWords: string[] = []): boolean {
      return (state[base] || []).includes(word) || cfgWords.includes(word);
    },
    load(s: ServesState | null | undefined) {
      if (!s || typeof s !== 'object') return;
      const clean: ServesState = {};
      for (const [k, v] of Object.entries(s)) if (typeof k === 'string' && Array.isArray(v)) clean[k] = parseServes(v.join(','));
      // A word learnt this session wins over the kept copy.
      state = { ...clean, ...state };
    },
    snapshot: (): ServesState => ({ ...state }),
  };
}

/**
 * Where a request's device and profile go: headers when the server reads them there, else the address as before.
 * Returns the path to ask and the headers to add.
 */
export function placeIds(path: string, ids: { device?: string | null; profile?: string | null } | undefined, asHeaders: boolean): { path: string; headers: Record<string, string> } {
  if (!ids) return { path, headers: {} };
  const dev = ids.device ? String(ids.device) : '', prof = ids.profile ? String(ids.profile) : '';
  if (asHeaders) {
    const headers: Record<string, string> = {};
    if (dev) headers['x-device'] = dev;
    if (prof) headers['x-profile'] = prof;
    return { path, headers };
  }
  const q = [dev ? `device=${encodeURIComponent(dev)}` : '', prof ? `profile=${encodeURIComponent(prof)}` : ''].filter(Boolean).join('&');
  return { path: q ? `${path}${path.includes('?') ? '&' : '?'}${q}` : path, headers: {} };
}
