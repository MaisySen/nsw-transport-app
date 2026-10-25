import { useMemo, useRef } from 'react';
import { goBack } from '@/lib/nav';
import { Alert, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSides } from '@/lib/layout';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { api } from '@/lib/api';
import { useLive, useNow } from '@/lib/hooks';
import { usePalette } from '@/lib/theme';
import { badgeLook } from '@/lib/lineStyle';
import { bestTime, clock, ms, shortName } from '@/lib/format';
import { useStore } from '@/lib/store';
import { svcSpec, toggleWatch, tripKey } from '@/lib/watch';
import TransitMap from '@/components/TransitMap';
import { Icon, I } from '@/components/Icon';
import { LineBadge, LiveStamp, OccupancyChip, QuietChip, StatusLine } from '@/components/Transit';
import { Button, T } from '@/components/ui';

export default function ServiceScreen() {
  const p = useLocalSearchParams<{ trip: string; feed: string; line: string; stop: string; planned: string; mode: string; destId: string; color: string; dest: string; rt: string; est: string; delay: string }>();
  const c = usePalette();
  const now = useNow();
  const insets = useSafeAreaInsets();
  const side = useSides();
  const { height } = useWindowDimensions();
  const st = useStore();
  const sheet = useRef<BottomSheet>(null);
  const { data, error, updatedAt } = useLive(() => api.service({ trip: p.trip, feed: p.feed || undefined, line: p.line, stop: p.stop, planned: p.planned, mode: p.mode, destId: p.destId }), 15000, [p.trip, p.planned]);
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
              <LineBadge line={p.line || data?.line} mode={p.mode || data?.mode} color={color} />
              <T kind="title3" numberOfLines={1} style={{ flex: 1 }}>to {shortName(p.dest || data?.dest)}</T>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <StatusLine realtime={live} delayMin={delayMin} cancelled={data?.cancelled} />
              {data?.vehicle?.occupancy?.text ? <OccupancyChip o={data.vehicle.occupancy} style={{ marginLeft: 6 }} /> : null}
              <QuietChip v={data?.vehicle as any} style={{ marginLeft: 6 }} />
              {data && !data.vehicle ? <T kind="foot" tone="text2">{'\u00b7'} No GPS position yet</T> : null}
            </View>
            {data?.where?.text ? <T kind="body" style={{ marginTop: 10 }}>{data.where.text}</T> : null}
            {data?.mine ? (
              <T kind="sub" tone="text2" style={{ marginTop: 4 }}>
                At {shortName(data.mine.name)} {clock(bestTime(data.mine.planned, mineEst))}{data.stopsAway != null && data.stopsAway > 0 ? `, ${data.stopsAway} stop${data.stopsAway === 1 ? '' : 's'} away` : ''}
              </T>
            ) : null}
            <View style={{ marginTop: 10 }}><LiveStamp updatedAt={updatedAt} error={error} /></View>
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
              const dim = s.passed;
              return (
                <View key={s.id + i} style={{ flexDirection: 'row', minHeight: 44 }}>
                  <View style={{ width: 28, alignItems: 'center' }}>
                    <View style={{ position: 'absolute', top: i === 0 ? 22 : 0, bottom: i === stops.length - 1 ? 22 : 0, width: 4, backgroundColor: dim ? c.text3 : color, opacity: dim ? 0.5 : 1 }} />
                    <View style={{ marginTop: 16, width: s.mine || isNext ? 14 : 10, height: s.mine || isNext ? 14 : 10, borderRadius: 7, backgroundColor: isNext ? color : c.card, borderWidth: 2.5, borderColor: dim ? c.text3 : color }} />
                  </View>
                  <View style={{ flex: 1, paddingVertical: 11, paddingLeft: 8, flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <T kind={s.mine ? 'headline' : 'callout'} tone={dim ? 'text2' : 'text'} numberOfLines={1}>{shortName(s.name)}</T>
                      {isNext ? <T kind="caption" style={{ color, fontWeight: '700', marginTop: 1 }}>NEXT STOP</T> : null}
                      {s.mine && !isNext ? <T kind="caption" tone="tint" style={{ fontWeight: '700', marginTop: 1 }}>YOUR STOP</T> : null}
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <T kind="sub" tone={dim ? 'text3' : live ? 'text' : 'text2'} style={{ fontVariant: ['tabular-nums'], fontWeight: s.mine ? '600' : '400' }}>{clock(t)}</T>
                      {changed && !dim ? <T kind="caption" tone="text3" style={{ textDecorationLine: 'line-through' }}>{clock(ms(s.planned))}</T> : null}
                    </View>
                  </View>
                </View>
              );
            })}
            {!data && !error ? <T kind="sub" tone="text2">Finding the vehicle</T> : null}
            {!data && error ? <T kind="sub" tone="text2">{error}</T> : null}
          </View>
        </BottomSheetScrollView>
      </BottomSheet>
    </View>
  );
}

const sx = StyleSheet.create({
  back: { position: 'absolute', left: 16, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
});
