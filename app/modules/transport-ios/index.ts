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
};

const native: Native | null = Platform.OS === 'ios' ? requireOptionalNativeModule<Native>('TransportIOS') : null;

/** What the Lock Screen card shows. Dates are milliseconds since 1970. Matches LiveTripAttributes.ContentState. */
export type TripCardState = {
  line: string; lineColorHex: string; mode: string; nextStop: string | null; stopsLeft: number | null; getOffAt: string;
  arrival: number; phase: 'wait' | 'ride' | 'arrived'; warning: string | null; progress: number;
  towards: string | null; platform: string | null; departs: number | null; legArrives: number | null; destination: string | null;
};

const clean = (s: TripCardState) => JSON.stringify(Object.fromEntries(Object.entries(s).filter(([, v]) => v !== null && v !== undefined)));

export const iosNative = {
  available: () => !!native,
  hasAppGroup: () => { try { return !!native?.hasAppGroup(); } catch { return false; } },
  setString(key: string, value: string | null) { try { native?.setSharedString(key, value); } catch {} },
  setJSON(key: string, value: unknown) { try { native?.setSharedJSON(key, value === null || value === undefined ? null : JSON.stringify(value)); } catch {} },
  setBool(key: string, value: boolean) { try { native?.setSharedBool(key, value); } catch {} },
  reloadWidgets(kind?: string) { try { native?.reloadWidgets(kind || null); } catch {} },
  activitiesEnabled: () => { try { return !!native?.areActivitiesEnabled(); } catch { return false; } },
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
