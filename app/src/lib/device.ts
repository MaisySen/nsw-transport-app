import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The server profile that holds this install's saved trips, home and work.
 * Each install gets its own random profile on first launch. The first test installs
 * (built before the store release) keep the original shared profile so nothing they saved is lost.
 * The Android widget reads the same "profile" key straight from this storage.
 */
export let PROFILE = '';
let cached: string | null = null;

function randomId(prefix: string) {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
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
