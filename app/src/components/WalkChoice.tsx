// Max walk chips on the trip screen (28 Oct): "Max walk" 5, 10 or 15 min and "Prefer bus" over a long walk, one tap
// each, kept for this trip (A to B) on this phone (lib/walkPrefCore.ts, store.tripWalk). A chip that is on goes back to
// Any when pressed again. Same chip look as the mode chips: a filled capsule on iPhone, a Material 3 filter chip on
// Android. No timers, no location.
import { Platform, Pressable, ScrollView } from 'react-native';
import { Icon, I, type IconName } from './Icon';
import { T } from './ui';
import { haptic } from '@/lib/haptic';
import { usePalette } from '@/lib/theme';
import { store } from '@/lib/store';
import { walkChipPress, walkChips, type WalkPref } from '@/lib/walkPrefCore';

/** What a chip says to VoiceOver and TalkBack. */
export function walkChipLabel(max: number, on: boolean): string {
  return `Max walk ${max} min${on ? ', on' : ''}`;
}
export const PREFER_LABEL = 'Prefer bus over long walk';

export function WalkChoice({ pref, tripKey }: { pref: WalkPref; tripKey: string }) {
  const c = usePalette();
  const ios = Platform.OS === 'ios';
  const set = (p: WalkPref) => { haptic.select(); store.setTripWalk(tripKey, p); };
  const chip = (key: string, text: string, label: string, on: boolean, press: () => void, icon?: IconName) => (
    <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={label} onPress={press}
      android_ripple={{ color: c.fill }} hitSlop={{ top: 4, bottom: 4 }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 36, paddingHorizontal: 12, borderRadius: ios ? 18 : 8, marginVertical: 4,
        backgroundColor: on ? c.tint : c.card, borderWidth: on || ios ? 0 : 1, borderColor: c.sep, opacity: pressed ? 0.75 : 1 })}>
      {icon ? <Icon name={icon} size={14} color={on ? '#FFFFFF' : c.text2} /> : null}
      <T kind="sub" style={{ marginLeft: icon ? 5 : 0, color: on ? '#FFFFFF' : c.text, fontWeight: on ? '600' : '400' }}>{text}</T>
    </Pressable>
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: 'center' }} accessibilityLabel="Walking">
      {walkChips(pref).map((m, i) => chip(`w${m}`, i === 0 ? `Max walk ${m} min` : `${m} min`, walkChipLabel(m, pref.max === m), pref.max === m, () => set(walkChipPress(pref, m)), i === 0 ? I.walk : undefined))}
      {chip('prefer', 'Prefer bus', PREFER_LABEL + (pref.prefer ? ', on' : ''), pref.prefer, () => set({ ...pref, prefer: !pref.prefer }), I.bus)}
    </ScrollView>
  );
}
