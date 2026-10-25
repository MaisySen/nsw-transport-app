import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { haptic } from '@/lib/haptic';
import { api, boardTimeSupported, departuresAt, departuresFor } from '@/lib/api';
import { useCountdownNow, useLive, useReportCountdowns } from '@/lib/hooks';
import { adaptiveGapMs, nextInMs } from '@/lib/pollCore';
import { bestTime } from '@/lib/format';
import { useScreenPoll } from '@/lib/activity';
import { cacheKey } from '@/lib/offlineCore';
import { usePalette, radius } from '@/lib/theme';
import { clock, shortName } from '@/lib/format';
import { boardAsk, boardKey, byRoute, keepRoute, modesServed } from '@/lib/stopBoardCore';
import { useUsualText } from '@/lib/usual';
import { departedWords } from '@/lib/recentCore';
import { useRecentDeparted } from '@/lib/recent';
import { rowNote, topAlerts } from '@/lib/stopAlertsCore';
import { useWhyLate } from '@/lib/whyLate';
import { store, useStore } from '@/lib/store';
import { svcSpec, toggleWatch, tripKey } from '@/lib/watch';
import { Icon, I } from '@/components/Icon';
import { openService } from '@/components/Cards';
import { DepartureRow, LineBadge, LiveStamp } from '@/components/Transit';
import { linesHere, stopLabel, stopNumber } from '@/lib/busCore';
import { BOARD_EARLIER_NEEDS_NEW, BOARD_MAX_ASKS, boardEarlierRow, boardEarlierSteps, boardFloor, boardList, boardDayWord, boardMoment, boardWhenWords, fillFrom, firstDepOf, freshBefore, isGone } from '@/lib/boardTimeCore';
import { afterBatch, canLoadEarlier, PAGE0, sydney, type PageState } from '@/lib/tripModesCore';
import { LeftDepartureRow } from '@/components/LeftRow';
import { WhenPicker } from '@/components/WhenPicker';
import type { When } from '@/lib/planCore';
import type { Departure } from '@/lib/types';
import { Chip, Empty, Screen, Sep, T } from '@/components/ui';
import { StationInfo } from '@/components/Access';
import { CarParkRow } from '@/components/CarParkRow';
import * as WebBrowser from 'expo-web-browser';
import { useStationMap } from '@/lib/stationMap';
import type { Station } from '@/lib/access';
import { hasSpeech, speak } from '@/lib/nativeExtras';
import { departuresSentence } from '@/lib/voiceCore';
import { openPlatform } from '@/lib/platform';
import { PLATFORM_VIEW } from '@/lib/features';

const canSpeak = hasSpeech();


const MODE_LABEL: Record<string, string> = { train: 'Trains', metro: 'Metro', bus: 'Buses', lightrail: 'Light rail', ferry: 'Ferries', coach: 'Coaches', school: 'School buses' };

export default function StopScreen() {
  // `time` (HHMM, optional): a link can open the board from that time in the service day, like the chip.
  const { id, name, time } = useLocalSearchParams<{ id: string; name?: string; time?: string }>();
  const c = usePalette();
  const now = useCountdownNow();
  const st = useStore();
  const [mode, setMode] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [showGone, setShowGone] = useState(false);
  // The time chip: null is now (the board as before); a moment is the board from that time in the service day, from
  // api.transportsydney.app (departuresAt), gone services included. Only Now is kept on the phone for offline.
  const [at, setAt] = useState<number | null>(() => { const t = /^([01]\d|2[0-3])[0-5]\d$/.test(String(time || '')) ? String(time) : ''; return t && boardTimeSupported() ? boardMoment(+t.slice(0, 2), +t.slice(2), Date.now()) : null; });
  const [pickOpen, setPickOpen] = useState(false);
  const [timeOk, setTimeOk] = useState(boardTimeSupported());
  // The modes this stop serves, from its board for every mode. Where there are several, a chosen mode or route asks
  // the server for that mode alone, so the board reaches further ahead than a mixed list of 40 (boardAsk).
  const [served, setServed] = useState<string[]>([]);
  const ask = boardAsk(served, mode, pick, at);
  const { data, error, updatedAt, offlineAt, staleAt, refreshing, refresh } = useLive((r) => (at != null ? departuresAt(String(id), at) : ask ? departuresFor(String(id), ask, r) : api.departures(String(id), r)),
    // Adaptive: every 15 s while the next service is 5 minutes away or less, slower when it is further off.
    (d) => adaptiveGapMs(15000, nextInMs(d?.items, Date.now())), [id, at, ask], { cacheKey: at == null ? cacheKey('dep', boardKey(String(id), ask)) : undefined });
  useEffect(() => { setServed((p) => modesServed(p, data)); }, [data]);
  // A server without earlier times (no echo): the chip and the row go for the session and the board goes back to now.
  useEffect(() => { if (!boardTimeSupported()) { setTimeOk(false); setAt(null); } }, [error]);
  const title = shortName(data?.stop?.name || name || 'Stop');
  const starred = st.starred.some((s) => s.id === id);
  const modes = useMemo(() => (served.length ? served : Array.from(new Set((data?.items || []).map((d) => d.mode)))), [data, served]);
  const railHere = modes.includes('train') || modes.includes('metro');
  const stopName = data?.stop?.name || (name ? String(name) : '');
  // Remember opened stops for Home's Recent stops.
  useEffect(() => { if (id && stopName) store.addRecent({ id: String(id), name: stopName }); }, [id, stopName]);
  // Station access, lifts and Park and Ride: once, then every 2 minutes. No data (404) shows nothing.
  const map = useStationMap(id ? String(id) : undefined);
  const [station, setStation] = useState<Station | null>(null);
  const stationFor = useRef<string | undefined>(undefined);
  const loadStation = useCallback(() => {
    const sid = String(id);
    return api.station(sid).then((r) => { if (stationFor.current === sid) setStation(r && (r as any).access ? r : null); return true; })
      .catch((e: any) => { if (stationFor.current === sid && e?.http === 404) setStation(null); return e?.http === 404; });
  }, [id]);
  useEffect(() => {
    stationFor.current = String(id);
    setStation(null);
    loadStation();
    return () => { stationFor.current = undefined; };
  }, [id, loadStation]);
  // Every 2 minutes only while this screen is on view and the app is in front.
  useScreenPoll(loadStation, 120000);
  // The stop's alerts show once at the top: the two that touch the most services here. A row adds an alert
  // only when the top does not already show it.
  const top = useMemo(() => topAlerts(data?.alerts, mode ? (data?.items || []).filter((d) => d.mode === mode) : data?.items, 2, !!mode), [data, mode]);
  const noteFor = (d: any) => rowNote(d.alerts, data?.alerts, top);
  // Why it's late: a delayed or changed service names its reason from its own linked alert (whyLateCore.ts).
  const whyOf = useWhyLate(data?.items, data?.alerts);
  const routes = useMemo(() => linesHere(data?.items), [data]);
  // Route chips filter the board (Opal style); a route that has left the board drops the filter.
  const route = keepRoute(pick, routes);
  // A route that is not on the live board for buses either drops the filter, so the board does not stay on buses alone.
  useEffect(() => { if (pick && ask && data?.askedMode === ask && !staleAt && !offlineAt && !route) setPick(null); }, [pick, ask, data, staleAt, offlineAt, route]);
  // Earlier departures: batches before the first service on the board, back to 4am, gone ones as Left (also on Now).
  const [extra, setExtra] = useState<Departure[]>([]);
  const [earlier, setEarlier] = useState<PageState>(PAGE0);
  const [earlierNote, setEarlierNote] = useState('');
  useEffect(() => { setExtra([]); setEarlier(PAGE0); setEarlierNote(''); }, [id, at]);
  const board = useMemo(() => boardList(data?.items || [], extra, at, now), [data, extra, at, now]);
  const firstDep = firstDepOf(board);
  const floor = boardFloor(at, now);
  const onView = useRef(true);
  useEffect(() => () => { onView.current = false; }, []);
  const loadEarlier = async () => {
    if (!timeOk || !canLoadEarlier(earlier, firstDep, floor, true) || firstDep == null) return;
    const sid = String(id), first = firstDep;
    setEarlier((x) => ({ ...x, busy: true }));
    try {
      // One tap or pull: step back 40 min, then further over a quiet stretch; a busy station's batch that stops short
      // of the first service is filled from its last one (a board answer is 40 services).
      let got: Departure[] = [];
      for (const t of boardEarlierSteps(first, floor)) {
        let ask = t;
        for (let n = 0; n < BOARD_MAX_ASKS; n++) {
          const r = await departuresAt(sid, ask);
          got = got.concat(freshBefore(r.items || [], first, got));
          const next = fillFrom(r.items || [], first, ask);
          if (next == null) break;
          ask = next;
        }
        if (got.length) break;
      }
      if (!onView.current) return;
      const fresh = got;
      setExtra((x) => x.concat(freshBefore(fresh, first, x)));
      setEarlier((x) => afterBatch(x, fresh.length, null, Infinity));
      setEarlierNote('');
    } catch (e: any) {
      if (!onView.current) return;
      if (e?.unsupported) { setTimeOk(false); setAt(null); }
      else setEarlierNote(BOARD_EARLIER_NEEDS_NEW);
      setEarlier((x) => ({ ...x, busy: false, pages: x.pages + 1 }));
    }
  };
  // Pull down: refresh as before, and try Earlier departures again when they did not load.
  const pull = () => { refresh(); if (earlierNote) loadEarlier(); };
  const items = byRoute(board.filter((d) => !mode || d.mode === mode), route);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useReportCountdowns('stopscreen:' + id, items.slice(0, 6).map((d) => bestTime(d.planned, d.realtime ? d.estimated : null)));
  // Services that left in the last few minutes, from this phone's own reads of this board (recentCore.ts).
  const next = items.find((d) => !isGone(d, now));
  const usual = useUsualText(route && next ? { kind: 'transit', line: route, stopId: next.stopId || String(id), planned: next.planned } : null);
  // The phone's own Recently departed, on Now only until Earlier departures are loaded (they list the same services).
  const recent = useRecentDeparted(id ? boardKey(String(id), ask) : undefined, now);
  const gone = at == null && !extra.length ? byRoute(recent.filter((g) => !mode || g.mode === mode), route).slice(0, 5) : [];
  // A bus stop opened by its own number (2046100) shows the number on the sign; a station or a stop with several
  // stands shows each row's stop number instead.
  const all = data?.items || [];
  const busOnly = served.length ? served.every((m) => m === 'bus' || m === 'coach' || m === 'school') : !!all.length && all.every((d) => d.mode === 'bus' || d.mode === 'coach' || d.mode === 'school');
  const signNo = busOnly || (!all.length && !!data && !ask) ? stopNumber(String(id)) : null;
  const stand = signNo ? String(data?.stop?.exactName || '').match(/\b(Stand|Side) [A-Z0-9]+\b/)?.[0] : undefined;
  const openRoute = (line: string) => {
    const d = (data?.items || []).find((x) => x.line === line);
    haptic.tap();
    router.push({ pathname: '/route', params: { line, mode: d?.mode || 'bus', stop: d?.stopId || String(id), towards: d?.dest || '', color: d?.color || '' } });
  };

  return (
    <>
      <Stack.Screen options={{
        title,
        headerRight: () => (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
          {/* Platform view: only at a station with trains or metro, and only while the switch in lib/features.ts is on. */}
          {PLATFORM_VIEW && railHere ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Platform view" accessibilityHint="Shows the next train full screen with its platform and stops" hitSlop={9}
              onPress={() => { haptic.tap(); openPlatform({ stop: String(id), name: stopName }); }}>
              <Icon name={I.platform} size={22} color={c.tint} />
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel={starred ? 'Remove from Starred stops' : 'Add to Starred stops'} accessibilityState={{ selected: !!starred }} hitSlop={13} onPress={() => { haptic.select(); store.toggleStar({ id: String(id), name: data?.stop?.name || String(name || title), ...(busOnly ? { mode: 'bus', lines: routes.map((r) => r.line).slice(0, 6) } : {}) }); }}>
            <Icon name={starred ? I.star : I.starOpen} size={22} color={starred ? c.yellow : c.tint} />
          </Pressable>
          </View>
        ),
      }} />
      <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pull} />}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 4 }}>
          {/* The stamp wraps to a second line rather than pushing Speak and Board off the screen. */}
          <View style={{ flex: 1, marginRight: 8 }}><LiveStamp updatedAt={updatedAt} error={error} offlineAt={offlineAt} staleAt={staleAt} /></View>
          {canSpeak && at == null ? (
            <Pressable onPress={() => { haptic.select(); speak(departuresSentence(itemsRef.current, Date.now(), { stop: stopName }), { interrupt: true }); }} hitSlop={8}
              accessibilityRole="button" accessibilityLabel="Speak departures" accessibilityHint="Reads the next two services out loud"
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 32, borderRadius: 16, backgroundColor: c.fill, opacity: pressed ? 0.7 : 1, marginRight: 8 })}>
              <Icon name={I.speaker} size={14} color={c.tint} />
              <T kind="sub" tone="tint" style={{ fontWeight: '600' }}>Speak</T>
            </Pressable>
          ) : null}
          <Pressable onPress={() => { haptic.tap(); router.push({ pathname: '/board', params: { id: String(id), name: stopName } }); }} hitSlop={8}
            accessibilityRole="button" accessibilityLabel="Open departure board, full screen"
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 32, borderRadius: 16, backgroundColor: c.fill, opacity: pressed ? 0.7 : 1 })}>
            <Icon name={I.clock} size={14} color={c.tint} />
            <T kind="sub" tone="tint" style={{ fontWeight: '600' }}>Board</T>
          </Pressable>
        </View>

        {timeOk ? <BoardWhen at={at} now={now} onOpen={() => setPickOpen(true)} onNow={() => { haptic.select(); setAt(null); }} /> : null}

        {signNo ? (
          <T kind="sub" tone="text2" style={{ marginHorizontal: 20, marginTop: 8 }} accessibilityLabel={`Stop number ${signNo.split('').join(' ')}${stand ? ', ' + stand : ''}`}>
            Stop {signNo}{stand ? ` \u00b7 ${stand}` : ''}
          </T>
        ) : null}

        {routes.length ? (
          <View style={{ marginTop: 12 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, alignItems: 'center' }}>
              {routes.length > 1 ? <Chip label="All routes" on={!route} onPress={() => { haptic.select(); setPick(null); }} /> : null}
              {routes.map((r) => {
                const on = route === r.line;
                return (
                  <Pressable key={r.line} onPress={() => { haptic.select(); setPick(on ? null : r.line); }} accessibilityRole="button" accessibilityLabel={`Route ${r.line}`}
                    accessibilityState={{ selected: on }} accessibilityHint={on ? 'Shows every route again' : 'Shows only this route'} hitSlop={4}
                    style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, minHeight: 44, justifyContent: 'center' })}>
                    <View style={{ padding: 2, borderRadius: 9, borderWidth: 2, borderColor: on ? c.tint : 'transparent' }}>
                      <LineBadge line={r.line} mode={r.mode} color={r.color} />
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
            {route ? (
              <Pressable onPress={() => openRoute(route)} accessibilityRole="button" accessibilityLabel={`Route ${route}, all stops and live buses`} hitSlop={6}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 20, marginTop: 4, minHeight: 32, opacity: pressed ? 0.6 : 1 })}>
                <Icon name={I.route} size={14} color={c.tint} />
                <T kind="sub" tone="tint" style={{ fontWeight: '600' }}>Route {route}: all stops and live buses</T>
                <Icon name={I.chevron} size={12} color={c.tint} />
              </Pressable>
            ) : null}
            {route && usual ? (
              <T kind="foot" tone="text2" style={{ marginHorizontal: 20, marginTop: 2 }} accessibilityLabel={`Route ${route} here: ${usual}`}>
                {route} here: {usual.charAt(0).toLowerCase() + usual.slice(1)}
              </T>
            ) : null}
          </View>
        ) : null}

        {/* A Park and Ride car park at this station: one row with the live count (components/CarParkRow.tsx). */}
        <CarParkRow list={station?.parking} stop={String(id)} station={station?.name} />

        {modes.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingTop: 14 }}>
            <Chip label="All" on={!mode} onPress={() => setMode(null)} />
            {modes.map((m) => <Chip key={m} label={MODE_LABEL[m] || m} on={mode === m} onPress={() => setMode(m)} />)}
          </ScrollView>
        ) : null}

        {top.length ? (
          <View style={{ marginHorizontal: 16, marginTop: 14, backgroundColor: c.card, borderRadius: radius, padding: 14, flexDirection: 'row', gap: 10 }}>
            <Icon name={I.warn} size={18} color={c.orange} />
            <View style={{ flex: 1 }}>
              {top.map((a, i) => <T key={i} kind="sub" numberOfLines={3} style={{ marginTop: i ? 6 : 0 }}>{a.title}</T>)}
            </View>
          </View>
        ) : null}

        {gone.length ? (
          <View style={{ marginHorizontal: 16, marginTop: 14, backgroundColor: c.card, borderRadius: radius, overflow: 'hidden' }}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: showGone }} onPress={() => { haptic.tap(); setShowGone(!showGone); }}
              accessibilityLabel={`Recently departed, ${gone.length}. Latest: ${gone[0].line} to ${shortName(gone[0].dest)}, ${departedWords(gone[0], clock).main}`}
              android_ripple={{ color: c.fill }} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 48, backgroundColor: pressed && Platform.OS === 'ios' ? c.card2 : c.card })}>
              <Icon name={I.history} size={15} color={c.text2} />
              <T kind="sub" tone="text2" style={{ flex: 1, marginLeft: 8 }} numberOfLines={1}>
                Recently departed{showGone ? '' : `: ${gone[0].line} ${departedWords(gone[0], clock).main.replace(/^Left/, 'left').replace(/^Due/, 'due')}`}
              </T>
              <Icon name={showGone ? I.up : I.down} size={12} color={c.text3} />
            </Pressable>
            {showGone ? gone.map((g) => {
              const w = departedWords(g, clock);
              return (
                <View key={g.key}>
                  <Sep inset={16} />
                  <Pressable accessibilityRole="button" accessibilityLabel={`${g.line} to ${shortName(g.dest)}. ${w.main}. ${w.sub}`} android_ripple={{ color: c.fill }}
                    onPress={() => openService({ tripId: g.tripId || undefined, feed: g.feed, line: g.line, stopId: g.stopId, planned: g.planned, mode: g.mode, destId: g.destId || undefined, color: g.color, dest: g.dest })}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, minHeight: 56, backgroundColor: pressed && Platform.OS === 'ios' ? c.card2 : c.card })}>
                    <View style={{ width: 66, alignItems: 'flex-start', opacity: 0.7 }}><LineBadge line={g.line} mode={g.mode} color={g.color} /></View>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <T kind="callout" tone="text2" numberOfLines={1}>{shortName(g.dest)}</T>
                      <T kind="foot" tone="text2">{w.sub}</T>
                    </View>
                    <T kind="sub" style={{ color: g.confirmed ? c.text : c.text2, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{w.main}</T>
                  </Pressable>
                </View>
              );
            }) : null}
          </View>
        ) : null}

        {items.length ? (
          <View style={{ marginHorizontal: 16, marginTop: 14, backgroundColor: c.card, borderRadius: radius, overflow: 'hidden' }}>
            {earlier.busy ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 48, gap: 8 }} accessibilityLiveRegion="polite" accessibilityLabel="Loading earlier departures">
                <ActivityIndicator size="small" />
                <T kind="foot" tone="text2">Loading earlier departures</T>
              </View>
            ) : null}
            {(() => {
              // Earlier departures, also on Now (the trip screen's Earlier services row): each tap loads the services
              // before the first one shown, gone ones as Left, back to 4am (pull down tries again after a miss).
              const er = boardEarlierRow(earlier, firstDep, floor, timeOk);
              return er.show ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`${er.label}. Loads the services before ${firstDep != null ? clock(firstDep) : 'the first one'}`} onPress={() => { haptic.select(); loadEarlier(); }}
                  android_ripple={{ color: c.fill }} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingHorizontal: 16, opacity: pressed ? 0.6 : 1 })}>
                  <Icon name={I.clock} size={14} color={c.tint} />
                  <T kind="sub" tone="tint" style={{ fontWeight: '600', marginLeft: 6 }}>{er.label}</T>
                </Pressable>
              ) : null;
            })()}
            {earlierNote && !earlier.busy ? <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}><T kind="foot" tone="text2">{earlierNote}</T></View> : null}
            {items.map((d, i) => {
              const key = tripKey(d.tripId, d.planned, d.line);
              const top = i === 0 && !earlier.busy && !earlierNote && !boardEarlierRow(earlier, firstDep, floor, timeOk).show;
              return (
                <View key={key + i}>
                  {top ? null : <Sep inset={i ? 82 : 0} />}
                  {isGone(d, now)
                    ? <LeftDepartureRow d={d} stopNo={signNo ? null : stopLabel(d.stopId, d.mode) || null} onPress={() => openService(d)} />
                    : <DepartureRow d={d} now={now} station={String(id)} stopNo={!signNo} alertText={noteFor(d)} why={whyOf(d)} watched={!!st.watchedTrips[key]} onPress={() => openService(d)} onWatch={() => toggleWatch(svcSpec(d), store.watchedId(key))} />}
                </View>
              );
            })}
          </View>
        ) : null}
        {data && !items.length ? <Empty icon={I.clock} title={route ? `No more ${route} services` : 'No more services'} body={at == null ? 'Nothing is due from here in the next few hours.' : 'Nothing is due from here around that time.'} /> : null}

        {!data && error && at != null ? <T kind="sub" tone="text2" style={{ marginHorizontal: 32, marginTop: 16 }} accessibilityLiveRegion="polite">{error}</T> : null}
        {!data && error && at == null ? <Empty icon={I.warn} title="Can't load this stop" body={error} /> : null}
        {!data && !error && at != null ? <View style={{ alignItems: 'center', marginTop: 24 }}><ActivityIndicator size="small" /></View> : null}
        {data ? <T kind="foot" tone="text2" style={{ marginHorizontal: 32, marginTop: 12 }}>Touch and hold a service to watch it. Live times show how old they are; grey times are from the timetable.</T> : null}
        {map ? (
          <Pressable onPress={() => { haptic.tap(); WebBrowser.openBrowserAsync(map.url).catch(() => {}); }} accessibilityRole="link" accessibilityLabel={`Station map, ${map.label}, from Transport for NSW`}
            android_ripple={{ color: c.fill }}
            style={({ pressed }) => ({ marginHorizontal: 16, marginTop: 14, backgroundColor: pressed && Platform.OS !== 'android' ? c.card2 : c.card, borderRadius: radius, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, minHeight: 56 })}>
            <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }}><Icon name={I.pin} size={16} color={c.tint} /></View>
            <View style={{ flex: 1, marginLeft: 12, paddingVertical: 10 }}>
              <T kind="body">Station map</T>
              <T kind="foot" tone="text2">Entrances, lifts and platforms, from Transport for NSW</T>
            </View>
            <Icon name={I.chevron} size={14} color={c.text3} />
          </Pressable>
        ) : null}
        <StationInfo st={station} />
      </Screen>
      <WhenPicker visible={pickOpen} now={now} onClose={() => setPickOpen(false)}
        value={at == null ? { kind: 'now' } : { kind: 'leave', h: sydney(at).h, m: sydney(at).m }}
        kinds={[{ k: 'now', label: 'Now' }, { k: 'leave', label: 'From' }]} nowText="Departures from now, with live times."
        dayNote={(w) => (w.kind === 'now' ? '' : boardDayWord(boardMoment(w.h, w.m, now), now))}
        onDone={(w: When) => { setPickOpen(false); setAt(w.kind === 'now' ? null : boardMoment(w.h, w.m, Date.now())); }} />
    </>
  );
}

/** The board's time chip: "Now", or "From 6:15pm" (any time in the service day, back to 4am), and Now one tap back.
 * The trip screen's When chip, with From instead of Leave at and no Arrive by. */
function BoardWhen({ at, now, onOpen, onNow }: { at: number | null; now: number; onOpen: () => void; onNow: () => void }) {
  const c = usePalette();
  const label = boardWhenWords(at, now);
  const ios = Platform.OS === 'ios';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 12, gap: 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Departures ${at == null ? 'from now' : label.replace(/^From/, 'from')}. Change time`} accessibilityHint="Opens a time picker, from 4am today" onPress={onOpen}
        android_ripple={{ color: c.fill, borderless: false }}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 14, borderRadius: ios ? 22 : 8, backgroundColor: c.card, borderWidth: ios ? 0 : 1, borderColor: c.sep, opacity: pressed ? 0.7 : 1, flexShrink: 1 })}>
        <Icon name={I.clock} size={15} color={c.tint} />
        <T kind="sub" numberOfLines={2} style={{ marginLeft: 6, fontWeight: '600', flexShrink: 1 }}>{label}</T>
        <Icon name={I.chevron} size={11} color={c.text3} style={{ marginLeft: 6, transform: [{ rotate: '90deg' }] }} />
      </Pressable>
      {at != null ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Departures from now" onPress={onNow} android_ripple={{ color: c.fill }}
          style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 14, borderRadius: ios ? 22 : 8, justifyContent: 'center', backgroundColor: c.fill, opacity: pressed ? 0.7 : 1 })}>
          <T kind="sub" tone="tint" style={{ fontWeight: '600' }}>Now</T>
        </Pressable>
      ) : null}
    </View>
  );
}
