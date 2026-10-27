import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { apiBase, DEFAULT_BASE, nextBase, setApiBase, startBase } from './server';
import { cleanConfig, DEFAULTS, flagOn, type RemoteConfig } from './configCore';
import { homeBundle } from './homeBundle';
export { cleanConfig, flagOn };
export type { RemoteConfig };

// Remote config from /api/app/config?platform=android: feature switches and the server address.
// Read at launch and each time the app comes to the front; the last good copy is kept on the phone,
// and the built in defaults (every feature on) apply until the first answer.

let cfg: RemoteConfig = DEFAULTS;
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
const KEY = 'remoteConfig';
const BASE_KEY = 'apiBase';
/** Set once this install has started on the new server (server.ts startBase): a stored address is then used as it is. */
const MOVED_KEY = 'apiBaseMoved';

function emit() { listeners.forEach((l) => l()); }

/** Loads the last good config and server address from the phone. Runs before the first request. */
export async function loadCachedConfig() {
  try {
    const [raw, b, moved] = await Promise.all([AsyncStorage.getItem(KEY), AsyncStorage.getItem(BASE_KEY), AsyncStorage.getItem(MOVED_KEY)]);
    // A build from before the move stored the first server; this update starts on the new one (once).
    setApiBase(startBase(b, moved === '1'));
    if (moved !== '1') await AsyncStorage.setItem(MOVED_KEY, '1');
    if (raw) { cfg = cleanConfig(JSON.parse(raw)); emit(); }
    // The home screen widgets read the address from the same key (plugins/widget/kotlin/TransitApi.kt).
    if (b !== apiBase()) await AsyncStorage.setItem(BASE_KEY, apiBase());
  } catch {}
}

const CONFIG_READ = '/api/app/config?platform=android';

async function fetchFrom(base: string): Promise<any> {
  // Home's one request (homeBundleCore.ts) may carry the config: taken from it, else asked on its own.
  if (base === apiBase()) {
    homeBundle.note(CONFIG_READ, false);
    const got = await homeBundle.take(base, CONFIG_READ).catch(() => null);
    if (got) return got.body;
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(`${base}/api/app/config?platform=android`, { signal: ctl.signal });
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } finally { clearTimeout(t); }
}

/**
 * Fetches the config unless a fresh copy is held (configRefreshMin, 5 to 240). On an answer, applies its
 * api_base (see server.ts) and keeps it as the last good copy. If a moved address does not answer, the
 * default address is asked once, so a removed api_base can still bring the app back.
 */
const refreshEvery = () => Math.min(240, Math.max(5, cfg.timing.configRefreshMin || 30)) * 60000;

/** True when the next refreshConfig() would ask the server (the bundle on a return to the front carries it then). */
export function configDue(): boolean { return !fetchedAt || Date.now() - fetchedAt >= refreshEvery(); }

export function refreshConfig(force = false): Promise<void> {
  const every = refreshEvery();
  if (!force && fetchedAt && Date.now() - fetchedAt < every) return Promise.resolve();
  if (inflight) return inflight;
  inflight = (async () => {
    let raw: any;
    try { raw = await fetchFrom(apiBase()); } catch {
      if (apiBase() === DEFAULT_BASE) return;
      try { raw = await fetchFrom(DEFAULT_BASE); } catch { return; }
    }
    if (!raw || typeof raw !== 'object') return;
    fetchedAt = Date.now();
    cfg = cleanConfig(raw);
    const b = setApiBase(nextBase(raw, apiBase()));
    emit();
    try { await AsyncStorage.multiSet([[KEY, JSON.stringify(raw)], [BASE_KEY, b]]); } catch {}
  })().finally(() => { inflight = null; });
  return inflight;
}

export const getConfig = () => cfg;
export const isOn = (name: string) => flagOn(cfg, name);

/** Re-renders when the config changes. */
export function useConfig(): RemoteConfig {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => cfg, () => cfg);
}
export function useFlag(name: string): boolean {
  return flagOn(useConfig(), name);
}
