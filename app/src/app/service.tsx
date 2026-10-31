import { useMemo, useRef } from 'react';
import { goBack } from '@/lib/nav';
import { Alert, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSides } from '@/lib/layout';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { api } from '@/lib/api';
import { useLive, useNow } from '@/lib/hooks';
import { cacheKey } from '@/lib/offlineCore';
import { keptRoute } from '@/lib/prefetch';
import { isSeeded, serviceQuery, serviceSeed, svcCacheId } from '@/lib/speedCore';
import { usePalette, androidLook } from '@/lib/theme';
import { badgeLook } from '@/lib/lineStyle';
import { bestTime, clock, ms, shortName } from '@/lib/format';
import { useStore } from '@/lib/store';
import { svcSpec, toggleWatch, tripKey } from '@/lib/watch';
import TransitMap from '@/components/LazyTransitMap';
import { Icon, I } from '@/components/Icon';
import { useUsualText } from '@/lib/usual';
import { LineBadge, LiveStamp, OccupancyChip, QuietChip, StatusLine } from '@/components/Transit';
import { Button, font, T } from '@/components/ui';
import { stopNumber } from '@/lib/busCore';
import { boardAlight } from '@/lib/stopBoardCore';
import { liveState } from '@/lib/liveLabelCore';
import { onColor } from '@/lib/theme';
import { busMarker, tripTraffic } from '@/lib/busLiveCore';

export default function ServiceScreen() {
  const p = useLocalSearchParams<{ trip: string; feed: string; line: string; stop: string; planned: string; mode: string; destId: string; color: string; dest: string; rt: string; est: string; delay: string; to: string; sname: string; tname: string; tplan: string; seen: string }>();
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const side = useSides();
  const { height } = useWindowDimensions();
  const st = useStore();
  const sheet = useRef<BottomSheet>(null);
  // First frame (27 Oct speed pass): the copy kept on the phone (or read on press in), else what the tapped row showed
  // (line, destination, live flag, delay, your stop and time), labelled with its age until the live answer lands.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // A bus whose route list is kept on the phone (route.tsx, or read on press in) also paints the stops after yours.
  const seed = useMemo(() => serviceSeed(p, Date.now(), keptRoute(p.line, p.mode)), [p.trip, p.planned, p.to]);
  const { data, error, updatedAt, offlineAt, staleAt } = useLive(() => api.service(serviceQuery(p)), 15000, [p.trip, p.planned, p.to],
    { cacheKey: p.trip ? cacheKey('svc', svcCacheId(p)) : undefined, seed });
  const seeded = isSeeded(data);
  const color = badgeLook(p.line || data?.line, p.mode || data?.mode, data?.color || p.color).bg;
  const snaps = useMemo(() => ['38%', '62%', '92%'], []);
  const key = tripKey(p.trip, p.planned, p.line);
  const watchedId = st.watchedTrips[key];
  const stops = data?.stops || [];
  const nextIdx = data?.nextIndex ?? stops.findIndex((s) => !s.passed);
  // One live flag for the whole app: the board said live, or the trip feed says live.
  const boardLive = p.rt === '1';
  const live = boardLive || !!data?.live;
  const delayMin = data?.live && data?.delayMin != null ? data.delayMin : boardLive && p.delay ? Number(p.delay) : data?.delayMin;
  const mineEst = data?.mine?.estimated || (boardLive && p.est ? p.est : null);
  const busMode = String(p.mode || data?.mode || '');
  const busLike = (busMode === 'bus' || busMode === 'coach' || busMode === 'school') && !!(p.line || data?.line);
  // Opened from a trip or a plan (`to` is the stop you get off at): GET ON and GET OFF tags on your two stops.
  const tags = boardAlight(stops, p.stop, p.to);
  const usual = useUsualText({ kind: 'transit', line: p.line || data?.line, stopId: p.stop, planned: p.planned });
  const mineStop = stops.find((s) => s.mine);
  // Buses: "Running slow in traffic" when the live delays ahead grow, and where to draw the bus on the line of stops.
  const traffic = busLike && data ? tripTraffic({ ...data, mode: data.mode || busMode }) : null;
  const mk = busLike && data?.live ? busMarker(stops, nextIdx, data.where, !!data.vehicle) : null;
  // The live label is the only thing on this screen that changes with the clock: it ticks in ServiceStatus, so the map and
  // the stop list do not redraw every 5 s (27 Oct speed pass 5).
  const liveAt = { planned: mineStop?.planned || p.planned, estimated: mineEst || mineStop?.estimated, realtime: live, cancelled: data?.cancelled, seenAt: updatedAt ?? (data as any)?.seenAt, vehicleAgeS: data?.vehicle?.ageS };

  const watch = () => {
    const mine = stops.find((s) => s.mine);
    toggleWatch(svcSpec({ mode: p.mode || data?.mode || 'bus', line: p.line || data?.line || '', dest: p.dest || data?.dest || '', destId: p.destId, stopId: p.stop, stopName: mine?.name, tripId: p.trip, planned: p.planned, estimated: mine?.estimated || mineEst, realtime: live, color, platform: mine?.platform } as any), watchedId)
      .then((id) => { if (id) Alert.alert('Watching', "I'll alert you when it's time to leave, if it runs late or the platform changes."); });
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <TransitMap path={data?.path} stops={stops} vehicle={data?.vehicle || null} color={color} mode={p.mode || data?.mode} dark={c.dark} bottomInset={height * 0.38} />
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => goBack()} style={[sx.back, { top: insets.top + 8, left: insets.left + 16, backgroundColor: c.card }]} hitSlop={8}>
        <Icon name={Platform.OS === 'ios' ? { ios: 'chevron.left', android: 'arrow_back' } : { ios: 'chevron.left', android: 'arrow_back' }} size={20} color={c.text} />
      </Pressable>
      <BottomSheet ref={sheet} index={0} snapPoints={snaps} enableDynamicSizing={false}
        backgroundStyle={{ backgroundColor: c.card, borderRadius: Platform.OS === 'ios' ? 14 : 28 }} handleIndicatorStyle={{ backgroundColor: c.text3, width: 36 }}>
        <BottomSheetScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingLeft: side.left, paddingRight: side.right }}>
          <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <LineBadge line={p.line || data?.line} mode={p.mode || data?.mode} color={color} kind />
              <T kind="title3" numberOfLines={2} style={{ flex: 1 }}>to {shortName(p.dest || data?.dest)}</T>
              {busLike ? (
                <Pressable onPress={() => router.push({ pathname: '/route', params: { line: String(p.line || data?.line || ''), mode: busMode, stop: p.stop || '', towards: p.dest || data?.dest || '', color: data?.color || p.color || '' } })}
                  accessibilityRole="button" accessibilityLabel={`Route ${p.line || data?.line}, all stops`} hitSlop={8}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, minHeight: 32, paddingVertical: 4, borderRadius: 16, backgroundColor: c.fill, opacity: pressed ? 0.7 : 1 })}>
                  <Icon name={I.route} size={14} color={c.tint} />
                  <T kind="sub" tone="tint" style={{ fontWeight: '600' }}>Route</T>
                </Pressable>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <ServiceStatus at={liveAt} realtime={live} delayMin={delayMin} cancelled={data?.cancelled} timetableText={busLike ? 'Timetable only' : undefined} />
              {data?.vehicle?.occupancy?.text ? <OccupancyChip o={data.vehicle.occupancy} style={{ marginLeft: 6 }} /> : null}
              <QuietChip v={data?.vehicle as any} style={{ marginLeft: 6 }} />
              {data && !seeded && !data.vehicle ? <T kind="foot" tone="text2">{'\u00b7'} No GPS position yet</T> : null}
            </View>
            {traffic ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }} accessibilityLabel={traffic}>
                <Icon name={I.traffic} size={13} color={c.orange} />
                <T kind="foot" style={{ color: c.lateText, fontWeight: '600', flexShrink: 1 }}>{traffic}</T>
              </View>
            ) : null}
            {usual ? <T kind="foot" tone="text2" style={{ marginTop: 4 }}>{usual} at this stop</T> : null}
            {data?.where?.text ? <T kind="body" style={{ marginTop: 10 }}>{data.where.text}</T> : null}
            {data?.mine ? (
              <T kind="sub" tone="text2" style={{ marginTop: 4 }}>
                At {shortName(data.mine.name)} {clock(bestTime(data.mine.planned, mineEst))}{data.stopsAway != null && data.stopsAway > 0 ? `, ${data.stopsAway} stop${data.stopsAway === 1 ? '' : 's'} away` : ''}
              </T>
            ) : null}
            <View style={{ marginTop: 10 }}><LiveStamp updatedAt={updatedAt} error={error} offlineAt={offlineAt} staleAt={staleAt} /></View>
            <View style={{ marginTop: 14 }}>
              <Button title={watchedId ? 'Stop watching' : 'Watch this service'} icon={watchedId ? I.bellOff : I.bell} kind={watchedId ? 'tinted' : 'filled'} onPress={watch} />
            </View>
            {data?.alerts?.length ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
                <Icon name={I.warn} size={15} color={c.orange} />
                <T kind="foot" style={{ flex: 1, color: c.lateText }}>{data.alerts[0].title}</T>
              </View>
            ) : null}
          </View>

          <View style={{ marginTop: 18, paddingHorizontal: 20 }}>
            {stops.map((s, i) => {
              const isNext = i === nextIdx;
              const est = s.estimated || (s.mine ? mineEst : null);
              const t = bestTime(s.planned, est);
              const changed = est && s.planned && Math.abs(ms(est) - ms(s.planned)) >= 60000;
              // A stop the service runs past today (the feed marks it skipped): kept in the list, greyed, "Not stopping".
              const skip = !!s.skipped && !s.mine;
              const dim = s.passed || skip || (tags.off >= 0 && i > tags.off);
              const tag = i === tags.on ? 'GET ON' : i === tags.off ? 'GET OFF' : null;
              return (
                <View key={s.id + i} style={{ flexDirection: 'row', minHeight: 44 }} accessibilityLabel={tag ? `${tag === 'GET ON' ? 'Get on' : 'Get off'} here: ${shortName(s.name)}` : skip ? `${shortName(s.name)}, not stopping` : undefined}>
                  <View style={{ width: 28, alignItems: 'center' }}>
                    <View style={{ position: 'absolute', top: i === 0 ? 22 : 0, bottom: i === stops.length - 1 ? 22 : 0, width: 4, backgroundColor: dim ? c.text3 : color, opacity: dim ? 0.5 : 1 }} />
                    <View style={{ marginTop: 16, width: s.mine || isNext || tag ? 14 : 10, height: s.mine || isNext || tag ? 14 : 10, borderRadius: 7, backgroundColor: isNext ? color : c.card, borderWidth: 2.5, borderColor: dim ? c.text3 : color }} />
                    {mk && mk.index === i ? (
                      <View style={[sx.bus, { top: mk.at ? 11 : i === 0 ? -2 : -12, backgroundColor: color, borderColor: c.card }]}>
                        <Icon name={I.bus} size={12} color={onColor(color)} />
                      </View>
                    ) : null}
                  </View>
                  <View style={{ flex: 1, paddingVertical: 11, paddingLeft: 8, flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <T kind={s.mine || tag ? 'headline' : 'callout'} tone={dim ? 'text2' : 'text'} numberOfLines={2}>{shortName(s.name)}</T>
                      {busLike && stopNumber(s.id) ? <T kind="caption" tone="text3">Stop {s.id}</T> : null}
                      {tag || isNext ? (
                        <View style={{ flexDirection: 'row', gap: 6, marginTop: 3 }}>
                          {tag ? <StopTag text={tag} on={tag === 'GET ON'} color={color} /> : null}
                          {isNext ? <T kind="caption" style={{ color, fontWeight: '700' }}>{mk && mk.at && mk.index === i ? 'BUS IS HERE' : 'NEXT STOP'}</T> : null}
                        </View>
                      ) : null}
                      {s.mine && !isNext && !tag ? <T kind="caption" tone="tint" style={{ textTransform: androidLook ? 'none' : 'uppercase', fontWeight: '700', marginTop: 1 }}>Your stop</T> : null}
                      {skip ? <T kind="caption" style={{ color: c.lateText, fontWeight: '600', marginTop: 1 }}>Not stopping</T> : null}
                      {mk && mk.at && mk.index === i && !isNext ? <T kind="caption" style={{ textTransform: androidLook ? 'none' : 'uppercase', color, fontWeight: '700', marginTop: 1 }}>Bus is here</T> : null}
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      {skip ? null : <T kind="sub" tone={dim ? 'text3' : live ? 'text' : 'text2'} style={{ fontVariant: ['tabular-nums'], fontWeight: s.mine ? '600' : '400' }}>{clock(t)}</T>}
                      {changed && !dim ? <T kind="caption" tone="text3" style={{ textDecorationLine: 'line-through' }}>{clock(ms(s.planned))}</T> : null}
                    </View>
                  </View>
                </View>
              );
            })}
            {!data && !error ? <T kind="sub" tone="text2">Finding the vehicle</T> : null}
            {seeded && !error ? <T kind="sub" tone="text2" style={{ marginTop: stops.length ? 6 : 0 }}>{stops.length > 2 ? 'Getting live times' : 'Loading every stop'}</T> : null}
            {(!data || seeded) && error ? <T kind="sub" tone="text2">{error}</T> : null}
          </View>
        </BottomSheetScrollView>
      </BottomSheet>
    </View>
  );
}

/** Opal style tag on a stop in the list: GET ON filled in the line colour, GET OFF outlined. */
function StopTag({ text, on, color }: { text: string; on: boolean; color: string }) {
  const c = usePalette();
  return (
    <View style={{ borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1, backgroundColor: on ? color : 'transparent', borderWidth: 1.5, borderColor: color }}>
      <Text maxFontSizeMultiplier={1.3} style={[font.caption, { fontWeight: '800', color: on ? onColor(color) : c.text, letterSpacing: 0.3 }]}>{text}</Text>
    </View>
  );
}

const sx = StyleSheet.create({
  bus: { position: 'absolute', width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  back: { position: 'absolute', left: 16, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
});

/** The service's live label with its own clock (useNow, 5 s, only while on view): the one part of the screen that ages. */
function ServiceStatus({ at, realtime, delayMin, cancelled, timetableText }: { at: Parameters<typeof liveState>[0]; realtime?: boolean; delayMin?: number | null; cancelled?: boolean; timetableText?: string }) {
  const now = useNow();
  return <StatusLine realtime={realtime} delayMin={delayMin} cancelled={cancelled} state={liveState(at, now)} timetableText={timetableText} />;
}
