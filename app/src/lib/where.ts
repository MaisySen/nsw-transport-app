import * as Location from 'expo-location';

/** How long a fresh position may take before the screen gives up and says so (Android can leave the call pending). */
export const FIX_TIMEOUT_MS = 12000;
/**
 * A fresh position within FIX_TIMEOUT_MS, else an Error("nofix") that each screen's existing catch already handles
 * (1 Nov polish: "Finding where you are" could spin for ever when the system location never answered).
 */
export function freshFix(accuracy: Location.Accuracy, ms = FIX_TIMEOUT_MS, L: any = Location): Promise<Location.LocationObject> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('nofix')), ms);
    Promise.resolve().then(() => L.getCurrentPositionAsync({ accuracy })).then((v: Location.LocationObject) => { clearTimeout(t); resolve(v); }, (e: unknown) => { clearTimeout(t); reject(e); });
  });
}

/** Where you are, only if location is allowed (asks once, the same permission Nearby uses). Null otherwise. */
export async function myPosition(ask = true, low = false): Promise<{ lat: number; lon: number } | null> {
  try {
    let p = await Location.getForegroundPermissionsAsync();
    if (!p.granted && ask && p.canAskAgain) p = await Location.requestForegroundPermissionsAsync();
    if (!p.granted) return null;
    let pos = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60000 }).catch(() => null);
    if (!pos) pos = await freshFix(low ? Location.Accuracy.Low : Location.Accuracy.Balanced);
    return pos ? { lat: pos.coords.latitude, lon: pos.coords.longitude } : null;
  } catch {
    return null;
  }
}
