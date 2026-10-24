// Park and Ride: every car park with live spaces, closest first when location is allowed, else A to Z.
import { useEffect, useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { api } from '@/lib/api';
import { useLive } from '@/lib/hooks';
import { radius, usePalette } from '@/lib/theme';
import { distText, type CarPark } from '@/lib/access';
import { geoDist } from '@/lib/trips';
import { myPosition } from '@/lib/where';
import { ParkCell } from '@/components/Access';
import { I } from '@/components/Icon';
import { Empty, Screen, Sep, T } from '@/components/ui';

export default function ParkingScreen() {
  const c = usePalette();
  const [me, setMe] = useState<{ lat: number; lon: number } | null>(null);
  useEffect(() => { myPosition(true).then(setMe); }, []);
  const { data, error, refreshing, refresh } = useLive(() => api.parking(), 120000);
  const list = useMemo(() => {
    const all: (CarPark & { d?: number })[] = (data?.carparks || []).map((p) => ({ ...p, d: me && p.lat != null && p.lon != null ? geoDist(me.lat, me.lon, p.lat, p.lon) : undefined }));
    return me ? all.sort((a, b) => (a.d ?? 1e12) - (b.d ?? 1e12)) : all.sort((a, b) => a.name.localeCompare(b.name));
  }, [data, me]);

  return (
    <>
      <Stack.Screen options={{ title: 'Park and Ride' }} />
      <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <T kind="sub" tone="text2" style={{ marginHorizontal: 20, marginTop: 6 }}>{me ? 'Live spaces, closest first' : 'Live spaces'}</T>
        {list.length ? (
          <View style={{ marginHorizontal: 16, marginTop: 12, backgroundColor: c.card, borderRadius: radius, overflow: 'hidden' }}>
            {list.map((p, i) => (
              <View key={p.id}>
                {i ? <Sep inset={61} /> : null}
                <ParkCell p={p} dist={p.d != null ? distText(p.d) : undefined} onPress={() => router.push({ pathname: '/stop/[id]', params: { id: p.station, name: '' } })} />
              </View>
            ))}
          </View>
        ) : null}
        {!data && !error ? (
          <View style={{ marginHorizontal: 16, marginTop: 12, backgroundColor: c.card, borderRadius: radius, overflow: 'hidden' }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }}>
                <View style={{ width: 29, height: 29, borderRadius: 7, backgroundColor: c.fill }} />
                <View style={{ flex: 1, gap: 8 }}><View style={{ height: 12, width: '55%', borderRadius: 6, backgroundColor: c.fill }} /><View style={{ height: 10, width: '35%', borderRadius: 5, backgroundColor: c.fill }} /></View>
              </View>
            ))}
          </View>
        ) : null}
        {error && !data ? <Empty icon={I.warn} title="Can't load car parks" body={error} /> : null}
        <T kind="foot" tone="text2" style={{ marginHorizontal: 32, marginTop: 12 }}>Live spaces from the Transport for NSW Car Park API, live. Nearly full means 10 percent or fewer spaces left. Open a station to get an alert when it gets nearly full.</T>
      </Screen>
    </>
  );
}
