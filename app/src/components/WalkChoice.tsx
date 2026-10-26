// Walking on the trip screen: the longest walk a trip may have (Any, 5, 10, 15, 20 min) and Prefer a bus over a long
// walk, in one system menu (lib/walkPrefCore.ts). Kept on this phone for every trip.
import { Platform, Pressable, View } from 'react-native';
import { PullDownButton } from './HoldMenu';
import { Icon, I } from './Icon';
import { T } from './ui';
import { haptic } from '@/lib/haptic';
import { radius, usePalette } from '@/lib/theme';
import { store } from '@/lib/store';
import { WALK_CHOICES, walkValueText, type WalkPref } from '@/lib/walkPrefCore';
import type { MenuSpec } from '@/lib/menuCore';

export function walkMenu(pref: WalkPref, set: (p: WalkPref) => void, os: string = Platform.OS): MenuSpec {
  const pick = (max: number) => () => { haptic.select(); set({ ...pref, max }); };
  const items = WALK_CHOICES.map((m) => {
    const on = pref.max === m;
    // The iPhone menu here is a system sheet of plain buttons (no icons), so the chosen one carries a check mark in its words.
    const text = `${m ? `Up to ${m} min` : 'Any walk'}${on && os === 'ios' ? ' \u2713' : ''}`;
    return { text, sf: on ? 'checkmark' : 'figure.walk', icon: on ? 'check' : 'walk', destructive: false, onPress: pick(m) };
  });
  items.push({ text: pref.prefer ? 'Stop preferring a bus' : 'Prefer a bus', sf: pref.prefer ? 'xmark' : 'bus', icon: pref.prefer ? 'close' : 'bus', destructive: false,
    onPress: () => { haptic.select(); set({ ...pref, prefer: !pref.prefer }); } });
  return { title: 'Walking', message: 'The longest walk on a trip; trips with a longer walk are not shown. Prefer a bus puts a trip with a long walk below one that walks less and arrives up to 10 min later.', items };
}

export function WalkChoice({ pref }: { pref: WalkPref }) {
  const c = usePalette();
  const menu = walkMenu(pref, (p) => store.setWalkPref(p));
  const value = walkValueText(pref);
  return (
    <View style={{ marginHorizontal: 16, marginTop: 12, backgroundColor: c.card, borderRadius: radius, overflow: 'hidden' }}>
      <PullDownButton menu={menu}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Walking, ${value}`} accessibilityHint="Choose the longest walk on a trip"
          android_ripple={{ color: c.fill }}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 48, backgroundColor: pressed && Platform.OS === 'ios' ? c.card2 : c.card })}>
          <Icon name={I.walk} size={17} color={c.text2} />
          <T kind="body" style={{ flex: 1, marginLeft: 10 }}>Walking</T>
          <T kind="body" tone="text2" numberOfLines={1}>{value}</T>
          <Icon name={I.chevron} size={12} color={c.text3} style={{ marginLeft: 6, transform: [{ rotate: '90deg' }] }} />
        </Pressable>
      </PullDownButton>
    </View>
  );
}
