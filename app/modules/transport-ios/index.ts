// The iPhone side of the widgets and the trip Live Activity. On Android and web every call is a no-op.
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

type Native = {
  hasAppGroup(): boolean;
  setSharedString(key: string, value: string | null): void;
  setSharedJSON(key: string, json: string | null): void;
  setSharedBool(key: string, value: boolean): void;
  reloadWidgets(kind: string | null): void;
  areActivitiesEnabled(): boolean;
  tripActivityIds(): string[];
  startTripActivity(title: string, legsCount: number, stateJSON: string, staleMs: number | null): Promise<string | null>;
  updateTripActivity(id: string, stateJSON: string, staleMs: number | null): Promise<boolean>;
  endTripActivity(id: string | null, stateJSON: string | null, dismissAfterSeconds: number): Promise<void>;
  /** 2 from the build that draws a stale trip card as "Updated 8:21am" instead of "You've arrived". Absent before. */
  liveCardVersion?: () => number;
  /** From build 205: the trip card asks for a push token so the server can update it while the phone is locked. */
  supportsActivityPush?: () => boolean;
  tripActivityPushToken?: (id: string) => string | null;
  addListener?: ((event: 'onActivityPushToken', cb: (e: { id: string; token: string }) => void) => { remove(): void }) &
    ((event: 'onIntentQueued', cb: () => void) => { remove(): void });
  /** From the build with the Apple Watch app: hands the watch its context (WatchConnectivity). Absent before. */
  sendWatchContext?: (json: string) => boolean;
  /** From build 206: reads a string from the app group and removes it (links left by Siri). */
  takeSharedString?: (key: string) => string | null;
  /** From build 211 (31 Oct): get off alerts from the phone's position (UNLocationNotificationTrigger). Absent before. */
  regionAlertStatus?: () => string;
  scheduleRegionAlert?: (id: string, title: string, body: string, lat: number, lon: number, radius: number, sound: string | null, dataJSON: string) => Promise<boolean>;
};

const native: Native | null = Platform.OS === 'ios' ? requireOptionalNativeModule<Native>('TransportIOS') : null;

export type { TripCardState } from '../../platform/tripCard';
import type { TripCardState } from '../../platform/tripCard';
import { activityPushOf, pushTokenOf } from '../../platform/livePushCore';

const clean = (s: TripCardState) => JSON.stringify(Object.fromEntries(Object.entries(s).filter(([, v]) => v !== null && v !== undefined)));

export const iosNative = {
  available: () => !!native,
  hasAppGroup: () => { try { return !!native?.hasAppGroup(); } catch { return false; } },
  setString(key: string, value: string | null) { try { native?.setSharedString(key, value); } catch {} },
  setJSON(key: string, value: unknown) { try { native?.setSharedJSON(key, value === null || value === undefined ? null : JSON.stringify(value)); } catch {} },
  setBool(key: string, value: boolean) { try { native?.setSharedBool(key, value); } catch {} },
  reloadWidgets(kind?: string) { try { native?.reloadWidgets(kind || null); } catch {} },
  activitiesEnabled: () => { try { return !!native?.areActivitiesEnabled(); } catch { return false; } },
  /** 1 on builds up to 204 (a stale card reads "You've arrived"), 2 once the card shows "Updated" when stale. */
  cardVersion: (): number => { try { return typeof native?.liveCardVersion === 'function' ? Number(native.liveCardVersion()) || 1 : 1; } catch { return 1; } },
  /** True on builds whose trip card can be updated by push (205 and later). */
  activityPush: (): boolean => activityPushOf(native),
  activityPushToken: (id: string): string | null => pushTokenOf(native, id),
  onActivityPushToken(cb: (id: string, token: string) => void): () => void {
    try {
      const sub = native?.addListener?.('onActivityPushToken', (e) => { if (e?.id && e?.token) cb(String(e.id), String(e.token)); });
      return () => { try { sub?.remove(); } catch {} };
    } catch { return () => {}; }
  },
  /** Reads and removes an app group string. Null on builds before 206, which have no such function. */
  takeString(key: string): string | null {
    try { return typeof native?.takeSharedString === 'function' ? native.takeSharedString(key) ?? null : null; } catch { return null; }
  },
  /** Siri left a link while the app was running (build 206 and later). A no-op before. */
  onIntentQueued(cb: () => void): () => void {
    try {
      if (typeof native?.takeSharedString !== 'function') return () => {};
      const sub = (native?.addListener as any)?.('onIntentQueued', () => cb());
      return () => { try { sub?.remove(); } catch {} };
    } catch { return () => {}; }
  },
  /** True on builds that can set get off alerts from the phone's position (211 and later). */
  hasRegionAlerts: (): boolean => typeof native?.scheduleRegionAlert === 'function' && typeof native?.regionAlertStatus === 'function',
  /** "ok" when location alerts can ring: location allowed (When In Use or Always), precise, region monitoring available.
   * Else "notDetermined", "denied", "reduced" (approximate location only) or "unavailable". Null before build 211. */
  regionAlertStatus(): string | null {
    try { return typeof native?.regionAlertStatus === 'function' ? String(native.regionAlertStatus()) : null; } catch { return null; }
  },
  /** Sets (or replaces: the same id) a location alert. False on builds before 211 or when iOS refuses it. */
  async scheduleRegionAlert(id: string, title: string, body: string, lat: number, lon: number, radius: number, sound: string | null, data: Record<string, unknown>): Promise<boolean> {
    try { return typeof native?.scheduleRegionAlert === 'function' ? !!(await native.scheduleRegionAlert(id, title, body, lat, lon, radius, sound, JSON.stringify(data))) : false; } catch { return false; }
  },
  /** True on builds that carry the Apple Watch app. */
  hasWatch: (): boolean => typeof native?.sendWatchContext === 'function',
  /** Sends the watch its context. Does nothing (false) on builds without the watch app or with no watch paired. */
  sendWatch(json: string): boolean {
    try { return typeof native?.sendWatchContext === 'function' ? !!native.sendWatchContext(json) : false; } catch { return false; }
  },
  activityIds: (): string[] => { try { return native?.tripActivityIds() || []; } catch { return []; } },
  async startTrip(title: string, legsCount: number, s: TripCardState, staleMs?: number | null) {
    if (!native) return null;
    try { return await native.startTripActivity(title, legsCount, clean(s), staleMs ?? null); } catch { return null; }
  },
  async updateTrip(id: string, s: TripCardState, staleMs?: number | null) {
    if (!native) return false;
    try { return await native.updateTripActivity(id, clean(s), staleMs ?? null); } catch { return false; }
  },
  async endTrip(id: string | null, final?: TripCardState | null, dismissAfterSeconds = 0) {
    if (!native) return;
    try { await native.endTripActivity(id, final ? clean(final) : null, dismissAfterSeconds); } catch {}
  },
};
