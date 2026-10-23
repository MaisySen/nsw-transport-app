import { useState } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/lib/api';
import { useLive, useNow } from '@/lib/hooks';
import { usePalette, radius, modeColor } from '@/lib/theme';
import { bestTime, clock, ms, shortName } from '@/lib/format';
import { useStore } from '@/lib/store';
import type { Journey, Leg, Place } from '@/lib/types';
import { startWatch, stopWatch, tripSpec } from '@/lib/watch';
import { Icon, I } from '@/components/Icon';
import { openService } from '@/components/Cards';
import { JourneyCard, LineBadge, LiveStamp, StatusLine } from '@/components/Transit';
import { Button, Empty, Screen, Sep, T } from '@/components/ui';

function LegView({ l, next, now }: { l: Leg; next?: Leg; now: number }) {
  const c = usePalette();
  if (l.kind === 'walk') {
    return (
      <View style={st.walk}>
        <View style={{ width: 36, alignItems: 'center' }}><Icon name={I.walk} size={18} color={c.text2} /></View>
        <T kind="sub" tone="text2">Walk {l.durationMin} min{l.distanceM ? ` (${Math.round(l.distanceM)} m)` : ''}{l.to ? ` to ${shortName(l.to)}` : ''}</T>
      </View>
    );
  }
  const color = l.color || modeColor[l.mode || 'bus'];
  const dep = bestTime(l.planned, l.realtime ? l.estimated : null);
  const arr = bestTime(l.arrPlanned, l.realtime ? l.arrEstimated : null);
  const depMins = Math.round((dep - now) / 60000);
  return (
    <Pressable onPress={() => openService({ tripId: l.tripId, line: l.line, stopId: l.stopId, planned: l.planned, mode: l.mode, destId: l.destId, color: l.color, dest: l.towards, realtime: l.realtime, estimated: l.estimated, delayMin: l.delayMin })}
      style={({ pressed }) => [st.leg, pressed ? { opacity: 0.7 } : null]}>
      <View style={{ width: 36, alignItems: 'center' }}>
        <View style={[st.dotBig, { borderColor: color, backgroundColor: c.card }]} />
        <View style={{ flex: 1, width: 5, backgroundColor: color, marginVertical: 2, borderRadius: 3 }} />
        <View style={[st.dotBig, { borderColor: color, backgroundColor: c.card }]} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <T kind="headline" numberOfLines={2}>{shortName(l.from)}</T>
            <T kind="foot" tone="text2">{[l.fromPlatform, `${clock(dep)}`].filter(Boolean).join(' \u00b7 ')}</T>
          </View>
          <T kind="headline" style={{ fontVariant: ['tabular-nums'], color: l.realtime ? (depMins <= 3 ? c.liveText : c.text) : c.text2 }}>{depMins <= 0 ? 'Now' : depMins < 60 ? `${depMins} min` : clock(dep)}</T>
        </View>
        {l.platformChangedFrom ? <T kind="foot" style={{ color: c.lateText, fontWeight: '600', marginTop: 2 }}>Platform changed from {l.platformChangedFrom}</T> : null}
        <View style={[st.ride, { backgroundColor: c.bg }]}>
          <LineBadge small line={l.line} mode={l.mode} color={l.color} />
          <View style={{ flex: 1, marginLeft: 8 }}>
            <T kind="sub" numberOfLines={1}>Towards {shortName(l.towards)}</T>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <StatusLine realtime={l.realtime} delayMin={l.delayMin} cancelled={l.cancelled} />
              <T kind="foot" tone="text2">{l.durationMin} min{l.stops ? `, ${l.stops} stops` : ''}{l.occupancy?.text ? ` \u00b7 ${l.occupancy.text}` : ''}</T>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <T kind="foot" tone="tint" style={{ fontWeight: '600' }}>Track</T>
            <Icon name={I.chevron} size={12} color={c.tint} />
          </View>
        </View>
        {l.alerts?.length ? (
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
            <Icon name={I.warn} size={13} color={c.orange} />
            <T kind="foot" style={{ color: c.lateText, flex: 1 }} numberOfLines={3}>{l.alerts[0].title}</T>
          </View>
        ) : null}
        <View style={{ marginTop: 10 }}>
          <T kind="headline" numberOfLines={2}>{shortName(l.to)}</T>
          <T kind="foot" tone="text2">{[l.toPlatform, `Arrive ${clock(arr)}`].filter(Boolean).join(' \u00b7 ')}</T>
        </View>
      </View>
    </Pressable>
  );
}

function Transfer({ a, b }: { a: Leg; b: Leg }) {
  const c = usePalette();
  const gap = Math.round((bestTime(b.planned, b.estimated) - bestTime(a.arrPlanned, a.arrEstimated)) / 60000);
  if (!Number.isFinite(gap)) return null;
  const tight = gap < 3;
  return (
    <View style={[st.walk, { paddingVertical: 6 }]}>
      <View style={{ width: 36, alignItems: 'center' }}><Icon name={I.clock} size={15} color={tight ? c.orange : c.text3} /></View>
      <T kind="foot" style={{ color: tight ? c.lateText : c.text2, fontWeight: tight ? '600' : '400' }}>{gap <= 0 ? 'Change now, very tight' : `${gap} min to change${tight ? ', tight' : ''}`}</T>
    </View>
  );
}

function JourneyDetail({ j, now, from, to }: { j: Journey; now: number; from: Place; to: Place }) {
  const c = usePalette();
  const st2 = useStore();
  const spec = tripSpec(j, from, to);
  const watchedId = st2.watchedTrips[spec.key];
  const [busy, setBusy] = useState(false);
  const legs = j.legs;
  return (
    <View style={{ paddingBottom: 14 }}>
      <Sep />
      <View style={{ paddingHorizontal: 12, paddingTop: 10 }}>
        {legs.map((l, i) => {
          const prevT = legs.slice(0, i).reverse().find((x) => x.kind === 'transit');
          return (
            <View key={i}>
              {l.kind === 'transit' && prevT && legs[i - 1]?.kind === 'transit' ? <Transfer a={prevT} b={l} /> : null}
              <LegView l={l} now={now} />
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginTop: 8 }}>
        <View style={{ flex: 1 }}>
          <Button title={watchedId ? 'Stop watching' : 'Watch this trip'} icon={watchedId ? I.bellOff : I.bell} kind={watchedId ? 'tinted' : 'filled'} disabled={busy}
            onPress={async () => {
              setBusy(true);
              try {
                if (watchedId) await stopWatch(watchedId);
                else { await startWatch(spec); Alert.alert('Watching this trip', "I'll alert you when it's time to leave, if it runs late, if the platform changes, if you'll miss a connection, and before your stop."); }
              } catch (e: any) { Alert.alert("Couldn't do that", e.message); }
              setBusy(false);
            }} />
        </View>
      </View>
    </View>
  );
}

export default function TripScreen() {
  const p = useLocalSearchParams<{ from: string; fromName: string; to: string; toName: string; pick?: string }>();
  const from = { id: String(p.from), name: String(p.fromName || '') };
  const to = { id: String(p.to), name: String(p.toName || '') };
  const c = usePalette();
  const now = useNow(1000);
  const [open, setOpen] = useState<number | null>(p.pick != null ? Number(p.pick) : 0);
  const { data, error, updatedAt, refreshing, refresh } = useLive((r) => api.trip(from, to, { refresh: r, count: 6 }), 20000, [from.id, to.id]);
  const js = (data?.journeys || []).filter((j) => ms(j.leave) > now - 120000);

  const save = () => {
    const doSave = async (name: string) => {
      try { await api.saveTrip(name, from, to); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); Alert.alert('Saved', `It's on your Home screen as "${name}". You can also text "${name}" to Tab.`); }
      catch (e: any) { Alert.alert("Couldn't save it", e.message); }
    };
    Alert.alert('Save this trip', 'Saved trips show live on Home.', [
      { text: 'Home', onPress: () => doSave('home') },
      { text: 'Work', onPress: () => doSave('work') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{
        title: `${shortName(from.name)} to ${shortName(to.name)}`,
        headerRight: () => <Pressable hitSlop={10} onPress={save}><Icon name={I.starOpen} size={22} color={c.tint} /></Pressable>,
      }} />
      <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <View style={{ paddingHorizontal: 20, paddingTop: 10 }}><LiveStamp updatedAt={updatedAt} error={error} /></View>
        {js.map((j, i) => (
          <View key={j.leave + i} style={{ marginHorizontal: 16, marginTop: 12, backgroundColor: c.card, borderRadius: radius, overflow: 'hidden' }}>
            <JourneyCard j={j} now={now} best={i === 0} onPress={() => { Haptics.selectionAsync(); setOpen(open === i ? null : i); }} />
            {open === i ? <JourneyDetail j={j} now={now} from={from} to={to} /> : null}
          </View>
        ))}
        {data && !js.length ? <Empty icon={I.route} title="No trips found" body={data.error || 'Try a different time or nearby stop.'} /> : null}
        {!data && error ? <Empty icon={I.warn} title="Can't plan this trip" body={error} /> : null}
        {!data && !error ? <T kind="sub" tone="text2" style={{ textAlign: 'center', marginTop: 40 }}>Finding live trips</T> : null}
        {data?.tomorrow ? <T kind="foot" tone="text2" style={{ marginHorizontal: 32, marginTop: 12 }}>No more trips tonight. These are the first ones tomorrow.</T> : null}
      </Screen>
    </>
  );
}

const st = StyleSheet.create({
  walk: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  leg: { flexDirection: 'row', paddingVertical: 8 },
  dotBig: { width: 14, height: 14, borderRadius: 7, borderWidth: 3.5 },
  ride: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, padding: 10, marginTop: 10 },
});
