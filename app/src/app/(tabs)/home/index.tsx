import { useState } from 'react';
import { Alert, RefreshControl, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { api } from '@/lib/api';
import { useLive, useNow } from '@/lib/hooks';
import { usePalette } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { daysText, shortName } from '@/lib/format';
import { Icon, I } from '@/components/Icon';
import { StopCard, TripCard, watchLine } from '@/components/Cards';
import { LiveStamp } from '@/components/Transit';
import { Button, Empty, Row, Screen, Section, Sep, T } from '@/components/ui';

function greeting() {
  const h = Number(new Date().toLocaleString('en-AU', { hour: 'numeric', hour12: false, timeZone: 'Australia/Sydney' }));
  return h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function Home() {
  const c = usePalette();
  const now = useNow(1000);
  const st = useStore();
  const [busy, setBusy] = useState(false);
  const live = useLive(async () => {
    const [commutes, saved, watches] = await Promise.all([
      api.commutes().catch(() => ({ items: [], suggestion: null })),
      api.saved().catch(() => ({ items: [] })),
      api.watches().catch(() => ({ items: [], notes: [] })),
    ]);
    return { commutes, saved, watches };
  }, 20000);
  const d = live.data;
  const activeWatches = (d?.watches.items || []).filter((w: any) => w.active);
  const sugg: any = d?.commutes.suggestion;
  const nothing = d && !d.commutes.items.length && !d.saved.items.length && !st.starred.length && !activeWatches.length;

  const acceptSuggestion = async () => {
    setBusy(true);
    try {
      await api.saveCommute({ name: sugg.name || 'Morning trip', from: sugg.from, to: sugg.to, tod: sugg.tod, days: '12345', active: true } as any);
      live.refresh();
    } catch (e: any) { Alert.alert("Couldn't save it", e.message); }
    setBusy(false);
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Transport' }} />
      <Screen refreshControl={<RefreshControl refreshing={live.refreshing} onRefresh={live.refresh} />}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 4 }}>
          <T kind="sub" tone="text2">{greeting()}</T>
          <LiveStamp updatedAt={live.updatedAt} error={live.error} />
        </View>

        {sugg ? (
          <Section>
            <View style={{ padding: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name={I.clock} size={18} color={c.tint} />
                <T kind="headline">Make this your {(sugg.name || 'regular trip').toLowerCase()}?</T>
              </View>
              <T kind="sub" tone="text2" style={{ marginTop: 6 }}>
                {shortName(sugg.from?.name)} to {shortName(sugg.to?.name)}{sugg.todText ? ` around ${sugg.todText}` : ''}, searched on {sugg.days} days. You'll get a leave now alert, and a heads up only when something is wrong.
              </T>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                <View style={{ flex: 1 }}><Button title="Make it my commute" onPress={acceptSuggestion} disabled={busy} /></View>
                <Button title="Not now" kind="tinted" onPress={() => api.dismissSuggestion(sugg.key).then(live.refresh)} />
              </View>
            </View>
          </Section>
        ) : null}

        {activeWatches.length ? (
          <Section title="Watching now">
            {activeWatches.map((w: any, i: number) => (
              <View key={w.id}>
                {i ? <Sep inset={57} /> : null}
                <Row icon={I.bell} iconBg={c.indigo} title={w.title} subtitle={watchLine(w, now)} onPress={() => router.push({ pathname: '/watch/[id]', params: { id: w.id } })} />
              </View>
            ))}
          </Section>
        ) : null}

        {d?.commutes.items.filter((x) => x.active).map((cm) => (
          <TripCard key={cm.id} from={cm.from} to={cm.to} title={cm.name} subtitle={`${daysText(cm.days)} around ${cm.todText}`} icon={I.clock} />
        ))}
        {d?.saved.items.map((s) => (
          <TripCard key={s.name} from={s.from} to={s.to} title={s.name.charAt(0).toUpperCase() + s.name.slice(1)} />
        ))}
        {st.starred.map((p) => <StopCard key={p.id} stop={p} />)}

        {nothing ? (
          <Empty icon={I.star} title="Your live board"
            body="Star a stop or save a trip and it shows up here with live times that update themselves. Swipe left on any service to get alerts for it."
            action={<Button title="Find a stop" icon={I.search} onPress={() => router.navigate('/search')} />} />
        ) : null}
        {!d && !live.error ? <T kind="sub" tone="text2" style={{ textAlign: 'center', marginTop: 40 }}>Loading</T> : null}
        {!d && live.error ? <Empty icon={I.warn} title="Can't reach the live feed" body={live.error} action={<Button title="Try again" onPress={live.refresh} />} /> : null}
      </Screen>
    </>
  );
}
