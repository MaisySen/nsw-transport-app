import { Platform } from 'react-native';
import { NativeTabs } from 'expo-router/native-tabs';
import { usePalette } from '@/lib/theme';

// iPhone: no background or label colours of our own, so iOS 26 draws the Liquid Glass tab bar (and earlier iOS the
// standard translucent bar) with system label colours, which adapt to light, dark and Increase Contrast.
const ios = Platform.OS === 'ios';

// Four tabs, one job each: Home (your trips and stops, live), Plan (the one place to search a stop or plan a
// trip), Ask (the chat), More (watching, commutes, tools and settings).
export default function TabsLayout() {
  const c = usePalette();
  return (
    <NativeTabs tintColor={c.tint} labelVisibilityMode="labeled" backgroundColor={ios ? undefined : c.card}
      // Explicit colours so labels pass 4.5:1 in light and dark (Android and the web preview).
      labelStyle={ios ? undefined : { default: { color: c.text2 }, selected: { color: c.tint } }}
      iconColor={ios ? undefined : { default: c.text2, selected: c.tint }}
      indicatorColor={c.dark ? '#2A3B57' : '#DCE6F8'} rippleColor={c.fill}>
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
