import { NativeTabs } from 'expo-router/native-tabs';
import { usePalette } from '@/lib/theme';

export default function TabsLayout() {
  const c = usePalette();
  return (
    <NativeTabs tintColor={c.tint} labelVisibilityMode="labeled">
      <NativeTabs.Trigger labelVisibilityMode="labeled" name="home">
        <NativeTabs.Trigger.Label>Trips</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger labelVisibilityMode="labeled" name="search">
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger labelVisibilityMode="labeled" name="watching">
        <NativeTabs.Trigger.Label>Watching</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'bell', selected: 'bell.fill' }} md="notifications" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger labelVisibilityMode="labeled" name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} md="settings" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
