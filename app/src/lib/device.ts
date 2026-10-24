import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The server profile that holds this install's saved trips, home and work.
 * Each install gets its own random profile on first launch. The first test installs
 * (built before the store release) keep the original shared profile so nothing they saved is lost.
 * The Android widget reads the same "profile" key straight from this storage.
 */
export let PROFILE = '';
let cached: string | null = null;

// A profile id is the only key to its saved trips, so it is long and random.
// Uses the secure generator when the runtime has one.
function randomId(prefix: string) {
  try {
    const c = (globalThis as any).crypto;
    if (c && typeof c.getRandomValues === 'function') {
      const b: Uint8Array = c.getRandomValues(new Uint8Array(12));
      return prefix + Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('');
    }
  } catch {}
  let s = '';
  while (s.length < 24) s += Math.random().toString(36).slice(2);
  return prefix + s.slice(0, 24);
}

export async function initProfile(): Promise<string> {
  if (PROFILE) return PROFILE;
  try {
    let p = await AsyncStorage.getItem('profile');
    if (!p) {
      const existing = await AsyncStorage.getItem('device');
      p = existing ? 'bidur' : randomId('u');
      await AsyncStorage.setItem('profile', p);
    }
    PROFILE = p;
  } catch {
    PROFILE = randomId('u');
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
