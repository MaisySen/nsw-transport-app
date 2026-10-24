import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { haptic } from '@/lib/haptic';
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
import { StationInfo } from '@/components/Access';
import type { Station } from '@/lib/access';

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
  const stopName = data?.stop?.name || (name ? String(name) : '');
  // Remember opened stops for Home's Recent stops.
  useEffect(() => { if (id && stopName) store.addRecent({ id: String(id), name: stopName }); }, [id, stopName]);
  // Station access, lifts and Park and Ride: once, then every 2 minutes. No data (404) shows nothing.
  const [station, setStation] = useState<Station | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => api.station(String(id)).then((r) => { if (live) setStation(r && (r as any).access ? r : null); }).catch((e: any) => { if (live && e?.http === 404) setStation(null); });
    setStation(null);
    load();
    const t = setInterval(load, 120000);
    return () => { live = false; clearInterval(t); };
  }, [id]);
  // The stop's alerts show once at the top; a row repeats an alert only when it is not already there.
  const topAlerts = [...(data?.alerts || [])].sort((a, b) => (a.priority === 'low' ? 1 : 0) - (b.priority === 'low' ? 1 : 0)).slice(0, 2);
  const topTitles = new Set(topAlerts.map((a) => a.title));
  const rowNote = (d: any) => { const t = rowAlert(d.alerts, data?.alerts); return t && !topTitles.has(t) ? t : null; };
  const items = (data?.items || []).filter((d) => (!mode || d.mode === mode) && ms(d.realtime ? d.estimated : d.planned) > now - 60000);

  return (
    <>
      <Stack.Screen options={{
        title,
        headerRight: () => (
          <Pressable accessibilityRole="button" accessibilityLabel={starred ? 'Remove from Starred stops' : 'Add to Starred stops'} accessibilityState={{ selected: !!starred }} hitSlop={13} onPress={() => { haptic.select(); store.toggleStar({ id: String(id), name: data?.stop?.name || String(name || title) }); }}>
            <Icon name={starred ? I.star : I.starOpen} size={22} color={starred ? c.yellow : c.tint} />
          </Pressable>
        ),
      }} />
      <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 4 }}>
          <LiveStamp updatedAt={updatedAt} error={error} />
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
              {topAlerts.map((a, i) => <T key={i} kind="sub" numberOfLines={3} style={{ marginTop: i ? 6 : 0 }}>{a.title}</T>)}
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
                  <DepartureRow d={d} now={now} alertText={rowNote(d)} watched={!!st.watchedTrips[key]} onPress={() => openService(d)} onWatch={() => toggleWatch(svcSpec(d), st.watchedTrips[key])} />
                </View>
              );
            })}
          </View>
        ) : null}
        {data && !items.length ? <Empty icon={I.clock} title="No more services" body="Nothing is due from here in the next few hours." /> : null}
        {!data && error ? <Empty icon={I.warn} title="Can't load this stop" body={error} /> : null}
        {data ? <T kind="foot" tone="text2" style={{ marginHorizontal: 32, marginTop: 12 }}>Touch and hold a service to watch it. Green times are live.</T> : null}
        <StationInfo st={station} />
      </Screen>
    </>
  );
}
