import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { usePalette } from '@/lib/theme';

export default function Layout() {
  const c = usePalette();
  return (
    <Stack screenOptions={{ headerLargeTitle: true, headerTransparent: Platform.OS === 'ios', headerBlurEffect: 'systemChromeMaterial', headerLargeTitleShadowVisible: false, headerShadowVisible: false, headerTintColor: c.tint, headerStyle: Platform.OS === 'android' ? { backgroundColor: c.bg } : undefined, contentStyle: { backgroundColor: c.bg } }}>
      <Stack.Screen name="index" options={{ title: 'Trips' }} />
    </Stack>
  );
}
