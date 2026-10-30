// A service that has already gone, on the trip screen's list (a chosen time in the past, or Earlier services).
// Kept apart from Home's ServiceRow on purpose: same layout, greyed, with "Left 6:18" and the live delay it left with.
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { pressService } from '@/lib/prefetch';
import { usePalette } from '@/lib/theme';
import { bestTime, clock, durText, shortName } from '@/lib/format';
import { leftWords } from '@/lib/tripModesCore';
import { goneWords } from '@/lib/boardTimeCore';
import type { Departure, Journey, Leg } from '@/lib/types';
import { LineBadge } from './Transit';
import { font, T } from './ui';
import { boardParts, boardText, placeText, stackColumns, tripLines } from '@/lib/rowTimeCore';
import { rowTime } from '@/lib/rowTime';
import { MUTED } from '@/lib/pastNowCore';

const hm = (t: number) => clock(t).replace(/(am|pm)$/i, '');
const plat = (p?: string | null) => (p ? p.replace(/^Platform\s*/i, 'Plat ') : '');

/** muted (PAST_NOW, 30 Oct): the gone row under the Earlier header, quieter still (faded times and badges, no
 * strikethrough, a little shorter), so it cannot be read as a service still to come. */
export function LeftRow({ j, arrive, onPress, muted }: { j: Journey; arrive: number; onPress: () => void; muted?: boolean }) {
  const c = usePalette();
  const win = useWindowDimensions();
  const legs = j.legs.filter((x) => x.kind === 'transit');
  const l: Leg | undefined = legs[0];
  const dep = l ? bestTime(l.planned, l.realtime ? l.estimated : null) : Date.parse(String(j.leave));
  const cancelled = !!(j.anyCancelled || l?.cancelled);
  const words = leftWords(dep, l ? { realtime: l.realtime, delayMin: l.delayMin, cancelled } : null, rowTime);
  const late = !cancelled && !!l?.realtime && (l.delayMin || 0) > 0;
  const badges = tripLines(j.legs);
  const changes = j.changes || Math.max(0, legs.length - 1);
  const boardAt = plat(l?.fromPlatform);
  // The same columns as the trip screen's ServiceRow (components/Home.tsx), greyed.
  const fromText = boardText(l?.from, l?.fromPlatform);
  const fromBits = boardParts(l?.from, l?.fromPlatform);
  const end = j.legs[j.legs.length - 1];
  const toText = placeText(end?.to || legs[legs.length - 1]?.to);
  const stack = stackColumns(win.width, win.fontScale);
  const names = !!(fromText || toText);
  const strike = cancelled && !muted;
  // Muted (PAST_NOW): on the grey past zone, its own secondary text colour (pastText, 4.5:1 or more on pastBg).
  const t2 = muted ? c.pastText : c.text2;
  const timeStyle = [font.title3, { color: t2, fontVariant: ['tabular-nums'] as any, textDecorationLine: strike ? ('line-through' as const) : ('none' as const) }, muted ? { opacity: MUTED.timeOpacity } : null];
  return (
    <Pressable accessibilityRole="button" onPress={onPress} android_ripple={{ color: c.fill }}
      accessibilityLabel={`${words.replace(' \u00b7 ', ', ')}${fromText ? ` from ${fromText}` : boardAt ? ` from ${boardAt}` : ''}, arrived ${toText ? `${toText} at ` : ''}${rowTime(arrive)}${changes ? `, ${changes} change${changes > 1 ? 's' : ''}` : ''}. Already gone`}
      style={({ pressed }) => [s.row, muted ? { paddingVertical: MUTED.padV } : null, pressed && Platform.OS !== 'android' ? { backgroundColor: c.card2 } : null]}>
      <View style={[s.block, { backgroundColor: muted ? 'transparent' : c.fill, borderWidth: muted ? StyleSheet.hairlineWidth : 0, borderColor: c.sep }]}>
        <Text maxFontSizeMultiplier={1.3} style={{ color: t2, fontSize: 13, fontWeight: '700' }} numberOfLines={1} adjustsFontSizeToFit>{cancelled ? 'Off' : 'Left'}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, marginLeft: 14, flexDirection: stack ? 'column' : 'row' }}>
        <View style={stack ? null : { flex: 1.2, minWidth: 0 }}>
          {names ? (
            <View style={{ flexDirection: 'row' }}>
              <T kind="foot"  numberOfLines={1} style={{ color: t2, flexShrink: 1 }}>{fromBits.name || ' '}</T>
              {fromBits.platform ? <T kind="foot"  numberOfLines={1} style={{ color: t2, marginLeft: 4, flexShrink: 0 }}>{fromBits.platform}</T> : null}
            </View>
          ) : null}
          <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={timeStyle}>{rowTime(dep)}</Text>
          <T kind="foot" numberOfLines={1} style={{ marginTop: 1 }}>
            <T kind="foot" style={{ color: late ? c.lateText : t2, fontWeight: '600' }}>{words}</T>
            <T kind="foot" style={{ color: t2 }}>{` \u00b7 ${durText(j.durationMin)}`}</T>
          </T>
        </View>
        {stack ? null : <Text accessible={false} maxFontSizeMultiplier={1.4} style={[font.body, { color: c.text3, alignSelf: 'center', marginHorizontal: 4 }]}>{'\u2192'}</Text>}
        <View style={stack ? { marginTop: 6 } : { flex: 1, minWidth: 0 }}>
          {names ? <T kind="foot" style={{ color: t2 }} numberOfLines={1}>{toText || ' '}</T> : null}
          <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={timeStyle}>{rowTime(arrive)}</Text>
          {badges.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 3, marginTop: 2, opacity: muted ? MUTED.badgeOpacity : 0.5 }}>
              {badges.slice(0, 4).map((b, i) => <LineBadge key={`${b.line}${i}`} line={b.line} mode={b.mode} color={b.color} />)}
              {badges.length > 4 ? <T kind="foot" style={{ color: t2 }}>{`+${badges.length - 4}`}</T> : null}
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

/** A service that has gone, on a stop's board (Earlier departures or a time picked in the past): the board's row
 * layout, greyed, with "Left 6:18 · 3 min late" (the live delay it left with), "Left 6:18 · Scheduled" or
 * "Cancelled 6:18", and the trip screen's Left block. Opens the service like any other row. */
export function LeftDepartureRow({ d, stopNo, onPress, muted }: { d: Departure; stopNo?: string | null; onPress: () => void; muted?: boolean }) {
  const c = usePalette();
  const words = goneWords(d, hm);
  const t2 = muted ? c.pastText : c.text2;
  const late = !d.cancelled && !!d.realtime && (d.delayMin || 0) > 0;
  const extra = [plat(d.platform), stopNo || ''].filter(Boolean);
  return (
    <Pressable accessibilityRole="button" onPress={onPress} onPressIn={() => pressService(d)} android_ripple={{ color: c.fill }}
      accessibilityLabel={`${d.line} to ${shortName(d.dest)}. ${words.replace(' \u00b7 ', ', ')}${extra.length ? `, ${extra.join(', ')}` : ''}. Already gone`}
      style={({ pressed }) => [s.depRow, muted ? { paddingVertical: MUTED.padV, minHeight: 56 } : null, { backgroundColor: pressed && Platform.OS === 'ios' ? (muted ? c.fill : c.card2) : muted ? c.pastBg : c.card }]}>
      <View style={{ width: 66, alignItems: 'flex-start', opacity: muted ? MUTED.badgeOpacity : 0.5 }}><LineBadge line={d.line} mode={d.mode} color={d.color} kind /></View>
      <View style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
        <T kind="headline" numberOfLines={2} style={{ color: t2, textDecorationLine: d.cancelled && !muted ? 'line-through' : 'none' }}>{shortName(d.dest)}</T>
        <T kind="foot" numberOfLines={2} style={{ marginTop: 3 }}>
          <T kind="foot" style={{ color: late ? c.lateText : t2, fontWeight: '600' }}>{words}</T>
          {extra.length ? <T kind="foot" style={{ color: t2 }}>{` \u00b7 ${extra.join(' \u00b7 ')}`}</T> : null}
        </T>
      </View>
      <View style={[s.block, s.small, { backgroundColor: muted ? 'transparent' : c.fill, borderWidth: muted ? StyleSheet.hairlineWidth : 0, borderColor: c.sep }]}>
        <Text maxFontSizeMultiplier={1.3} style={{ color: t2, fontSize: 13, fontWeight: '700' }} numberOfLines={1} adjustsFontSizeToFit>{d.cancelled ? 'Off' : 'Left'}</Text>
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
