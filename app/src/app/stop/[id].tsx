import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/lib/api';
import { useLive, useNow } from '@/lib/hooks';
import { usePalette, radius } from '@/lib/theme';
import { ms, rowAlert, shortName } from '@/lib/format';
import { store, useStore } from '@/lib/store';
import { svcSpec, toggleWatch, tripKey } from '@/lib/watch';
import { Icon, I } from '@/components/Icon';
import { openService } from '@/components/Cards';
import { DepartureRow, LiveStamp } from '@/components/Transit';
import { Chip, Empty, Screen, Sep, T } from '@/components/ui';

const MODE_LABEL: Record<string, string> = { train: 'Trains', metro: 'Metro', bus: 'Buses', lightrail: 'Light rail', ferry: 'Ferries', coach: 'Coaches', school: 'School buses' };

export default function StopScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const c = usePalette();
  const now = useNow(1000);
  const st = useStore();
  const [mode, setMode] = useState<string | null>(null);
  const { data, error, updatedAt, refreshing, refresh } = useLive((r) => api.departures(String(id), r), 15000, [id]);
  const title = shortName(data?.stop?.name || name || 'Stop');
  const starred = st.starred.some((s) => s.id === id);
  const modes = useMemo(() => Array.from(new Set((data?.items || []).map((d) => d.mode))), [data]);
  const items = (data?.items || []).filter((d) => (!mode || d.mode === mode) && ms(d.realtime ? d.estimated : d.planned) > now - 60000);

  return (
    <>
      <Stack.Screen options={{
        title,
        headerRight: () => (
          <Pressable hitSlop={10} onPress={() => { Haptics.selectionAsync(); store.toggleStar({ id: String(id), name: data?.stop?.name || String(name || title) }); }}>
            <Icon name={starred ? I.star : I.starOpen} size={22} color={starred ? c.yellow : c.tint} />
          </Pressable>
        ),
      }} />
      <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 4 }}>
          <LiveStamp updatedAt={updatedAt} error={error} />
          {data?.live?.total ? <T kind="foot" tone="text2">{data.live.liveCount} of {data.live.total} live</T> : null}
        </View>

        {modes.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingTop: 14 }}>
            <Chip label="All" on={!mode} onPress={() => setMode(null)} />
            {modes.map((m) => <Chip key={m} label={MODE_LABEL[m] || m} on={mode === m} onPress={() => setMode(m)} />)}
          </ScrollView>
        ) : null}

        {data?.alerts?.length ? (
          <View style={{ marginHorizontal: 16, marginTop: 14, backgroundColor: c.card, borderRadius: radius, padding: 14, flexDirection: 'row', gap: 10 }}>
            <Icon name={I.warn} size={18} color={c.orange} />
            <View style={{ flex: 1 }}>
              {[...data.alerts].sort((a, b) => (a.priority === 'low' ? 1 : 0) - (b.priority === 'low' ? 1 : 0)).slice(0, 2).map((a, i) => <T key={i} kind="sub" numberOfLines={3} style={{ marginTop: i ? 6 : 0 }}>{a.title}</T>)}
            </View>
          </View>
        ) : null}

        {items.length ? (
          <View style={{ marginHorizontal: 16, marginTop: 14, backgroundColor: c.card, borderRadius: radius, overflow: 'hidden' }}>
            {items.map((d, i) => {
              const key = tripKey(d.tripId, d.planned, d.line);
              return (
                <View key={key + i}>
                  {i ? <Sep inset={82} /> : null}
                  <DepartureRow d={d} now={now} alertText={rowAlert(d.alerts, data?.alerts)} watched={!!st.watchedTrips[key]} onPress={() => openService(d)} onWatch={() => toggleWatch(svcSpec(d), st.watchedTrips[key])} />
                </View>
              );
            })}
          </View>
        ) : null}
        {data && !items.length ? <Empty icon={I.clock} title="No more services" body="Nothing is due from here in the next few hours." /> : null}
        {!data && error ? <Empty icon={I.warn} title="Can't load this stop" body={error} /> : null}
        {data ? <T kind="foot" tone="text2" style={{ marginHorizontal: 32, marginTop: 12 }}>Swipe left on a service, or touch and hold, to get alerts for it. Green times are live from the vehicle. Grey times are the timetable.</T> : null}
      </Screen>
    </>
  );
}
