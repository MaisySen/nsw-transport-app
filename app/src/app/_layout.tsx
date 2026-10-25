import { useEffect, useState } from 'react';
import { AppState, Platform, useColorScheme } from 'react-native';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import { pollNotes, pollNotesTick } from '@/lib/push';
import { startAppPoll } from '@/lib/activity';
import { endLive, setupLiveNotifications } from '@/lib/live';
import { finishProfileMove, initProfile } from '@/lib/device';
import { loadCachedConfig, refreshConfig } from '@/lib/config';
import { api } from '@/lib/api';
import { morningTripParams } from '@/lib/morning';
import { store } from '@/lib/store';
import { usePalette } from '@/lib/theme';
import { sheetHeaderOptions, stopHeaderOptions } from '@/lib/headerOptions';
import { LiftAlertSync } from '@/lib/liftAlerts';
import { LiveTripEngine } from '@/lib/liveEngine';

export default function RootLayout() {
  const scheme = useColorScheme();
  const c = usePalette();
  const [ready, setReady] = useState(false);

  // Every install has its own profile on the server; read or create it before the first request.
  useEffect(() => {
    // The last good remote config (and server address) is read before the first request.
    Promise.all([initProfile().catch(() => {}), loadCachedConfig()]).finally(() => { setReady(true); finishProfileMove(api); refreshConfig(true); });
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refreshConfig(); });
    return () => sub.remove();
  }, []);

  // Keep alerts coming while the app is open, and open the right screen when an alert is tapped.
  useEffect(() => {
    if (!ready) return;
    // Only while the app is in front (activity.ts); with a push token the server is asked once a minute (push.ts).
    const poll = startAppPoll(pollNotesTick, 20000, { runAtStart: false });
    pollNotes();
    setupLiveNotifications();
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const d: any = r.notification.request.content.data || {};
      // Buttons on the ongoing trip notification.
      if (r.actionIdentifier === 'end') { endLive().finally(() => router.replace('/')); return; }
      if (r.actionIdentifier === 'share') { router.push({ pathname: '/go', params: { share: '1' } }); return; }
      if (d.go) { router.push('/go'); return; }
      // A trip reminder opens its saved trip with live times.
      if (d.tripOpen && typeof d.tripOpen === 'object') { router.push({ pathname: '/trip', params: d.tripOpen }); return; }
      // A morning check alert (tag m<id>) opens its trip with live times and Plan B; a check not on the phone opens the checks.
      if (typeof d.tag === 'string' && /^m[A-Za-z0-9]/.test(d.tag)) {
        const open = morningTripParams(d.tag, store.morningList());
        if (open) router.push({ pathname: '/trip', params: open }); else router.push('/morning');
        return;
      }
      if (d.watch) router.push({ pathname: '/watch/[id]', params: { id: String(d.watch) } });
    });
    return () => { poll.remove(); sub.remove(); };
  }, [ready]);

  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  if (!ready) return null;
  const theme = { ...base, colors: { ...base.colors, primary: c.tint, background: c.bg, card: c.card, text: c.text, border: c.sep } };
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={theme}>
        <StatusBar style="auto" />
        <LiftAlertSync />
        <LiveTripEngine />
        {/* Every screen stays upright; only the departure board turns sideways (build 205 lets iPhone turn). */}
        <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal', headerTintColor: c.tint, contentStyle: { backgroundColor: c.bg }, orientation: 'portrait_up' }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="stop/[id]" options={stopHeaderOptions(Platform.OS)} />
          <Stack.Screen name="trip" options={{ title: 'Trips', headerLargeTitle: false }} />
          <Stack.Screen name="board" options={{ headerShown: false, presentation: Platform.OS === 'ios' ? 'fullScreenModal' : 'card', orientation: 'all' }} />
          <Stack.Screen name="service" options={{ headerShown: false, presentation: 'card' }} />
          <Stack.Screen name="go" options={{ headerShown: false, presentation: 'card' }} />
          <Stack.Screen name="topup" options={{ title: 'Opal machines' }} />
          <Stack.Screen name="parking" options={{ title: 'Park and Ride' }} />
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
