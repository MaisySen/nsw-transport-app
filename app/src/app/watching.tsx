import { Alert, RefreshControl, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { api } from '@/lib/api';
import { useLive, useNow } from '@/lib/hooks';
import { usePalette, radius } from '@/lib/theme';
import { clock } from '@/lib/format';
import { stopWatch } from '@/lib/watch';
import { Icon, I } from '@/components/Icon';
import { watchLine } from '@/components/Cards';
import { LineBadge, LiveStamp } from '@/components/Transit';
import { Button, Empty, Row, Screen, Section, Sep, T } from '@/components/ui';

export default function Watching() {
  const c = usePalette();
  const now = useNow(1000);
  const { data, error, updatedAt, refreshing, refresh } = useLive(() => api.watches(), 15000);
  const active = (data?.items || []).filter((w) => w.active);
  const done = (data?.items || []).filter((w) => !w.active);
  const notes = data?.notes || [];
  return (
    <>
      <Stack.Screen options={{ title: 'Watching' }} />
      <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <View style={{ paddingHorizontal: 20, paddingTop: 4 }}><LiveStamp updatedAt={updatedAt} error={error} /></View>
        {active.map((w) => {
          const L = w.legs?.[0];
          return (
            <View key={w.id} style={{ marginHorizontal: 16, marginTop: 12, backgroundColor: c.card, borderRadius: radius, overflow: 'hidden' }}>
              <View style={{ padding: 16 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  {L ? <LineBadge line={L.line} mode={L.mode} color={L.color || undefined} /> : null}
                  <T kind="headline" numberOfLines={1} style={{ flex: 1 }}>{w.title}</T>
                  <Icon name={I.bell} size={16} color={c.indigo} />
                </View>
                <T kind="sub" style={{ marginTop: 8 }}>{watchLine(w, now)}</T>
                {w.legs.length > 1 ? <T kind="foot" tone="text2" style={{ marginTop: 3 }}>{w.legs.map((l) => l.line).join(', then ')}{w.replanned ? ' \u00b7 replanned' : ''}</T> : null}
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                  <View style={{ flex: 1 }}><Button title="Details" kind="tinted" onPress={() => router.push({ pathname: '/watch/[id]', params: { id: w.id } })} /></View>
                  <View style={{ flex: 1 }}><Button title="Stop" kind="tinted" onPress={() => Alert.alert('Stop watching?', w.title, [{ text: 'Cancel', style: 'cancel' }, { text: 'Stop', style: 'destructive', onPress: () => stopWatch(w.id).then(refresh) }])} /></View>
                </View>
              </View>
            </View>
          );
        })}
        {data && !active.length ? (
          <Empty icon={I.bell} title="Nothing watched"
            body="Swipe left on a departure to watch it. You get an alert if it runs late or the platform changes." />
        ) : null}
        {notes.length ? (
          <Section title="Recent alerts">
            {notes.map((n, i) => (
              <View key={n.id}>
                {i ? <Sep /> : null}
                <View style={{ paddingHorizontal: 16, paddingVertical: 11 }}>
                  <View style={{ flexDirection: 'row' }}>
                    <T kind="headline" style={{ flex: 1 }} numberOfLines={2}>{n.title}</T>
                    <T kind="foot" tone="text2">{clock(n.at)}</T>
                  </View>
                  <T kind="sub" tone="text2" style={{ marginTop: 2 }}>{n.body}</T>
                </View>
              </View>
            ))}
          </Section>
        ) : null}
        {done.length ? (
          <Section title="Ended">
            {done.map((w, i) => (
              <View key={w.id}>
                {i ? <Sep inset={57} /> : null}
                <Row icon={I.check} iconBg={c.text3} title={w.title} subtitle={w.ended || 'Finished'} chevron={false} />
              </View>
            ))}
          </Section>
        ) : null}
      </Screen>
    </>
  );
}
