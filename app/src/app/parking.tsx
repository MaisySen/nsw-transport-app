// Car parks (Park and Ride): every car park with live spaces, closest first when location is already allowed (low
// accuracy, never asks), else A to Z. Tap opens the car park with Directions (app/carpark.tsx).
import { useEffect, useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { api } from '@/lib/api';
import { useLive } from '@/lib/hooks';
import { radius, usePalette } from '@/lib/theme';
import { distText, type CarPark } from '@/lib/access';
import { sortParks } from '@/lib/carparkCore';
import { geoDist } from '@/lib/trips';
import { myPosition } from '@/lib/where';
import { ParkCell } from '@/components/Access';
import { I } from '@/components/Icon';
import { Empty, Screen, Sep, T } from '@/components/ui';

export default function ParkingScreen() {
  const c = usePalette();
  const [me, setMe] = useState<{ lat: number; lon: number } | null>(null);
  useEffect(() => { myPosition(false, true).then(setMe); }, []);
  const { data, error, refreshing, refresh } = useLive(() => api.parking(), 120000);
  const list = useMemo(() => sortParks<CarPark>(data?.carparks, me, geoDist), [data, me]);

  return (
    <>
      <Stack.Screen options={{ title: 'Car parks' }} />
      <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <T kind="sub" tone="text2" style={{ marginHorizontal: 20, marginTop: 6 }}>{me ? 'Park and Ride, live spaces, closest first' : 'Park and Ride, live spaces, A to Z'}</T>
        {list.length ? (
          <View style={{ marginHorizontal: 16, marginTop: 12, backgroundColor: c.card, borderRadius: radius, overflow: 'hidden' }}>
            {list.map((p, i) => (
              <View key={p.id}>
                {i ? <Sep inset={61} /> : null}
                <ParkCell p={p} dist={p.d != null ? distText(p.d) : undefined} onPress={() => router.push({ pathname: '/carpark', params: { id: p.id, from: 'list' } })} />
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
        {data && !list.length ? <Empty icon={I.warn} title="No car parks to show" body="The list came back empty. Pull down to try again." /> : null}
        <T kind="foot" tone="text2" style={{ marginHorizontal: 32, marginTop: 12 }}>Live spaces from the Transport for NSW Car Park API. Nearly full means 10 percent or fewer spaces left. Open the station to get an alert when it gets nearly full.</T>
      </Screen>
    </>
  );
}
