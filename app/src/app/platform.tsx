// Platform view: one train or metro at a station, full screen and readable from a distance. Its platform, the
// carriages (only when live data reports them), when it leaves, the stops it calls at after this station and the
// next two services. Opened from the platform button in a station's header and from Platform view in the hold menu
// of a train or metro departure; nothing else on the existing screens changes.
// Data: /api/departures (platform, live times, carriages) and /api/service (the stop list), both already served.
// Battery (docs/PERFORMANCE.md): useLive polls only while this screen is on view with the app in front, the
// countdown ticks on whole minutes (useCountdownNow), and the stop list is read once per service and then each minute.
// Wide windows (an open iPhone Duo or fold, a tablet, a resized window) get two columns, chosen by width alone.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, platformDepartures } from '@/lib/api';
import { useCountdownNow, useLive, useReportCountdowns } from '@/lib/hooks';
import { adaptiveGapMs, nextInMs } from '@/lib/pollCore';
import { cacheKey, offlineText } from '@/lib/offlineCore';
import { usePalette, radius } from '@/lib/theme';
import { badgeLook } from '@/lib/lineStyle';
import { bestTime, clock, shortName } from '@/lib/format';
import { haptic } from '@/lib/haptic';
import { goBack } from '@/lib/nav';
import { useReduceMotion } from '@/lib/motion';
import { useSolidLook } from '@/lib/cardSkin';
import { skinStyle } from '@/lib/cardSkinCore';
import { hasSpeech, speak } from '@/lib/nativeExtras';
import { takeVoicePrompt } from '@/lib/voiceHelp';
import { stationRows } from '@/lib/platform';
import { carsOf, destName, listWords, pickService, platformLayout, platformNo, platformSentence, speakSentence, stoppingTag, stopsAfter, stopsShown, viaAirport, whenWords,
  type StationRow, type StopsAfter } from '@/lib/platformCore';
import type { Departure } from '@/lib/types';
import { depState } from '@/components/Transit';
import { Icon, I, modeIconName } from '@/components/Icon';

// The one time Get a better voice prompt, loaded only when it shows (the same as the other Speak buttons).
const VoiceHelp = lazy(() => import('@/components/VoiceHelp').then((m) => ({ default: m.VoiceHelp })));

/** The stop list for the shown service: read once per service, again each minute while on view. */
function useStopsAfter(d: Departure | null, station: string): { stops: StopsAfter; loading: boolean } {
  const [stations, setStations] = useState<StationRow[] | null>(null);
  useEffect(() => { let on = true; stationRows().then((r) => { if (on) setStations(r); }).catch(() => {}); return () => { on = false; }; }, []);
  const key = d ? `${d.tripId || ''}|${d.planned || ''}` : '';
  const { data, error } = useLive(() => (d ? api.service({ trip: d.tripId, feed: d.feed || undefined, line: d.line, stop: d.stopId, planned: d.planned, mode: d.mode, destId: d.destId || undefined }) : Promise.resolve(null)),
    60000, [key], { enabled: !!d });
  const stops = useMemo(() => (data && Array.isArray((data as any).stops) ? stopsAfter((data as any).stops, { mineIndex: (data as any).mineIndex, stopId: d?.stopId, station }, stations) : null),
    [data, d?.stopId, station, stations]);
  return { stops, loading: !!d && !data && !error };
}

export default function PlatformView() {
  const p = useLocalSearchParams<{ stop: string; name?: string; trip?: string; planned?: string; line?: string }>();
  const stop = String(p.stop || '');
  const c = usePalette();
  const now = useCountdownNow();
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const L = platformLayout(width, fontScale);
  const reduce = useReduceMotion();
  const solid = useSolidLook();
  const canSpeak = useMemo(() => hasSpeech(), []);
  const { data, error, offlineAt } = useLive((r) => platformDepartures(stop, r), (x) => adaptiveGapMs(15000, nextInMs(x?.items, Date.now())), [stop], { cacheKey: cacheKey('dep', stop) });
  const pick = useMemo(() => ({ trip: p.trip || null, planned: p.planned || null, line: p.line || null }), [p.trip, p.planned, p.line]);
  const { main, next } = pickService<Departure>(data?.items, now, pick);
  const stationName = shortName(data?.stop?.name || (p.name ? String(p.name) : '')).replace(/ Station$/, '');
  const { stops, loading } = useStopsAfter(main, data?.stop?.name || String(p.name || ''));
  useReportCountdowns('platform:' + stop, [main, ...next].filter(Boolean).map((d) => bestTime(d!.planned, d!.realtime ? d!.estimated : null)));
  const live = main ? depState(main, now) : null;
  const cars = carsOf(main);
  const tag = stoppingTag(main);
  const plat = platformNo(main?.platform);
  const when = whenWords(live);
  const a11y = main ? platformSentence({ platform: main.platform, cars, when, stops, tag }) : '';
  const saidRef = useRef('');
  saidRef.current = main ? speakSentence({ line: main.line, mode: main.mode, dest: main.dest, platform: main.platform, cars, when, stops, tag }) : '';
  const close = () => { haptic.tap(); goBack(stop ? ({ pathname: '/stop/[id]', params: { id: stop, name: p.name ? String(p.name) : '' } } as any) : '/'); };
  const status = offlineAt ? offlineText(offlineAt, now) : !data ? (error ? 'Live times unavailable right now, trying again' : 'Loading live times') : null;
  const sk = skinStyle('line', { dark: c.dark, line: main?.color || null, lines: [main?.color], solid, cardColor: c.card, text3: c.text3 });
  const pad = { paddingLeft: insets.left + 20, paddingRight: insets.right + 20 };

  const head = (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52 }}>
      <Pressable onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close Platform view"
        style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: c.fill, opacity: pressed ? 0.6 : 1 })}>
        <Icon name={I.close} size={19} color={c.text} />
      </Pressable>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text accessibilityRole="header" numberOfLines={1} maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 22, fontWeight: '700' }}>{stationName || 'Platform view'}</Text>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.4} style={{ color: c.text2, fontSize: 15 }}>Platform view</Text>
      </View>
      <Text maxFontSizeMultiplier={1.3} accessibilityLabel={`Time now ${clock(now)}`} style={{ color: c.text, fontSize: 20, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{clock(now)}</Text>
    </View>
  );

  const badge = (d: Departure, size: 'big' | 'small') => {
    const b = badgeLook(d.line, d.mode, d.color);
    const h = size === 'big' ? 34 : 26;
    return (
      <View accessible accessibilityLabel={b.label} style={{ minWidth: h * 1.4, height: h, borderRadius: size === 'big' ? 8 : 6, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: b.bg }}>
        {b.text ? <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={{ color: b.fg, fontSize: size === 'big' ? 19 : 15, fontWeight: '800' }}>{b.text}</Text>
          : <Icon name={modeIconName(b.mode)} size={size === 'big' ? 18 : 14} color={b.fg} />}
      </View>
    );
  };

  const ring: any = sk.ring ? { backgroundImage: sk.ring, padding: sk.width } : { borderWidth: sk.width || 1, borderColor: sk.border || c.sep };
  const mainCard = main && live ? (
    <View style={[{ borderRadius: radius + 8 + (sk.width || 0) }, ring, sk.shadow ? ({ boxShadow: sk.shadow } as any) : null]}>
      <View accessible accessibilityLabel={`${badgeLook(main.line, main.mode, main.color).label} to ${destName(main.dest)}. ${a11y}`}
        style={{ borderRadius: radius + 8, overflow: 'hidden', backgroundColor: sk.surface || c.card, padding: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          {badge(main, 'big')}
          <Text maxFontSizeMultiplier={1.6} style={{ color: c.text, fontSize: L.wide ? 30 : 26, fontWeight: '800', flexShrink: 1 }}>{destName(main.dest)}</Text>
          {viaAirport(main.dest, stops?.names) ? <Icon name={I.plane} size={20} color={c.text2} /> : null}
        </View>
        {tag ? (
          <View style={{ alignSelf: 'flex-start', marginTop: 10, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: c.fill }}>
            <Text maxFontSizeMultiplier={1.6} style={{ color: c.text, fontSize: 14, fontWeight: '700' }}>{tag}</Text>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 16, flexWrap: 'wrap', rowGap: 12 }}>
          <View style={{ flex: 1, minWidth: 150 }}>
            <Text maxFontSizeMultiplier={1.6} style={{ color: c.text2, fontSize: 15, fontWeight: '600' }}>Platform</Text>
            {plat ? <Text maxFontSizeMultiplier={1.2} style={{ color: c.text, fontSize: L.big * 0.78, lineHeight: L.big * 0.86, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{plat}</Text>
              : <Text maxFontSizeMultiplier={1.6} style={{ color: c.text, fontSize: 20, fontWeight: '700', marginTop: 4 }}>Platform not given yet</Text>}
            {cars ? <Text maxFontSizeMultiplier={1.6} style={{ color: c.text, fontSize: 20, fontWeight: '700', marginTop: 4 }}>{cars} cars</Text> : null}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            {live.kind === 'stale' ? (
              <>
                <Text maxFontSizeMultiplier={1.6} style={{ color: c.lateText, fontSize: 17, fontWeight: '700' }}>Not tracking</Text>
                <Text maxFontSizeMultiplier={1.2} style={{ color: c.text, fontSize: L.big * 0.5, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{live.big}</Text>
                <Text maxFontSizeMultiplier={1.6} style={{ color: c.text2, fontSize: 15 }}>Timetable time</Text>
              </>
            ) : (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
                  <Text maxFontSizeMultiplier={1.2} style={{ color: live.soon ? c.liveText : c.text, fontSize: live.unit ? L.big : L.big * 0.6, lineHeight: live.unit ? L.big * 1.05 : L.big * 0.7, fontWeight: '900', fontVariant: ['tabular-nums'] }}>{live.big}</Text>
                  {live.unit ? <Text maxFontSizeMultiplier={1.4} style={{ color: c.text2, fontSize: 22, fontWeight: '700', marginLeft: 4, marginBottom: L.big * 0.14 }}>{live.unit}</Text> : null}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: live.kind === 'live' ? c.green : c.text3, marginRight: 6 }} />
                  <Text maxFontSizeMultiplier={1.6} style={{ color: live.kind === 'live' ? c.liveText : c.text2, fontSize: 15, fontWeight: '600' }}>{live.kind === 'cancelled' ? 'Cancelled' : live.kind === 'live' ? 'Live' : 'Timetable'} {clock(live.t)}</Text>
                </View>
              </>
            )}
          </View>
        </View>
      </View>
    </View>
  ) : null;

  const speakBtn = main && canSpeak ? <SpeakPill say={() => saidRef.current} /> : null;

  const after = next.length ? (
    <View>
      <Text accessibilityRole="header" maxFontSizeMultiplier={1.6} style={{ color: c.text2, fontSize: 15, fontWeight: '700', letterSpacing: 0.4, marginBottom: 8 }}>AFTER THIS</Text>
      <View style={{ backgroundColor: c.card, borderRadius: radius + 4, overflow: 'hidden' }}>
        {next.map((d, i) => {
          const s = depState(d, now);
          const pn = platformNo(d.platform);
          const n = carsOf(d);
          const right = s.kind === 'stale' ? s.big : s.unit ? `${s.big} ${s.unit}` : s.big;
          return (
            <View key={`${d.tripId || d.line}|${d.planned}`} accessible accessibilityLabel={`${badgeLook(d.line, d.mode, d.color).label} to ${destName(d.dest)}. ${platformSentence({ platform: d.platform, cars: n, when: whenWords(s) })}`}
              style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, minHeight: 64, borderTopWidth: i ? 0.5 : 0, borderTopColor: c.sep }}>
              {badge(d, 'small')}
              <View style={{ flex: 1, marginHorizontal: 12 }}>
                <Text maxFontSizeMultiplier={1.6} numberOfLines={2} style={{ color: c.text, fontSize: 18, fontWeight: '700' }}>{destName(d.dest)}</Text>
                <Text maxFontSizeMultiplier={1.6} numberOfLines={1} style={{ color: c.text2, fontSize: 15 }}>{[pn ? `Platform ${pn}` : 'Platform not given yet', n ? `${n} cars` : ''].filter(Boolean).join(' \u00b7 ')}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{right}</Text>
                {s.kind === 'stale' ? <Text maxFontSizeMultiplier={1.6} style={{ color: c.lateText, fontSize: 13, fontWeight: '600' }}>Not tracking</Text> : null}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  ) : null;

  // Odd caps, so with the "N more stops" cell the two column grid ends on a full row.
  const maxStops = L.wide ? 23 : L.stopCols === 2 ? 15 : 12;
  const shown = stops ? stopsShown(stops.names, maxStops) : null;
  const stopList = main ? (
    <View>
      <Text accessibilityRole="header" maxFontSizeMultiplier={1.6} style={{ color: c.text2, fontSize: 15, fontWeight: '700', letterSpacing: 0.4, marginBottom: 8 }}>STOPS AFTER THIS STATION</Text>
      <View style={{ backgroundColor: c.card, borderRadius: radius + 4, padding: 14 }}>
        {shown && shown.shown.length ? (
          <View accessible accessibilityLabel={`Stops at ${shown.shown.join(', ')}${shown.more ? `, and ${shown.more} more` : ''}`} style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {shown.shown.map((n, i) => {
              const last = i === shown.shown.length - 1;
              const cell = (key: string, text: string, kind: 'stop' | 'last' | 'more') => (
                <View key={key} style={{ width: L.stopCols === 2 ? '50%' : '100%', flexDirection: 'row', alignItems: 'center', paddingVertical: 5, paddingRight: 8 }}>
                  <View style={{ width: 9, height: 9, borderRadius: 5, borderWidth: kind === 'more' ? 0 : 2, borderColor: main.color || c.text2, backgroundColor: kind === 'last' ? main.color || c.text2 : kind === 'more' ? c.text3 : 'transparent', marginRight: 8 }} />
                  <Text maxFontSizeMultiplier={1.6} numberOfLines={2} style={{ color: kind === 'more' ? c.text2 : c.text, fontSize: 17, fontWeight: kind === 'last' ? '800' : '500', flexShrink: 1 }}>{text}</Text>
                </View>
              );
              return last && shown.more
                ? [cell('more', `${shown.more} more stop${shown.more === 1 ? '' : 's'}`, 'more'), cell(n + i, n, 'last')]
                : cell(n + i, n, last ? 'last' : 'stop');
            })}
          </View>
        ) : (
          <Text maxFontSizeMultiplier={1.6} style={{ color: c.text2, fontSize: 16 }}>
            {loading ? 'Loading stops' : stops && !stops.names.length ? (stops.unnamed ? 'Stop names not given for this service' : 'This station is the last stop') : 'Stops not available for this service right now'}
          </Text>
        )}
        {stops && stops.skipped && stops.skipped.length ? (
          <Text maxFontSizeMultiplier={1.6} style={{ color: c.lateText, fontSize: 15, fontWeight: '600', marginTop: 8 }}>Not stopping at {listWords(stops.skipped)}</Text>
        ) : null}
      </View>
    </View>
  ) : null;

  const empty = data && !main ? (
    <View style={{ backgroundColor: c.card, borderRadius: radius + 4, padding: 18 }}>
      <Text maxFontSizeMultiplier={1.6} style={{ color: c.text, fontSize: 20, fontWeight: '700' }}>{offlineAt ? 'No kept times left' : 'No more trains right now'}</Text>
      <Text maxFontSizeMultiplier={1.6} style={{ color: c.text2, fontSize: 16, marginTop: 4 }}>Platform view shows train and metro services at this station.</Text>
    </View>
  ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ headerShown: false, animation: reduce ? 'none' : Platform.OS === 'ios' ? 'default' : 'fade' }} />
      <ScrollView contentContainerStyle={[pad, { paddingTop: insets.top + 6, paddingBottom: insets.bottom + 24 }]}>
        {head}
        {status ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }} accessibilityLiveRegion="polite">
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: offlineAt || error ? c.orange : c.text3, marginRight: 7 }} />
            <Text maxFontSizeMultiplier={1.6} style={{ color: c.text2, fontSize: 15, flex: 1 }}>{status}</Text>
          </View>
        ) : null}
        {L.wide ? (
          <View style={{ flexDirection: 'row', gap: 24, marginTop: 14, alignItems: 'flex-start' }}>
            <View style={{ flex: 1, gap: 16 }}>{mainCard}{empty}{speakBtn}</View>
            <View style={{ flex: 1, gap: 20 }}>{after}{stopList}</View>
          </View>
        ) : (
          <View style={{ gap: 18, marginTop: 14 }}>
            {mainCard}{empty}
            {speakBtn}
            {stopList}
            {after}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

/** Speak: says the platform, carriages, when it leaves and the stops, in the best installed voice. */
function SpeakPill({ say }: { say: () => string }) {
  const c = usePalette();
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
      <Pressable onPress={go} accessibilityRole="button" accessibilityLabel="Speak" accessibilityHint="Reads the platform, carriages, departure time and stops out loud"
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch', minHeight: 52, borderRadius: 26, backgroundColor: c.fill, opacity: pressed ? 0.7 : 1 })}>
        <Icon name={I.speaker} size={18} color={c.tint} />
        <Text maxFontSizeMultiplier={1.6} style={{ color: c.tint, fontSize: 18, fontWeight: '700', marginLeft: 8 }}>Speak</Text>
      </Pressable>
      {help ? <Suspense fallback={null}><VoiceHelp visible start="prompt" onClose={() => setHelp(false)} /></Suspense> : null}
    </>
  );
}
