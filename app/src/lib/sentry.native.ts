// Sentry crash reporting on iPhone and Android (build 209 and later). docs/SENTRY.md.
//
// Builds 201 to 208 have no Sentry native module, and they run this same JavaScript over the air. So nothing from
// @sentry/react-native is loaded until the native module has been found (TurboModuleRegistry.get, never the
// getEnforcing lookup that throws); without it every function here does nothing and crash.ts keeps sending crash
// reports to the server's feedback inbox as before. The web build uses sentry.ts, which never loads Sentry.
//
// Switch off without an update: the server's app config flag "sentry" false (or kill.sentry) drops every event at
// beforeSend; crash reports to the feedback inbox carry on.
import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import type { ComponentType } from 'react';
import { hasNativeSentry, MAX_EVENTS_PER_RUN, releaseFor, scrubBreadcrumb, scrubEvent, sentryOptions, validDsn } from './sentryCore';
import { isOn } from './config';

type SentryNS = typeof import('@sentry/react-native');

let S: SentryNS | null = null;
let tried = false;
let sent = 0;

function nativePresent(): boolean {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return false;
  return hasNativeSentry({
    turbo: (n) => (TurboModuleRegistry && typeof TurboModuleRegistry.get === 'function' ? TurboModuleRegistry.get(n as any) : null),
    legacy: NativeModules as any,
  });
}

function appInfo(): { version: string | null; build: string | null; bundleId: string | null; dsn: string | null; channel: string | null; updateId: string | null } {
  let version: string | null = null, build: string | null = null, bundleId: string | null = null, dsn: string | null = null, channel: string | null = null, updateId: string | null = null;
  try { const A = require('expo-application'); version = A?.nativeApplicationVersion || null; build = A?.nativeBuildVersion || null; bundleId = A?.applicationId || null; } catch {}
  try {
    const C = require('expo-constants');
    const extra = (C?.default || C)?.expoConfig?.extra || {};
    dsn = validDsn(process.env.EXPO_PUBLIC_SENTRY_DSN) || validDsn(extra.sentryDsn);
  } catch { dsn = validDsn(process.env.EXPO_PUBLIC_SENTRY_DSN); }
  try { const U = require('expo-updates'); channel = U?.channel || null; updateId = U?.updateId || null; } catch {}
  return { version, build, bundleId, dsn, channel, updateId };
}

/** Starts Sentry once, only on a build with its native module and a DSN. Never throws. */
export function initSentry(): boolean {
  if (tried) return !!S;
  tried = true;
  try {
    if (!nativePresent()) return false;
    const info = appInfo();
    if (!info.dsn) return false;
    const mod: SentryNS = require('@sentry/react-native');
    const { release, dist } = releaseFor(info.bundleId, info.version, info.build);
    const environment = __DEV__ ? 'development' : (info.channel || 'production');
    mod.init({
      ...(sentryOptions({ dsn: info.dsn, release, dist, environment }) as any),
      beforeSend: (event: any) => {
        const out = scrubEvent(event, sentryAllowed() && sent < MAX_EVENTS_PER_RUN);
        if (out) sent++;
        return out;
      },
      beforeBreadcrumb: (b: any) => scrubBreadcrumb(b),
    });
    // The over the air update the phone runs (first 8 characters), so a crash can be tied to an update.
    if (info.updateId) mod.setTag('update', String(info.updateId).slice(0, 8));
    S = mod;
    return true;
  } catch {
    S = null;
    return false;
  }
}

function sentryAllowed(): boolean {
  try { return isOn('sentry'); } catch { return true; }
}

/** True once Sentry is running on this phone. */
export function sentryActive(): boolean { return !!S; }

/** Sends one caught error (a screen's error boundary) to Sentry. Fatal errors outside screens are Sentry's own. */
export function captureToSentry(error: unknown, where: string): void {
  if (!S) return;
  try {
    S.withScope((scope) => {
      scope.setTag('where', where.split(' ')[0] || 'screen');
      scope.setLevel('error');
      S!.captureException(error);
    });
  } catch { /* never in the way of the recovery screen */ }
}

/**
 * Wraps the root layout with Sentry on a build that has it; on any other build returns it unchanged. Touches are
 * not recorded (no names, no text; beforeBreadcrumb drops them too).
 */
export function withSentry<P extends object>(C: ComponentType<P>): ComponentType<P> {
  if (!initSentry() || !S) return C;
  try { return S.wrap(C as any, { touchEventBoundaryProps: { ignoreNames: [/.*/], maxComponentTreeSize: 1, extractTextFromChildren: false } } as any) as unknown as ComponentType<P>; } catch { return C; }
}
