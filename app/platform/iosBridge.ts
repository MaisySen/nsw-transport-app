// iPhone only: keeps the widgets and the trip Live Activity in step with the app.
//
// Widgets: the home screen and Lock Screen widgets load departures from the server themselves, for the
// trips and stops saved on this install's profile. This writes what they need into the app group:
// the profile id (apiProfile), starred stops (starredStops), the fare type (tb_fare), Home and Work with the
// trips saved on this phone (homeWork) and the card of a trip in progress (liveCard), then reloads them.
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
import { computeLive } from '@/lib/liveCalc';
import type { LiveTrip } from '@/lib/live';
import type { ServiceResp, WatchLeg } from '@/lib/types';
import { boardTime, missedConn, missedPlanLegs, pickNextOption, sydHHMM } from '@/lib/smart';
import { cardFor, shortName, staleAt, type CardAlt, type CardOpts } from './tripCard';
import { homeWorkFor, liveCardFor } from './widgetShare';

const ARRIVED_KEEP_S = 120;
const TICK_MS = 30000;

if (Platform.OS === 'ios' && iosNative.available()) {
  // Live service responses per leg, as the trip engine loads them.
  const svcByKey = new Map<string, ServiceResp>();
  const keyOf = (q: Record<string, string | undefined>) => [q.trip || '', q.line || '', q.stop || '', q.planned || ''].join('|');
  const legKey = (l: WatchLeg) => [l.tripId || '', l.line || '', l.stopId || '', l.planned || ''].join('|');
  const origService = api.service;
  (api as any).service = async (q: Record<string, string | undefined>) => {
    const r = await origService(q);
    if (r && !r.error) { svcByKey.set(keyOf(q), r); lastSvcAt = Date.now(); setTimeout(() => refreshCard(), 0); }
    return r;
  };

  let lastSvcAt = 0;
  // The card can only change while the app runs (no push updates yet). Builds whose card shows "Updated" when stale
  // get a stale date 2 minutes after the live times; older builds get "Updated 8:21am" written on the card itself
  // when the app goes to the background.
  const honestStale = iosNative.cardVersion() >= 2;

  // The next service for a change the live times say you will miss, from the same plan the trip screen shows.
  let alt: { key: string; at: number; v: CardAlt | null; busy: boolean } = { key: '', at: 0, v: null, busy: false };
  function altFor(g: LiveTrip, s: ReturnType<typeof stateFor>): CardAlt | null {
    const m = s.done ? null : missedConn(g.legs, s, g.to);
    if (!m) return null;
    const key = `${g.id}:${m.i}:${m.missing.tripId || m.missing.planned}`;
    if (alt.key !== key || (!alt.busy && Date.now() - alt.at > 60000)) {
      if (alt.key !== key) alt = { key, at: 0, v: null, busy: false };
      alt.busy = true; alt.at = Date.now();
      api.plan(missedPlanLegs(m) as any, { count: 5, time: sydHHMM(m.readyAt - 60000) })
        .then((r: any) => {
          const j = pickNextOption(r?.journeys || [], m);
          const l = j?.legs.find((x) => x.kind === 'transit');
          if (alt.key === key) alt.v = j && l ? { line: l.line || '', dep: boardTime(j), arr: Date.parse(j.arrive) } : null;
        })
        .catch(() => {})
        .finally(() => { if (alt.key === key) { alt.busy = false; refreshCard(); } });
    }
    return alt.v;
  }

  let trip: LiveTrip | null = null;
  let activityId: string | null = null;
  let activityTrip: string | null = null;
  let lastJSON = '';
  let starting = false;

  const stateFor = (g: LiveTrip) =>
    computeLive(g.legs, g.legs.map((l) => svcByKey.get(legKey(l)) || null), Date.now(), { rode: g.rode, arrivedAt: g.arrivedAt });

  async function refreshCard(background = false) {
    const g = trip;
    if (!g) return;
    const s = stateFor(g);
    const updated = lastSvcAt || null;
    const o: CardOpts = { alt: altFor(g, s), updated, asOf: background && !honestStale ? updated || Date.now() : null };
    if (!iosNative.activitiesEnabled() && !activityId) { shareLive(g, cardFor(g, s, Date.now(), o)); return; }
    const card = cardFor(g, s, Date.now(), o);
    shareLive(g, card);
    const stale = staleAt(card, updated, honestStale, ARRIVED_KEEP_S * 1000);
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

  // The Next trip widget follows a trip in progress. Reload it only when the words on it change.
  let liveKey = '';
  function shareLive(g: LiveTrip | null, card: TripCardState | null) {
    if (!g || !card) {
      if (liveKey) { liveKey = ''; iosNative.setJSON('liveCard', null); iosNative.reloadWidgets('NextTrip'); }
      return;
    }
    const share = liveCardFor(g.title || `${shortName(g.origin?.name)} to ${shortName(g.to?.name)}`, card, ARRIVED_KEEP_S * 1000);
    iosNative.setJSON('liveCard', share);
    const k = [card.phase, card.line, card.getOffAt, card.departs, card.legArrives, card.platform].join('|');
    if (k !== liveKey) { liveKey = k; iosNative.reloadWidgets('NextTrip'); }
  }

  async function onTrip(g: LiveTrip | null) {
    const prev = trip;
    trip = g;
    if (!g) shareLive(null, null);
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
        iosNative.setJSON('homeWork', homeWorkFor(st));
      } else {
        iosNative.setJSON('starredStops', []);
        iosNative.setJSON('homeWork', homeWorkFor(null));
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
    if (!trip) iosNative.setJSON('liveCard', null);
    shareWidgetData();
    refreshCard();
  }

  boot();
  setInterval(() => { if (trip && AppState.currentState === 'active') refreshCard(); }, TICK_MS);
  // Going to the background: the last chance to say on the card when its live times are from.
  AppState.addEventListener('change', (s) => { if (s === 'active') { shareWidgetData(); refreshCard(); } else if (s === 'background') refreshCard(true); });
}
