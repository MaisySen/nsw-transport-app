// Crash safety net (27 Oct, "App has been crashing continuously"): the app had no error boundary and no error
// reporting, so one bad answer or a bad kept copy closed the whole app with nothing to show for it. Now:
// - a screen that throws while drawing shows a recovery screen (app/_layout.tsx ErrorBoundary) instead of closing;
// - every caught error, and a fatal error outside the screens, is sent once to the server's existing feedback inbox
//   (POST /api/feedback, topic problem, page "crash:<where>") with its message and the top of its stack, so the cause
//   can be read from the server; at most MAX_REPORTS a run, never with personal data beyond the install id;
// - "Clear saved times" drops the phone's kept answers, timetable packs and an active trip (not places, starred stops,
//   trips on Home or settings), then reloads, for a crash that comes back from a kept copy.
// - build 209 and later (Sentry native module, docs/SENTRY.md): a caught error also goes to Sentry, and Sentry's own
//   handler takes fatal errors and native crashes. Builds 201 to 208 have no module and use the feedback inbox alone.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { crashMessage, crashPage, keptKeys, MAX_REPORTS, recentRequests } from './crashCore';
import { apiBase } from './server';
import { captureToSentry } from './sentry';

let sent = 0;
const seen = new Set<string>();

function updateId(): string | null {
  if (Platform.OS === 'web') return null;
  try { const U = require('expo-updates'); return (U && U.updateId) || null; } catch { return null; }
}

function buildNo(): string | null {
  try { const A = require('expo-application'); return (A && A.nativeBuildVersion) || null; } catch { return null; }
}

async function installId(): Promise<string> {
  try { return ((await AsyncStorage.getItem('device')) || '').slice(0, 40); } catch { return ''; }
}


/**
 * Sends one crash report. Never throws; the same error is sent once a run. A caught error also goes to Sentry where
 * the build has it; a fatal one (fatal true, from the global handler) is left to Sentry's own handler, so it is not
 * sent there twice.
 */
export async function reportCrash(error: unknown, where: string, fatal = false): Promise<void> {
  if (!fatal) captureToSentry(error, where);
  try {
    const message = crashMessage(error, { where, fatal, os: Platform.OS, build: buildNo(), update: updateId(), recent: recentRequests() });
    const sig = message.slice(0, 300);
    if (sent >= MAX_REPORTS || seen.has(sig)) return;
    seen.add(sig);
    sent++;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
      await fetch(`${apiBase()}/api/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic: 'problem', message, page: crashPage(where), install: await installId() }),
        signal: ctl.signal,
      });
    } finally { clearTimeout(t); }
  } catch { /* a report that cannot be sent is dropped */ }
}

let installed = false;
/** Fatal errors outside the screens (a timer, a callback) are reported before the app closes as before. */
export function installCrashReporter(): void {
  if (installed) return;
  installed = true;
  const EU: any = (globalThis as any).ErrorUtils;
  if (!EU || typeof EU.getGlobalHandler !== 'function' || typeof EU.setGlobalHandler !== 'function') return;
  const prev = EU.getGlobalHandler();
  EU.setGlobalHandler((e: unknown, isFatal?: boolean) => {
    if (!isFatal) { try { prev && prev(e, isFatal); } catch {} return; }
    // Give the report a moment to leave, then close as before (a blank app that cannot recover is worse).
    let done = false;
    const go = () => { if (done) return; done = true; try { prev && prev(e, isFatal); } catch {} };
    reportCrash(e, 'global', true).finally(go);
    setTimeout(go, 1500);
  });
}

/** Drops kept answers, timetable packs, kept lists and an active trip, then reloads the app. */
export async function clearKeptAndReload(): Promise<void> {
  try {
    const all = await AsyncStorage.getAllKeys();
    let listed: string[] = [];
    try { const raw = await AsyncStorage.getItem('offline:index'); const v = raw ? JSON.parse(raw) : []; listed = Array.isArray(v) ? v.filter((k) => typeof k === 'string') : []; } catch {}
    const drop = keptKeys(all as string[], listed);
    if (drop.length) await AsyncStorage.multiRemove(drop);
  } catch {}
  reloadApp();
}

export function reloadApp(): void {
  if (Platform.OS === 'web') { try { (globalThis as any).location?.reload(); } catch {} return; }
  try { const U = require('expo-updates'); if (U && typeof U.reloadAsync === 'function') { U.reloadAsync().catch(() => {}); return; } } catch {}
  try { const D = require('react-native').DevSettings; if (D && typeof D.reload === 'function') D.reload(); } catch {}
}
