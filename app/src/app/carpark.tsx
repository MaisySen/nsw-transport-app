// One car park (or every car park at a station): live spaces, when Transport for NSW read them, and Directions in
// Apple Maps on iPhone or Google Maps on Android. Opened from the station's car park row and from Car parks.
import { useMemo } from 'react';
import { Linking, Platform, RefreshControl, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { api } from '@/lib/api';
import { prefetchStop } from '@/lib/prefetch';
import { useLive } from '@/lib/hooks';
import { cacheKey } from '@/lib/offlineCore';
import { LiveStamp } from '@/components/Transit';
import { radius, usePalette } from '@/lib/theme';
import { parkBadge, parkFill, parkName, stShort, usualLine, type CarPark } from '@/lib/access';
import { directionsUrl, updatedText } from '@/lib/carparkCore';
import { Badge } from '@/components/Access';
import { I } from '@/components/Icon';
import { Empty, font, Row, Screen, Sep, T } from '@/components/ui';

function ParkBlock({ p, station }: { p: CarPark; station?: string }) {
  const c = usePalette();
  const live = p.free != null && !p.stale;
  const b = live ? parkBadge(p) : parkBadge({ status: 'unknown' });
  const fill = live ? parkFill(p) : null;
  const barCol = p.status === 'full' ? c.red : p.status === 'nearly' ? c.orange : c.green;
  const url = directionsUrl(p, Platform.OS);
  const usual = usualLine(p);
  const upd = updatedText(p.updated, Date.now());
  return (
    <View style={{ marginHorizontal: 16, marginTop: 16, backgroundColor: c.card, borderRadius: radius, overflow: 'hidden' }}>
      <View accessible accessibilityLabel={`${parkName(p, station)}. ${live ? `${p.free} of ${p.spots} spaces free` : `${p.spots} spaces, no live count right now`}${upd ? `. ${upd}` : ''}`} style={{ padding: 16 }}>
        <T kind="headline" numberOfLines={2}>{parkName(p, station)}</T>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 8, gap: 8 }}>
          {live ? (
            <>
              <Text maxFontSizeMultiplier={1.4} style={[font.largeTitle, { color: c.text, fontVariant: ['tabular-nums'] }]}>{p.free}</Text>
              <T kind="body" tone="text2" style={{ marginBottom: 5, fontVariant: ['tabular-nums'] }}>free of {p.spots}</T>
            </>
          ) : <T kind="body" tone="text2">{p.spots} spaces, no live count right now</T>}
          <View style={{ marginBottom: live ? 7 : 0 }}><Badge text={b.text} tone={b.tone} /></View>
        </View>
        {fill != null ? <View style={{ height: 6, borderRadius: 3, marginTop: 10, overflow: 'hidden', backgroundColor: c.fill }}><View style={{ width: `${fill}%`, height: '100%', backgroundColor: barCol }} /></View> : null}
        {upd ? <T kind="foot" tone="text2" style={{ marginTop: 8, fontVariant: ['tabular-nums'] }}>{upd}</T> : null}
        {usual ? <T kind="foot" tone="text2" style={{ marginTop: 4 }}>{usual}</T> : null}
        {p.address ? <T kind="foot" tone="text2" style={{ marginTop: 4 }}>{p.address}</T> : null}
      </View>
      {url ? (<><Sep inset={61} /><Row icon={I.nav} iconBg="#34C759" title="Directions" subtitle={Platform.OS === 'ios' ? 'Opens Apple Maps' : 'Opens Google Maps'} onPress={() => { Linking.openURL(url).catch(() => {}); }} /></>) : null}
    </View>
  );
}

export default function CarParkScreen() {
  const c = usePalette();
  const p = useLocalSearchParams<{ id?: string; stop?: string; station?: string; from?: string }>();
  const id = typeof p.id === 'string' ? p.id : '';
  const stop = typeof p.stop === 'string' ? p.stop : '';
  const station = typeof p.station === 'string' && p.station ? p.station : undefined;
  const { data, error, refreshing, refresh, staleAt, offlineAt } = useLive<{ carparks: CarPark[] } | null>(
    () => (id ? api.carpark(id).then((r) => ({ carparks: r.carpark ? [r.carpark] : [] })) : stop ? api.parking(stop) : Promise.resolve(null)), 120000, [id, stop],
    // First frame (27 Oct speed pass): the car park the list showed, or the copy kept on the phone, with its age.
    { cacheKey: id ? cacheKey('park', `cp:${id}`) : stop ? cacheKey('park', `stop:${stop}`) : undefined });
  const list = useMemo(() => data?.carparks || [], [data]);
  const title = list.length === 1 ? 'Car park' : station ? `${stShort(station)} car parks` : 'Car parks';
  const stationId = list[0]?.station;
  return (
    <>
      <Stack.Screen options={{ title }} />
      <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />} contentContainerStyle={{ paddingBottom: 32 }}>
        {staleAt || offlineAt ? <View style={{ marginHorizontal: 20, marginTop: 8 }}><LiveStamp updatedAt={null} error={error} staleAt={staleAt} offlineAt={offlineAt} /></View> : null}
        {list.map((x) => <ParkBlock key={x.id} p={x} station={station} />)}
        {p.from === 'list' && stationId ? (
          <View style={{ marginHorizontal: 16, marginTop: 16, backgroundColor: c.card, borderRadius: radius, overflow: 'hidden' }}>
            <Row icon={I.train} iconBg="#F6891F" title="Station departures" onPressIn={() => prefetchStop(stationId)} onPress={() => router.push({ pathname: '/stop/[id]', params: { id: stationId, name: '' } })} />
          </View>
        ) : null}
        {data && !list.length ? <Empty icon={I.car} title="No live car park here" body="Transport for NSW sends no Park and Ride count for this one right now." /> : null}
        {error && !data ? <Empty icon={I.warn} title="Can't load the car park" body={error} /> : null}
        {list.length ? <T kind="foot" tone="text2" style={{ marginHorizontal: 32, marginTop: 12 }}>Live spaces from the Transport for NSW Car Park API. Nearly full means 10 percent or fewer spaces left.</T> : null}
      </Screen>
    </>
  );
}
