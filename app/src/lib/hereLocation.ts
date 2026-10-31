// The one location read behind Plan's "Current location" (lib/hereCore.ts). Feature detected: expo-location's native
// module is looked up first and the package is loaded only when it is there, so a build without it never shows the row
// and never throws. Every iPhone build from 201 and every Android build has it (app.json plugin since 24 Oct).
// Battery: one fix on a tap (a recent fix the system already has, else one Balanced fix), When In Use only, nothing
// in the background and no watching. The permission prompt shows only when Current location is tapped.
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { HereResult } from './hereCore';

export function hasLocation(): boolean {
  if (Platform.OS === 'web') return !!(globalThis as any).navigator?.geolocation;
  try { return !!requireOptionalNativeModule('ExpoLocation'); } catch { return false; }
}

function locationModule(): any | null {
  if (!hasLocation()) return null;
  try { return require('expo-location'); } catch { return null; }
}

/** Where the phone is, asking When In Use permission only if `ask` and the system still lets us ask. */
export async function hereOnce(ask: boolean): Promise<HereResult | null> {
  const L = locationModule();
  if (!L) return null;
  try {
    let p = await L.getForegroundPermissionsAsync();
    if (!p.granted && ask && p.canAskAgain) p = await L.requestForegroundPermissionsAsync();
    if (!p.granted) return { pos: null, denied: true, canAskAgain: !!p.canAskAgain };
    let pos = await L.getLastKnownPositionAsync({ maxAge: 2 * 60000 }).catch(() => null);
    if (!pos) {
      // At most 12 s (as lib/where.ts freshFix; not imported here so expo-location stays optional): never a spinner for ever.
      let t: ReturnType<typeof setTimeout> | undefined;
      pos = await Promise.race([L.getCurrentPositionAsync({ accuracy: L.Accuracy.Balanced }), new Promise<null>((r) => { t = setTimeout(() => r(null), 12000); })]).finally(() => clearTimeout(t));
    }
    return { pos: pos ? { lat: pos.coords.latitude, lon: pos.coords.longitude } : null };
  } catch {
    return { pos: null };
  }
}
