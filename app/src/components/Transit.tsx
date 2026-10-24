import { memo, useEffect, useRef } from 'react';
import { offlineText } from '@/lib/offlineCore';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
// Buttons revealed by a swipe use the gesture handler's Pressable: on Android a React Native Pressable there
// can lose its press to the swipe gesture.
import { Pressable as GHPressable } from 'react-native-gesture-handler';
import { haptic } from '@/lib/haptic';
import { modeColor, onColor, usePalette } from '@/lib/theme';
import { bestTime, clock, countdown, countdownKey, delayWords, ms, shortName } from '@/lib/format';
import type { Departure, Journey, Leg } from '@/lib/types';
import { Icon, I, modeIconName } from './Icon';
import { font, T } from './ui';
import { useFlag } from '@/lib/config';
import { occBusy, occText } from '@/lib/occupancy';
import type { Occupancy } from '@/lib/types';

/** A small "Few seats" chip when Transport for NSW sends occupancy for this service; nothing when it does not. */
export function OccupancyChip({ o, style }: { o?: Occupancy; style?: any }) {
  const c = usePalette();
  const on = useFlag('occupancy');
  const text = occText(o, on);
  if (!text) return null;
  const busy = occBusy(o);
  return (
    <View accessible accessibilityLabel={`Crowding: ${text}`} style={[st.occ, { backgroundColor: c.fill }, style]}>
      <Icon name={I.people} size={11} color={busy ? c.lateText : c.text2} />
      <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={[font.caption, { color: busy ? c.lateText : c.text2, fontWeight: '600', marginLeft: 3 }]}>{text}</Text>
    </View>
  );
}

export function LineBadge({ line, mode, color, small }: { line?: string; mode?: string; color?: string; small?: boolean }) {
  const bg = color || modeColor[mode || 'bus'] || '#888888';
  const fg = onColor(bg);
  return (
    <View style={[st.badge, small && st.badgeSm, { backgroundColor: bg }]}>
      <Icon name={modeIconName(mode)} size={small ? 11 : 13} color={fg} />
      {line ? <Text maxFontSizeMultiplier={1.3} style={[st.badgeText, { color: fg }, small && { fontSize: 13 }]} numberOfLines={1}>{line}</Text> : null}
    </View>
  );
}

/** Pulsing green dot, iOS style, that beats once on each refresh. */
export function LiveDot({ beat, size = 7, color }: { beat?: any; size?: number; color?: string }) {
  const c = usePalette();
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    a.setValue(0);
    Animated.timing(a, { toValue: 1, duration: 1200, useNativeDriver: true }).start();
  }, [beat, a]);
  const col = color || c.green;
  return (
    <View style={{ width: size * 2.4, height: size * 2.4, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ position: 'absolute', width: size * 2.4, height: size * 2.4, borderRadius: size * 1.2, backgroundColor: col, opacity: a.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }), transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] }} />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: col }} />
    </View>
  );
}

export function LiveStamp({ updatedAt, error, offlineAt }: { updatedAt: number | null; error?: string | null; offlineAt?: number | null }) {
  const c = usePalette();
  if (offlineAt) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <LiveDot beat={offlineAt} color={c.orange} />
        <T kind="foot" tone="text2" style={{ marginLeft: 2 }}>{offlineText(offlineAt, Date.now())}</T>
      </View>
    );
  }
  if (!updatedAt) return <T kind="foot" tone="text2">{error ? 'Live times unavailable right now, trying again' : 'Loading live times'}</T>;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <LiveDot beat={updatedAt} color={error ? c.orange : undefined} />
      <T kind="foot" tone="text2" style={{ marginLeft: 2 }}>
        {error ? `Offline, last update ${clock(updatedAt)}` : `Live, updated ${new Date(updatedAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Australia/Sydney' }).replace(' ', '')}`}
      </T>
    </View>
  );
}

export function StatusLine({ realtime, delayMin, cancelled }: { realtime?: boolean; delayMin?: number | null; cancelled?: boolean }) {
  const c = usePalette();
  const d = delayWords(delayMin, realtime, cancelled);
  const color = d.tone === 'green' ? c.liveText : d.tone === 'orange' ? c.lateText : d.tone === 'red' ? c.redText : c.text2;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {realtime && !cancelled ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, marginRight: 5 }} /> : null}
      {!realtime && !cancelled ? <Icon name={I.clock} size={12} color={c.text2} style={{ marginRight: 4 }} /> : null}
      <Text maxFontSizeMultiplier={1.4} style={[font.foot, { color, fontWeight: realtime ? '600' : '400' }]}>{d.text}</Text>
    </View>
  );
}

/** The big right-hand number. Live times are bold and coloured; scheduled ones stay grey so they never pass for live. */
export function Countdown({ planned, estimated, realtime, cancelled, now, align = 'right' }: { planned?: string; estimated?: string | null; realtime?: boolean; cancelled?: boolean; now: number; align?: 'right' | 'left' }) {
  const c = usePalette();
  const t = bestTime(planned, realtime ? estimated : null);
  const cd = countdown(t, now);
  const changed = realtime && estimated && planned && Math.abs(ms(estimated) - ms(planned)) >= 60000;
  const color = cancelled ? c.text3 : realtime ? (cd.soon ? c.liveText : c.text) : c.text2;
  return (
    <View style={{ alignItems: align === 'right' ? 'flex-end' : 'flex-start', minWidth: 56 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text maxFontSizeMultiplier={1.3} style={[{ fontSize: cd.big.length > 4 ? 19 : 26, fontWeight: '700', color, fontVariant: ['tabular-nums'], letterSpacing: -0.5 }, cancelled && { textDecorationLine: 'line-through' }]}>{cd.big}</Text>
        {cd.unit ? <Text maxFontSizeMultiplier={1.3} style={[font.foot, { color, marginLeft: 2, fontWeight: '600' }]}>{cd.unit}</Text> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {changed ? <Text style={[font.caption, { color: c.text3, textDecorationLine: 'line-through' }]}>{clock(ms(planned))}</Text> : null}
        <Text style={[font.caption, { color: c.text2, fontVariant: ['tabular-nums'] }]}>{clock(t)}</Text>
      </View>
    </View>
  );
}

export const DepartureRow = memo(DepartureRowView, sameDepartureRow);

type DepartureRowProps = { d: Departure; now: number; onPress: () => void; onWatch?: () => void; watched?: boolean; showStop?: boolean; alertText?: string | null };

/**
 * A row redraws when its departure, watch state, note or the countdown it shows changes; not on every clock tick.
 * Callers pass fresh arrow functions each render that only close over `d` and `watched`, which are compared here.
 */
function sameDepartureRow(a: DepartureRowProps, b: DepartureRowProps) {
  return a.d === b.d && a.watched === b.watched && a.showStop === b.showStop && a.alertText === b.alertText && !!a.onWatch === !!b.onWatch
    && countdownKey(a.d.planned, a.d.estimated, a.d.realtime, a.now) === countdownKey(b.d.planned, b.d.estimated, b.d.realtime, b.now);
}

function DepartureRowView({ d, now, onPress, onWatch, watched, showStop, alertText }: { d: Departure; now: number; onPress: () => void; onWatch?: () => void; watched?: boolean; showStop?: boolean; alertText?: string | null }) {
  const c = usePalette();
  const sw = useRef<any>(null);
  const extra: string[] = [];
  if (d.platform) extra.push(d.platform.replace(/^Platform /, 'Plat. '));
  if (d.stopsAway != null && d.realtime && d.stopsAway >= 0 && d.stopsAway <= 15) extra.push(d.stopsAway === 0 ? 'At the stop' : `${d.stopsAway} stop${d.stopsAway === 1 ? '' : 's'} away`);
  const right = () => (
    <GHPressable onPress={() => { sw.current?.close(); onWatch?.(); }} accessibilityRole="button" accessibilityLabel={watched ? 'Stop watching' : 'Watch'} style={[st.swipeAct, { backgroundColor: watched ? c.text2 : c.indigo }]}>
      <Icon name={watched ? I.bellOff : I.bell} size={20} color="#fff" />
      <Text style={[font.foot, { color: '#fff', fontWeight: '600', marginTop: 3 }]}>{watched ? 'Stop' : 'Watch'}</Text>
    </GHPressable>
  );
  const body = (
    <Pressable accessibilityRole="button" onPress={onPress} onLongPress={onWatch ? () => { haptic.tap(); onWatch(); } : undefined}
      android_ripple={{ color: c.fill }} style={({ pressed }) => [st.depRow, { backgroundColor: pressed && Platform.OS === 'ios' ? c.card2 : c.card }]}>
      <View style={{ width: 66, alignItems: 'flex-start' }}><LineBadge line={d.line} mode={d.mode} color={d.color} /></View>
      <View style={{ flex: 1, marginRight: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <T kind="headline" numberOfLines={1} style={{ flexShrink: 1 }}>{shortName(d.dest)}</T>
          {watched ? <Icon name={I.bell} size={13} color={c.indigo} style={{ marginLeft: 5 }} /> : null}
        </View>
        {showStop && d.stopName ? <T kind="foot" tone="text2" numberOfLines={1}>{shortName(d.stopName)}</T> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3, flexWrap: 'wrap', gap: 6 }}>
          <StatusLine realtime={d.realtime} delayMin={d.delayMin} cancelled={d.cancelled} />
          {extra.length ? <T kind="foot" tone="text2" numberOfLines={1}>{extra.join(' \u00b7 ')}</T> : null}
          <OccupancyChip o={d.occupancy} />
        </View>
        {d.platformChangedFrom ? <T kind="foot" style={{ color: c.lateText, fontWeight: '600', marginTop: 2 }}>Platform changed from {d.platformChangedFrom}</T> : null}
        {d.pred && !d.realtime ? <T kind="caption" tone="text2" style={{ marginTop: 2 }}>Prediction: {d.pred.short || d.pred.text} ({d.pred.n} trips)</T> : null}
        {alertText ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
            <Icon name={I.warn} size={12} color={c.orange} />
            <T kind="foot" numberOfLines={1} style={{ color: c.lateText, marginLeft: 4, flex: 1 }}>{alertText}</T>
          </View>
        ) : null}
      </View>
      <Countdown planned={d.planned} estimated={d.estimated} realtime={d.realtime} cancelled={d.cancelled} now={now} />
    </Pressable>
  );
  if (!onWatch) return body;
  return (
    <ReanimatedSwipeable ref={sw} friction={2} rightThreshold={40} renderRightActions={right} overshootRight={false}
      onSwipeableWillOpen={() => haptic.select()}>
      {body}
    </ReanimatedSwipeable>
  );
}

function legLine(l: Leg) {
  return l.kind === 'walk' ? null : <LineBadge small line={l.line} mode={l.mode} color={l.color} />;
}

export function JourneyCard({ j, now, onPress, best }: { j: Journey; now: number; onPress: () => void; best?: boolean }) {
  const c = usePalette();
  const leave = ms(j.leave);
  const mins = Math.round((leave - now) / 60000);
  const first = j.legs.find((l) => l.kind === 'transit');
  const leaveText = mins <= 0 ? 'Leave now' : mins < 60 ? `Leave in ${mins} min` : `Leave ${clock(leave)}`;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} android_ripple={{ color: c.fill }} style={({ pressed }) => [st.jRow, pressed && Platform.OS === 'ios' ? { backgroundColor: c.card2 } : null]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text maxFontSizeMultiplier={1.3} style={[font.title3, { color: j.live ? (mins <= 3 ? c.liveText : c.text) : c.text, fontVariant: ['tabular-nums'] }]}>{leaveText}</Text>
            {best ? <View style={[st.tag, { backgroundColor: c.fill }]}><Text style={[font.caption, { color: c.tint, fontWeight: '700' }]}>BEST</Text></View> : null}
          </View>
          <T kind="sub" tone="text2" style={{ marginTop: 2, fontVariant: ['tabular-nums'] }}>
            {clock(ms(j.board))} to {clock(ms(j.arrive))} {'\u00b7'} {j.durationMin} min{j.changes ? ` \u00b7 ${j.changes} change${j.changes > 1 ? 's' : ''}` : ''}
          </T>
        </View>
        <StatusLine realtime={first?.realtime} delayMin={first?.delayMin} cancelled={j.anyCancelled} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 10, gap: 5 }}>
        {j.legs.map((l, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            {i > 0 ? <Icon name={I.chevron} size={10} color={c.text3} /> : null}
            {l.kind === 'walk' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Icon name={I.walk} size={14} color={c.text2} />
                <T kind="caption" tone="text2">{l.durationMin}</T>
              </View>
            ) : legLine(l)}
          </View>
        ))}
      </View>
      {first?.fromPlatform ? <T kind="foot" tone="text2" style={{ marginTop: 8 }}>From {shortName(first.from)}, {first.fromPlatform}</T> : null}
      {j.risk ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
          <Icon name={I.warn} size={12} color={c.orange} />
          <T kind="foot" style={{ color: c.lateText, marginLeft: 4 }}>{j.riskText || 'Tight change'}</T>
        </View>
      ) : null}
    </Pressable>
  );
}

const st = StyleSheet.create({
  occ: { flexDirection: 'row', alignItems: 'center', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start' },
  badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 7, height: 26, borderRadius: 7, gap: 4, maxWidth: 66 },
  badgeSm: { height: 22, paddingHorizontal: 6, borderRadius: 6, gap: 3 },
  badgeText: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  depRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 16, paddingVertical: 11, minHeight: 64 },
  swipeAct: { width: 88, alignItems: 'center', justifyContent: 'center' },
  jRow: { paddingHorizontal: 16, paddingVertical: 14 },
  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
});
