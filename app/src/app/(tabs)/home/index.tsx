import { useState } from 'react';
import { Alert, Pressable, RefreshControl, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { api } from '@/lib/api';
import { useLive, useNow } from '@/lib/hooks';
import { usePalette } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { shortName } from '@/lib/format';
import type { Place } from '@/lib/types';
import { Icon, I } from '@/components/Icon';
import { watchLine } from '@/components/Cards';
import { ActionRow, HomeSection, LiveTag, pullHome, SearchField, StopBoard, TripBoard, TripItem, useNearby } from '@/components/Home';
import { Button, Empty, Row, Section, Screen, Sep, T } from '@/components/ui';

const POPULAR: Place[] = [
  { id: '200060', name: 'Central Station' },
  { id: '200070', name: 'Town Hall Station' },
  { id: '213510', name: 'Strathfield Station' },
];

function AddButton() {
  const c = usePalette();
  return (
    <Pressable onPress={() => router.push('/add-trip')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Add a trip"
      style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 16, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
      <Icon name={I.plus} size={17} color={c.tint} />
    </Pressable>
  );
}

export default function Home() {
  const c = usePalette();
  const now = useNow(1000);
  const st = useStore();
  const near = useNearby();
  const [busy, setBusy] = useState(false);
  const [pulling, setPulling] = useState(false);
  const live = useLive(async () => {
    const [commutes, saved, watches] = await Promise.all([
      api.commutes().catch(() => ({ items: [], suggestion: null })),
      api.saved().catch(() => ({ items: [] })),
      api.watches().catch(() => ({ items: [], notes: [] })),
    ]);
    return { commutes, saved, watches };
  }, 15000);
  const d = live.data;
  const activeWatches = (d?.watches.items || []).filter((w: any) => w.active);
  const sugg: any = d?.commutes.suggestion;

  // Your trips: commutes, saved trips, then up to 2 recent A to B trips. Max 4.
  const trips: TripItem[] = [];
  const seen = new Set<string>();
  const add = (t: TripItem) => {
    const k = `${t.from.id}>${t.to.id}`;
    if (seen.has(k) || trips.length >= 4) return;
    seen.add(k);
    trips.push({ ...t, key: k });
  };
  (d?.commutes.items || []).filter((x) => x.active).forEach((cm) => add({ key: '', from: cm.from, to: cm.to, kind: 'commute', name: cm.name }));
  (d?.saved.items || []).forEach((s) => add({ key: '', from: s.from, to: s.to, kind: 'saved', name: s.name }));
  let recentCount = 0;
  for (const r of st.recentTrips || []) {
    if (recentCount >= 2) break;
    const k = `${r.from.id}>${r.to.id}`;
    if (seen.has(k)) continue;
    add({ key: '', from: r.from, to: r.to, kind: 'recent' });
    recentCount++;
  }

  // Recent stops: starred first, then recently opened. Max 4.
  const stops: (Place & { starred: boolean })[] = [];
  for (const p of st.starred) if (stops.length < 4 && !stops.some((x) => x.id === p.id)) stops.push({ ...p, starred: true });
  for (const p of st.recents) if (stops.length < 4 && !stops.some((x) => x.id === p.id)) stops.push({ ...p, starred: false });
  const nearIds = new Set(near.stops.map((x) => x.id));

  const firstLaunch = !!d && !trips.length && !stops.length;

  const acceptSuggestion = async () => {
    setBusy(true);
    try {
      await api.saveCommute({ name: sugg.name || 'Morning trip', from: sugg.from, to: sugg.to, tod: sugg.tod, days: '12345', active: true } as any);
      live.refresh();
    } catch (e: any) { Alert.alert("Couldn't save it", e.message); }
    setBusy(false);
  };

  const onPull = async () => {
    setPulling(true);
    pullHome();
    await live.refresh();
    setPulling(false);
  };

  return (
    <>
      <Stack.Screen options={{
        title: 'Home',
        headerRight: () => (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <LiveTag />
            <AddButton />
          </View>
        ),
      }} />
      <Screen refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} />}>
        <SearchField />

        {firstLaunch ? <ActionRow icon={I.plus} title="Add a trip" onPress={() => router.push('/add-trip')} /> : null}

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

        {sugg ? (
          <Section>
            <View style={{ padding: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name={I.clock} size={18} color={c.tint} />
                <T kind="headline" style={{ flex: 1 }}>Make this your {(sugg.name || 'regular trip').toLowerCase()}?</T>
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

        {trips.length ? (
          <HomeSection title="Your trips">
            {trips.map((t) => <TripBoard key={t.key} trip={t} now={now} />)}
            <ActionRow icon={I.plus} title="Add a trip" onPress={() => router.push('/add-trip')} />
          </HomeSection>
        ) : null}

        {stops.length ? (
          <HomeSection title="Recent stops">
            {stops.map((p) => <StopBoard key={p.id} stop={p} starred={p.starred} now={now} />)}
          </HomeSection>
        ) : null}

        {near.phase !== 'checking' ? (
          <HomeSection title="Nearby">
            {near.phase === 'on' && near.stops.length ? near.stops.map((p) => <StopBoard key={p.id} stop={p} distance={p.distance} now={now} />) : null}
            {near.phase === 'on' && !near.stops.length ? <T kind="foot" tone="text2" style={{ marginHorizontal: 20, marginTop: 8 }}>No stops within walking distance</T> : null}
            {near.phase === 'off' || near.phase === 'loading' || near.phase === 'error' ? (
              <ActionRow icon={I.location} title="Show stops near me" onPress={near.ask} busy={near.phase === 'loading'} />
            ) : null}
            {near.phase === 'error' ? <T kind="foot" tone="text2" style={{ marginHorizontal: 20, marginTop: 6 }}>{near.error}</T> : null}
          </HomeSection>
        ) : null}

        {firstLaunch ? (
          <HomeSection title="Popular stations">
            {POPULAR.filter((p) => !nearIds.has(p.id)).map((p) => <StopBoard key={p.id} stop={p} now={now} />)}
          </HomeSection>
        ) : null}

        {!d && !live.error ? <T kind="sub" tone="text2" style={{ textAlign: 'center', marginTop: 40 }}>Loading</T> : null}
        {!d && live.error ? <Empty icon={I.warn} title="Can't reach the live feed" body={live.error} action={<Button title="Try again" onPress={live.refresh} />} /> : null}
      </Screen>
    </>
  );
}
