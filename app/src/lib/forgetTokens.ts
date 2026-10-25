// Delete all my data, part two: the iPhone trip card tokens and the phone push token live on the push server
// (api.transportsydney.app) whichever address the rest of the app uses, so they are deleted there too.
// A server without the route (404) is skipped quietly; logic in platform/livePushCore.ts (test/forgettokens.test.mjs).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDevice } from './device';
import { apiBase } from './server';
import { FORGET_PATH, forgetOutcome, PUSH_BASE, PUSH_FORGOTTEN_KEY, type ForgetOutcome } from '../../platform/livePushCore';

export { PUSH_FORGOTTEN_KEY };

export async function forgetPushTokens(): Promise<ForgetOutcome> {
  // Set first, so a token is not sent again by a launch that races this call.
  await AsyncStorage.setItem(PUSH_FORGOTTEN_KEY, '1').catch(() => {});
  if (apiBase() === PUSH_BASE) return forgetOutcome(null, true);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(PUSH_BASE + FORGET_PATH, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device: await getDevice() }), signal: ctl.signal });
    return forgetOutcome(r.status);
  } catch {
    return forgetOutcome(null);
  } finally {
    clearTimeout(t);
  }
}

/** Alerts turned on again: the phone push token may be sent again. */
export async function allowPushTokens() {
  await AsyncStorage.removeItem(PUSH_FORGOTTEN_KEY).catch(() => {});
}
