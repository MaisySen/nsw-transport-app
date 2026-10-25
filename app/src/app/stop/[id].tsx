import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { haptic } from '@/lib/haptic';
import { api } from '@/lib/api';
import { useLive, useNow } from '@/lib/hooks';
import { useScreenPoll } from '@/lib/activity';
import { cacheKey } from '@/lib/offlineCore';
import { usePalette, radius } from '@/lib/theme';
import { clock, ms, shortName } from '@/lib/format';
import { byRoute, keepRoute } from '@/lib/stopBoardCore';
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
import { linesHere, stopNumber } from '@/lib/busCore';
import { Chip, Empty, Screen, Sep, T } from '@/components/ui';
import { StationInfo } from '@/components/Access';
import * as WebBrowser from 'expo-web-browser';
import { useStationMap } from '@/lib/stationMap';
import type { Station } from '@/lib/access';

const MODE_LABEL: Record<string, string> = { train: 'Trains', metro: 'Metro', bus: 'Buses', lightrail: 'Light rail', ferry: 'Ferries', coach: 'Coaches', school: 'School buses' };

export default function StopScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const c = usePalette();
  const now = useNow();
  const st = useStore();
  const [mode, setMode] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [showGone, setShowGone] = useState(false);
  const { data, error, updatedAt, offlineAt, refreshing, refresh } = useLive((r) => api.departures(String(id), r), 15000, [id], { cacheKey: cacheKey('dep', String(id)) });
  const title = shortName(data?.stop?.name || name || 'Stop');
  const starred = st.starred.some((s) => s.id === id);
  const modes = useMemo(() => Array.from(new Set((data?.items || []).map((d) => d.mode))), [data]);
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
  const items = byRoute((data?.items || []).filter((d) => (!mode || d.mode === mode) && ms(d.realtime ? d.estimated : d.planned) > now - 60000), route);
  // Services that left in the last few minutes, from this phone's own reads of this board (recentCore.ts).
  const usual = useUsualText(route && items[0] ? { kind: 'transit', line: route, stopId: items[0].stopId || String(id), planned: items[0].planned } : null);
  const gone = byRoute(useRecentDeparted(id ? String(id) : undefined, now).filter((g) => !mode || g.mode === mode), route).slice(0, 5);
  // A bus stop opened by its own number (2046100) shows the number on the sign; a station or a stop with several
  // stands shows each row's stop number instead.
  const all = data?.items || [];
  const busOnly = !!all.length && all.every((d) => d.mode === 'bus' || d.mode === 'coach' || d.mode === 'school');
  const signNo = busOnly || (!all.length && !!data) ? stopNumber(String(id)) : null;
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
          <Pressable accessibilityRole="button" accessibilityLabel={starred ? 'Remove from Starred stops' : 'Add to Starred stops'} accessibilityState={{ selected: !!starred }} hitSlop={13} onPress={() => { haptic.select(); store.toggleStar({ id: String(id), name: data?.stop?.name || String(name || title), ...(busOnly ? { mode: 'bus', lines: routes.map((r) => r.line).slice(0, 6) } : {}) }); }}>
            <Icon name={starred ? I.star : I.starOpen} size={22} color={starred ? c.yellow : c.tint} />
          </Pressable>
        ),
      }} />
      <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 4 }}>
          <LiveStamp updatedAt={updatedAt} error={error} offlineAt={offlineAt} />
          <Pressable onPress={() => { haptic.tap(); router.push({ pathname: '/board', params: { id: String(id), name: stopName } }); }} hitSlop={8}
            accessibilityRole="button" accessibilityLabel="Open departure board, full screen"
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 32, borderRadius: 16, backgroundColor: c.fill, opacity: pressed ? 0.7 : 1 })}>
            <Icon name={I.clock} size={14} color={c.tint} />
            <T kind="sub" tone="tint" style={{ fontWeight: '600' }}>Board</T>
          </Pressable>
        </View>

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
            {items.map((d, i) => {
              const key = tripKey(d.tripId, d.planned, d.line);
              return (
                <View key={key + i}>
                  {i ? <Sep inset={82} /> : null}
                  <DepartureRow d={d} now={now} stopNo={!signNo} alertText={noteFor(d)} why={whyOf(d)} watched={!!st.watchedTrips[key]} onPress={() => openService(d)} onWatch={() => toggleWatch(svcSpec(d), store.watchedId(key))} />
                </View>
              );
            })}
          </View>
        ) : null}
        {data && !items.length ? <Empty icon={I.clock} title={route ? `No more ${route} services` : 'No more services'} body="Nothing is due from here in the next few hours." /> : null}

        {!data && error ? <Empty icon={I.warn} title="Can't load this stop" body={error} /> : null}
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
    </>
  );
}
