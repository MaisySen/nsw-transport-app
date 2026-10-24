import { useEffect, useState } from 'react';
import { AppState, Platform, useColorScheme } from 'react-native';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import { pollNotes } from '@/lib/push';
import { endLive, setupLiveNotifications } from '@/lib/live';
import { finishProfileMove, initProfile } from '@/lib/device';
import { loadCachedConfig, refreshConfig } from '@/lib/config';
import { api } from '@/lib/api';
import { usePalette } from '@/lib/theme';
import { stopHeaderOptions } from '@/lib/headerOptions';
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
    const id = setInterval(() => { if (AppState.currentState === 'active') pollNotes(); }, 20000);
    pollNotes();
    setupLiveNotifications();
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const d: any = r.notification.request.content.data || {};
      // Buttons on the ongoing trip notification.
      if (r.actionIdentifier === 'end') { endLive().finally(() => router.replace('/')); return; }
      if (r.actionIdentifier === 'share') { router.push({ pathname: '/go', params: { share: '1' } }); return; }
      if (d.go) { router.push('/go'); return; }
      // A morning check alert (tag m<id>) opens the checks, where Check now shows the latest.
      if (typeof d.tag === 'string' && /^m[A-Za-z0-9]/.test(d.tag)) { router.push('/morning'); return; }
      if (d.watch) router.push({ pathname: '/watch/[id]', params: { id: String(d.watch) } });
    });
    return () => { clearInterval(id); sub.remove(); };
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
          <Stack.Screen name="new-trip" options={{ title: 'New trip', presentation: Platform.OS === 'ios' ? 'modal' : 'card' }} />
          <Stack.Screen name="add-trip" options={{ title: 'Add a trip', presentation: Platform.OS === 'ios' ? 'modal' : 'card' }} />
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
