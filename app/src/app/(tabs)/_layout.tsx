import { NativeTabs } from 'expo-router/native-tabs';
import { usePalette } from '@/lib/theme';

// Four tabs, one job each: Home (your trips and stops, live), Plan (the one place to search a stop or plan a
// trip), Ask (the chat), More (watching, commutes, tools and settings).
export default function TabsLayout() {
  const c = usePalette();
  return (
    <NativeTabs tintColor={c.tint} labelVisibilityMode="labeled">
      <NativeTabs.Trigger labelVisibilityMode="labeled" name="home">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger labelVisibilityMode="labeled" name="search">
        <NativeTabs.Trigger.Label>Plan</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger labelVisibilityMode="labeled" name="ask">
        <NativeTabs.Trigger.Label>Ask</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' }} md="chat" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger labelVisibilityMode="labeled" name="settings">
        <NativeTabs.Trigger.Label>More</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="ellipsis.circle" md="more_horiz" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
