import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, PanResponder, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { CARD_SWIPE, SwipeRow, type SwipeAct } from '@/components/Swipe';
import { haptic } from '@/lib/haptic';
import { gripStep, type GripEvent, type GripState } from '@/lib/gesture';
import { dragOrder, sameEnds, splitNext, toFront } from '@/lib/homeCore';
import { clearAllWords } from '@/lib/planCore';
import { router, Stack, useFocusEffect } from 'expo-router';
import { GetMeHome } from '@/components/GetMeHome';
import { api } from '@/lib/api';
import { useCountdownNow, useLive } from '@/lib/hooks';
import { cacheKey } from '@/lib/offlineCore';
import { usePalette } from '@/lib/theme';
import { useSides } from '@/lib/layout';
import { store, tripKeyOf, useStore } from '@/lib/store';
import { shortName } from '@/lib/format';
import type { Place } from '@/lib/types';
import { Icon, I } from '@/components/Icon';
import { watchLine } from '@/components/Cards';
import { ActionRow, clearAllTrips, deleteTrip, deletedSaved, HomeSection, LiveTag, onTripDeleted, pullHome, StopBoard, TripBoard, TripItem, UNDO_MS, useNearby, tripCacheId, tripPkey } from '@/components/Home';
import { homeForeground, prefetchTripScreen } from '@/lib/prefetch';
import { HOME_IDLE_MS, mayReadAhead, nextTripPlan } from '@/lib/homePrefetchCore';
import { readWalkPref } from '@/lib/walkPrefCore';
import { menuFrom, type MenuSpec } from '@/lib/menuCore';
import { AnchoredMenu, type MenuItem, type Rect } from '@/components/AnchoredMenu';
import { LineBadge } from '@/components/Transit';
import { TabBarSafe } from '@/components/TabBarSafe';
import { useLiveTrip } from '@/lib/live';
import { radius } from '@/lib/theme';
import { Button, Empty, Section, Screen, T } from '@/components/ui';
import { LeaveLine, MorningLink, useMyPos } from '@/components/Smart';
import { LastHomeCard } from '@/components/LastHome';
import { Notices } from '@/components/Notices';
import { topBar } from '@/lib/noticesCore';
import { useCardSkin, useSolidLook } from '@/lib/cardSkin';
import { CalendarLeaveByCard } from '@/components/CalendarLeaveBy';
import { pickOrigin } from '@/lib/calendarLeaveByCore';
import { commuteDir, halfDayKey } from '@/lib/smart';
import { useLoaded } from '@/lib/store';

export default function Home() {
  const c = usePalette();
  const side = useSides();
  // Redraws when a countdown on Home changes its minute (each card reports its times), not every 5 seconds.
  const now = useCountdownNow();
  const st = useStore();
  const near = useNearby();
  const [busy, setBusy] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [scrollOn, setScrollOn] = useState(true);
  const live = useLive(async () => {
    let offline: any = null;
    const soft = <T,>(p: Promise<T>, empty: T) => p.catch((e: any) => { if (e?.offline) offline = e; return empty; });
    const [commutes, saved, watches] = await Promise.all([
      soft(api.commutes(), { items: [], suggestion: null } as unknown as Awaited<ReturnType<typeof api.commutes>>),
      soft(api.saved(), { items: [] } as Awaited<ReturnType<typeof api.saved>>),
      soft(api.watches(), { items: [], notes: [] } as unknown as Awaited<ReturnType<typeof api.watches>>),
    ]);
    // No signal: fail so the saved trips list kept on the phone is shown instead of an empty one.
    if (offline) throw offline;
    return { commutes, saved, watches };
    // Commutes, saved trips and watches change when you change them (each write empties the read cache and this
    // reloads on view), so once a minute is enough; it was every 15 seconds.
  }, 60000, [], { cacheKey: cacheKey('home', 'lists') });
  const d = live.data;
  const activeWatches = (d?.watches.items || []).filter((w: any) => w.active);
  const sugg: any = d?.commutes.suggestion;

  // Trips: Home to Work and Work to Home first (the one for this time of day on top), then commutes, saved trips and up to 2 recent A to B trips.
  const trips: TripItem[] = [];
  const places = st.places || {};
  const seen = new Set<string>();
  const add = (t: TripItem) => {
    const k = tripKeyOf(t);
    if (seen.has(k) || trips.length >= 8) return;
    seen.add(k);
    trips.push({ ...t, key: k, okey: t.kind === 'place' ? 'places' : k });
  };
  // Your commute: one card on top, Home to Work before 12pm and Work to Home after, unless you swapped it for now.
  const half = halfDayKey(now);
  const flipped = st.commuteFlip === half;
  let commute: TripItem | null = null;
  if (places.home && places.work && places.home.id !== places.work.id) {
    const dir = commuteDir(now, flipped);
    commute = dir === 'toWork'
      ? { key: '', from: places.home, to: places.work, kind: 'place', tag: 'To work', name: 'To work' }
      : { key: '', from: places.work, to: places.home, kind: 'place', tag: 'To home', name: 'To home' };
    commute.key = tripKeyOf(commute);
    seen.add(commute.key);
    seen.add(tripKeyOf({ from: commute.to, to: commute.from }));
  }
  const me = useMyPos();
  // First launch: two questions, home and work. Skippable, and asked once.
  const loaded = useLoaded();
  const asked = useRef(false);
  useEffect(() => {
    if (!loaded || asked.current || st.onboarded || (places.home && places.work)) return;
    asked.current = true;
    const t = setTimeout(() => router.push('/welcome'), 300);
    return () => clearTimeout(t);
  }, [loaded, st.onboarded, places.home, places.work]);
  (d?.commutes.items || []).filter((x) => x.active).forEach((cm) => add({ key: '', from: cm.from, to: cm.to, kind: 'commute', name: cm.name, id: cm.id }));
  (st.myTrips || []).forEach((m) => add({ key: '', from: m.from, to: m.to, via: m.via, conn: m.conn, legs: m.legs, modes: m.modes, kind: 'mine', name: m.name }));
  const savedItems = deletedSaved.filter(d?.saved.items || []);
  savedItems.forEach((s) => add({ key: '', from: s.from, to: s.to, kind: 'saved', name: s.name }));
  // A saved trip with the same two ends as the commute shows in the commute card, not twice; say so.
  const twin = commute ? [...(st.myTrips || []), ...savedItems].find((t: any) => t.name && sameEnds(t, commute!)) as { name: string } | undefined : undefined;

  // Your own order from dragging wins; home and work move together and keep their morning and evening order.
  const order = st.tripOrder || [];
  const sorted = trips.map((t, i) => ({ t, p: order.indexOf(t.okey!) < 0 ? 1000 + i : order.indexOf(t.okey!), i })).sort((x, y) => x.p - y.p || x.i - y.i).map((o) => o.t);

  // Starred stops. Recent stops and trips live in Plan, so Home shows each thing once.
  const starred = st.starred || [];
  // Nearby leaves out stops already on Home as starred, and shows at most 3.
  const nearStops = (near.stops || []).filter((p: Place) => !starred.some((s) => s.id === p.id)).slice(0, 3);
  const g = useLiveTrip();
  // The Next trip card's look (plain today; three new looks switchable in development, lib/cardSkin.ts).
  const skin = useCardSkin();
  const solid = useSolidLook();
  // Trip in progress and Watching now share one bar; a watch of the live trip is not shown twice.
  const bar = topBar(g, activeWatches as any[]);
  // Undo bar after a trip is deleted (swipe, hold menu or VoiceOver). A newer delete sends the older one to the server.
  const [snack, setSnack] = useState<{ text: string; undo: () => void; commit: () => void; id: number } | null>(null);
  const snackRef = useRef(snack);
  snackRef.current = snack;
  useEffect(() => onTripDeleted((u) => { snackRef.current?.commit(); setSnack({ ...u, id: Date.now() }); }), []);
  useEffect(() => { if (!snack) return; const t = setTimeout(() => setSnack(null), UNDO_MS); return () => clearTimeout(t); }, [snack]);
  // Going to the background ends the chance to undo, so the server delete is sent now rather than lost.
  useEffect(() => { const sub = AppState.addEventListener('change', (a) => { if (a === 'background') { snackRef.current?.commit(); setSnack(null); } }); return () => sub.remove(); }, []);
  // Clear all: Your trips (not the commute card or Home and Work) and Starred stops, each after a confirm dialog.
  const clearable = sorted.filter((t) => t.kind === 'mine' || t.kind === 'saved' || t.kind === 'commute');
  const clearWord = Platform.OS === 'ios' ? 'Clear All' : 'Clear all';
  const confirmClear = (what: 'trips' | 'stops', count: number, run: () => void) => {
    const w = clearAllWords(what, count, Platform.OS === 'ios');
    Alert.alert(w.title, w.message, [{ text: 'Cancel', style: 'cancel' }, { text: w.confirm, style: 'destructive', onPress: run }]);
  };
  // Tap and hold on a starred stop: the system context menu on iPhone, the Material 3 menu on Android (HoldMenu).
  const stopMenu = (p: Place, isStarred: boolean): MenuSpec => ({ title: shortName(p.name), items: menuFrom(isStarred ? [
    { text: 'Unstar stop', style: 'destructive', onPress: () => store.toggleStar(p) },
  ] : [
    { text: 'Star stop', onPress: () => store.toggleStar(p) },
    { text: 'Remove from Recent', style: 'destructive', onPress: () => store.removeRecent(p.id) },
  ]) });

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

  // Next trip card on top (your commute, or the first trip in your order), every other trip as a compact row.
  const { next, rest } = splitNext(commute, sorted);
  const nextIsCommute = !!commute && next === commute;
  const lead = next && !nextIsCommute && next.okey ? [next.okey] : [];
  const allKeys = [...new Set(sorted.map((t) => t.okey!))];
  const showFirst = (t: TripItem) => () => { store.setTripOrder(toFront(order, allKeys, t.okey!)); haptic.success(); };
  const hasTrips = !!(next || rest.length);
  // Calendar leave by starts where your usual trip starts: the commute card's start, else your first trip's.
  const calFrom = pickOrigin(commute?.from, sorted[0]?.from, places);
  const nextDel = next && (next.kind === 'mine' || next.kind === 'saved') ? delAct(next, c.red) : undefined;

  // Read ahead (homePrefetchCore.ts): a moment after Home is on screen with its lists, the top card's trip screen is
  // read and kept, once per foreground, within the press in limits; never with the app in the background.
  const [fg, setFg] = useState(0);
  useEffect(() => { const sub = AppState.addEventListener('change', (a) => { if (a === 'active') { homeForeground(); setFg((n) => n + 1); } }); return () => sub.remove(); }, []);
  const aheadPlan = nextTripPlan(next, next ? ((st as any).tripModes || {})[`${next.from.id}>${next.to.id}`] : null);
  const aheadKey = aheadPlan ? cacheKey('trip', tripCacheId(tripPkey(aheadPlan), false)) : '';
  useFocusEffect(useCallback(() => {
    if (!aheadPlan || !mayReadAhead({ focused: true, appState: AppState.currentState, hasLists: !!d })) return;
    let idle: any = null;
    const g: any = globalThis as any;
    const t = setTimeout(() => {
      const go = () => prefetchTripScreen(aheadPlan, aheadKey, readWalkPref(store.snapshot().walkPref), AppState.currentState);
      // Feature detected: an idle callback where the runtime has one, else at once (the timer already waited).
      idle = typeof g.requestIdleCallback === 'function' ? g.requestIdleCallback(go, { timeout: 2000 }) : (go(), null);
    }, HOME_IDLE_MS);
    return () => { clearTimeout(t); if (idle != null && typeof g.cancelIdleCallback === 'function') g.cancelIdleCallback(idle); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aheadKey, !!d, fg]));

  return (
    <>
      {/* iPhone: the + is a system bar button with its own UIMenu (AddMenu). Android and the web: a drawn + and menu. */}
      <Stack.Screen options={Platform.OS === 'ios' ? { title: 'Home' } : { title: 'Home', headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <LiveTag />
          <AddButton places={places} />
        </View>
      ) }} />
      {Platform.OS === 'ios' ? <AddMenu places={places} /> : null}
      <Screen scrollEnabled={scrollOn} refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} enabled={scrollOn} />}>
        {/* Above the commute card: one slim bar for the trip in progress (or a single watched trip), nothing else. */}
        {g ? <LiveBar title={g.title} line={g.legs[0]?.line} mode={g.legs[0]?.mode} color={g.legs[0]?.color} />
          : bar.watch ? <WatchBar title={bar.watch.title} sub={watchLine(bar.watch, now)} onPress={() => router.push({ pathname: '/watch/[id]', params: { id: bar.watch.id } })} /> : null}

        {next ? (
          <HomeSection title={nextIsCommute ? 'Your commute' : 'Next trip'}>
            {nextIsCommute ? (
              <TripBoard trip={next} now={now} look="hero" skin={skin} solid={solid}
                aside={<SwapButton to={next.tag === 'To work' ? 'To home' : 'To work'} onPress={() => { store.setCommuteFlip(flipped ? null : half); haptic.select(); }} />}
                below={(js) => (
                  // When to leave and Check before I go as small buttons in the card, not two full rows.
                  <View style={hs.extras}>
                    <LeaveLine compact js={js} now={now} me={me} ends={{ from: next.from.id, to: next.to.id }} />
                    <MorningLink compact from={next.from} to={next.to} dir={next.tag === 'To work' ? 'toWork' : 'toHome'} />
                  </View>
                )} />
            ) : nextDel ? (
              <SwipeRow act={nextDel} style={CARD_SWIPE}>
                <TripBoard trip={next} now={now} look="hero" flush act={nextDel} skin={skin} solid={solid} />
              </SwipeRow>
            ) : <TripBoard trip={next} now={now} look="hero" skin={skin} solid={solid} />}
          </HomeSection>
        ) : null}

        {/* Get me home: one tap from where you are to your saved Home (components/GetMeHome.tsx). */}
        <GetMeHome home={places.home} />

        {/* Notifications: alerts, trackwork, line problems and other watched trips as chips, closed until tapped. */}
        <Notices now={now} watches={bar.rest.map((w: any) => ({ id: w.id, title: w.title, sub: watchLine(w, now) }))} />

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
                <Button title="Not now" kind="tinted" disabled={busy} onPress={() => api.dismissSuggestion(sugg.key).then(live.refresh, (e: any) => Alert.alert("Couldn't hide it", String(e?.message || e)))} />
              </View>
            </View>
          </Section>
        ) : null}

        <CalendarLeaveByCard origin={calFrom} now={now} />
        <LastHomeCard />

        {rest.length ? (
          <HomeSection title="Your trips" {...(clearable.length ? { onClear: () => confirmClear('trips', clearable.length, () => clearAllTrips(clearable)), clearTitle: clearWord } : {})}>
            <DragTrips trips={rest} lead={lead} now={now} all={st.allServices || {}} onScroll={setScrollOn} onTop={showFirst} />
          </HomeSection>
        ) : null}
        {d && twin && !sorted.length ? <T kind="sub" tone="text2" style={{ marginHorizontal: 20, marginTop: 10 }}>{`${twin.name.charAt(0).toUpperCase() + twin.name.slice(1)} is the same trip as your commute, so it shows in the card above.`}</T> : null}

        {!hasTrips && d ? (
          <View style={{ alignItems: 'center', marginTop: 48, marginHorizontal: 32 + Math.max(side.left, side.right) }}>
            <Icon name={I.star} size={36} color={c.tint} />
            <T kind="title3" style={{ marginTop: 12, textAlign: 'center' }} accessibilityRole="header">Save the trips you take</T>
            <T kind="sub" tone="text2" style={{ marginTop: 6, textAlign: 'center' }}>They show here with live times, platforms and delays.</T>
            <View style={{ marginTop: 18, alignSelf: 'stretch' }}><Button title="Add a trip" onPress={() => router.push('/new-trip')} /></View>
          </View>
        ) : null}

        {starred.length ? (
          <HomeSection title="Starred stops" onClear={() => confirmClear('stops', starred.length, () => { store.clearStarred(); haptic.success(); })} clearTitle={clearWord}>
            {starred.map((p) => <StopBoard key={p.id} stop={p} starred now={now} menu={stopMenu(p, true)} />)}
          </HomeSection>
        ) : null}

        {near.phase !== 'checking' ? (
          <HomeSection title="Nearby">
            {near.phase === 'on' && nearStops.length ? nearStops.map((p) => <StopBoard key={p.id} stop={p} distance={p.distance} now={now} />) : null}
            {near.phase === 'on' && !nearStops.length ? <T kind="foot" tone="text2" style={{ marginHorizontal: 20, marginTop: 8 }}>No stops within walking distance</T> : null}
            {near.phase === 'off' || near.phase === 'loading' || near.phase === 'error' ? (
              <ActionRow icon={I.location} title="Show stops near me" onPress={near.ask} busy={near.phase === 'loading'} />
            ) : null}
            {near.phase === 'error' ? <T kind="foot" tone="text2" style={{ marginHorizontal: 20, marginTop: 6 }}>{near.error}</T> : null}
          </HomeSection>
        ) : null}

        {!d && !live.error ? <T kind="sub" tone="text2" style={{ textAlign: 'center', marginTop: 40 }}>Loading</T> : null}
        {!d && live.error ? <Empty icon={I.warn} title="Can't reach the live feed" body={live.error} action={<Button title="Try again" onPress={live.refresh} />} /> : null}
      </Screen>
      {snack ? (
        // Above the tab bar: on iPhone the screen runs under the floating bar, so the undo bar is lifted by the screen's
        // bottom safe area (TabBarSafe) instead of a fixed 16 pt from the screen edge, where it sat behind the bar.
        <TabBarSafe overlay style={StyleSheet.absoluteFill}>
        <View style={[hs.snack, { marginLeft: 16 + side.left, marginRight: 16 + side.right, backgroundColor: c.dark ? '#E6E1E5' : '#313033' }]} accessibilityLiveRegion="polite">
          <Text style={{ color: c.dark ? '#313033' : '#F4EFF4', fontSize: 14, flex: 1 }}>{snack.text}</Text>
          <Pressable onPress={() => { snack.undo(); setSnack(null); haptic.select(); }} hitSlop={10} accessibilityRole="button">
            <Text style={{ color: c.dark ? '#1F6FEB' : '#8AB4F8', fontSize: 14, fontWeight: '700' }}>Undo</Text>
          </Pressable>
        </View>
        </TabBarSafe>
      ) : null}
    </>
  );
}

/** "In transit \u00b7 Central to Strathfield \u00b7 T1" slim bar above the commute card while a live trip is running. */
function LiveBar({ title, line, mode, color }: { title: string; line?: string; mode?: string; color?: string | null }) {
  const c = usePalette();
  return (
    <Pressable onPress={() => router.push('/go')} accessibilityRole="button" accessibilityLabel={`In transit, ${title}${line ? `, ${line}` : ''}`} accessibilityHint="Opens the live trip" android_ripple={{ color: 'rgba(255,255,255,0.2)' }}
      style={({ pressed }) => [hs.live, { backgroundColor: c.liveBg, opacity: pressed ? 0.85 : 1 }]}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff', marginRight: 8 }} />
      <Text style={{ color: '#fff', fontSize: 15, flex: 1 }} numberOfLines={2}>
        <Text style={{ fontWeight: '700' }}>In transit</Text>{` \u00b7 ${title}`}
      </Text>
      {line ? <View style={{ marginLeft: 8 }}><LineBadge line={line} mode={mode} color={color} /></View> : null}
      <Icon name={I.chevron} size={13} color="#fff" style={{ marginLeft: 8 }} />
    </Pressable>
  );
}

/** The same slim bar for one watched trip when no trip is in progress. More than one watch is a Notifications chip. */
function WatchBar({ title, sub, onPress }: { title: string; sub: string; onPress: () => void }) {
  const c = usePalette();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Watching, ${title}${sub ? `, ${sub}` : ''}`} accessibilityHint="Opens the watched trip" android_ripple={{ color: c.fill }}
      style={({ pressed }) => [hs.live, { backgroundColor: c.card, opacity: pressed && Platform.OS !== 'android' ? 0.7 : 1 }]}>
      <Icon name={I.bell} size={14} color={c.indigo} style={{ marginRight: 8 }} />
      <T kind="sub" style={{ flex: 1 }} numberOfLines={2}>
        <T kind="sub" style={{ fontWeight: '700' }}>Watching</T>{` \u00b7 ${title}`}{sub ? <T kind="sub" tone="text2">{` \u00b7 ${sub}`}</T> : null}
      </T>
      <Icon name={I.chevron} size={13} color={c.text3} style={{ marginLeft: 8 }} />
    </Pressable>
  );
}

/** Swaps the commute card's direction until the next 12 (noon or midnight). */
function SwapButton({ to, onPress }: { to: string; onPress: () => void }) {
  const c = usePalette();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Swap direction, show ${to.toLowerCase()}`} android_ripple={{ color: c.fill, borderless: true, radius: 24 }}
      style={({ pressed }) => ({ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24, opacity: pressed && Platform.OS !== 'android' ? 0.6 : 1 })}>
      <Icon name={I.swap} size={20} color={c.tint} />
    </Pressable>
  );
}

/** Trip cards that reorder by dragging the handle on each card. */
function DragTrips({ trips, lead, now, all, onScroll, onTop }: { trips: TripItem[]; lead: string[]; now: number; all: Record<string, boolean>; onScroll: (on: boolean) => void; onTop: (t: TripItem) => () => void }) {
  const c = usePalette();
  const lay = useRef<{ y: number; h: number }[]>([]);
  const [drag, setDrag] = useState<{ i: number; dy: number; target: number } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const start = (i: number) => { onScroll(false); haptic.tap(); setDrag({ i, dy: 0, target: i }); };
  const move = (dy: number) => {
    const d = dragRef.current; const L = lay.current;
    if (!d || !L[d.i]) return;
    const mid = L[d.i].y + L[d.i].h / 2 + dy;
    let target = d.i;
    L.forEach((r, j) => { if (!r) return; if (j < d.i && mid < r.y + r.h / 2) target = Math.min(target, j); if (j > d.i && mid > r.y + r.h / 2) target = Math.max(target, j); });
    if (target !== d.target) haptic.select();
    setDrag({ ...d, dy, target });
  };
  const end = () => {
    const d = dragRef.current;
    onScroll(true); setDrag(null);
    if (!d || d.target === d.i) return;
    // The Next trip card (lead) stays on top; the rows take the new order under it.
    store.setTripOrder(dragOrder(lead, trips.map((t) => t.okey!), d.i, d.target));
  };
  return (
    <View>
      {trips.map((t, i) => {
        let ty = 0;
        if (drag) {
          const sh = lay.current[drag.i]?.h || 0;
          if (i === drag.i) ty = drag.dy;
          else if (drag.i < drag.target && i > drag.i && i <= drag.target) ty = -sh;
          else if (drag.i > drag.target && i < drag.i && i >= drag.target) ty = sh;
        }
        const lifted = drag?.i === i;
        return (
          <View key={t.key} onLayout={(e) => { lay.current[i] = { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height }; }}
            style={{ transform: [{ translateY: ty }, { scale: lifted ? 1.02 : 1 }], zIndex: lifted ? 10 : 0, elevation: lifted ? 8 : 0, shadowColor: '#000', shadowOpacity: lifted ? 0.18 : 0, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } }}>
            {(() => {
              const grip = trips.length > 1 ? (open: () => void) => <Grip onStart={() => start(i)} onMove={move} onEnd={end} onTap={open} /> : undefined;
              if (t.kind !== 'mine' && t.kind !== 'saved') return <TripBoard trip={t} now={now} allServices={!!all[t.key]} handle={grip} onTop={onTop(t)} />;
              const del = delAct(t, c.red);
              return (
                <SwipeRow act={del} style={CARD_SWIPE}>
                  <TripBoard trip={t} now={now} allServices={!!all[t.key]} handle={grip} flush act={del} onTop={onTop(t)} />
                </SwipeRow>
              );
            })()}
          </View>
        );
      })}
    </View>
  );
}

function Grip({ onStart, onMove, onEnd, onTap }: { onStart: () => void; onMove: (dy: number) => void; onEnd: () => void; onTap: () => void }) {
  const c = usePalette();
  const cb = useRef({ onStart, onMove, onEnd, onTap });
  cb.current = { onStart, onMove, onEnd, onTap };
  // The handle sits inside the card header. A tap on it opens the trip like the rest of the header; only a
  // move or a hold starts the reorder (and its buzz). Before, every touch here started a drag, so a tap near
  // the chevron buzzed and did nothing.
  const pan = useMemo(() => {
    let st: GripState = { phase: 'idle', t0: 0 };
    let hold: ReturnType<typeof setTimeout> | null = null;
    const run = (e: GripEvent, dy = 0) => {
      const [n, out] = gripStep(st, e);
      st = n;
      if (out === 'startDrag') { if (hold) clearTimeout(hold); cb.current.onStart(); if (dy) cb.current.onMove(dy); }
      else if (out === 'move') cb.current.onMove(dy);
      else if (out === 'endDrag') cb.current.onEnd();
      else if (out === 'tap') cb.current.onTap();
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => st.phase !== 'drag',
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => { run({ type: 'down', t: Date.now() }); hold = setTimeout(() => run({ type: 'hold', t: Date.now() }), 260); },
      onPanResponderMove: (_, g) => run({ type: 'move', t: Date.now(), dy: g.dy }, g.dy),
      onPanResponderRelease: () => { if (hold) clearTimeout(hold); run({ type: 'up', t: Date.now() }); },
      onPanResponderTerminate: () => { if (hold) clearTimeout(hold); run({ type: 'cancel' }); },
    });
  }, []);
  return (
    <View {...pan.panHandlers} hitSlop={8} accessible accessibilityRole="button" accessibilityLabel="Reorder trip" accessibilityHint="Drag up or down to move this trip. Tap to open it."
      onAccessibilityTap={onTap}
      style={{ width: 40, height: 48, marginLeft: 4, marginRight: -8, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={I.grip} size={20} color={c.text3} />
    </View>
  );
}

const hs = StyleSheet.create({
  live: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 10, paddingHorizontal: 14, paddingVertical: 8, minHeight: 44, borderRadius: radius },
  extras: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 14 },
  snack: { marginTop: 'auto', marginBottom: 16, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderRadius: 8, elevation: 6, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
});

/** Swipe or VoiceOver Delete on a saved trip: it goes at once, with Undo above the tab bar for 5 seconds. */
function delAct(t: TripItem, red: string): SwipeAct {
  return { label: 'Delete', text: 'Delete', icon: I.trash, color: red, onPress: () => deleteTrip(t) };
}

/** New trip, Star a stop, Set or Change Home, Set or Change Work: the + menu on Home, on every platform. */
function addItems(hasHome: boolean, hasWork: boolean) {
  return [
    { text: 'New trip', icon: I.route, sf: 'point.topleft.down.to.point.bottomright.curvepath', onPress: () => router.push('/new-trip') },
    { text: 'Star a stop', icon: I.starOpen, sf: 'star', onPress: () => router.push('/search') },
    { text: hasHome ? 'Change Home' : 'Set Home', icon: I.home, sf: 'house', onPress: () => router.push({ pathname: '/add-trip', params: { place: 'home' } }) },
    { text: hasWork ? 'Change Work' : 'Set Work', icon: I.briefcase, sf: 'briefcase', onPress: () => router.push({ pathname: '/add-trip', params: { place: 'work' } }) },
  ];
}

/**
 * iPhone: the one Add on Home is a system bar button in the navigation bar with a UIMenu (react-native-screens header
 * items through expo-router's Stack.Toolbar, native code in every build from 201 to 208). Tapping + drops the system
 * menu from the button, with SF Symbols and no Cancel row; on iOS 26 and 27 it is the Liquid Glass menu. The live
 * time sits beside it as its own item. Bidur, 25 Oct 8:42 PM: the action sheet in the middle of the screen was wrong
 * (React Native's ActionSheetIOS uses its anchor only on iPad, so on iPhone it was always the centred sheet).
 */
function AddMenu({ places }: { places: { home?: Place; work?: Place } }) {
  const hasHome = !!places?.home, hasWork = !!places?.work;
  // One element per Home/Work state: the toolbar's options change only when a label does.
  return useMemo(() => {
    const items = addItems(hasHome, hasWork);
    return (
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.View hidesSharedBackground>
          <LiveTag />
        </Stack.Toolbar.View>
        <Stack.Toolbar.Menu icon="plus" accessibilityLabel="Add" accessibilityHint="New trip, star a stop, or set Home or Work">
          {items.map((it) => (
            <Stack.Toolbar.MenuAction key={it.text} icon={it.sf as any} onPress={it.onPress}>{it.text}</Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
    );
  }, [hasHome, hasWork]);
}

/**
 * Android and the web preview: the + in the top app bar opens a menu that drops from the button (Material 3 menu on
 * Android, the iPhone menu's shape on the web), anchored by measuring the button on screen.
 */
function AddButton({ places }: { places: { home?: Place; work?: Place } }) {
  const c = usePalette();
  const [at, setAt] = useState<Rect | null>(null);
  const items: MenuItem[] = addItems(!!places?.home, !!places?.work);
  const btn = useRef<any>(null);
  const show = () => {
    haptic.tap();
    const b = btn.current as any;
    if (b?.measureInWindow) b.measureInWindow((x: number, y: number, w: number, h: number) => setAt({ x, y, w, h }));
    else setAt({ x: 0, y: 0, w: 0, h: 0 });
  };
  return (
    <>
      <Pressable ref={btn} onPress={show} accessibilityRole="button" accessibilityLabel="Add" accessibilityHint="New trip, star a stop, or set Home or Work"
        accessibilityState={{ expanded: !!at }} hitSlop={4} android_ripple={{ color: c.fill, borderless: true, radius: 24 }}
        style={({ pressed }) => ({ width: Platform.OS === 'web' ? 36 : 48, height: Platform.OS === 'web' ? 36 : 48, marginRight: Platform.OS === 'web' ? 8 : 0, alignItems: 'center', justifyContent: 'center', opacity: pressed && Platform.OS !== 'android' ? 0.5 : 1 })}>
        <Icon name={I.plus} size={24} color={Platform.OS === 'web' ? c.tint : c.text} />
      </Pressable>
      <AnchoredMenu visible={!!at} anchor={at} items={items} label="Add" onClose={() => setAt(null)} />
    </>
  );
}
