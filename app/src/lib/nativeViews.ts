import { Platform } from 'react-native';

/**
 * Feature checks for native views an over the air update may call. Updates reach builds 201 to 208, so every native
 * view is looked up first; a build without it keeps the menus it had (the old sheet), never a blank row.
 */
const seen = new Map<string, boolean>();

export function hasNativeView(moduleName: string, viewName: string): boolean {
  const k = `${moduleName}.${viewName}`;
  const was = seen.get(k);
  if (was !== undefined) return was;
  let ok = false;
  try { ok = !!(globalThis as any).expo?.getViewConfig?.(moduleName, viewName); } catch { ok = false; }
  seen.set(k, ok);
  return ok;
}

/** __DEV__ only: set globalThis.__legacyMenus = true to try the older build path (the old sheet) on a new build. */
const forcedLegacy = () => __DEV__ && !!(globalThis as any).__legacyMenus;

/**
 * expo-router's Link.Menu: a UIContextMenuInteraction on the row (the row lifts as the preview, the system menu
 * under it). Native code in expo-router 58 (ExpoRouterNativeLinkPreview), which needs the New Architecture.
 */
export function canContextMenu(): boolean {
  if (Platform.OS !== 'ios' || forcedLegacy()) return false;
  if ((globalThis as any).RN$Bridgeless !== true) return false;
  return hasNativeView('ExpoRouterNativeLinkPreview', 'NativeLinkPreviewView') && hasNativeView('ExpoRouterNativeLinkPreview', 'LinkPreviewNativeActionView');
}

/** @expo/ui SwiftUI Menu (a pull-down menu from the control the person tapped). */
export function canSwiftUIMenu(): boolean {
  if (Platform.OS !== 'ios' || forcedLegacy()) return false;
  return hasNativeView('ExpoUI', 'HostView') && hasNativeView('ExpoUI', 'MenuView') && hasNativeView('ExpoUI', 'Button') && hasNativeView('ExpoUI', 'SlotView');
}
