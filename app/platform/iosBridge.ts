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
import { AppState, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { iosNative, type TripCardState } from '../modules/transport-ios';
import { api } from '@/lib/api';
import { computeLive } from '@/lib/liveCalc';
import type { LiveTrip } from '@/lib/live';
import type { ServiceResp, WatchLeg } from '@/lib/types';
import { boardTime, missedConn, missedPlanLegs, pickNextOption, sydHHMM } from '@/lib/smart';
import { cardFor, shortName, staleAt, type CardAlt, type CardOpts } from './tripCard';
import { homeWorkFor, liveCardFor, starredFor, type HomeWork, type LiveCardShare, type SharedStop } from './widgetShare';
import { watchContextFor, watchContextJSON } from './watchShare';
import { apiBase } from '@/lib/server';
import { endActivityToken, sendActivityToken, sendDeviceToken } from './livePush';
import { pendingOpenURL } from './intentInboxCore';
import { startAppPoll } from '@/lib/activity';
import { appMayWriteCard } from '@/lib/liveFreshCore';
import { phone24h } from '@/lib/rowTime';

const ARRIVED_KEEP_S = 120;
const TICK_MS = 30000;
/** Leaving the app reloads the widgets only when the last reload from the app is older than this. */
const WIDGET_LEAVE_RELOAD_MS = 120000;

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
  // Up to build 204 the card can only change while the app runs; from 205 the server also updates it by push. Builds whose card shows "Updated" when stale
  // get a stale date 2 minutes after the live times; older builds get "Updated 8:21am" written on the card itself
  // when the app goes to the background.
  // Native card version 3 (build 212) draws Due and Now itself and is also redrawn at the get off moment (staleAt).
  const cardV = iosNative.cardVersion();
  const honestStale = cardV >= 2;

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
  // Build 205 and later: the card's push token, so the server can update it while the phone is locked.
  const tokens = new Map<string, string>();
  let activityToken: string | null = null;
  const tokenFor = (id: string | null) => (id ? tokens.get(id) || iosNative.activityPushToken(id) : null);
  function shareToken() {
    if (!activityId || !trip || activityTrip !== trip.id) return;
    activityToken = tokenFor(activityId);
    if (activityToken) sendActivityToken(activityId, activityToken, trip);
  }
  function dropToken() {
    const t = activityToken;
    activityToken = null;
    if (t) endActivityToken(t);
  }
  iosNative.onActivityPushToken((id, token) => { tokens.set(id, token); if (id === activityId) shareToken(); });

  // The one trip state (tripState.ts, phase 2): times from when the live answers were loaded (lastSvcAt), the planner
  // estimate from Start trip with its own age, legs finished by live evidence (here) kept, words on the phone's clock.
  const stateFor = (g: LiveTrip) =>
    computeLive(g.legs, g.legs.map((l) => svcByKey.get(legKey(l)) || null), Date.now(), { rode: g.rode, here: g.here, arrivedAt: g.arrivedAt }, null,
      { asOf: lastSvcAt || null, plannerAt: g.started ?? null, c24: phone24h() });

  async function refreshCard(background = false) {
    const g = trip;
    if (!g) return;
    const s = stateFor(g);
    const updated = lastSvcAt || null;
    // updated is always sent (G7): a stale card then reads "Updated 7:47pm", never "You've arrived".
    const o: CardOpts = { alt: altFor(g, s), updated: updated || g.started || Date.now(), asOf: background && !honestStale ? updated || Date.now() : null, c24: phone24h() };
    if (!iosNative.activitiesEnabled() && !activityId) { shareLive(g, cardFor(g, s, Date.now(), o)); return; }
    const card = cardFor(g, s, Date.now(), o);
    shareLive(g, card);
    const stale = staleAt(card, card.updated ?? updated, cardV, ARRIVED_KEEP_S * 1000);
    if (!activityId || activityTrip !== g.id) {
      if (starting || card.phase === 'arrived') return;
      starting = true;
      try {
        activityId = await iosNative.startTrip(g.title || `${shortName(g.origin?.name)} to ${shortName(g.to?.name)}`, g.legs.length, card, stale);
        activityTrip = activityId ? g.id : null;
        lastJSON = JSON.stringify(card);
      } finally { starting = false; }
      shareToken();
      return;
    }
    shareToken();
    // While the server pushes this card, older times of the app's own (back in front after a while) do not overwrite
    // what it pushed; the engine's fresh answer a moment later writes the card (liveFreshCore.ts).
    if (!appMayWriteCard({ background, pushing: !!activityToken, lastSvcAt, now: Date.now() })) return;
    const j = JSON.stringify({ ...card, progress: Math.round(card.progress * 20) / 20 });
    if (j === lastJSON) return;
    lastJSON = j;
    if (card.phase === 'arrived') {
      await iosNative.endTrip(activityId, card, ARRIVED_KEEP_S);
      activityId = null;
      dropToken();
      return;
    }
    const ok = await iosNative.updateTrip(activityId, card, stale);
    if (!ok) { activityId = null; activityTrip = null; dropToken(); }
  }

  // What is shared with the widgets and the Live Activity's app group is written once per change (g13, 26 Oct): each
  // key keeps the last value written, and the same value again is not written (before, Home, starred stops and the
  // trip card were written on every store write and every card tick, and every widget reloaded with them).
  const sharedLast = new Map<string, string>();
  const putJSON = (k: string, v: any): boolean => {
    const j = JSON.stringify(v ?? null);
    if (sharedLast.get(k) === j) return false;
    sharedLast.set(k, j); iosNative.setJSON(k, v); return true;
  };
  const putString = (k: string, v: string): boolean => {
    if (sharedLast.get(k) === 's:' + v) return false;
    sharedLast.set(k, 's:' + v); iosNative.setString(k, v); return true;
  };

  // The Next trip widget follows a trip in progress. Reload it only when the words on it change.
  let liveKey = '';
  function shareLive(g: LiveTrip | null, card: TripCardState | null) {
    if (!g || !card) {
      if (liveKey) { liveKey = ''; putJSON('liveCard', null); iosNative.reloadWidgets('NextTrip'); }
      watchData.live = null; shareWatch();
      return;
    }
    const share = liveCardFor(g.title || `${shortName(g.origin?.name)} to ${shortName(g.to?.name)}`, card, ARRIVED_KEEP_S * 1000);
    putJSON('liveCard', share);
    watchData.live = share; shareWatch();
    const k = [card.phase, card.line, card.getOffAt, card.departs, card.legArrives, card.platform].join('|');
    if (k !== liveKey) { liveKey = k; iosNative.reloadWidgets('NextTrip'); }
  }

  async function onTrip(g: LiveTrip | null) {
    const prev = trip;
    trip = g;
    cardPoll.setEnabled(!!g);
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
    dropToken();
  }

  // Apple Watch (builds with the watch app): Home, Work, starred stops and the trip card, sent when they change.
  const watchData: { profile: string | null; hw: HomeWork; starred: SharedStop[]; live: LiveCardShare | null } =
    { profile: null, hw: homeWorkFor(null), starred: [], live: null };
  let watchJSON = '';
  let watchTimer: ReturnType<typeof setTimeout> | null = null;
  // Sent at most once every 2 seconds, and only when the context differs from the last one sent.
  function shareWatch() {
    if (!iosNative.hasWatch() || watchTimer) return;
    watchTimer = setTimeout(() => {
      watchTimer = null;
      const c = watchContextFor(apiBase(), watchData.profile, watchData.hw, watchData.starred, watchData.live);
      if (!c) return;
      const j = watchContextJSON(c);
      if (j === watchJSON) return;
      if (iosNative.sendWatch(j)) watchJSON = j;
    }, 2000);
  }

  // Widget data. The widgets reload when something on them changed, and each time the app comes to the front
  // (force); a store write that changed nothing they show (a recent search, a setting) no longer reloads them.
  // When the widgets were last reloaded from here. Leaving the app reloads them once more when that was over 2 minutes
  // ago, so their hour of minute entries starts from fresh times as you lock the phone (30 Oct, widget refresh fix;
  // works on every build, reloadWidgets is in all of them).
  let widgetsReloadedAt = 0;
  function reloadWidgetsOnLeave(now = Date.now()) {
    if (now - widgetsReloadedAt < WIDGET_LEAVE_RELOAD_MS) return;
    widgetsReloadedAt = now;
    iosNative.reloadWidgets();
  }

  async function shareWidgetData(force = false) {
    try {
      const [profile, store] = await Promise.all([AsyncStorage.getItem('profile'), AsyncStorage.getItem('store')]);
      let changed = false;
      if (profile) changed = putString('apiProfile', profile) || changed;
      // The server the app uses now, so Siri and the widgets ask the same one.
      changed = putString('apiBase.v1', apiBase()) || changed;
      if (store) {
        const st = JSON.parse(store);
        const starred = starredFor(st);
        const hw = homeWorkFor(st);
        changed = putJSON('starredStops', starred) || changed;
        if (st?.fareType) changed = putString('tb_fare', String(st.fareType)) || changed;
        changed = putJSON('homeWork', hw) || changed;
        watchData.starred = starred; watchData.hw = hw;
      } else {
        changed = putJSON('starredStops', []) || changed;
        changed = putJSON('homeWork', homeWorkFor(null)) || changed;
        watchData.starred = []; watchData.hw = homeWorkFor(null);
      }
      watchData.profile = profile || null;
      if (changed || force) iosNative.reloadWidgets();
      if (changed || force) widgetsReloadedAt = Date.now();
      shareWatch();
    } catch {}
  }

  // Follow the app's own writes.
  const WATCH = new Set(['liveTrip', 'profile', 'store', 'apiBase']);
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

  const cardPoll = startAppPoll(() => { if (trip) refreshCard(); return true; }, TICK_MS, { runAtStart: false });
  cardPoll.setEnabled(false);

  async function boot() {
    try {
      const raw = await AsyncStorage.getItem('liveTrip');
      trip = raw ? JSON.parse(raw) : null;
    } catch { trip = null; }
    // A card left from an earlier run belongs to this trip, or to none.
    const ids = iosNative.activityIds();
    if (trip && ids.length) { activityId = ids[0]; activityTrip = trip.id; }
    else if (!trip && ids.length) await iosNative.endTrip(null, null, 0);
    if (!trip) putJSON('liveCard', null);
    shareWidgetData();
    refreshCard();
    sendDeviceToken();
  }

  // "Start my commute" from Siri or Shortcuts (build 206 and later) leaves a link in the app group and opens
  // the app. It is read when the app comes to the front, a moment later in case Siri writes it after that, and
  // at once when the app was already open.
  const takePending = () => {
    const url = pendingOpenURL(iosNative.takeString('intentPendingOpen'), Date.now());
    if (url) Linking.openURL(url).catch(() => {});
  };
  const checkPending = () => { takePending(); setTimeout(takePending, 800); setTimeout(takePending, 2500); };
  iosNative.onIntentQueued(takePending);

  boot();
  checkPending();
  // The card refresh runs only while a trip is on and the app is in front; in the background push moves the card.
  cardPoll.setEnabled(!!trip);
  // Going to the background: the last chance to say on the card when its live times are from.
  AppState.addEventListener('change', (s) => { if (s === 'active') { checkPending(); shareWidgetData(true); refreshCard(); sendDeviceToken(); } else if (s === 'background') { refreshCard(true); reloadWidgetsOnLeave(); } });
}
