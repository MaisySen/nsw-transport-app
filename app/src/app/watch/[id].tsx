import { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { goBack } from '@/lib/nav';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { api } from '@/lib/api';
import { useLive } from '@/lib/hooks';
import { LIST_KEYS, watchSeed } from '@/lib/offlineCore';
import { peekOffline } from '@/lib/offline';
import type { Watch } from '@/lib/types';
import { usePalette } from '@/lib/theme';
import { clock, ms, shortName } from '@/lib/format';
import { stopWatch } from '@/lib/watch';
import { pressService } from '@/lib/prefetch';
import { WatchLineText, openService } from '@/components/Cards';
import { LineBadge, LiveStamp } from '@/components/Transit';
import { I } from '@/components/Icon';
import { Button, Empty, Row, Screen, Section, Sep, T } from '@/components/ui';

export default function WatchDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = usePalette();
  // A watch the server no longer has (stopped, ended and cleared, or a mistyped link) answers 404: say so once and stop
  // asking, instead of "Live times unavailable, trying again" over an empty screen every 15 seconds.
  const [gone, setGone] = useState(false);
  // First frame (27 Oct speed pass 3): this watch's kept copy, else the watch as the Watching list showed it (its
  // kept copy), labelled with its age until the detail answer lands.
  const seed = useMemo(() => watchSeed(peekOffline<{ items?: Watch[] }>(LIST_KEYS.watches), String(id)), [id]);
  const { data, error, updatedAt, staleAt, offlineAt } = useLive(() => api.watchDetail(String(id)).catch((e: any) => { if (e?.http === 404) setGone(true); throw e; }), 15000, [id],
    { enabled: !gone, cacheKey: id ? LIST_KEYS.watch(String(id)) : undefined, seed });
  const w = gone ? null : data?.watch;
  return (
    <>
      <Stack.Screen options={{ title: w?.title || 'Watching' }} />
      <Screen>
        {gone ? (
          <Empty icon={I.route} title="This watch has ended" body="It was stopped or its trip is over. Watches you have on now are in Watching."
            action={<Button title="Show Watching" onPress={() => router.replace('/watching')} />} />
        ) : <View style={{ paddingHorizontal: 20, paddingTop: 12 }}><LiveStamp updatedAt={updatedAt} error={error} staleAt={staleAt} offlineAt={offlineAt} /></View>}
        {w ? (
          <>
            <WatchLineText w={w} kind="title3" style={{ marginHorizontal: 20, marginTop: 10 }} />
            <Section title={w.legs.length > 1 ? 'Legs' : 'Service'}>
              {w.legs.map((l, i) => {
                const s0 = w.snap?.legs?.[i];
                const dep = s0?.depLive || s0?.dep || ms(l.estimated || l.planned);
                return (
                  <View key={i}>
                    {i ? <Sep /> : null}
                    <Row title={`${l.line} to ${shortName(l.towards)}`}
                      subtitle={`${shortName(l.from)}${l.fromPlatform ? `, ${l.fromPlatform}` : ''} at ${clock(dep)}${l.to ? `, off at ${shortName(l.to)}` : ''}${s0?.delay > 0 ? `, ${s0.delay} min late` : s0?.depLive ? ', on time' : ''}`}
                      right={<LineBadge line={l.line} mode={l.mode} color={l.color || undefined} />}
                      onPressIn={() => pressService(legSvc(l))} onPress={() => openService(legSvc(l))} />
                  </View>
                );
              })}
            </Section>
            {data?.notes?.length ? (
              <Section title="Alerts sent">
                {data.notes.map((n: any, i: number) => (
                  <View key={n.id}>
                    {i ? <Sep /> : null}
                    <View style={{ paddingHorizontal: 16, paddingVertical: 11 }}>
                      <T kind="headline">{n.title}</T>
                      <T kind="sub" tone="text2">{n.body}</T>
                      <T kind="caption" tone="text3" style={{ marginTop: 2 }}>{clock(n.at)}</T>
                    </View>
                  </View>
                ))}
              </Section>
            ) : null}
            {w.active ? <View style={{ margin: 16, marginTop: 24 }}><Button title="Stop watching" kind="tinted" onPress={() => stopWatch(w.id).then(() => goBack('/watching'), (e: any) => Alert.alert("Couldn't stop watching", String(e?.message || e)))} /></View> : null}
          </>
        ) : null}
      </Screen>
    </>
  );
}

/** The service a watch leg opens; a finger on the row starts its read (prefetch.pressService) like a board row does. */
function legSvc(l: Watch['legs'][number]) {
  return { tripId: l.tripId || undefined, line: l.line, stopId: l.stopId, planned: l.planned, mode: l.mode, destId: l.destId || undefined, color: l.color || undefined, dest: l.towards || undefined };
}
