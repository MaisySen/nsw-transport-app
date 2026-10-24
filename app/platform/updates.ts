// Over the air updates on Android and iPhone.
// expo-updates checks on every cold start (updates.checkAutomatically ON_LOAD in app.json). This adds a check
// each time the app comes back to the foreground, at most every 15 minutes. A downloaded update runs on the
// next start, so nothing reloads while someone is using the app.
import { AppState, Platform } from 'react-native';
import * as Updates from 'expo-updates';

const GAP = 15 * 60 * 1000;
let last = Date.now();
let busy = false;

export async function checkForegroundUpdate(force = false) {
  if (Platform.OS === 'web' || __DEV__ || !Updates.isEnabled || busy) return;
  if (!force && Date.now() - last < GAP) return;
  busy = true;
  last = Date.now();
  try {
    const r = await Updates.checkForUpdateAsync();
    if (r.isAvailable) await Updates.fetchUpdateAsync();
  } catch {
    // Offline or the update server is busy: the next foreground tries again.
  } finally {
    busy = false;
  }
}

if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (s) => { if (s === 'active') checkForegroundUpdate(); });
}
