import { Alert, View } from 'react-native';
import { goBack } from '@/lib/nav';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { api } from '@/lib/api';
import { useLive, useNow } from '@/lib/hooks';
import { usePalette } from '@/lib/theme';
import { clock, ms, shortName } from '@/lib/format';
import { stopWatch } from '@/lib/watch';
import { watchLine, openService } from '@/components/Cards';
import { LineBadge, LiveStamp } from '@/components/Transit';
import { Button, Row, Screen, Section, Sep, T } from '@/components/ui';

export default function WatchDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = usePalette();
  const now = useNow();
  const { data, error, updatedAt } = useLive(() => api.watchDetail(String(id)), 15000, [id]);
  const w = data?.watch;
  return (
    <>
      <Stack.Screen options={{ title: w?.title || 'Watching' }} />
      <Screen>
        <View style={{ paddingHorizontal: 20, paddingTop: 12 }}><LiveStamp updatedAt={updatedAt} error={error} /></View>
        {w ? (
          <>
            <T kind="title3" style={{ marginHorizontal: 20, marginTop: 10 }}>{watchLine(w, now)}</T>
            <Section title={w.legs.length > 1 ? 'Legs' : 'Service'}>
              {w.legs.map((l, i) => {
                const s0 = w.snap?.legs?.[i];
                const dep = s0?.depLive || s0?.dep || ms(l.estimated || l.planned);
                return (
                  <View key={i}>
                    {i ? <Sep /> : null}
                    <Row title={`${l.line} to ${shortName(l.towards)}`}
                      subtitle={`${shortName(l.from)}${l.fromPlatform ? `, ${l.fromPlatform}` : ''} at ${clock(dep)}${l.to ? `, off at ${shortName(l.to)}` : ''}${s0?.delay > 0 ? `, ${s0.delay} min late` : s0?.depLive ? ', on time' : ''}`}
                      right={<LineBadge small line={l.line} mode={l.mode} color={l.color || undefined} />}
                      onPress={() => openService({ tripId: l.tripId || undefined, line: l.line, stopId: l.stopId, planned: l.planned, mode: l.mode, destId: l.destId || undefined, color: l.color || undefined, dest: l.towards || undefined })} />
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
