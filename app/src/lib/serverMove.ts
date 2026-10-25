// Moving a phone to the new server (26 Oct 2026). The data copy between the two servers was made on 25 Oct; what this
// phone saved on the first server after that is carried over by the phone itself, once, after the first launch on
// the new server: its own saved trips (kept on the phone, device.ts), its push token (so alerts reach it from the new
// server) and its morning checks (moved: copied to the new server, then this phone's checks are deleted on the first
// server, so both servers' minute ticks never send the same morning alert twice). Nothing else is deleted there.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { api } from './api';
import { finishProfileMove, getDevice } from './device';
import { PUSH_FORGOTTEN_KEY } from './forgetTokens';
import { apiBase, LEGACY_BASE, NEW_API_BASE } from './server';
import { morningToCopy, type MorningLike } from './serverMoveCore';

const DONE_KEY = 'serverMoveDone';

async function legacyMorning(device: string): Promise<MorningLike[] | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(`${LEGACY_BASE}/api/morning-check?device=${encodeURIComponent(device)}`, { signal: ctl.signal });
    if (r.status === 404) return [];
    if (!r.ok) return null;
    const d = await r.json();
    return Array.isArray(d?.items) ? d.items : [];
  } catch {
    return null;
  } finally { clearTimeout(t); }
}

async function legacyMorningDelete(device: string): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(`${LEGACY_BASE}/api/morning-check?device=${encodeURIComponent(device)}`, { method: 'DELETE', signal: ctl.signal });
    return r.ok || r.status === 404;
  } catch {
    return false;
  } finally { clearTimeout(t); }
}

/** Runs a moment after launch (with finishProfileMove). Marks itself done only when every step worked; else next launch. */
export async function finishServerMove(): Promise<void> {
  try {
    if (apiBase() !== NEW_API_BASE) return;
    if ((await AsyncStorage.getItem(DONE_KEY)) === '1') return;
    const device = await getDevice();
    // Saved trips: the phone's own list is saved again under its profile (the same step as a profile move).
    await AsyncStorage.setItem('profileReupload', '1');
    await finishProfileMove(api);
    if ((await AsyncStorage.getItem('profileReupload')) === '1') return;
    // Push token: only when alerts are on and the person has not asked for the token to be forgotten.
    const [tok, forgot] = await Promise.all([AsyncStorage.getItem('expoPushToken'), AsyncStorage.getItem(PUSH_FORGOTTEN_KEY)]);
    if (tok && forgot !== '1') await api.registerExpo(tok, Platform.OS, false);
    // Morning checks saved on the first server and not on the new one.
    const old = await legacyMorning(device);
    if (old == null) return;
    if (old.length) {
      const now = await api.morningList();
      for (const body of morningToCopy(old, (now as any)?.items || [], Number((now as any)?.max) || 5)) await api.morningSave(body as any);
      if (!(await legacyMorningDelete(device))) return;
    }
    await AsyncStorage.setItem(DONE_KEY, '1');
  } catch {
    // offline or a server said no: try again next launch
  }
}
