// A service that has already gone, on the trip screen's list (a chosen time in the past, or Earlier services).
// Kept apart from Home's ServiceRow on purpose: same layout, greyed, with "Left 6:18" and the live delay it left with.
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { usePalette } from '@/lib/theme';
import { bestTime, clock, durText } from '@/lib/format';
import { leftWords } from '@/lib/tripModesCore';
import type { Journey, Leg } from '@/lib/types';
import { LineBadge } from './Transit';
import { font, T } from './ui';

const hm = (t: number) => clock(t).replace(/(am|pm)$/i, '');
const plat = (p?: string | null) => (p ? p.replace(/^Platform\s*/i, 'Plat ') : '');

export function LeftRow({ j, arrive, onPress }: { j: Journey; arrive: number; onPress: () => void }) {
  const c = usePalette();
  const legs = j.legs.filter((x) => x.kind === 'transit');
  const l: Leg | undefined = legs[0];
  const dep = l ? bestTime(l.planned, l.realtime ? l.estimated : null) : Date.parse(String(j.leave));
  const cancelled = !!(j.anyCancelled || l?.cancelled);
  const words = leftWords(dep, l ? { realtime: l.realtime, delayMin: l.delayMin, cancelled } : null, hm);
  const late = !cancelled && !!l?.realtime && (l.delayMin || 0) > 0;
  const badges: Leg[] = [];
  for (const x of legs) if (x.line && !badges.some((b) => b.line === x.line)) badges.push(x);
  const changes = j.changes || Math.max(0, legs.length - 1);
  const boardAt = plat(l?.fromPlatform);
  return (
    <Pressable accessibilityRole="button" onPress={onPress} android_ripple={{ color: c.fill }}
      accessibilityLabel={`${words.replace(' \u00b7 ', ', ')}${boardAt ? ` from ${boardAt}` : ''}, arrived ${hm(arrive)}${changes ? `, ${changes} change${changes > 1 ? 's' : ''}` : ''}. Already gone`}
      style={({ pressed }) => [s.row, pressed && Platform.OS !== 'android' ? { backgroundColor: c.card2 } : null]}>
      <View style={[s.block, { backgroundColor: c.fill }]}>
        <Text maxFontSizeMultiplier={1.3} style={{ color: c.text2, fontSize: 13, fontWeight: '700' }} numberOfLines={1} adjustsFontSizeToFit>{cancelled ? 'Off' : 'Left'}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, marginLeft: 14 }}>
        <Text maxFontSizeMultiplier={1.4} style={[font.title3, { color: c.text2, fontVariant: ['tabular-nums'], textDecorationLine: cancelled ? 'line-through' : 'none' }]}>{hm(dep)}{' '}<Text style={{ color: c.text3, fontWeight: '400' }}>{'\u2192'}</Text>{' '}{hm(arrive)}</Text>
        <T kind="foot" numberOfLines={1} style={{ marginTop: 2 }}>
          <T kind="foot" style={{ color: late ? c.lateText : c.text2, fontWeight: '600' }}>{words}</T>
          {boardAt ? <T kind="foot" tone="text2">{` \u00b7 ${boardAt}`}</T> : null}
          <T kind="foot" tone="text2">{` \u00b7 ${durText(j.durationMin)}`}</T>
        </T>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 8, opacity: 0.5 }}>
        {badges.slice(0, 3).map((b, i) => <LineBadge key={`${b.line}${i}`} line={b.line} mode={b.mode} color={b.color} />)}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 16, paddingVertical: 12 },
  block: { width: 56, alignSelf: 'stretch', minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
});
