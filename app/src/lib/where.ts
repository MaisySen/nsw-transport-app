import * as Location from 'expo-location';

/** Where you are, only if location is allowed (asks once, the same permission Nearby uses). Null otherwise. */
export async function myPosition(ask = true, low = false): Promise<{ lat: number; lon: number } | null> {
  try {
    let p = await Location.getForegroundPermissionsAsync();
    if (!p.granted && ask && p.canAskAgain) p = await Location.requestForegroundPermissionsAsync();
    if (!p.granted) return null;
    let pos = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60000 }).catch(() => null);
    if (!pos) pos = await Location.getCurrentPositionAsync({ accuracy: low ? Location.Accuracy.Low : Location.Accuracy.Balanced });
    return pos ? { lat: pos.coords.latitude, lon: pos.coords.longitude } : null;
  } catch {
    return null;
  }
}
