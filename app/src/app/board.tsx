// Departure board: a full screen, big type board for a station or stop, like the screens on Sydney platforms.
// Next services with platform or stand, destination, where they stop (when known), minutes and the shared live
// label (docs/LIVE-LABELS.md). Dark by default with a light option, high contrast, sized by Dynamic Type.
// Battery (docs/PERFORMANCE.md): live times through useLive, which polls only while this screen is on view with
// the app in front; the screen is kept awake only while the board is on view, on builds that have the module.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { goBack } from '@/lib/nav';
import { Platform, Pressable, StatusBar, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { api } from '@/lib/api';
import { useCountdownNow, useLive, useReportCountdowns } from '@/lib/hooks';
import { adaptiveGapMs, nextInMs } from '@/lib/pollCore';
import { cacheKey, offlineText } from '@/lib/offlineCore';
import { boardRows, boardScale, rowsThatFit, stopsSummary, type BoardRow } from '@/lib/boardCore';
import { androidLook, palettes } from '@/lib/theme';
import { badgeLook } from '@/lib/lineStyle';
import { bestTime, clock, shortName } from '@/lib/format';
import { haptic } from '@/lib/haptic';
import { useWhyLate } from '@/lib/whyLate';
import type { Departure } from '@/lib/types';
import { Icon, I } from '@/components/Icon';
import { SpeakButton } from '@/components/SpeakButton';
import { departuresSentence } from '@/lib/voiceCore';
import { busBoardWords, rowTraffic } from '@/lib/busLiveCore';

const TAG = 'departure-board';

/** The keep awake module, only when this build has its native side (OTAs reach builds 201 to 206). Web uses the browser's wake lock. */
function keepAwake(): { activateKeepAwakeAsync: (t: string) => Promise<void>; deactivateKeepAwake: (t: string) => Promise<void> | void } | null {
  try {
    if (Platform.OS !== 'web' && !requireOptionalNativeModule('ExpoKeepAwake')) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-keep-awake');
  } catch { return null; }
}

/** Keeps the screen on while the board is on view. Builds without the keep awake module just skip it. */
function useStayAwake() {
  // On focus only: covered by another screen or left, the screen may sleep again. The release waits for the lock
  // to be taken, so leaving at once never throws ("has not activated yet").
  useFocusEffect(useCallback(() => {
    const mod = keepAwake();
    if (!mod) return undefined;
    let taken: Promise<unknown> = Promise.resolve();
    try { taken = Promise.resolve(mod.activateKeepAwakeAsync(TAG)).catch(() => {}); } catch { /* skipped */ }
    return () => { taken.then(() => mod.deactivateKeepAwake(TAG)).catch(() => {}); };
  }, []));
}

// Where trains and metros stop after this station, from /api/service (one read per service, kept for the session).
const stopsKept = new Map<string, string>();
function useStops(items: Departure[], rows: BoardRow[]) {
  const want = rows.filter((r) => !r.pattern && r.tripId && (r.mode === 'train' || r.mode === 'metro') && !stopsKept.has(r.tripId)).slice(0, 3);
  const key = want.map((r) => r.tripId).join(',');
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!key) return;
    let live = true;
    Promise.all(want.map(async (r) => {
      const d = items.find((x) => x.tripId === r.tripId);
      if (!d) return;
      try {
        const s = await api.service({ trip: d.tripId, feed: d.feed || undefined, line: d.line, stop: d.stopId, planned: d.planned, mode: d.mode, destId: d.destId || undefined });
        stopsKept.set(r.tripId!, stopsSummary(s?.stops, s?.mineIndex));
      } catch { stopsKept.set(r.tripId!, ''); }
      if (stopsKept.size > 80) stopsKept.delete(stopsKept.keys().next().value as string);
    })).then(() => { if (live) setTick((t) => t + 1); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (r: BoardRow) => r.pattern || (r.tripId ? stopsKept.get(r.tripId) || '' : '');
}

// The board's own colours: the dark set by default (easy to read across a platform, kind at night), the light
// set on request. Secondary text is brighter than the app's for contrast at a distance.
function boardColours(light: boolean) {
  const set = androidLook ? palettes.md : palettes.ios;
  const p = light ? set.light : set.dark;
  return { ...p, dark: !light, text2: light ? '#3A3A3C' : '#D1D1D6', text3: light ? '#636366' : '#AEAEB2', close: light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.16)' };
}

let lightChosen = false;

export default function Board() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const [light, setLight] = useState(lightChosen);
  const c = boardColours(light);
  const now = useCountdownNow();
  const insets = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
  const wide = width > height;
  useStayAwake();
  const { data, error, offlineAt } = useLive((r) => api.departures(String(id), r), (d) => adaptiveGapMs(15000, nextInMs(d?.items, Date.now())), [id], { cacheKey: cacheKey('dep', String(id)) });
  const dataRef = useRef(data);
  dataRef.current = data;
  // Dynamic Type: the board grows with the text size setting, within what still fits a few rows.
  const big = boardScale(width, height, fontScale);
  const rowH = big * 1.75;
  const headH = big * 1.6 + 40;
  const fit = rowsThatFit(height - insets.top - insets.bottom - 16, rowH, headH + big * 0.6);
  const rows = boardRows(data?.items || [], now, fit);
  const stopsOf = useStops(data?.items || [], rows);
  useReportCountdowns('board:' + id, (data?.items || []).slice(0, fit).map((d) => bestTime(d.planned, d.realtime ? d.estimated : null)));
  const whyOf = useWhyLate(data?.items, data?.alerts);
  const why = useMemo(() => new Map((data?.items || []).map((d) => [`${d.tripId || d.line}|${d.planned}`, whyOf(d)])), [data, whyOf]);
  const depOf = useMemo(() => new Map((data?.items || []).map((d) => [`${d.tripId || d.line}|${d.planned}`, d])), [data]);
  const title = shortName(data?.stop?.name || (name ? String(name) : 'Departures')).replace(/ Station$/, '');
  const close = () => { haptic.tap(); goBack({ pathname: '/stop/[id]', params: { id: String(id), name: name ? String(name) : '' } } as any); };
  const flip = () => { haptic.select(); lightChosen = !light; setLight(!light); };
  const status = offlineAt ? offlineText(offlineAt, now) : !data ? (error ? 'Live times unavailable right now, trying again' : 'Loading live times') : 'Live and timetable times, updated often while a service is close';
  const small = Math.max(15, big * 0.34);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8, paddingLeft: insets.left + 20, paddingRight: insets.right + 20 }}>
      <Stack.Screen options={{ headerShown: false, animation: 'fade' }} />
      <StatusBar hidden barStyle={light ? 'dark-content' : 'light-content'} />
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48 }}>
        <Pressable onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close departure board"
          style={({ pressed }) => [s.round, { backgroundColor: c.close, borderColor: c.text3, opacity: pressed ? 0.6 : 1 }]}>
          <Icon name={I.close} size={20} color={c.text} />
        </Pressable>
        <Text accessibilityRole="header" numberOfLines={1} maxFontSizeMultiplier={1} style={{ flex: 1, marginLeft: 14, color: c.text, fontSize: big * 0.62, fontWeight: '700' }}>{title}</Text>
        <Text maxFontSizeMultiplier={1} accessibilityLabel={`Time now ${clock(now)}`} style={{ color: c.text, fontSize: big * 0.52, fontWeight: '600', fontVariant: ['tabular-nums'], marginLeft: 10 }}>{clock(now)}</Text>
        <View style={{ marginLeft: 12 }}>
          <SpeakButton look="round" color={c.text} bg={c.close} border={c.text3} say={() => departuresSentence(dataRef.current?.items, Date.now(), { stop: dataRef.current?.stop?.name })} />
        </View>
        <Pressable onPress={flip} hitSlop={10} accessibilityRole="button" accessibilityLabel={light ? 'Dark board' : 'Light board'}
          style={({ pressed }) => [s.round, { marginLeft: 12, backgroundColor: c.close, borderColor: c.text3, opacity: pressed ? 0.6 : 1 }]}>
          <Icon name={light ? I.moon : I.sun} size={19} color={c.text} />
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, marginBottom: 6 }} accessibilityLiveRegion="polite">
        <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: offlineAt || (error && !data) ? c.orange : c.green, marginRight: 7 }} />
        <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={{ color: c.text2, fontSize: 15, flex: 1 }}>{status}</Text>
      </View>
      {data && !rows.length ? <Text maxFontSizeMultiplier={1.4} style={{ color: c.text2, fontSize: big * 0.5, marginTop: big }}>{offlineAt ? 'No kept times left' : 'No more services right now'}</Text> : null}
      {rows.map((r, i) => {
        const { bg, fg } = badgeLook(r.line, r.mode, r.color);
        const stops = stopsOf(r);
        const w = why.get(r.key) || null;
        const tone = r.cancelled ? c.redText : r.kind === 'live' ? c.liveText : r.kind === 'stale' ? c.lateText : c.text2;
        const dep = depOf.get(r.key);
        // Buses say how they are running: "4 min late, 3 stops away", or "Timetable only" (busLiveCore.ts).
        const bus = dep && !r.cancelled && r.kind !== 'stale' ? busBoardWords(dep, r.kind === 'live') : null;
        const slow = dep && r.kind === 'live' ? rowTraffic(dep) : null;
        const word = r.cancelled ? 'Cancelled' : bus || (r.kind === 'live' ? `Live${r.age ? `, ${r.age}` : ''}` : r.label);
        const sub = [r.platform, word].filter(Boolean).join('  \u00b7  ');
        const third = w ? w.text : slow || (stops ? `Stops: ${stops}` : '');
        const warm = !!w || !!slow;
        const subTone = bus && / late/.test(bus) ? c.lateText : tone;
        return (
          <View key={r.key + i} accessible accessibilityLabel={[r.a11y, bus && bus !== 'Timetable only' ? bus : '', slow || '', stops && !r.pattern ? `stops at ${stops}` : '', w ? w.text : ''].filter(Boolean).join(', ')}
            style={[s.row, { minHeight: rowH, borderTopColor: c.sep, borderTopWidth: i ? StyleSheet.hairlineWidth : 0 }]}>
            <View style={[s.badge, { backgroundColor: bg, minWidth: big * 1.6, height: big * 1.05, borderRadius: big * 0.22 }]}>
              <Text numberOfLines={1} maxFontSizeMultiplier={1} style={{ color: fg, fontSize: big * 0.52, fontWeight: '800' }}>{r.line}</Text>
            </View>
            <View style={{ flex: 1, marginLeft: big * 0.35, paddingVertical: 4 }}>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={1} style={{ color: r.cancelled ? c.text3 : c.text, fontSize: big * 0.6, fontWeight: '700', textDecorationLine: r.cancelled ? 'line-through' : 'none' }}>{r.dest}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                {r.kind === 'live' && !r.cancelled ? <View style={{ width: small * 0.5, height: small * 0.5, borderRadius: small, backgroundColor: c.green, marginRight: 6 }} /> : null}
                <Text numberOfLines={1} maxFontSizeMultiplier={1} style={{ color: subTone, fontSize: small, fontWeight: '600', flexShrink: 1 }}>{sub}</Text>
              </View>
              {third ? <Text numberOfLines={1} maxFontSizeMultiplier={1} style={{ color: warm ? c.lateText : c.text2, fontSize: small * 0.92, marginTop: 2, fontWeight: warm ? '600' : '400' }}>{third}</Text> : null}
            </View>
            <Text maxFontSizeMultiplier={1} style={{ color: r.cancelled ? c.text3 : r.kind === 'live' ? c.liveText : r.kind === 'stale' ? c.lateText : c.text, fontSize: r.unit || r.when === 'Now' ? big : big * 0.62, fontWeight: '800', fontVariant: ['tabular-nums'], marginLeft: 12 }}>
              {r.when}{r.unit ? <Text style={{ fontSize: big * 0.4, fontWeight: '600' }}> {r.unit}</Text> : null}
            </Text>
          </View>
        );
      })}
      {wide ? null : <View style={{ flex: 1 }} />}
    </View>
  );
}

const s = StyleSheet.create({
  round: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center' },
  badge: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
});
