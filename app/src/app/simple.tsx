// Simple mode (More > Simple mode, off by default; Bidur, 25 Oct: "like TripView Lite"). One screen: "Here" (the
// stop or stand nearest you) and a page per saved trip, each a plain list of the next services. Swipe between pages.
// Battery (docs/PERFORMANCE.md): only the page on view polls, adaptively; countdowns redraw at whole minutes;
// location is the foreground position the app already uses, at low accuracy, and only when already allowed.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Platform, Pressable, RefreshControl, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { api } from '@/lib/api';
import { haptic } from '@/lib/haptic';
import { useCountdownNow, useLive, useReportCountdowns } from '@/lib/hooks';
import { adaptiveGapMs, nextInMs } from '@/lib/pollCore';
import { cacheKey } from '@/lib/offlineCore';
import { store, useStore } from '@/lib/store';
import { usePalette } from '@/lib/theme';
import { planTrip } from '@/lib/trips';
import { countdownWords, defaultPage, depRows, hereChoices, chipLabel, splitStopName, tripRows, type HereChoice, type SimpleDepRow, type SimplePage, type SimpleTripRow } from '@/lib/simpleCore';
import type { Departure } from '@/lib/types';
import { openService } from '@/components/Cards';
import { LineBadge } from '@/components/Transit';
import { Icon, I } from '@/components/Icon';
import { font, T } from '@/components/ui';

const short = (n?: string) => splitStopName(String(n || '')).place.replace(/ Station$/, '');

function Countdown({ at, now, tone }: { at: number; now: number; tone: string }) {
  const c = usePalette();
  const cd = countdownWords(at, now);
  return (
    <View style={{ alignItems: 'flex-end', minWidth: 64 }} accessible={false}>
      <Text maxFontSizeMultiplier={1.6} style={[font.title2, { color: tone, fontVariant: ['tabular-nums'] }]}>{cd.big}</Text>
      {cd.unit ? <Text maxFontSizeMultiplier={1.6} style={[font.foot, { color: c.text2 }]}>{cd.unit}</Text> : null}
    </View>
  );
}

const DepRow = memo(function DepRow({ r, d, now }: { r: SimpleDepRow; d: Departure; now: number }) {
  const c = usePalette();
  const tone = r.tone === 'red' ? c.redText : r.tone === 'late' ? c.lateText : r.tone === 'live' ? c.liveText : c.text2;
  return (
    <Pressable onPress={() => { haptic.select(); openService(d); }} accessibilityRole="button" accessibilityLabel={r.a11y} accessibilityHint="Opens the service"
      android_ripple={{ color: c.fill }} style={({ pressed }) => [s.row, { borderBottomColor: c.sep, backgroundColor: pressed && Platform.OS === 'ios' ? c.fill : c.card }]}>
      <LineBadge line={r.line} mode={r.mode} color={r.color} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text maxFontSizeMultiplier={1.6} numberOfLines={2} style={[font.headline, { color: r.tone === 'red' ? c.text3 : c.text, textDecorationLine: r.tone === 'red' ? 'line-through' : 'none' }]}>{r.dest}</Text>
        <Text maxFontSizeMultiplier={1.6} style={[font.sub, { color: c.text2, marginTop: 2 }]}>
          {r.sched}  <Text style={{ color: tone, fontWeight: '600' }}>{r.status}</Text>
        </Text>
      </View>
      {r.tone === 'red' ? null : <Countdown at={r.at} now={now} tone={c.text} />}
    </Pressable>
  );
}, (a, b) => a.r.key === b.r.key && a.r.status === b.r.status && a.r.at === b.r.at && Math.floor((a.r.at - a.now) / 60000) === Math.floor((b.r.at - b.now) / 60000));

const TripRow = memo(function TripRow({ r, onPress, now }: { r: SimpleTripRow; onPress: () => void; now: number }) {
  const c = usePalette();
  const tone = r.tone === 'red' ? c.redText : r.tone === 'late' ? c.lateText : r.tone === 'live' ? c.liveText : c.text2;
  return (
    <Pressable onPress={() => { haptic.select(); onPress(); }} accessibilityRole="button" accessibilityLabel={r.a11y} accessibilityHint="Opens the trip"
      android_ripple={{ color: c.fill }} style={({ pressed }) => [s.row, { borderBottomColor: c.sep, backgroundColor: pressed && Platform.OS === 'ios' ? c.fill : c.card }]}>
      <View style={{ flex: 1 }}>
        <Text maxFontSizeMultiplier={1.6} style={[font.headline, { color: c.text, fontVariant: ['tabular-nums'] }]}>{r.times}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 4 }}>
          {r.lines.map((l, i) => <LineBadge key={i} line={l.line} mode={l.mode} color={l.color} />)}
          <Text maxFontSizeMultiplier={1.6} style={[font.sub, { color: c.text2 }]}>{r.sub}</Text>
        </View>
        <Text maxFontSizeMultiplier={1.6} style={[font.foot, { color: tone, fontWeight: '600', marginTop: 3 }]}>{r.status}</Text>
      </View>
      {r.tone === 'red' ? null : <Countdown at={r.dep} now={now} tone={c.text} />}
    </Pressable>
  );
}, (a, b) => a.r.key === b.r.key && a.r.status === b.r.status && a.r.dep === b.r.dep && Math.floor((a.r.dep - a.now) / 60000) === Math.floor((b.r.dep - b.now) / 60000));

function Note({ text }: { text: string }) {
  return <T kind="sub" tone="text2" style={{ marginHorizontal: 20, marginTop: 18 }}>{text}</T>;
}

/** Here: the nearest stop or stand (or your saved stops when location is off), and its next departures. */
function HerePage({ width, visible }: { width: number; visible: boolean }) {
  const c = usePalette();
  const st = useStore();
  const [choices, setChoices] = useState<HereChoice[] | null>(null);
  const [locOff, setLocOff] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const saved = useMemo<HereChoice[]>(() => {
    const list = [...(st.starred || []), ...(st.places?.home ? [st.places.home] : []), ...(st.places?.work ? [st.places.work] : [])];
    return hereChoices(list.map((p) => ({ id: p.id, name: p.name })));
  }, [st.starred, st.places]);
  const findNear = useCallback(async (ask: boolean) => {
    try {
      let p = await Location.getForegroundPermissionsAsync();
      if (!p.granted && ask && p.canAskAgain) p = await Location.requestForegroundPermissionsAsync();
      if (!p.granted) { setLocOff(true); return; }
      setLocOff(false);
      // The phone's last fix if it is recent, else one low accuracy fix (no tracking, no background location).
      let pos = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60000 }).catch(() => null);
      if (!pos) pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
      const r = await api.nearby(pos.coords.latitude, pos.coords.longitude);
      setChoices(hereChoices((r.stops || []).map((x) => ({ id: String(x.id), name: x.name, distance: Number((x as any).distance ?? x.distanceM ?? x.dist) }))));
    } catch { setLocOff(true); }
  }, []);
  useEffect(() => { if (visible && choices == null) findNear(false); }, [visible, choices, findNear]);
  const list = choices && choices.length ? choices : locOff ? saved : [];
  const cur = list.find((x) => x.id === pick) || list[0] || null;
  const now = useCountdownNow();
  const live = useLive((r) => (cur ? api.departures(cur.id, r) : Promise.resolve(null)), (d) => adaptiveGapMs(15000, nextInMs(d?.items, Date.now())), [cur?.id],
    { cacheKey: cur ? cacheKey('dep', cur.id) : undefined, enabled: visible && !!cur });
  const items = live.data?.items || [];
  const rows = useMemo(() => depRows(items, now), [items, now]);
  const byKey = useMemo(() => new Map(items.map((d) => [`${d.tripId || d.line}|${d.planned}`, d])), [items]);
  useReportCountdowns('simple:here', visible ? rows.slice(0, 6).map((r) => r.at) : []);
  const title = cur ? short(live.data?.stop?.name || cur.place) : 'Here';
  const head = (
    <View>
      <Text accessibilityRole="header" maxFontSizeMultiplier={1.6} numberOfLines={2} style={[font.largeTitle, { color: c.text, marginHorizontal: 20, marginTop: 6 }]}>{title}</Text>
      {list.length > 1 ? (
        <FlatList horizontal data={list} keyExtractor={(x) => x.id} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 10 }}
          renderItem={({ item }) => {
            const on = item.id === cur?.id;
            const label = choices && choices.length ? chipLabel(item) : short(item.place);
            return (
              <Pressable onPress={() => { haptic.select(); setPick(item.id); }} hitSlop={{ top: 6, bottom: 6 }} accessibilityRole="button" accessibilityState={{ selected: on }}
                accessibilityLabel={`${short(item.place)}${item.stand ? ', ' + item.stand : ''}`}
                style={[s.chip, { backgroundColor: on ? c.tint : c.card, borderColor: on ? c.tint : c.sep }]}>
                <Text maxFontSizeMultiplier={1.4} style={[font.sub, { fontWeight: '600', color: on ? '#fff' : c.text }]}>{label}</Text>
              </Pressable>
            );
          }} />
      ) : cur?.stand ? <T kind="sub" tone="text2" style={{ marginHorizontal: 20, marginTop: 4, marginBottom: 8 }}>{cur.stand}</T> : <View style={{ height: 10 }} />}
      {locOff && !(choices && choices.length) ? (
        <Pressable onPress={() => findNear(true)} accessibilityRole="button" style={{ marginHorizontal: 20, marginBottom: 8, minHeight: 44, justifyContent: 'center' }}>
          <T kind="sub" tone="tint" style={{ fontWeight: '600' }}>{saved.length ? 'Showing your saved stops. Use my location' : 'Use my location to find the nearest stop'}</T>
        </Pressable>
      ) : null}
    </View>
  );
  return (
    <View style={{ width }}>
      <FlatList data={rows} keyExtractor={(r) => r.key} ListHeaderComponent={head}
        renderItem={({ item }) => <DepRow r={item} d={byKey.get(item.key)!} now={now} />}
        refreshControl={<RefreshControl refreshing={live.refreshing} onRefresh={() => { if (choices == null || locOff) findNear(false); return live.refresh(); }} />}
        ListEmptyComponent={<Note text={!cur ? (choices == null && !locOff ? 'Finding the nearest stop' : 'No stops to show. Star a stop or set Home and Work.') : !live.data ? (live.error ? 'Live times unavailable right now, trying again' : 'Loading live times') : 'No more services right now'} />}
        initialNumToRender={10} windowSize={5} removeClippedSubviews={Platform.OS === 'android'} contentContainerStyle={{ paddingBottom: 40 }} />
    </View>
  );
}

/** A saved trip: the next services, with depart and arrive times, duration and changes. */
function TripPage({ page, width, visible }: { page: Extract<SimplePage, { kind: 'trip' }>; width: number; visible: boolean }) {
  const c = usePalette();
  const now = useCountdownNow();
  const plan = useMemo(() => ({ from: page.from, to: page.to }), [page.from, page.to]);
  const live = useLive((r) => planTrip(plan, { refresh: r, count: 8 }), (d) => adaptiveGapMs(20000, d ? Math.min(...tripRows(d.journeys as any, Date.now()).map((x) => x.dep)) - Date.now() : null),
    [page.key], { cacheKey: cacheKey('trip', `simple|${page.key}`), enabled: visible });
  const rows = useMemo(() => tripRows((live.data?.journeys || []) as any, now), [live.data, now]);
  useReportCountdowns('simple:' + page.key, visible ? rows.slice(0, 6).map((r) => r.dep) : []);
  const open = (i: number) => router.push({ pathname: '/trip', params: { from: page.from.id, fromName: page.from.name, to: page.to.id, toName: page.to.name, pick: String(i) } });
  return (
    <View style={{ width }}>
      <FlatList data={rows} keyExtractor={(r) => r.key}
        ListHeaderComponent={<View>
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.6} numberOfLines={2} style={[font.largeTitle, { color: c.text, marginHorizontal: 20, marginTop: 6 }]}>{page.title}</Text>
          <T kind="sub" tone="text2" style={{ marginHorizontal: 20, marginTop: 2, marginBottom: 12 }}>{`${short(page.from.name)} to ${short(page.to.name)}`}</T>
        </View>}
        renderItem={({ item, index }) => <TripRow r={item} now={now} onPress={() => open(index)} />}
        refreshControl={<RefreshControl refreshing={live.refreshing} onRefresh={live.refresh} />}
        ListEmptyComponent={<Note text={!live.data ? (live.error ? 'Live times unavailable right now, trying again' : 'Loading live trips') : (live.data as any).error || 'No more services today'} />}
        initialNumToRender={8} windowSize={5} contentContainerStyle={{ paddingBottom: 40 }} />
    </View>
  );
}

/** The pages: Here, then Home to Work and Work to Home when both are set, then the trips saved on this phone. */
function simplePages(st: ReturnType<typeof useStore>): SimplePage[] {
  const pages: SimplePage[] = [{ kind: 'here' }];
  const seen = new Set<string>();
  const add = (p: Extract<SimplePage, { kind: 'trip' }>) => { if (seen.has(p.key)) return; seen.add(p.key); pages.push(p); };
  const { home, work } = st.places || {};
  if (home && work) {
    add({ kind: 'trip', key: `${home.id}>${work.id}`, from: home, to: work, title: 'To work', tag: 'toWork' });
    add({ kind: 'trip', key: `${work.id}>${home.id}`, from: work, to: home, title: 'To home', tag: 'toHome' });
  }
  for (const t of st.myTrips || []) {
    if (t.legs && t.legs.length > 1) continue;
    add({ kind: 'trip', key: `${t.from.id}>${t.to.id}`, from: t.from, to: t.to, title: t.name ? t.name.charAt(0).toUpperCase() + t.name.slice(1) : `${short(t.from.name)} to ${short(t.to.name)}` });
  }
  return pages.slice(0, 10);
}

export default function Simple() {
  const c = usePalette();
  const st = useStore();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const pages = useMemo(() => simplePages(st), [st.places, st.myTrips]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = useRef(defaultPage(pages, Date.now(), st.recentTrips || [])).current;
  const [page, setPage] = useState(Math.min(first, pages.length - 1));
  const list = useRef<FlatList<SimplePage>>(null);
  const go = (i: number) => { const k = Math.max(0, Math.min(pages.length - 1, i)); setPage(k); list.current?.scrollToIndex({ index: k, animated: true }); };
  // The page on view (more than half of it showing) is the one that polls.
  const onViewable = useRef(({ viewableItems }: { viewableItems: any[] }) => {
    const i = viewableItems.find((v) => v.isViewable)?.index;
    if (i != null) setPage((p) => (p === i ? p : (haptic.select(), i)));
  }).current;
  const viewCfg = useRef({ itemVisiblePercentThreshold: 60 }).current;
  const settings = () => {
    haptic.select();
    Alert.alert('Simple mode', 'Turn it off to see the full app with Home, Plan, Ask and More.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Turn off Simple mode', onPress: () => { store.setSimple(false); router.replace('/home'); } },
    ]);
  };
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, minHeight: 48 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 8 }} accessible accessibilityRole="adjustable"
          accessibilityLabel={`Page ${page + 1} of ${pages.length}`} accessibilityValue={{ text: pages[page]?.kind === 'here' ? 'Here' : (pages[page] as any)?.title }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={(e) => go(page + (e.nativeEvent.actionName === 'increment' ? 1 : -1))}>
          {pages.map((p, i) => <View key={i} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: i === page ? c.text : c.text3, opacity: i === page ? 1 : 0.5 }} />)}
        </View>
        <Pressable onPress={settings} hitSlop={8} accessibilityRole="button" accessibilityLabel="Settings" accessibilityHint="Turn off Simple mode"
          style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
          <Icon name={I.gear} size={22} color={c.text2} />
        </Pressable>
      </View>
      <FlatList ref={list} data={pages} horizontal pagingEnabled showsHorizontalScrollIndicator={false} keyExtractor={(p) => (p.kind === 'here' ? 'here' : p.key)}
        initialScrollIndex={page} getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })} onViewableItemsChanged={onViewable} viewabilityConfig={viewCfg}
        extraData={page} windowSize={3} initialNumToRender={1} maxToRenderPerBatch={1}
        renderItem={({ item, index }) => (item.kind === 'here'
          ? <HerePage width={width} visible={index === page} />
          : <TripPage page={item} width={width} visible={index === page} />)} />
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, minHeight: 64, borderBottomWidth: StyleSheet.hairlineWidth },
  chip: { paddingHorizontal: 14, minHeight: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
});
