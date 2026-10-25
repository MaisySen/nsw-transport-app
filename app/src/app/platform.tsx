// Platform view: one train or metro at a station, styled as a station platform board and readable from a distance.
// A white board (dark in dark mode) with an orange Next train bar, the line and destination in large type, the stops
// it calls at in their own scrolling list, the platform with carriages (only when live data reports them), when it
// departs, and the next two services in a small table. Opened from the platform button in a station's header and
// from Platform view in the hold menu of a train or metro departure; nothing else on the existing screens changes.
// Data: /api/departures (platform, live times, carriages) and /api/service (the stop list), both already served, both
// asked of api.transportsydney.app first (platformDepartures, platformService) with the server in use as the fallback.
// Battery (docs/PERFORMANCE.md): useLive polls only while this screen is on view with the app in front, the
// countdown ticks on whole minutes (useCountdownNow), and the stop list is read once per service and then each minute.
// Wide windows (an open iPhone Duo or fold, a tablet, a resized window) get two columns, chosen by width alone.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { PLATFORM_VIEW } from '@/lib/features';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { platformDepartures, platformService } from '@/lib/api';
import { useCountdownNow, useLive, useReportCountdowns } from '@/lib/hooks';
import { adaptiveGapMs, nextInMs } from '@/lib/pollCore';
import { cacheKey, offlineText, staleText } from '@/lib/offlineCore';
import { usePalette } from '@/lib/theme';
import { badgeLook } from '@/lib/lineStyle';
import { bestTime, clock, shortName } from '@/lib/format';
import { haptic } from '@/lib/haptic';
import { goBack } from '@/lib/nav';
import { useReduceMotion } from '@/lib/motion';
import { hasSpeech, speak } from '@/lib/nativeExtras';
import { takeVoicePrompt } from '@/lib/voiceHelp';
import { stationRows } from '@/lib/platform';
import { carsOf, destName, fitSize, listWords, textEm, pickService, serviceFits, serviceKey, platformLayout, platformNo, platformSentence, speakSentence, splitVia, stoppingTag, stopsAfter, stopsNote, viaAirport, whenWords,
  type StationRow, type StopsAfter } from '@/lib/platformCore';
import type { Departure } from '@/lib/types';
import { depState } from '@/components/Transit';
import { Icon, I, modeIconName } from '@/components/Icon';

// The one time Get a better voice prompt, loaded only when it shows (the same as the other Speak buttons).
const VoiceHelp = lazy(() => import('@/components/VoiceHelp').then((m) => ({ default: m.VoiceHelp })));

/** Board colours: white with near black text, or the dark variant. Orange is for the bar and the big figures. */
function boardColors(dark: boolean) {
  return dark
    ? { bg: '#141416', fg: '#F4F4F6', sub: '#A3A3AA', line: '#2F2F34', or: '#FF8A3D', bar: '#C9561A', pill: '#55555C', screen: '#000000', btn: '#2A2A2C', rgb: '20,20,22' }
    : { bg: '#FFFFFF', fg: '#111111', sub: '#5C5C62', line: '#DEDEE3', or: '#D85A14', bar: '#E8641B', pill: '#4A4A50', screen: '#000000', btn: '#2A2A2C', rgb: '255,255,255' };
}

/**
 * The stop list for the shown service: read once per service, again each minute while on view. Each answer is kept
 * with the service it was asked for, and shown only under that service (serviceFits): when the next train takes over,
 * an answer still arriving for the one before is dropped and the new one is asked for at once.
 */
function useStopsAfter(d: Departure | null, station: string): { stops: StopsAfter; loading: boolean; status: string | null; cancelled: boolean } {
  const [stations, setStations] = useState<StationRow[] | null>(null);
  useEffect(() => { let on = true; stationRows().then((r) => { if (on) setStations(r); }).catch(() => {}); return () => { on = false; }; }, []);
  const key = serviceKey(d);
  const { data, error, refresh } = useLive(async () => {
    if (!d) return null;
    const k = serviceKey(d);
    const resp = await platformService({ trip: d.tripId, feed: d.feed || undefined, line: d.line, stop: d.stopId, planned: d.planned, mode: d.mode, destId: d.destId || undefined });
    return { key: k, resp: resp as any };
  }, 60000, [key], { enabled: !!d });
  const fits = !!d && serviceFits(data as any, d);
  // An answer for another service landed after the switch (its request was already on the way): ask again now.
  const asked = useRef('');
  useEffect(() => {
    if (d && data && !fits && asked.current !== key) { asked.current = key; refresh().catch(() => {}); }
  }, [d, data, fits, key, refresh]);
  const resp = fits ? (data as any).resp : null;
  const stops = useMemo(() => (resp && Array.isArray(resp.stops) ? stopsAfter(resp.stops, { mineIndex: resp.mineIndex, stopId: d?.stopId, station }, stations) : null),
    [resp, d?.stopId, station, stations]);
  const status = resp && typeof resp.stopsStatus === 'string' ? resp.stopsStatus as string : null;
  return { stops, loading: !!d && !fits && !error, status, cancelled: !!(resp && resp.cancelled) };
}

/** The route: while the switch in lib/features.ts is off, a link straight here goes to Home instead. */
export default function PlatformRoute() {
  return PLATFORM_VIEW ? <PlatformView /> : <Redirect href="/" />;
}

function PlatformView() {
  const p = useLocalSearchParams<{ stop: string; name?: string; trip?: string; planned?: string; line?: string }>();
  const stop = String(p.stop || '');
  const c = usePalette();
  const B = boardColors(!!c.dark);
  const now = useCountdownNow();
  const insets = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
  const L = platformLayout(width, fontScale);
  const fs = Math.min(Math.max(fontScale || 1, 1), 2);
  // With very large text or a short window the fixed parts would not fit, so the whole board scrolls instead.
  const fixed = fs < 1.4 && height >= 560;
  const reduce = useReduceMotion();
  const canSpeak = useMemo(() => hasSpeech(), []);
  // The fade under the stop list shows only when the list is longer than its area (so it scrolls).
  const [boxH, setBoxH] = useState(0);
  const [listH, setListH] = useState(0);
  const { data, error, offlineAt, staleAt } = useLive((r) => platformDepartures(stop, r), (x) => adaptiveGapMs(15000, nextInMs(x?.items, Date.now())), [stop], { cacheKey: cacheKey('dep', stop) });
  const pick = useMemo(() => ({ trip: p.trip || null, planned: p.planned || null, line: p.line || null }), [p.trip, p.planned, p.line]);
  const { main, next } = pickService<Departure>(data?.items, now, pick, depState);
  const stationName = shortName(data?.stop?.name || (p.name ? String(p.name) : '')).replace(/ Station$/, '');
  const svc = useStopsAfter(main, data?.stop?.name || String(p.name || ''));
  const stops = svc.stops;
  useReportCountdowns('platform:' + stop, [main, ...next].filter(Boolean).map((d) => bestTime(d!.planned, d!.realtime ? d!.estimated : null)));
  const live = main ? depState(main, now) : null;
  const cars = carsOf(main);
  const tag = stoppingTag(main);
  const plat = platformNo(main?.platform);
  const when = whenWords(live);
  const dest = splitVia(main?.dest);
  const note = main ? stopsNote(stops, { loading: svc.loading, status: svc.status, cancelled: svc.cancelled }) : null;
  const a11y = main ? platformSentence({ platform: main.platform, cars, when, stops, tag }) : '';
  const saidRef = useRef('');
  saidRef.current = main ? speakSentence({ line: main.line, mode: main.mode, dest: main.dest, platform: main.platform, cars, when, stops, tag }) : '';
  const close = () => { haptic.tap(); goBack(stop ? ({ pathname: '/stop/[id]', params: { id: stop, name: p.name ? String(p.name) : '' } } as any) : '/'); };
  const status = offlineAt ? offlineText(offlineAt, now) : staleAt ? staleText(staleAt, now) : !data ? (error ? 'Live times unavailable right now, trying again' : 'Loading live times') : null;
  const kindWord = main && main.mode === 'metro' ? 'metro' : 'train';
  const stopsLabel = stops && stops.names.length
    ? `Stops at ${listWords(stops.names)}${stops.skipped && stops.skipped.length ? `. Not stopping at ${listWords(stops.skipped)}` : ''}`
    : note || '';

  // Big figures: a phone size and a wide size, growing with the text size within reason.
  const k = L.wide ? 1.45 : 1;
  const sz = { dest: 34 * k * (L.wide ? 0.82 : 1), via: 20 * (L.wide ? 1.1 : 1), stop: L.wide ? 26 : 24, plat: 68 * (L.wide ? 1.5 : 1), mins: 44 * (L.wide ? 1.6 : 1), label: L.wide ? 19 : 16 };

  const badge = (d: Departure, size: 'big' | 'small') => {
    const b = badgeLook(d.line, d.mode, d.color);
    const h = size === 'big' ? (L.wide ? 52 : 44) : 26;
    return (
      <View accessible accessibilityLabel={b.label} style={{ minWidth: size === 'big' ? h : 32, height: h, borderRadius: size === 'big' ? 9 : 5, paddingHorizontal: size === 'big' ? 6 : 4, alignItems: 'center', justifyContent: 'center', backgroundColor: b.bg }}>
        {b.text ? <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={{ color: b.fg, fontSize: size === 'big' ? (L.wide ? 22 : 19) : 13, fontWeight: '800' }}>{b.text}</Text>
          : <Icon name={modeIconName(b.mode)} size={size === 'big' ? 20 : 14} color={b.fg} />}
      </View>
    );
  };

  // Above the board: close, the station, Speak. The station's name is sized to fit between them (no cut off names).
  const titleW = width - insets.left - insets.right - 24 - 44 - 20 - (main && canSpeak ? 110 : 44);
  const top = (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 50, paddingHorizontal: 12 }}>
      <Pressable onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close Platform view"
        style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: B.btn, opacity: pressed ? 0.6 : 1 })}>
        <Icon name={I.close} size={17} color="#FFFFFF" />
      </Pressable>
      <Text accessibilityRole="header" accessibilityLabel={stationName ? `${stationName}, Platform view` : 'Platform view'} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} maxFontSizeMultiplier={1.4}
        style={{ flex: 1, textAlign: 'center', color: '#C4C4C9', fontSize: fitSize(stationName || 'Platform view', 17, titleW, Math.min(fs, 1.4)), fontWeight: '600', marginHorizontal: 10 }}>
        {stationName || 'Platform view'}
      </Text>
      {main && canSpeak ? <SpeakPill say={() => saidRef.current} bg={B.btn} /> : <View style={{ width: 44 }} />}
    </View>
  );

  const bar = (
    <View style={{ backgroundColor: B.bar, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, minHeight: L.wide ? 56 : 50 }}>
      <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={{ color: '#FFFFFF', fontSize: L.wide ? 24 : 21, fontWeight: '800' }}>{`Next ${kindWord}`}</Text>
      <Text maxFontSizeMultiplier={1.4} accessibilityLabel={`Time now ${clock(now)}`} style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>
        Time now <Text style={{ fontSize: L.wide ? 21 : 19, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{clock(now)}</Text>
      </Text>
    </View>
  );

  const destBlock = main ? (
    <View accessible accessibilityLabel={`${badgeLook(main.line, main.mode, main.color).label} to ${destName(main.dest)}. ${a11y}`} style={{ paddingHorizontal: L.wide ? 20 : 16, paddingTop: 14, paddingBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {badge(main, 'big')}
        <Text maxFontSizeMultiplier={1.5} style={{ color: B.fg, fontSize: sz.dest, lineHeight: sz.dest * 1.08, fontWeight: '800', flexShrink: 1, letterSpacing: -0.4 }}>{dest.name}</Text>
      </View>
      {dest.via || viaAirport(main.dest, stops?.names) ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, marginLeft: (L.wide ? 52 : 44) + 12, gap: 6 }}>
          {dest.via ? <Text maxFontSizeMultiplier={1.5} style={{ color: B.sub, fontSize: sz.via, fontWeight: '600' }}>via {dest.via}</Text> : null}
          {viaAirport(main.dest, stops?.names) ? <Icon name={I.plane} size={20} color={B.sub} /> : null}
        </View>
      ) : null}
    </View>
  ) : null;

  const rule = (m = L.wide ? 20 : 16) => <View style={{ height: 2, backgroundColor: B.line, marginHorizontal: m }} />;

  // The stop list: large bold names down the left, in its own scrolling area with a soft fade at the bottom.
  const stopNames = stops && stops.names.length ? (
    <>
      {stops.names.map((n, i) => (
        <Text key={n + i} maxFontSizeMultiplier={1.5} numberOfLines={2} style={{ color: B.fg, fontSize: sz.stop, lineHeight: sz.stop * 1.25, fontWeight: '800', paddingVertical: sz.stop * 0.055 }}>{n}</Text>
      ))}
      {stops.skipped && stops.skipped.length ? (
        <Text maxFontSizeMultiplier={1.5} style={{ color: B.or, fontSize: 17, fontWeight: '700', marginTop: 8 }}>Not stopping at {listWords(stops.skipped)}</Text>
      ) : null}
    </>
  ) : (
    <Text maxFontSizeMultiplier={1.5} style={{ color: B.sub, fontSize: 20, fontWeight: '700', marginTop: 4 }}>{note}</Text>
  );
  const fade = (
    <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 56 }}>
      {Platform.OS === 'web'
        ? <View style={{ flex: 1, backgroundImage: `linear-gradient(to bottom, rgba(${B.rgb},0), rgba(${B.rgb},1))` } as any} />
        : [0.15, 0.35, 0.55, 0.75, 0.92].map((o) => <View key={o} style={{ flex: 1, backgroundColor: `rgba(${B.rgb},${o})` }} />)}
    </View>
  );
  const stopArea = main ? (fixed ? (
    <View style={L.wide ? { flexShrink: 1, minHeight: 0, minWidth: 0 } : { flex: 1, minWidth: 0 }} onLayout={(e) => setBoxH(e.nativeEvent.layout.height)}>
      <ScrollView accessible accessibilityLabel={stopsLabel} contentContainerStyle={{ paddingTop: 10, paddingBottom: 44, paddingRight: 8 }} showsVerticalScrollIndicator
        onContentSizeChange={(_w, h) => setListH(h)}>
        {stopNames}
      </ScrollView>
      {listH > boxH + 4 ? fade : null}
    </View>
  ) : (
    <View accessible accessibilityLabel={stopsLabel} style={{ flex: 1, minWidth: 0, paddingTop: 10, paddingBottom: 12 }}>{stopNames}</View>
  )) : null;

  const align = L.wide ? 'left' as const : 'right' as const;
  // The right hand column on a phone, and the space Departs has on a wide window (beside the platform).
  const sideW = Math.round(128 * Math.min(fs, 1.3));
  const departsW = L.wide ? Math.max(150, Math.round(width * 0.42) - 48 - 140) : sideW - 2;
  // Times stay on one line at every text size: each size is worked out to fit the space (fitSize), and the
  // screen may still shrink a little further (adjustsFontSizeToFit) where the platform supports it.
  const kM = Math.min(fs, 1.2), kL = Math.min(fs, 1.4);
  const minsFont = live && live.unit
    ? Math.min(sz.mins, Math.floor((departsW / ((textEm(live.big) + 0.58 * textEm(` ${live.unit}`)) * Math.max(1, kM))) * 10) / 10)
    : live ? fitSize(live.big, sz.mins * 0.7, departsW, kM) : sz.mins;
  const departs = main && live ? (
    <View accessible accessibilityLabel={when} style={{ maxWidth: departsW + 2 }}>
      <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={{ color: B.fg, fontSize: sz.label, fontWeight: '700', textAlign: align }}>Departs</Text>
      {live.kind === 'stale' ? (
        <>
          <Text maxFontSizeMultiplier={1.4} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}
            style={{ color: B.or, fontSize: fitSize('Not tracking', L.wide ? 22 : 19, departsW, kL), fontWeight: '800', textAlign: align }}>Not tracking</Text>
          <Text maxFontSizeMultiplier={1.2} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}
            style={{ color: B.or, fontSize: fitSize(live.big, sz.mins * 0.62, departsW, kM), fontWeight: '800', textAlign: align, fontVariant: ['tabular-nums'] }}>{live.big}</Text>
          <Text maxFontSizeMultiplier={1.4} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}
            style={{ color: B.sub, fontSize: fitSize('Timetable time', L.wide ? 16 : 13, departsW, kL), fontWeight: '600', textAlign: align }}>Timetable time</Text>
        </>
      ) : (
        <>
          <Text maxFontSizeMultiplier={1.2} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}
            style={{ color: live.kind === 'cancelled' ? B.sub : B.or, fontSize: minsFont, lineHeight: minsFont * 1.12, fontWeight: '800', textAlign: align, fontVariant: ['tabular-nums'] }}>
            {live.big}{live.unit ? <Text style={{ fontSize: minsFont * 0.58 }}>{` ${live.unit}`}</Text> : null}
          </Text>
          <Text maxFontSizeMultiplier={1.4} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}
            style={{ color: B.sub, fontSize: fitSize(`Timetable ${clock(live.t)}`, L.wide ? 16 : 13, departsW, kL), fontWeight: '600', textAlign: align }}>
            {live.kind === 'cancelled' ? 'Cancelled' : live.kind === 'live' ? 'Live' : 'Timetable'} {clock(live.t)}
          </Text>
        </>
      )}
    </View>
  ) : null;

  const platformBlock = main ? (
    <View accessible accessibilityLabel={[plat ? `Platform ${plat}` : 'Platform not given yet', cars ? `${cars} cars` : ''].filter(Boolean).join(', ')} style={{ alignItems: 'flex-end' }}>
      <Text maxFontSizeMultiplier={1.4} style={{ color: B.fg, fontSize: sz.label, fontWeight: '700' }}>Platform</Text>
      {plat ? <Text maxFontSizeMultiplier={1.2} numberOfLines={1} adjustsFontSizeToFit style={{ color: B.or, fontSize: sz.plat, lineHeight: sz.plat * 1.05, fontWeight: '800', letterSpacing: -1, fontVariant: ['tabular-nums'] }}>{plat}</Text>
        : <Text maxFontSizeMultiplier={1.4} style={{ color: B.sub, fontSize: 17, fontWeight: '700', textAlign: 'right', marginTop: 4 }}>Not given yet</Text>}
      {cars ? (
        <View style={{ marginTop: 8, backgroundColor: B.pill, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 5 }}>
          <Text maxFontSizeMultiplier={1.4} style={{ color: '#FFFFFF', fontSize: L.wide ? 17 : 15, fontWeight: '700' }}>{cars} cars</Text>
        </View>
      ) : null}
    </View>
  ) : null;

  const tagPill = tag ? (
    <View style={{ alignSelf: 'flex-start', backgroundColor: B.pill, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 5 }}>
      <Text maxFontSizeMultiplier={1.4} style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700' }}>{tag}</Text>
    </View>
  ) : null;

  // Next service | Platform | Departs, two rows.
  const colP = L.wide ? 96 : 76, colD = L.wide ? 100 : 92;
  const nextTable = next.length ? (
    <View style={{ paddingHorizontal: L.wide ? 0 : 16, paddingTop: 8, paddingBottom: 12 }}>
      <View style={{ flexDirection: 'row', paddingBottom: 4 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text maxFontSizeMultiplier={1.4} style={{ flex: 1, color: B.sub, fontSize: L.wide ? 15 : 14, fontWeight: '700' }}>Next service</Text>
        <Text maxFontSizeMultiplier={1.4} style={{ width: colP, textAlign: 'center', color: B.sub, fontSize: L.wide ? 15 : 14, fontWeight: '700' }}>Platform</Text>
        <Text maxFontSizeMultiplier={1.4} style={{ width: colD, textAlign: 'right', color: B.sub, fontSize: L.wide ? 15 : 14, fontWeight: '700' }}>Departs</Text>
      </View>
      {next.map((d) => {
        const s = depState(d, now);
        const pn = platformNo(d.platform);
        const n = carsOf(d);
        const sv = splitVia(d.dest);
        const right = s.kind === 'stale' ? s.big : s.unit ? `${s.big} ${s.unit}` : s.big;
        const rightFont = fitSize(right, L.wide ? 24 : 21, colD - 2, Math.min(fs, 1.3));
        return (
          <View key={`${d.tripId || d.line}|${d.planned}`} accessible accessibilityLabel={`Next service, ${badgeLook(d.line, d.mode, d.color).label} to ${destName(d.dest)}. ${platformSentence({ platform: d.platform, cars: n, when: whenWords(s) })}`}
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: L.wide ? 12 : 9, borderTopWidth: 1, borderTopColor: B.line, minHeight: 56 }}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 }}>
              {badge(d, 'small')}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text maxFontSizeMultiplier={1.4} numberOfLines={2} style={{ color: B.fg, fontSize: L.wide ? 24 : 21, lineHeight: (L.wide ? 24 : 21) * 1.12, fontWeight: '800' }}>{sv.name}</Text>
                {sv.via ? <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={{ color: B.sub, fontSize: L.wide ? 15 : 13.5, fontWeight: '600' }}>via {sv.via}</Text> : null}
              </View>
            </View>
            <Text maxFontSizeMultiplier={1.3} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ width: colP, textAlign: 'center', color: pn ? B.fg : B.sub, fontSize: fitSize(pn || 'Not given', pn ? (L.wide ? 30 : 26) : 15, colP - 4, Math.min(fs, 1.3)), fontWeight: '800' }}>{pn || 'Not given'}</Text>
            <View style={{ width: colD, alignItems: 'flex-end' }}>
              <Text maxFontSizeMultiplier={1.3} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ color: B.fg, fontSize: rightFont, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{right}</Text>
              {s.kind === 'stale' ? <Text maxFontSizeMultiplier={1.4} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ color: B.or, fontSize: fitSize('Not tracking', 12, colD - 2, Math.min(fs, 1.4)), fontWeight: '700' }}>Not tracking</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  ) : null;

  const empty = data && !main ? (
    <View style={{ padding: 18 }}>
      <Text maxFontSizeMultiplier={1.5} style={{ color: B.fg, fontSize: 24, fontWeight: '800' }}>{offlineAt ? 'No kept times left' : 'No more trains right now'}</Text>
      <Text maxFontSizeMultiplier={1.5} style={{ color: B.sub, fontSize: 17, marginTop: 6 }}>Platform view shows train and metro services at this station.</Text>
    </View>
  ) : null;

  const statusLine = status ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingBottom: 6 }} accessibilityLiveRegion="polite">
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: offlineAt || error ? '#FF9F0A' : '#8E8E93', marginRight: 7 }} />
      <Text maxFontSizeMultiplier={1.5} style={{ color: '#C4C4C9', fontSize: 15, flex: 1 }}>{status}</Text>
    </View>
  ) : null;

  // The board. Phone: destination, then stops left with platform and departs right, then next services.
  // Wide: destination and stops on the left; departs, platform and next services on the right.
  const phoneBody = main ? (
    <>
      {destBlock}
      {rule()}
      <View style={[{ flexDirection: 'row', paddingLeft: 16 }, fixed ? { flexShrink: 1, minHeight: 0 } : null]}>
        {stopArea}
        <View style={{ width: sideW, justifyContent: 'flex-start', alignItems: 'flex-end', paddingVertical: 12, paddingRight: 16, gap: 16 }}>
          {platformBlock}
          {departs}
        </View>
      </View>
      {tagPill ? <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>{tagPill}</View> : null}
      {next.length ? rule() : null}
      {nextTable}
    </>
  ) : empty;
  const wideBody = main ? (
    <View style={[{ flexDirection: 'row' }, fixed ? { flexShrink: 1, minHeight: 0 } : null]}>
      <View style={{ flex: 1.35, minWidth: 0 }}>
        {destBlock}
        {rule()}
        <View style={[{ paddingLeft: 20 }, fixed ? { flexShrink: 1, minHeight: 0 } : null]}>{stopArea}</View>
        {tagPill ? <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>{tagPill}</View> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, borderLeftWidth: 2, borderLeftColor: B.line }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 24, paddingVertical: 22 }}>
          <View style={{ alignItems: 'flex-start' }}>{departs}</View>
          {platformBlock}
        </View>
        <View style={{ marginHorizontal: 24, borderTopWidth: next.length ? 2 : 0, borderTopColor: B.line }}>{nextTable}</View>
      </View>
    </View>
  ) : empty;

  const board = (
    <View style={[{ marginHorizontal: 8, marginBottom: 8, borderRadius: 18, overflow: 'hidden', backgroundColor: B.bg }, fixed ? { flexShrink: 1, minHeight: 0 } : null]}>
      {bar}
      {L.wide ? wideBody : phoneBody}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: B.screen, paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }}>
      <Stack.Screen options={{ headerShown: false, animation: reduce ? 'none' : Platform.OS === 'ios' ? 'default' : 'fade' }} />
      <StatusBar style="light" />
      {top}
      {statusLine}
      {fixed ? (
        <View style={{ flex: 1, paddingBottom: Math.max(insets.bottom, 8) }}>{board}</View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>{board}</ScrollView>
      )}
    </View>
  );
}

/** Speak: says the platform, carriages, when it leaves and the stops, in the best installed voice. */
function SpeakPill({ say, bg }: { say: () => string; bg: string }) {
  const [help, setHelp] = useState(false);
  const go = () => {
    haptic.select();
    const text = say();
    if (text) speak(text, { interrupt: true });
    // The first Speak on a phone with only its basic voice also offers the better voice, once ever (voiceHelpCore).
    takeVoicePrompt().then((show) => { if (show) setHelp(true); }).catch(() => {});
  };
  return (
    <>
      <Pressable onPress={go} hitSlop={6} accessibilityRole="button" accessibilityLabel="Speak" accessibilityHint="Reads the platform, carriages, departure time and stops out loud"
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: bg, opacity: pressed ? 0.7 : 1 })}>
        <Icon name={I.speaker} size={17} color="#FFFFFF" />
        <Text maxFontSizeMultiplier={1.4} style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700', marginLeft: 6 }}>Speak</Text>
      </Pressable>
      {help ? <Suspense fallback={null}><VoiceHelp visible start="prompt" onClose={() => setHelp(false)} /></Suspense> : null}
    </>
  );
}
