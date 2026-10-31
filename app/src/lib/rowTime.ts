// The phone's clock setting for every time in the app, first the Plan tab trip rows (rules and formats in lib/rowTimeCore.ts).
// iPhone: Settings, General, Date and Time, 24-Hour Time, read from the app's settings copy react-native already
// keeps (no new native module). Elsewhere, and when that key is missing, the locale's hour cycle from Intl.
// Read at most once a minute, on demand while rows draw: no timer, no listener.
import { Platform, Settings } from 'react-native';
import { rowClock, uses24h, type ClockSignals } from './rowTimeCore';

let cached: { at: number; h24: boolean } | null = null;
const REREAD_MS = 60000;

function bool(v: unknown): boolean | null {
  if (v === true || v === 1 || v === '1' || v === 'true' || v === 'YES') return true;
  if (v === false || v === 0 || v === '0' || v === 'false' || v === 'NO') return false;
  return null;
}

function signals(): ClockSignals {
  const sig: ClockSignals = {};
  if (Platform.OS === 'ios') {
    try {
      const get = (Settings as any)?.get;
      if (typeof get === 'function') {
        const on = bool(get('AppleICUForce24HourTime'));
        const off = bool(get('AppleICUForce12HourTime'));
        sig.force24 = on === true ? true : off === true ? false : null;
        // Newer iOS writes the choice into the locale as "@hours=h23" (or "h12").
        const loc = String(get('AppleLocale') || '');
        const hrs = loc.match(/hours=(h11|h12|h23|h24)/);
        if (sig.force24 == null && hrs) sig.force24 = hrs[1] === 'h23' || hrs[1] === 'h24';
      }
    } catch {}
  }
  try {
    const o: any = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions();
    sig.hourCycle = o.hourCycle || null;
    sig.hour12 = typeof o.hour12 === 'boolean' ? o.hour12 : null;
  } catch {}
  return sig;
}

/** True when the phone shows 24 hour time (read again at most once a minute). */
export function phone24h(now = Date.now()): boolean {
  if (cached && now - cached.at < REREAD_MS) return cached.h24;
  let h24 = false;
  try { h24 = uses24h(signals()); } catch {}
  cached = { at: now, h24 };
  return h24;
}

/**
 * Hands the phone's setting to every clock in the app (lib/format.ts clock, the board, trip, Plan, Ask and offline
 * stamps): they read it through globalThis so the pure modules stay free of react-native and testable in Node.
 * Called once at start from app/_layout.tsx (31 Oct, in-app 24 hour time).
 */
export function installPhoneClock(): void {
  try { (globalThis as any).__tslPhone24h = () => phone24h(); } catch {}
}

/** A trip row's time in the phone's clock: "12:56 pm" or "12:56". Sydney time. */
export const rowTime = (t: number) => rowClock(t, phone24h());
