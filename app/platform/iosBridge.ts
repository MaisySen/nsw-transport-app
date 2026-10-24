// iPhone only: keeps the widgets and the trip Live Activity in step with the app.
//
// Widgets: the home screen and Lock Screen widgets load departures from the server themselves, for the
// trips and stops saved on this install's profile. This writes what they need into the app group:
// the profile id (apiProfile), starred stops (starredStops) and the fare type (tb_fare), then reloads them.
//
// Live Activity: one Lock Screen card per trip. It starts when a trip starts, follows the live times the
// trip screen already loads, says "You've arrived" at the end and goes away 2 minutes later.
//
// This file only listens. It reads the saved trip ('liveTrip'), profile and store as the app writes them,
// and the live service data the trip engine loads, so the screens need no iPhone specific code.
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { iosNative, type TripCardState } from '../modules/transport-ios';
import { api } from '@/lib/api';
import { computeLive, type LiveState } from '@/lib/liveCalc';
import type { LiveTrip } from '@/lib/live';
import type { ServiceResp, WatchLeg } from '@/lib/types';

const ARRIVED_KEEP_S = 120;
const TICK_MS = 30000;

const shortName = (n?: string | null) =>
  String(n || '').replace(/ (Station|Light Rail|Wharf)$/i, '').replace(/,.*$/, '').trim();
const platText = (p?: string | null) => (p ? p.replace(/^Platform\s*/i, 'Platform ').replace(/^Stand\s*/i, 'Stand ') : null);
const colorOf = (l: WatchLeg) => l.color || '#0A84FF';
const hhmm = (t: number) => {
  const s = new Date(t).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Australia/Sydney' });
  return s.replace(/\s/g, '').toLowerCase();
};

/** The card for a live state. Exported for tests. */
export function cardFor(g: LiveTrip, s: LiveState): TripCardState {
  const legs = g.legs;
  const last = legs[legs.length - 1];
  const destination = shortName(g.to?.name || last?.to) || null;
  if (s.done) {
    return {
      line: last?.line || '', lineColorHex: last ? colorOf(last) : '#0A84FF', mode: last?.mode || '', nextStop: null, stopsLeft: null,
      getOffAt: shortName(last?.to), arrival: s.eta, phase: 'arrived', warning: null, progress: 1,
      towards: null, platform: null, departs: null, legArrives: s.eta, destination,
    };
  }
  const l = legs[s.cur];
  const x = s.L2[s.cur];
  const d: ServiceResp | null = x?.d || null;
  const next = d && s.nextIdx >= 0 ? d.stops[s.nextIdx] : null;
  let progress = 0;
  if (s.phase === 'ride') {
    const span = x.arr - x.dep;
    progress = span > 0 ? Math.min(1, Math.max(0, (Date.now() - x.dep) / span)) : 0;
  }
  let warning: string | null = null;
  const c = s.conns.find((k) => k.i === s.cur) || s.conns[0];
  if (c && c.risk === 'miss') warning = `You'll likely miss the ${hhmm(c.nextDep)} ${c.next.line}`;
  else if (c && c.risk === 'tight') warning = `Tight change at ${shortName(c.at)}`;
  return {
    line: l.line, lineColorHex: colorOf(l), mode: l.mode,
    nextStop: s.phase === 'wait' ? shortName(l.from) || null : next ? shortName(next.name) : null,
    stopsLeft: s.stopsLeft, getOffAt: shortName(l.to), arrival: s.eta, phase: s.phase, warning, progress,
    towards: shortName(l.towards || d?.dest) || null, platform: platText(l.fromPlatform),
    departs: Number.isFinite(x.dep) ? x.dep : null, legArrives: Number.isFinite(x.arr) ? x.arr : null, destination,
  };
}

if (Platform.OS === 'ios' && iosNative.available()) {
  // Live service responses per leg, as the trip engine loads them.
  const svcByKey = new Map<string, ServiceResp>();
  const keyOf = (q: Record<string, string | undefined>) => [q.trip || '', q.line || '', q.stop || '', q.planned || ''].join('|');
  const legKey = (l: WatchLeg) => [l.tripId || '', l.line || '', l.stopId || '', l.planned || ''].join('|');
  const origService = api.service;
  (api as any).service = async (q: Record<string, string | undefined>) => {
    const r = await origService(q);
    if (r && !r.error) { svcByKey.set(keyOf(q), r); setTimeout(() => refreshCard(), 0); }
    return r;
  };

  let trip: LiveTrip | null = null;
  let activityId: string | null = null;
  let activityTrip: string | null = null;
  let lastJSON = '';
  let starting = false;

  const stateFor = (g: LiveTrip) =>
    computeLive(g.legs, g.legs.map((l) => svcByKey.get(legKey(l)) || null), Date.now(), { rode: g.rode, arrivedAt: g.arrivedAt });

  async function refreshCard() {
    const g = trip;
    if (!g) return;
    if (!iosNative.activitiesEnabled() && !activityId) return;
    const s = stateFor(g);
    const card = cardFor(g, s);
    const stale = card.phase === 'arrived' ? null : card.arrival + ARRIVED_KEEP_S * 1000;
    if (!activityId || activityTrip !== g.id) {
      if (starting || card.phase === 'arrived') return;
      starting = true;
      try {
        activityId = await iosNative.startTrip(g.title || `${shortName(g.origin?.name)} to ${shortName(g.to?.name)}`, g.legs.length, card, stale);
        activityTrip = activityId ? g.id : null;
        lastJSON = JSON.stringify(card);
      } finally { starting = false; }
      return;
    }
    const j = JSON.stringify({ ...card, progress: Math.round(card.progress * 20) / 20 });
    if (j === lastJSON) return;
    lastJSON = j;
    if (card.phase === 'arrived') {
      await iosNative.endTrip(activityId, card, ARRIVED_KEEP_S);
      activityId = null;
      return;
    }
    const ok = await iosNative.updateTrip(activityId, card, stale);
    if (!ok) { activityId = null; activityTrip = null; }
  }

  async function onTrip(g: LiveTrip | null) {
    const prev = trip;
    trip = g;
    if (g) { refreshCard(); return; }
    // The trip ended: an arrived trip keeps its card for 2 minutes, a trip ended by hand goes at once.
    if (prev?.arrivedAt) {
      const s = stateFor({ ...prev });
      await iosNative.endTrip(activityId, cardFor(prev, s), ARRIVED_KEEP_S);
    } else {
      await iosNative.endTrip(null, null, 0);
    }
    activityId = null; activityTrip = null; lastJSON = '';
  }

  // Widget data.
  async function shareWidgetData() {
    try {
      const [profile, store] = await Promise.all([AsyncStorage.getItem('profile'), AsyncStorage.getItem('store')]);
      if (profile) iosNative.setString('apiProfile', profile);
      if (store) {
        const st = JSON.parse(store);
        const starred = Array.isArray(st?.starred) ? st.starred.filter((p: any) => p?.id).map((p: any) => ({ id: String(p.id), name: String(p.name || '') })) : [];
        iosNative.setJSON('starredStops', starred);
        if (st?.fareType) iosNative.setString('tb_fare', String(st.fareType));
      } else {
        iosNative.setJSON('starredStops', []);
      }
      iosNative.reloadWidgets();
    } catch {}
  }

  // Follow the app's own writes.
  const WATCH = new Set(['liveTrip', 'profile', 'store']);
  let widgetTimer: ReturnType<typeof setTimeout> | null = null;
  const onWrite = (key: string, value: string | null) => {
    if (key === 'liveTrip') {
      let g: LiveTrip | null = null;
      try { g = value ? JSON.parse(value) : null; } catch {}
      onTrip(g);
    } else if (!widgetTimer) {
      widgetTimer = setTimeout(() => { widgetTimer = null; shareWidgetData(); }, 1500);
    }
  };
  const S = AsyncStorage as any;
  const setItem = S.setItem.bind(AsyncStorage);
  const removeItem = S.removeItem.bind(AsyncStorage);
  const multiRemove = S.multiRemove?.bind(AsyncStorage);
  const clear = S.clear?.bind(AsyncStorage);
  S.setItem = async (k: string, v: string, cb?: any) => { const r = await setItem(k, v, cb); if (WATCH.has(k)) onWrite(k, v); return r; };
  S.removeItem = async (k: string, cb?: any) => { const r = await removeItem(k, cb); if (WATCH.has(k)) onWrite(k, null); return r; };
  if (multiRemove) S.multiRemove = async (ks: string[], cb?: any) => { const r = await multiRemove(ks, cb); ks.filter((k) => WATCH.has(k)).forEach((k) => onWrite(k, null)); return r; };
  if (clear) S.clear = async (cb?: any) => { const r = await clear(cb); ['liveTrip', 'store'].forEach((k) => onWrite(k, null)); return r; };

  async function boot() {
    try {
      const raw = await AsyncStorage.getItem('liveTrip');
      trip = raw ? JSON.parse(raw) : null;
    } catch { trip = null; }
    // A card left from an earlier run belongs to this trip, or to none.
    const ids = iosNative.activityIds();
    if (trip && ids.length) { activityId = ids[0]; activityTrip = trip.id; }
    else if (!trip && ids.length) await iosNative.endTrip(null, null, 0);
    shareWidgetData();
    refreshCard();
  }

  boot();
  setInterval(() => { if (trip && AppState.currentState === 'active') refreshCard(); }, TICK_MS);
  AppState.addEventListener('change', (s) => { if (s === 'active') { shareWidgetData(); refreshCard(); } });
}
