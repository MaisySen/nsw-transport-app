// Opal machines: stations with an Opal top up or ticket machine, closest first, on a map and in a list.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { api } from '@/lib/api';
import { radius, usePalette } from '@/lib/theme';
import { distText, stShort, TICKET, type TopupItem } from '@/lib/access';
import { myPosition } from '@/lib/where';
import TransitMap from '@/components/TransitMap';
import { Segmented } from '@/components/Segmented';
import { MapCard } from '@/components/MapCard';
import { I } from '@/components/Icon';
import { Empty, Row, Screen, Sep, T } from '@/components/ui';

type Filter = 'all' | 'cash';

export default function TopupScreen() {
  const c = usePalette();
  const p = useLocalSearchParams<{ cash?: string }>();
  const [filter, setFilter] = useState<Filter>(p.cash === '1' ? 'cash' : 'all');
  const [me, setMe] = useState<{ lat: number; lon: number } | null>(null);
  const [items, setItems] = useState<TopupItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scrollOn, setScrollOn] = useState(true);
  const onScrollChange = useCallback((on: boolean) => setScrollOn(on), []);

  useEffect(() => {
    let live = true;
    (async () => {
      const pos = await myPosition(true);
      if (!live) return;
      setMe(pos);
      try {
        const r = await api.topup(pos?.lat, pos?.lon, 40);
        if (live) setItems(r.items || []);
      } catch (e: any) { if (live) setError(e.message); }
    })();
    return () => { live = false; };
  }, []);

  const list = useMemo(() => (items || []).filter((r) => filter === 'all' || r.kind === 'cash'), [items, filter]);
  const near = me ? list.slice(0, 25) : list.slice(0, 40);
  const pins = useMemo(() => (me ? list.slice(0, 60) : list).map((r) => ({ id: r.id, name: stShort(r.name), lat: r.lat, lon: r.lon, color: (TICKET[r.kind] || TICKET.card)[2] })), [list, me]);
  const fit = useMemo<[number, number][] | undefined>(() => (me ? [[me.lat, me.lon], ...near.slice(0, 5).map((r) => [r.lat, r.lon] as [number, number])] : undefined), [me, near]);
  const open = (r: { id: string; name: string }) => router.push({ pathname: '/stop/[id]', params: { id: r.id, name: r.name } });

  return (
    <>
      <Stack.Screen options={{ title: 'Opal machines' }} />
      <Screen scrollEnabled={scrollOn}>
        <T kind="sub" tone="text2" style={{ marginHorizontal: 20, marginTop: 6 }}>{me ? 'Closest stations with a top up or ticket machine' : 'Stations with a top up or ticket machine'}</T>
        <Segmented value={filter} onChange={setFilter} options={[{ k: 'all', label: 'All machines' }, { k: 'cash', label: 'Takes cash' }]} />
        <MapCard onScrollChange={onScrollChange} label="Map of Opal machines" style={{ height: 260, marginHorizontal: 16, marginTop: 12, borderRadius: radius, overflow: 'hidden', backgroundColor: c.card }}>
          {items ? (
            <TransitMap key={filter} stops={pins} me={me} fit={fit} color={c.tint} dark={c.dark} embedded
              onStopPress={(id) => { const r = list.find((x) => x.id === id); if (r) open(r); }} />
          ) : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={c.tint} /></View>}
        </MapCard>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginHorizontal: 20, marginTop: 10 }}>
          {(filter === 'all' ? ['cash', 'card', 'topup'] : ['cash']).map((k) => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: TICKET[k][2] }} />
              <T kind="caption" tone="text2">{k === 'cash' ? 'Cash or card' : k === 'card' ? 'Card only' : 'Top up only'}</T>
            </View>
          ))}
        </View>
        {near.length ? (
          <View style={{ marginHorizontal: 16, marginTop: 14, backgroundColor: c.card, borderRadius: radius, overflow: 'hidden' }}>
            {near.map((r, i) => {
              const k = TICKET[r.kind] || TICKET.card;
              return (
                <View key={r.id}>
                  {i ? <Sep inset={57} /> : null}
                  <Row icon={I.fare} iconBg={k[2]} title={stShort(r.name)} subtitle={`${k[1]}${r.kind === 'topup' ? ' \u00b7 top up only' : ''}`}
                    right={r.distance != null ? <T kind="body" tone="text2" style={{ fontVariant: ['tabular-nums'] }}>{distText(r.distance)}</T> : undefined}
                    onPress={() => open(r)} />
                </View>
              );
            })}
          </View>
        ) : null}
        {items && !near.length ? <Empty icon={I.fare} title="No machines found" body={filter === 'cash' ? 'None nearby take cash. Try All machines.' : 'Try again in a moment.'} /> : null}
        {error && !items ? <Empty icon={I.warn} title="Can't load Opal machines" body={error} /> : null}
        <T kind="foot" tone="text2" style={{ marginHorizontal: 32, marginTop: 12 }}>
          Machines at stations, wharves and light rail stops, from Transport for NSW open data (station facilities). Opal retailers are not in the open data. You can also top up in the Opal Travel app.
        </T>
      </Screen>
    </>
  );
}
