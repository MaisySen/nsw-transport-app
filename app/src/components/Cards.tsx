import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { api } from '@/lib/api';
import { useLive, useNow } from '@/lib/hooks';
import { usePalette, radius } from '@/lib/theme';
import { clock, ms, shortName } from '@/lib/format';
import type { Place } from '@/lib/types';
import { svcSpec, toggleWatch, tripKey } from '@/lib/watch';
import { useStore } from '@/lib/store';
import { Icon, I } from './Icon';
import { DepartureRow, JourneyCard, LiveDot } from './Transit';
import { Sep, T } from './ui';

export function openService(d: { tripId?: string; line?: string; stopId?: string; planned?: string; mode?: string; destId?: string; color?: string; dest?: string }) {
  router.push({ pathname: '/service', params: { trip: d.tripId || '', line: d.line || '', stop: d.stopId || '', planned: d.planned || '', mode: d.mode || '', destId: d.destId || '', color: d.color || '', dest: d.dest || '' } });
}

function CardHead({ title, subtitle, onPress, live, beat, icon }: { title: string; subtitle?: string; onPress?: () => void; live?: boolean; beat?: any; icon?: any }) {
  const c = usePalette();
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 13, paddingBottom: 9 }}>
      {icon ? <Icon name={icon} size={15} color={c.tint} style={{ marginRight: 7 }} /> : null}
      <View style={{ flex: 1 }}>
        <T kind="headline" numberOfLines={1}>{title}</T>
        {subtitle ? <T kind="foot" tone="text2" numberOfLines={1}>{subtitle}</T> : null}
      </View>
      {live ? <LiveDot beat={beat} /> : null}
      {onPress ? <Icon name={I.chevron} size={13} color={c.text3} style={{ marginLeft: 6 }} /> : null}
    </Pressable>
  );
}

export function StopCard({ stop }: { stop: Place }) {
  const c = usePalette();
  const now = useNow(1000);
  const st = useStore();
  const { data, updatedAt, error } = useLive((r) => api.departures(stop.id, r), 20000, [stop.id]);
  const items = (data?.items || []).filter((d) => ms(d.estimated || d.planned) > now - 60000).slice(0, 3);
  return (
    <View style={{ backgroundColor: c.card, borderRadius: radius, marginHorizontal: 16, marginTop: 12, overflow: 'hidden' }}>
      <CardHead icon={I.star} title={shortName(data?.stop?.name || stop.name)} live={!!updatedAt && !error} beat={updatedAt}
        onPress={() => router.push({ pathname: '/stop/[id]', params: { id: stop.id, name: stop.name } })} />
      {!data ? <T kind="foot" tone="text2" style={{ paddingHorizontal: 16, paddingBottom: 14 }}>{error || 'Loading live times'}</T> : null}
      {data && !items.length ? <T kind="foot" tone="text2" style={{ paddingHorizontal: 16, paddingBottom: 14 }}>No more services right now</T> : null}
      {items.map((d, i) => {
        const key = tripKey(d.tripId, d.planned, d.line);
        return (
          <View key={key + i}>
            <Sep inset={16} />
            <DepartureRow d={d} now={now} watched={!!st.watchedTrips[key]} onPress={() => openService(d)} onWatch={() => toggleWatch(svcSpec(d), st.watchedTrips[key])} />
          </View>
        );
      })}
    </View>
  );
}

export function TripCard({ from, to, title, subtitle, icon }: { from: Place; to: Place; title?: string; subtitle?: string; icon?: any }) {
  const c = usePalette();
  const now = useNow(1000);
  const { data, updatedAt, error } = useLive((r) => api.trip(from, to, { refresh: r, count: 3 }), 20000, [from.id, to.id]);
  const js = (data?.journeys || []).filter((j) => ms(j.leave) > now - 120000).slice(0, 2);
  const open = () => router.push({ pathname: '/trip', params: { from: from.id, fromName: from.name, to: to.id, toName: to.name } });
  return (
    <View style={{ backgroundColor: c.card, borderRadius: radius, marginHorizontal: 16, marginTop: 12, overflow: 'hidden' }}>
      <CardHead icon={icon || I.route} title={title || `${shortName(from.name)} to ${shortName(to.name)}`} subtitle={subtitle || (title ? `${shortName(from.name)} to ${shortName(to.name)}` : undefined)} live={!!updatedAt && !error} beat={updatedAt} onPress={open} />
      {!data ? <T kind="foot" tone="text2" style={{ paddingHorizontal: 16, paddingBottom: 14 }}>{error || 'Loading live trips'}</T> : null}
      {data && !js.length ? <T kind="foot" tone="text2" style={{ paddingHorizontal: 16, paddingBottom: 14 }}>{data.error || 'No trips found right now'}</T> : null}
      {js.map((j, i) => (
        <View key={j.leave + i}>
          <Sep inset={16} />
          <JourneyCard j={j} now={now} best={i === 0 && js.length > 1} onPress={() => router.push({ pathname: '/trip', params: { from: from.id, fromName: from.name, to: to.id, toName: to.name, pick: String(i) } })} />
        </View>
      ))}
    </View>
  );
}

export function watchLine(w: any, now: number) {
  const L = w.legs?.[0];
  const s0 = w.snap?.legs?.[0];
  if (!w.active || w.snap?.phase === 'done') return 'Finished';
  const t = s0?.depLive || s0?.dep || ms(L?.estimated || L?.planned);
  const mins = Math.round((t - now) / 60000);
  const when = Number.isFinite(t) ? (mins <= 0 ? 'Departing now' : mins < 60 ? `Departs in ${mins} min` : `Departs ${clock(t)}`) : '';
  let status = '';
  if (s0) status = s0.cancelled ? 'Cancelled' : !s0.depLive ? 'Scheduled' : s0.delay > 0 ? `${s0.delay} min late` : 'On time';
  const plat = s0?.platform || L?.fromPlatform;
  return [when, status, plat].filter(Boolean).join(' \u00b7 ');
}
