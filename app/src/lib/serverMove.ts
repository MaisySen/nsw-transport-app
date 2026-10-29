// Moving a phone to the new server (26 Oct 2026). The data copy between the two servers was made on 25 Oct; what this
// phone saved on the first server after that is carried over by the phone itself, once, after the first launch on
// the new server: its own saved trips (kept on the phone, device.ts), its push token (so alerts reach it from the new
// server). Morning checks were carried over from the first server until it was switched off on 30 Oct 2026; that step
// is gone, and the phone never asks the first server for anything.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { api } from './api';
import { finishProfileMove } from './device';
import { PUSH_FORGOTTEN_KEY } from './forgetTokens';
import { apiBase, NEW_API_BASE } from './server';

const DONE_KEY = 'serverMoveDone';

/** Runs a moment after launch (with finishProfileMove). Marks itself done only when every step worked; else next launch. */
export async function finishServerMove(): Promise<void> {
  try {
    if (apiBase() !== NEW_API_BASE) return;
    if ((await AsyncStorage.getItem(DONE_KEY)) === '1') return;
    // Saved trips: the phone's own list is saved again under its profile (the same step as a profile move).
    await AsyncStorage.setItem('profileReupload', '1');
    await finishProfileMove(api);
    if ((await AsyncStorage.getItem('profileReupload')) === '1') return;
    // Push token: only when alerts are on and the person has not asked for the token to be forgotten.
    const [tok, forgot] = await Promise.all([AsyncStorage.getItem('expoPushToken'), AsyncStorage.getItem(PUSH_FORGOTTEN_KEY)]);
    if (tok && forgot !== '1') await api.registerExpo(tok, Platform.OS, false);
    // Morning checks: the first server is switched off (30 Oct 2026; its address only forwards to the new server), so
    // there is nothing left to read or delete there. Never call it: a forwarded delete would reach the new server.
    await AsyncStorage.setItem(DONE_KEY, '1');
  } catch {
    // offline or a server said no: try again next launch
  }
}
