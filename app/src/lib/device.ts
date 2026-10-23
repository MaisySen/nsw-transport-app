import AsyncStorage from '@react-native-async-storage/async-storage';

export const PROFILE = 'bidur';
let cached: string | null = null;

export async function getDevice(): Promise<string> {
  if (cached) return cached;
  let id = await AsyncStorage.getItem('device');
  if (!id) {
    id = 'app' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    await AsyncStorage.setItem('device', id);
  }
  cached = id;
  return id;
}
