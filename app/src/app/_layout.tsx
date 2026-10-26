import { useEffect, useState } from 'react';
import { AppState, Platform, useColorScheme, useWindowDimensions } from 'react-native';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import { pollNotes, pollNotesTick } from '@/lib/push';
import { startAppPoll } from '@/lib/activity';
import { startPacks } from '@/lib/timetablePack';
import { endLive, setupLiveNotifications } from '@/lib/live';
import { finishProfileMove } from '@/lib/device';
import { finishServerMove } from '@/lib/serverMove';
import { warmLocalSearch } from '@/lib/localSearch';
import { refreshConfig } from '@/lib/config';
import { bootLocal } from '@/lib/boot';
import { api } from '@/lib/api';
import { morningTripParams } from '@/lib/morning';
import { store } from '@/lib/store';
import { recheckLastLocal } from '@/lib/lastHome';
import { usePalette } from '@/lib/theme';
import { sheetHeaderOptions, stopHeaderOptions } from '@/lib/headerOptions';
import { LiftAlertSync } from '@/lib/liftAlerts';
import { TripAlertSync } from '@/lib/tripAlerts';
import { LiveTripEngine } from '@/lib/liveEngine';
import { orientationFor } from '@/lib/layoutCore';

/** Startup work that is not the first screen's own data waits this long after the app is ready. */
const STARTUP_DEFER_MS = 1500;

// The phone's own data for the first screen starts loading as soon as this file runs, before React draws anything.
bootLocal();

// Feature detected: a build without the native module skips it instead of failing at import.
function systemUI(): any {
  try { return require('expo-system-ui'); } catch { return null; }
}

export default function RootLayout() {
  const scheme = useColorScheme();
  const c = usePalette();
  const [ready, setReady] = useState(false);
  // Upright on a phone sized window; on a wide one (an open iPhone Duo, a fold's inner screen, a tablet) screens turn
  // and resize. The orientation screen option is already in every build on runtime 1.0.0 (the board uses it), so no
  // new native call is made; the web ignores it.
  const { width, height } = useWindowDimensions();
  const orientation = orientationFor(width, height);

  // Every install has its own profile on the server; read or create it before the first request.
  useEffect(() => {
    // The last good remote config (and server address) is read before the first request.
    // The fresh config is asked a moment after the first screen has asked for its own times, so the first board is
    // not queued behind it on a slow connection (docs/PERFORMANCE.md, startup). The cached one is already in use.
    let later: ReturnType<typeof setTimeout> | null = null;
    let search: ReturnType<typeof setTimeout> | null = null;
    // The profile, cached config, saved places and kept copies are read side by side (lib/boot.ts), so the first
    // screen draws once, with its saved times, instead of empty cards that fill a few frames later.
    bootLocal().finally(() => {
      setReady(true);
      later = setTimeout(() => { later = null; finishProfileMove(api).then(() => finishServerMove()); refreshConfig(true); }, STARTUP_DEFER_MS);
      // The stop lists for search as you type are read (or fetched once) well after the first screen has its times.
      search = setTimeout(() => { search = null; warmLocalSearch(); }, STARTUP_DEFER_MS * 4);
    });
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refreshConfig(); });
    // Timetable packs (timetablePack.ts): kept ones are read now for the first frame; due ones are fetched after the
    // first screen has its times, and again (once a day) when the app comes back to the front.
    const packs = startPacks(STARTUP_DEFER_MS * 3);
    return () => { sub.remove(); packs(); if (later) clearTimeout(later); if (search) clearTimeout(search); };
  }, []);

  // Keep alerts coming while the app is open, and open the right screen when an alert is tapped.
  useEffect(() => {
    if (!ready) return;
    // Only while the app is in front (activity.ts); with a push token the server is asked once a minute (push.ts).
    const poll = startAppPoll(pollNotesTick, 20000, { runAtStart: false });
    // The phone's own Last way home reminder looks at live times again while the app is open (and on opening it).
    const lastPoll = startAppPoll(() => recheckLastLocal(), 60000, { runAtStart: false });
    // Alerts for watched services and the Last way home recheck wait until the first screen has its times.
    const first = setTimeout(() => { pollNotes(); recheckLastLocal().catch(() => {}); }, STARTUP_DEFER_MS);
    setupLiveNotifications();
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const d: any = r.notification.request.content.data || {};
      // Buttons on the ongoing trip notification.
      if (r.actionIdentifier === 'end') { endLive().finally(() => router.replace('/')); return; }
      if (r.actionIdentifier === 'share') { router.push({ pathname: '/go', params: { share: '1' } }); return; }
      if (d.go) { router.push('/go'); return; }
      // A trip reminder opens its saved trip with live times.
      if (d.tripOpen && typeof d.tripOpen === 'object') { router.push({ pathname: '/trip', params: d.tripOpen }); return; }
      // The weekend trackwork heads up and a Last way home reminder from a spot on the map open Home, where their cards are.
      if (d.trackwork || d.lastHome) { router.navigate('/home'); return; }
      // A morning check alert (tag m<id>) opens its trip with live times and Plan B; a check not on the phone opens the checks.
      if (typeof d.tag === 'string' && /^m[A-Za-z0-9]/.test(d.tag)) {
        const open = morningTripParams(d.tag, store.morningList());
        if (open) router.push({ pathname: '/trip', params: open }); else router.push('/morning');
        return;
      }
      if (d.watch) router.push({ pathname: '/watch/[id]', params: { id: String(d.watch) } });
    });
    return () => { poll.remove(); lastPoll.remove(); sub.remove(); clearTimeout(first); };
  }, [ready]);

  // The window behind every screen takes the theme's background (expo-system-ui, in every build), so a push, a
  // sheet or the keyboard never shows a white strip in dark mode or before the first screen draws (g10, 26 Oct).
  useEffect(() => {
    try { const p: any = systemUI()?.setBackgroundColorAsync?.(c.bg); if (p && typeof p.catch === 'function') p.catch(() => {}); } catch {}
  }, [c.bg]);
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  if (!ready) return null;
  const theme = { ...base, colors: { ...base.colors, primary: c.tint, background: c.bg, card: c.card, text: c.text, border: c.sep } };
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={theme}>
        <StatusBar style="auto" />
        <LiftAlertSync />
        <TripAlertSync />
        <LiveTripEngine />
        {/* On a phone sized window every screen stays upright and only the departure board turns sideways (build 205
            lets iPhone turn); on a wide window every screen follows the window. */}
        <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal', headerTintColor: c.tint, contentStyle: { backgroundColor: c.bg }, orientation }}>
          {/* The opening route only redirects to Home; without this it drew an empty screen titled "index" for a frame (g13). */}
          <Stack.Screen name="index" options={{ headerShown: false, animation: 'none' }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="stop/[id]" options={stopHeaderOptions(Platform.OS)} />
          <Stack.Screen name="trip" options={{ title: 'Trips', headerLargeTitle: false }} />
          <Stack.Screen name="board" options={{ headerShown: false, presentation: Platform.OS === 'ios' ? 'fullScreenModal' : 'card', orientation: 'all' }} />
          <Stack.Screen name="platform" options={{ headerShown: false, presentation: Platform.OS === 'ios' ? 'fullScreenModal' : 'card' }} />
          <Stack.Screen name="service" options={{ headerShown: false, presentation: 'card' }} />
          <Stack.Screen name="go" options={{ headerShown: false, presentation: 'card' }} />
          <Stack.Screen name="topup" options={{ title: 'Opal machines' }} />
          <Stack.Screen name="parking" options={{ title: 'Car parks' }} />
          <Stack.Screen name="carpark" options={{ title: 'Car park', presentation: Platform.OS === 'ios' ? 'formSheet' : 'card', sheetAllowedDetents: [0.6, 1], sheetGrabberVisible: true }} />
          <Stack.Screen name="voice" options={{ title: 'Voice' }} />
          <Stack.Screen name="simple" options={{ headerShown: false, gestureEnabled: false, animation: 'fade' }} />
          <Stack.Screen name="new-trip" options={{ ...sheetHeaderOptions(Platform.OS, c), title: 'New trip', presentation: Platform.OS === 'ios' ? 'modal' : 'card' }} />
          <Stack.Screen name="add-trip" options={{ ...sheetHeaderOptions(Platform.OS, c), title: 'Add a trip', presentation: Platform.OS === 'ios' ? 'modal' : 'card' }} />
          <Stack.Screen name="watching" options={{ title: 'Watching' }} />
          <Stack.Screen name="welcome" options={{ title: 'Set up' }} />
          <Stack.Screen name="morning" options={{ title: 'Check before I go' }} />
          <Stack.Screen name="shared/[id]" options={{ title: 'Shared trip' }} />
          <Stack.Screen name="watch/[id]" options={{ title: 'Watching', presentation: Platform.OS === 'ios' ? 'formSheet' : 'card', sheetAllowedDetents: [0.6, 1], sheetGrabberVisible: true }} />
        </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
