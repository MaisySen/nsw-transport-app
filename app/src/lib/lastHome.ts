// Last way home reminder on the phone: the current reminder, set and cancel. The server sends the push (iPhone);
// Android builds without server push show it on Home. A server without /api/last-home (404) hides the feature.
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiBase } from './server';
import { getDevice } from './device';
import type { LastHomeItem } from './lastHomeCore';

type State = { base: string; available: boolean | null; item: LastHomeItem | null; push: { web: number; expo: number } | null; at: number };
let state: State = { base: '', available: null, item: null, push: null, at: 0 };
const listeners = new Set<() => void>();
const KEY = 'lastHome';
function set(s: Partial<State>) {
  state = { ...state, ...s };
  listeners.forEach((l) => l());
  AsyncStorage.setItem(KEY, JSON.stringify({ item: state.item, base: state.base })).catch(() => {});
}

async function call(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(apiBase() + path, { ...init, signal: ctl.signal, headers: init?.body ? { 'content-type': 'application/json' } : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  } finally { clearTimeout(t); }
}

/** Shows the last known reminder at once, before the server answers. */
export async function loadCachedLastHome() {
  try { const raw = await AsyncStorage.getItem(KEY); if (raw) { const v = JSON.parse(raw); if (v?.base === apiBase()) state = { ...state, item: v.item || null }; } } catch {}
}

/** Reads the reminder from the server (at most every 30 s unless forced). Marks the feature missing on a 404. */
export async function refreshLastHome(force = false) {
  const base = apiBase();
  if (state.base === base && state.available === false) return;
  if (!force && state.base === base && Date.now() - state.at < 30000) return;
  try {
    const r = await call(`/api/last-home?device=${encodeURIComponent(await getDevice())}`);
    if (r.status === 404) { set({ base, available: false, item: null, at: Date.now() }); return; }
    if (r.status >= 400) return;
    set({ base, available: r.body?.enabled !== false, item: r.body?.item || null, push: r.body?.push || null, at: Date.now() });
  } catch { /* offline: keep what we had */ }
}

export type SetResult = { ok: true; item: LastHomeItem; push: { web: number; expo: number } } | { ok: false; missing?: boolean; error: string };

/** Asks for the reminder. The server picks the last service itself and may answer that it is too soon or gone. */
export async function remindLastHome(from: { id: string; name: string }, to: { id: string; name: string }, mode: string | null, acc = false): Promise<SetResult> {
  const base = apiBase();
  try {
    const r = await call('/api/last-home', { method: 'POST', body: JSON.stringify({ device: await getDevice(), from, to, mode, acc }) });
    if (r.status === 404) { set({ base, available: false }); return { ok: false, missing: true, error: 'Reminders are not available yet.' }; }
    if (r.status >= 400 || !r.body?.item) return { ok: false, error: r.body?.error || `Something went wrong (${r.status})` };
    set({ base, available: true, item: r.body.item, push: r.body.push || null, at: Date.now() });
    return { ok: true, item: r.body.item, push: r.body.push || { web: 0, expo: 0 } };
  } catch {
    return { ok: false, error: 'No answer from the server. Check your connection.' };
  }
}

export async function cancelLastHome(): Promise<boolean> {
  try {
    const r = await call(`/api/last-home?device=${encodeURIComponent(await getDevice())}`, { method: 'DELETE' });
    if (r.status >= 400) return false;
    set({ item: null, at: Date.now() });
    return true;
  } catch { return false; }
}

/** Delete all data: the server removes it with scope all; this forgets it on the phone. */
export function clearLastHomeLocal() { set({ item: null, push: null, at: 0 }); }

export function useLastHome(): State {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state, () => state);
}
