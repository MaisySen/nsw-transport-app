import { useEffect, useState } from 'react';
import { AppState, Platform, useColorScheme } from 'react-native';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import { pollNotes } from '@/lib/push';
import { initProfile } from '@/lib/device';
import { usePalette } from '@/lib/theme';

export default function RootLayout() {
  const scheme = useColorScheme();
  const c = usePalette();
  const [ready, setReady] = useState(false);

  // Every install has its own profile on the server; read or create it before the first request.
  useEffect(() => {
    initProfile().catch(() => {}).finally(() => setReady(true));
  }, []);

  // Keep alerts coming while the app is open, and open the right screen when an alert is tapped.
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => { if (AppState.currentState === 'active') pollNotes(); }, 20000);
    pollNotes();
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const d: any = r.notification.request.content.data || {};
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
        <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal', headerTintColor: c.tint, contentStyle: { backgroundColor: c.bg } }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="stop/[id]" options={{ title: '', headerLargeTitle: Platform.OS === 'ios', headerTransparent: Platform.OS === 'ios', headerBlurEffect: 'systemChromeMaterial', headerLargeTitleShadowVisible: false, headerShadowVisible: false }} />
          <Stack.Screen name="trip" options={{ title: 'Trips', headerLargeTitle: false }} />
          <Stack.Screen name="service" options={{ headerShown: false, presentation: 'card' }} />
          <Stack.Screen name="add-trip" options={{ title: 'Add a trip', presentation: Platform.OS === 'ios' ? 'modal' : 'card' }} />
          <Stack.Screen name="watch/[id]" options={{ title: 'Watching', presentation: Platform.OS === 'ios' ? 'formSheet' : 'card', sheetAllowedDetents: [0.6, 1], sheetGrabberVisible: true }} />
        </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
