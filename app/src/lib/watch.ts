import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { api } from './api';
import { shortName } from './format';
import { store } from './store';
import type { Departure, Journey, Place, WatchLeg } from './types';

export type WatchSpec = { kind: 'svc' | 'trip'; title: string; legs: WatchLeg[]; origin?: Place | null; to?: Place | null; lead: number; key: string };

export const tripKey = (tripId?: string | null, planned?: string | null, line?: string) => `${tripId || line || ''}@${planned || ''}`;

export function svcSpec(d: Departure, extra: { toStopId?: string; toName?: string; arrPlanned?: string } = {}): WatchSpec {
  return {
    kind: 'svc', title: `${d.line} to ${shortName(d.dest)}`, lead: 5, key: tripKey(d.tripId, d.planned, d.line),
    legs: [{ mode: d.mode, line: d.line, tripId: d.tripId, stopId: d.stopId, toStopId: extra.toStopId || null, from: shortName(d.stopName), to: extra.toName || null,
      planned: d.planned, arrPlanned: extra.arrPlanned || null, estimated: d.estimated, fromPlatform: d.platform || '', color: d.color, towards: shortName(d.dest), destId: d.destId }],
  };
}

export function tripSpec(j: Journey, from: Place, to: Place): WatchSpec {
  const legs: WatchLeg[] = [];
  let walk = 0;
  for (const x of j.legs) {
    if (x.kind === 'walk') { walk += x.durationMin; continue; }
    legs.push({ mode: x.mode || 'bus', line: x.line || '', tripId: x.tripId, stopId: x.stopId || '', toStopId: x.toStopId, from: x.from, to: x.to, planned: x.planned || '', arrPlanned: x.arrPlanned,
      estimated: x.estimated, fromPlatform: x.fromPlatform, toPlatform: x.toPlatform, color: x.color, towards: shortName(x.towards), destId: x.destId, walkBefore: walk });
    walk = 0;
  }
  return { kind: 'trip', title: `${shortName(from.name)} to ${shortName(to.name)}`, legs, origin: from, to, lead: legs[0]?.walkBefore || 0, key: tripKey(legs[0]?.tripId, legs[0]?.planned, legs[0]?.line) };
}

export async function startWatch(spec: WatchSpec, leadExtra = 0) {
  if (!spec.legs[0]?.planned) throw new Error("This one can't be watched.");
  const r = await api.watch({ kind: spec.kind, title: spec.title, legs: spec.legs, origin: spec.origin, to: spec.to, lead: spec.lead + leadExtra });
  if (r.watch?.id) store.markWatched(spec.key, r.watch.id);
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  return r.watch?.id;
}

export async function stopWatch(id: string) {
  await api.stopWatch(id);
  store.unmarkWatched(id);
  Haptics.selectionAsync();
}

/** Toggle from a swipe or long press: start with the default lead, or stop if already watched. */
export async function toggleWatch(spec: WatchSpec, watchedId?: string) {
  try {
    if (watchedId) { await stopWatch(watchedId); return null; }
    return await startWatch(spec);
  } catch (e: any) {
    Alert.alert("Couldn't do that", String(e?.message || e));
    return null;
  }
}
