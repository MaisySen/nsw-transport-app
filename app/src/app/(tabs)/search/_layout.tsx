import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { usePalette } from '@/lib/theme';
import { tabHeaderOptions } from '@/lib/headerOptions';

export default function Layout() {
  const c = usePalette();
  return (
    <Stack screenOptions={tabHeaderOptions(Platform.OS, c)}>
      <Stack.Screen name="index" options={{ title: 'Plan' }} />
    </Stack>
  );
}
