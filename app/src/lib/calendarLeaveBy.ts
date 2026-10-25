// Calendar leave by: reading the phone's calendar (docs/CALENDAR-LEAVE-BY.md). Read only, on the phone only.
// iPhone builds 201 to 205 have no calendar module, and 206 and 207 have it with add only access (no text for full
// access in the app, so asking for read access there is refused). Read access comes with build 208; until then the
// setting is hidden and nothing here runs. Android: from the first build with the calendar module.
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import * as Application from 'expo-application';
import { hasCalendar } from './nativeExtras';
import { readSupported, type CalEvent } from './calendarLeaveByCore';

/** Dev only (web screenshots): a clearly labelled mock calendar, set by the test page. Never in a release. */
function devMock(): CalEvent[] | null {
  if (!__DEV__ || Platform.OS !== 'web') return null;
  const m = (globalThis as any).__TRANSPORT_CALENDAR_MOCK__;
  return Array.isArray(m) ? (m as CalEvent[]) : null;
}

function hasNext(): boolean {
  try { return !!requireOptionalNativeModule('CalendarNext'); } catch { return false; }
}

/** True when this phone can read the calendar for leave by; the More setting shows only then. */
export function calendarReadSupported(): boolean {
  if (devMock()) return true;
  if (Platform.OS === 'web') return false;
  let build: string | null = null;
  try { build = Application.nativeBuildVersion; } catch {}
  return readSupported(Platform.OS, hasCalendar(), hasNext(), build);
}

/** iPhone gives ISO strings, Android numbers or strings. */
const toMs = (v: any) => (typeof v === 'number' ? v : v instanceof Date ? v.getTime() : Date.parse(String(v || '')));

function legacy(): any | null {
  if (!hasCalendar()) return null;
  try { return require('expo-calendar/legacy'); } catch { return null; }
}

/** Whether read access is granted now (no prompt). */
export async function calendarReadGranted(): Promise<boolean> {
  if (devMock()) return true;
  if (!calendarReadSupported()) return false;
  try {
    const C = legacy();
    const r = await C?.getCalendarPermissionsAsync?.();
    return !!r?.granted;
  } catch { return false; }
}

/**
 * Asks for calendar access once (iOS: full access, which reading needs; the system shows the app's own text).
 * On iPhone the request goes through the module that checks the app has that text first, so a build without it
 * gets a refusal, not a crash. Returns whether access was granted.
 */
export async function askCalendarRead(): Promise<{ granted: boolean; canAskAgain: boolean }> {
  if (devMock()) return { granted: true, canAskAgain: true };
  if (!calendarReadSupported()) return { granted: false, canAskAgain: false };
  try {
    let r: any;
    if (Platform.OS === 'ios') {
      const ask = require('expo-calendar').requestCalendarPermissions;
      if (typeof ask !== 'function') return { granted: false, canAskAgain: false };
      r = await ask(false);
    } else {
      r = await legacy()?.requestCalendarPermissionsAsync?.();
    }
    return { granted: !!r?.granted, canAskAgain: r?.canAskAgain !== false };
  } catch { return { granted: false, canAskAgain: false }; }
}

/**
 * Events from now to `until` in every calendar on the phone, cut down to id, title, times, location and status.
 * Read on the phone; nothing here is sent anywhere. Empty when access is missing.
 */
export async function readEvents(now: number, until: number): Promise<CalEvent[]> {
  const mock = devMock();
  if (mock) return mock;
  if (!calendarReadSupported()) return [];
  const C = legacy();
  if (!C) return [];
  try {
    const perm = await C.getCalendarPermissionsAsync();
    if (!perm?.granted) return [];
    const cals: any[] = await C.getCalendarsAsync(C.EntityTypes?.EVENT ?? 'event');
    const ids = (cals || []).map((x) => x?.id).filter(Boolean);
    if (!ids.length) return [];
    const evs: any[] = await C.getEventsAsync(ids, new Date(now), new Date(until));
    return (evs || []).map((e) => ({
      id: String(e.id || ''),
      title: String(e.title || ''),
      start: toMs(e.startDate),
      end: toMs(e.endDate),
      location: String(e.location || ''),
      allDay: !!e.allDay,
      status: e.status ? String(e.status) : null,
    }));
  } catch { return []; }
}
