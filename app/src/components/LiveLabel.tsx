import { Text, View } from 'react-native';
import { usePalette } from '@/lib/theme';
import { clock, delayWords } from '@/lib/format';
import { liveState, liveWords, type LiveInput, type LiveState } from '@/lib/liveLabelCore';
import { Icon, I } from './Icon';
import { font } from './ui';

// The one place a countdown and its label are drawn. Departures, the trip screen, the service screen, the live trip
// and Home use these, so a time always says where it comes from (docs/LIVE-LABELS.md).

export type LiveProps = LiveInput & { delayMin?: number | null; now: number };

/** The label line: "3 min late · Live, updated 20 s ago", "Timetable", "Not tracking", "Cancelled". */
export function LiveStatus({ state, delayMin, compact, timetableText }: { state: LiveState; delayMin?: number | null; compact?: boolean; timetableText?: string }) {
  const c = usePalette();
  if (state.kind === 'cancelled') {
    return <Text maxFontSizeMultiplier={1.4} style={[font.foot, { color: c.redText, fontWeight: '600' }]}>Cancelled</Text>;
  }
  if (state.kind === 'timetable') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityLabel={timetableText ? `${timetableText}, no live data` : 'Timetable time, no live data'}>
        <Icon name={I.clock} size={12} color={c.text2} style={{ marginRight: 4 }} />
        <Text maxFontSizeMultiplier={1.4} style={[font.foot, { color: c.text2 }]}>{timetableText || 'Timetable'}</Text>
      </View>
    );
  }
  if (state.kind === 'stale') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityLabel={`Not tracking${state.age ? `, last live time ${state.age}` : ''}`}>
        <Icon name={I.noLive} size={12} color={c.lateText} style={{ marginRight: 4 }} />
        <Text maxFontSizeMultiplier={1.4} style={[font.foot, { color: c.lateText, fontWeight: '600' }]}>Not tracking</Text>
      </View>
    );
  }
  const d = delayWords(delayMin, true, false);
  const color = d.tone === 'green' ? c.liveText : d.tone === 'orange' ? c.lateText : d.tone === 'red' ? c.redText : c.text2;
  const words = compact ? (state.age && state.age !== 'just now' ? `Live ${state.age}` : 'Live') : liveWords(state);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }} accessibilityLabel={`${d.text}, ${liveWords(state)}`}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, marginRight: 5 }} />
      {/* compact (a row of a list): one line, so the row keeps its height as "Live" becomes "Live 30 s ago" between
          refreshes; before, the longer words wrapped and every row below jumped down (g13). The full words are in the label. */}
      <Text maxFontSizeMultiplier={1.4} numberOfLines={compact ? 1 : undefined} style={[font.foot, { color, fontWeight: '600', flexShrink: 1 }]}>
        {d.text}<Text style={{ color: c.text2, fontWeight: '400' }}>{` \u00b7 ${words}`}</Text>
      </Text>
    </View>
  );
}

/** The big right-hand number. Live times are bold, timetable times grey, a stale live time shows its timetable clock time. */
export function LiveCountdown({ state, planned, align = 'right' }: { state: LiveState; planned?: string | null; align?: 'right' | 'left' }) {
  const c = usePalette();
  const color = state.kind === 'cancelled' ? c.text3 : state.kind === 'live' ? (state.soon ? c.liveText : c.text) : c.text2;
  const p = planned ? new Date(planned).getTime() : NaN;
  const changed = state.kind === 'live' && Number.isFinite(p) && Math.abs(state.t - p) >= 60000;
  return (
    <View style={{ alignItems: align === 'right' ? 'flex-end' : 'flex-start', minWidth: 56 }} accessibilityLabel={state.a11y}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text maxFontSizeMultiplier={1.3} style={[{ fontSize: state.big.length > 4 ? 19 : 26, fontWeight: '700', color, fontVariant: ['tabular-nums'], letterSpacing: -0.5 }, state.kind === 'cancelled' && { textDecorationLine: 'line-through' }]}>{state.big}</Text>
        {state.unit ? <Text maxFontSizeMultiplier={1.3} style={[font.foot, { color, marginLeft: 2, fontWeight: '600' }]}>{state.unit}</Text> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {changed ? <Text style={[font.caption, { color: c.text3, textDecorationLine: 'line-through' }]}>{clock(p)}</Text> : null}
        {state.counting ? <Text style={[font.caption, { color: c.text2, fontVariant: ['tabular-nums'] }]}>{clock(state.t)}</Text> : null}
        {!state.counting && state.kind === 'stale' ? <Text style={[font.caption, { color: c.text2 }]}>timetable</Text> : null}
      </View>
    </View>
  );
}

/** A small pill for headers and cards: green "Live 20 s ago", grey "Timetable", amber "Not tracking". */
export function LivePill({ state }: { state: LiveState }) {
  const c = usePalette();
  const live = state.kind === 'live';
  const fg = live ? '#fff' : state.kind === 'stale' ? c.lateText : state.kind === 'cancelled' ? c.redText : c.text2;
  const words = live ? (state.age && state.age !== 'just now' ? `Live ${state.age}` : 'Live') : state.label;
  return (
    <View style={{ backgroundColor: live ? c.liveBg : c.fill, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, alignSelf: 'flex-start' }} accessibilityLabel={liveWords(state)}>
      <Text maxFontSizeMultiplier={1.3} style={[font.caption, { color: fg, fontWeight: '700' }]}>{words}</Text>
    </View>
  );
}

export { liveState };
