// iPhone, build 205 and later: hands the trip card's push token to the server, which then updates the card with
// live times every minute while the phone is locked, and ends it on arrival. Also saves this phone's push token
// for alerts later (none are sent yet). Older builds have no push token, so nothing here runs on them.
import { Platform } from 'react-native';
import { getDevice } from '@/lib/device';
import { iosNative } from '../modules/transport-ios';
import type { LiveTrip } from '@/lib/live';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cleanToken, PUSH_BASE, PUSH_FORGOTTEN_KEY, pushKey, pushTrip, shouldSendDeviceToken } from './livePushCore';

async function post(path: string, body: unknown): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(PUSH_BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

let sentKey = '';
let sending = false;

/** Tells the server the card's token and trip. Repeats only when something it needs has changed. */
export async function sendActivityToken(activityId: string, token: string | null, g: LiveTrip | null) {
  const tok = cleanToken(token);
  if (Platform.OS !== 'ios' || !tok || !g || sending) return;
  const key = pushKey(tok, g);
  if (key === sentKey) return;
  sending = true;
  try {
    const ok = await post('/api/live-activity', { token: tok, activity: activityId, device: await getDevice(), trip: pushTrip(g) });
    if (ok) sentKey = key;
  } finally {
    sending = false;
  }
}

/** The trip ended on the phone: the server stops updating the card. */
export async function endActivityToken(token: string | null) {
  const tok = cleanToken(token);
  sentKey = '';
  if (Platform.OS !== 'ios' || !tok) return;
  await post('/api/live-activity/end', { token: tok });
}

let deviceSent = false;
/**
 * Saves this phone's push token on the server for alerts later. Only when notifications are already allowed,
 * so it never asks for permission on its own, and not after Delete all my data until alerts are turned on again.
 */
export async function sendDeviceToken() {
  if (Platform.OS !== 'ios' || deviceSent || !iosNative.activityPush()) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const N = require('expo-notifications');
    const p = await N.getPermissionsAsync();
    // Not after Delete all my data, until alerts are turned on again (push.ts enablePush clears the mark).
    const forgotten = await AsyncStorage.getItem(PUSH_FORGOTTEN_KEY).catch(() => null);
    if (!shouldSendDeviceToken(!!p?.granted, forgotten)) return;
    const t = await N.getDevicePushTokenAsync();
    const tok = cleanToken(t?.data);
    if (!tok) return;
    deviceSent = await post('/api/apns/device', { token: tok, device: await getDevice(), env: 'production' });
  } catch {}
}
