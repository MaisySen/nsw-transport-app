import AsyncStorage from '@react-native-async-storage/async-storage';
import { bytesFromUuid, idFromBytes, isSharedProfile, tripsToUpload } from './profileMigrate';

/**
 * The server profile that holds this install's saved trips, home and work.
 * Each install gets its own random profile on first launch. An install still on the old shared
 * test profile moves to a fresh private one on launch, and its saved trips are saved again there.
 * The Android widget reads the same "profile" key straight from this storage.
 */
export let PROFILE = '';
let cached: string | null = null;

/**
 * 12 bytes from a secure random source. The web and newer runtimes have crypto.getRandomValues;
 * on the phone the Expo core module makes version 4 UUIDs from the system's secure generator.
 * There is no weak fallback: with no secure source this throws.
 */
function secureBytes(): number[] {
  const c = (globalThis as any).crypto;
  if (c && typeof c.getRandomValues === 'function') return Array.from(c.getRandomValues(new Uint8Array(12)) as Uint8Array);
  const uuidv4 = (globalThis as any).expo?.uuidv4;
  if (typeof uuidv4 === 'function') return bytesFromUuid(uuidv4());
  throw new Error('no secure random source');
}

// A profile id is the only key to its saved trips, so it is long and random.
export const randomId = (prefix: string) => idFromBytes(prefix, secureBytes());

/** Saves the phone's own trips under the current profile. Kept as pending until it works. */
async function reupload(api: { saveTrip: Function; saveTripLegs: Function }) {
  const items = tripsToUpload(await AsyncStorage.getItem('store'));
  for (const it of items) {
    if ('legs' in it) await api.saveTripLegs(it.name, it.legs);
    else await api.saveTrip(it.name, it.from, it.to);
  }
  await AsyncStorage.removeItem('profileReupload');
  return items.length;
}

/** Runs after PROFILE is set: finishes a move off the shared profile when one is pending. */
export async function finishProfileMove(api: { saveTrip: Function; saveTripLegs: Function }) {
  try {
    if ((await AsyncStorage.getItem('profileReupload')) !== '1' || !PROFILE) return 0;
    return await reupload(api);
  } catch {
    return 0; // offline or the server said no: try again next launch
  }
}

export async function initProfile(): Promise<string> {
  if (PROFILE) return PROFILE;
  try {
    let p = await AsyncStorage.getItem('profile');
    if (!p || isSharedProfile(p)) {
      const moved = !!p;
      p = randomId('u');
      await AsyncStorage.setItem('profile', p);
      if (moved) {
        await AsyncStorage.setItem('profileReupload', '1');
        await AsyncStorage.setItem('profileMovedAt', String(Date.now()));
      }
    }
    PROFILE = p;
  } catch {
    try { PROFILE = randomId('u'); } catch { PROFILE = ''; }
  }
  return PROFILE;
}

export async function getDevice(): Promise<string> {
  if (cached) return cached;
  let id = await AsyncStorage.getItem('device');
  if (!id) {
    id = randomId('app');
    await AsyncStorage.setItem('device', id);
  }
  cached = id;
  return id;
}
