// A service that has already gone, on the trip screen's list (a chosen time in the past, or Earlier services).
// Kept apart from Home's ServiceRow on purpose: same layout, greyed, with "Left 6:18" and the live delay it left with.
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { usePalette } from '@/lib/theme';
import { bestTime, clock, durText, shortName } from '@/lib/format';
import { leftWords } from '@/lib/tripModesCore';
import { goneWords } from '@/lib/boardTimeCore';
import type { Departure, Journey, Leg } from '@/lib/types';
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

/** A service that has gone, on a stop's board (Earlier departures or a time picked in the past): the board's row
 * layout, greyed, with "Left 6:18 · 3 min late" (the live delay it left with), "Left 6:18 · Scheduled" or
 * "Cancelled 6:18", and the trip screen's Left block. Opens the service like any other row. */
export function LeftDepartureRow({ d, stopNo, onPress }: { d: Departure; stopNo?: string | null; onPress: () => void }) {
  const c = usePalette();
  const words = goneWords(d, hm);
  const late = !d.cancelled && !!d.realtime && (d.delayMin || 0) > 0;
  const extra = [plat(d.platform), stopNo || ''].filter(Boolean);
  return (
    <Pressable accessibilityRole="button" onPress={onPress} android_ripple={{ color: c.fill }}
      accessibilityLabel={`${d.line} to ${shortName(d.dest)}. ${words.replace(' \u00b7 ', ', ')}${extra.length ? `, ${extra.join(', ')}` : ''}. Already gone`}
      style={({ pressed }) => [s.depRow, { backgroundColor: pressed && Platform.OS === 'ios' ? c.card2 : c.card }]}>
      <View style={{ width: 66, alignItems: 'flex-start', opacity: 0.5 }}><LineBadge line={d.line} mode={d.mode} color={d.color} /></View>
      <View style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
        <T kind="headline" numberOfLines={2} style={{ color: c.text2, textDecorationLine: d.cancelled ? 'line-through' : 'none' }}>{shortName(d.dest)}</T>
        <T kind="foot" numberOfLines={2} style={{ marginTop: 3 }}>
          <T kind="foot" style={{ color: late ? c.lateText : c.text2, fontWeight: '600' }}>{words}</T>
          {extra.length ? <T kind="foot" tone="text2">{` \u00b7 ${extra.join(' \u00b7 ')}`}</T> : null}
        </T>
      </View>
      <View style={[s.block, s.small, { backgroundColor: c.fill }]}>
        <Text maxFontSizeMultiplier={1.3} style={{ color: c.text2, fontSize: 13, fontWeight: '700' }} numberOfLines={1} adjustsFontSizeToFit>{d.cancelled ? 'Off' : 'Left'}</Text>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 16, paddingVertical: 12 },
  block: { width: 56, alignSelf: 'stretch', minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  small: { alignSelf: 'center', minHeight: 36, width: 52 },
  depRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 11, minHeight: 64 },
});
