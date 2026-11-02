// The trip you are on now: one at a time, kept on this phone. Started from a trip's Start trip button.
import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { api } from './api';
import { phone24h } from './rowTime';
import { enablePush, getPushState } from './push';
import type { Fare, Place, WatchLeg } from './types';
import type { WatchSpec } from './watch';
import { wakeId } from './smart';
import { getOffId, readGetOff, readGetOffSay } from './getOffCore';
import { cancelGetOff, serverGetOff, setServerGetOffWatch, setTripWatch, soundChannels, voiceClips } from './getOffNotify';
import { cancelLeave, cancelWake } from './smartNotify';
import { startCancels } from './noteShowCore';
import { iosNative } from '../../modules/transport-ios';
import { wantOngoing } from './leaveByCore';
import { store } from './store';
import { hasSpeech } from './nativeExtras';
import { AppState } from 'react-native';
import { getDevice, PROFILE } from './device';
import { NEW_API_BASE } from './server';
import { regKeyFor, regNextAt, regOutcome, serverKeepsKeys, stopEntry, watchEntry, type RegOutcome } from './tripRegCore';

export type LiveShare = { id: string; key: string; url: string; pos: boolean };
export type LiveTrip = {
  id: string; title: string; origin: Place | null; to: Place | null; legs: WatchLeg[]; fare: Fare | null; started: number;
  alerted: Record<string, 1>; share: LiveShare | null; watchId: string | null; loc?: boolean;
  /** Arrival time of each leg while it was being ridden, and when the trip arrived. See LiveMemo. */
  rode?: Record<number, number>; arrivedAt?: number | null;
  /** When you got off each leg, by your tap or your location (LiveMemo.here). */
  here?: Record<number, number>;
  /** Wake me before my stop: on, and when each leg's alarm is set for (leg index to time). */
  wake?: boolean; wakeSet?: Record<string, number>;
  /** Get off alerts (getOffCore.ts) set on the phone: alert key to the time it is set for. */
  offSet?: Record<string, number>;
  /** Get off alerts set on the phone with a spoken sound (getOffCore offVoice): already said when they ring. */
  offVoice?: Record<string, 1>;
  /** Get off alerts set from the phone's position (getOffCore offRegion, rnow<leg> and rsoon<leg>, 31 Oct). */
  offRegion?: Record<string, string>;
  /** The server sends Get off now for this trip (build 210; its watch said getOff: true): not set on the phone. */
  offServer?: boolean;
  /** Say trip alerts out loud (builds with the speech module), and the alerts already read out. */
  speak?: boolean; spoken?: Record<string, 1>;
  /** The trip state's memory (tripState.TripMemory, phase 2): phases from the live train and the calm steps rung. */
  flow?: import('./tripState').TripMemory;
  /** The key this trip's watch is registered under (tripRegCore.ts, 1 Nov): the same key on every try. */
  regKey?: string;
};

const KEY = 'liveTrip';
const NOTE = 'live-trip';
let cur: LiveTrip | null = null;
let loaded = false;
const subs = new Set<() => void>();

async function load() {
  if (loaded) return;
  loaded = true;
  try { const raw = await AsyncStorage.getItem(KEY); if (raw) cur = JSON.parse(raw); } catch {}
  subs.forEach((f) => f());
}
export function setLive(g: LiveTrip | null) {
  cur = g;
  if (g) AsyncStorage.setItem(KEY, JSON.stringify(g)).catch(() => {});
  else AsyncStorage.removeItem(KEY).catch(() => {});
  subs.forEach((f) => f());
}
export const getLive = () => cur;
export async function loadLive() { await load(); return cur; }

export function useLiveTrip() {
  useEffect(() => { load(); }, []);
  return useSyncExternalStore((l) => { subs.add(l); return () => subs.delete(l); }, () => cur, () => cur);
}

// Speak alerts stays as you last set it (Settings store), on builds that can speak.
function speakDefault(): boolean {
  try { return store.speakOn() && hasSpeech(); } catch { return false; }
}

/** Starts tracking a planned trip. Starting another trip ends the first. */
export async function startLive(spec: WatchSpec, fare?: Fare | null) {
  await load();
  const legs = spec.legs.filter((l) => l.stopId && l.planned).slice(0, 6);
  if (!legs.length) throw new Error("This trip can't be tracked.");
  if (cur) await endLive();
  const g: LiveTrip = { id: 'g' + Date.now().toString(36), title: spec.title, origin: spec.origin || null, to: spec.to || null, legs, fare: fare && fare.total != null ? fare : null,
    started: Date.now(), alerted: {}, share: null, watchId: null, ...(speakDefault() ? { speak: true } : {}) };
  setLive(g);
  // Start trip means you have left (31 Oct, Bidur: "Leave now, 0 min away" rang during the ride): the phone's own
  // departure reminders for it come off at once.
  takeBackLeave(g).catch(() => {});
  // The ongoing notification starts with the trip: ask for notifications once, if never asked, then let the
  // server follow the trip. This runs after Start trip has returned, so the live trip opens at once and the
  // button never waits on the permission dialog or the network.
  (async () => {
    if (Platform.OS !== 'web') {
      try { const ps = await getPushState(); if (ps.status === 'off') await enablePush(false); } catch {}
    }
    await liveWatch();
  })().catch(() => {});
  return g;
}

/** The Remind me leave alert, and the Last way home reminder when this trip goes where it was for (noteShowCore). */
async function takeBackLeave(g: LiveTrip) {
  let lastHome: any = null;
  try { lastHome = await (await import('./lastHome')).lastLocalItem(); } catch {}
  const leave = !!store.snapshot().leaveReminder;
  for (const c of startCancels({ to: g.to, legs: g.legs }, { leave, lastHome })) {
    if (c === 'leave') { await cancelLeave(); store.setLeaveReminder(null); }
    else if (c === 'lastHome') { try { await (await import('./lastHome')).cancelLastLocal(); } catch {} }
  }
}

/** What an api error means for a registration (tripRegCore.regOutcome): its status, a time out, or no connection. */
function outcomeOf(e: any): RegOutcome {
  if (e && typeof e.http === 'number') return regOutcome(e.http);
  if (e && e.slow) return regOutcome('timeout');
  return regOutcome('offline');
}

// The trip watch is asked again until the server has it (1 Nov, real-time harness #3): once at Start trip was all, so no
// signal or a server blip at that moment meant no server alerts, Get off now among them, for the whole trip.
const wreg = { trip: '', tries: 0, started: 0, timer: null as ReturnType<typeof setTimeout> | null, busy: false, keeps: false };
function retryLater(at: number | null) {
  if (wreg.timer) { clearTimeout(wreg.timer); wreg.timer = null; }
  if (at == null) return;
  wreg.timer = setTimeout(() => { wreg.timer = null; if (AppState.currentState === 'active') liveWatch().catch(() => {}); }, Math.max(1000, at - Date.now()));
}
let appStateHooked = false;
function hookAppState() {
  if (appStateHooked) return;
  appStateHooked = true;
  // Back in front: a registration still unanswered goes again at once (the phone may have been locked through the tries).
  try { AppState.addEventListener('change', (st) => { if (st === 'active') { const g = cur; if (g && !g.watchId && !g.arrivedAt) liveWatch().catch(() => {}); } }); } catch {}
}

/** The phone's own Get off now alerts set for this trip (the ones that come off once the server sends it). */
function phoneGetOffIds(g: LiveTrip): string[] {
  return [...Object.keys(g.offSet || {}).filter((k) => /^(gnow|quiet)\d+$/.test(k)), ...Object.keys(g.offRegion || {}).filter((k) => /^rnow\d+$/.test(k))].map((k) => getOffId(g.id, k));
}

/** With notifications on, the server also sends next stop, change and connection alerts while the app is closed. */
export async function liveWatch() {
  const g0 = cur;
  if (!g0 || g0.watchId || g0.arrivedAt || wreg.busy) return;
  const ps = await getPushState();
  if (ps.status !== 'on' && ps.status !== 'local') return;
  hookAppState();
  // The key: made once for this registration and kept on the live trip, so every try (here, the native queue, a
  // retry after a time out) is the same watch on the server.
  let g = g0;
  if (!g.regKey) { g = { ...g, regKey: regKeyFor(g.id + Date.now().toString(36).slice(-4), await getDevice().catch(() => '')) }; if (cur && cur.id === g.id) setLive({ ...cur, regKey: g.regKey }); }
  const key = g.regKey as string;
  if (wreg.trip !== key) { wreg.trip = key; wreg.tries = 0; wreg.started = Date.now(); retryLater(null); }
  // voice: this build has the spoken alert sounds and Speak alerts is on, so the server's "Next stop" alert rings with
  // "Your stop is coming up" (heard with the phone locked). Older builds never send it and get the normal sound.
  // Android: the server's alert names the spoken sound's channel, so it is made first (made once).
  const voice = voiceClips() && !!g.speak && (await soundChannels()) ? { voice: 'soon' } : {};
  // Get off now from the server (30 Oct, build 210): with a native push token and Get off now on, the watch asks the
  // server to send it from live times (getOff), with the spoken sound when the phone's own would have it (getOffVoice).
  // Set on the phone at the last open, it rang early when the bus ran late after the phone locked.
  let off = {};
  try {
    if (ps.status === 'on' && serverGetOff() && readGetOff(store.getOff()).now) {
      const say = voiceClips() && (readGetOffSay(store.getOffSay()) || !!g.speak) && (await soundChannels());
      off = { getOff: 1, ...(say ? { getOffVoice: 1 } : {}) };
    }
  } catch { off = {}; }
  // tripFlow 2 (phase 2): the server runs the new trip flow for this watch when its tripflow2 switch is on; c24: its
  // words follow the phone's 12 or 24 hour clock; started: when the planner estimate on the legs was read.
  const body = { kind: 'trip', title: g.title, legs: g.legs, origin: g.origin, to: g.to, lead: 0, track: true, silentStart: true, ...voice, ...off,
    tripFlow: 2, c24: phone24h(), ...(typeof g.started === 'number' ? { started: g.started } : {}), key };
  // iPhone, builds with the native queue: a copy waits there (20 s) in case this app is suspended before it hears back;
  // sent by a background upload while locked, with the phone's own Get off now to take off if the server says yes.
  if (Platform.OS === 'ios') iosNative.outboxPut('watch', watchEntry({ ...body, device: await getDevice().catch(() => ''), profile: PROFILE || undefined }, Date.now(), phoneGetOffIds(g)), NEW_API_BASE);
  wreg.busy = true;
  wreg.tries++;
  let r: any = null, out: RegOutcome = 'retry';
  try { r = await api.watch(body); out = 'ok'; } catch (e) { out = outcomeOf(e); } finally { wreg.busy = false; }
  if (out !== 'ok') {
    // A time out may have reached the server: asked again with the same key only from a server that keeps one watch
    // per key (an older one would make two). A 4xx is never asked again.
    const next = out === 'unknown' && !wreg.keeps ? null : regNextAt(wreg.tries, out, Date.now(), wreg.started);
    retryLater(next);
    if (out === 'gone' && Platform.OS === 'ios') iosNative.outboxTake('watch');
    return;
  }
  retryLater(null);
  if (Platform.OS === 'ios') iosNative.outboxTake('watch');
  if (serverKeepsKeys(r, key)) wreg.keeps = true;
  if (r && r.watch === null && r.ended) return; // this trip already ended on the server
  if (!r?.watch?.id) return;
  if (cur && cur.id === g.id && !cur.arrivedAt) {
    // The server said yes: the phone's own Get off now comes off now, before the phone is locked (getOffCore server).
    // (tripRegCore.keepPhoneGetOff: the phone's own stay until the server said yes with getOff true)
    const server = (r.watch as any).getOff === true && 'getOff' in off;
    const offSet = { ...(cur.offSet || {}) };
    if (server) for (const k of Object.keys(offSet)) if (/^(gnow|quiet)\d+$/.test(k)) { cancelGetOff(getOffId(cur.id, k)).catch(() => {}); delete offSet[k]; }
    // The server sends Get off now from the live times: the location alert for it comes off too (one voice, 31 Oct).
    const offRegion = { ...(cur.offRegion || {}) };
    if (server) for (const k of Object.keys(offRegion)) if (/^rnow\d+$/.test(k)) { cancelGetOff(getOffId(cur.id, k)).catch(() => {}); delete offRegion[k]; }
    if (server) setServerGetOffWatch(r.watch.id);
    setLive({ ...cur, regKey: key, watchId: r.watch.id, ...(server ? { offServer: true, offSet, offRegion } : { offServer: false }) });
  } else api.stopWatch(r.watch.id, key).catch(() => {});
}

/**
 * End trip stops the server's alerts even when Start trip never heard back (1 Nov, harness #4: a watch the app took as
 * failed kept alerting after End trip): by the key, the id when known, asked again until the server answers.
 */
async function stopServerWatch(id: string | null, key: string | null) {
  if (!id && !key) return;
  if (Platform.OS === 'ios') {
    iosNative.outboxTake('watch');
    if (key) iosNative.outboxPut('stop', stopEntry(await getDevice().catch(() => ''), key, id, Date.now()), NEW_API_BASE);
  }
  for (let i = 1; i <= 4; i++) {
    try { await api.stopWatch(id, key || undefined); if (Platform.OS === 'ios') iosNative.outboxTake('stop'); return; }
    catch (e) { if (outcomeOf(e) === 'gone') { if (Platform.OS === 'ios') iosNative.outboxTake('stop'); return; } }
    await new Promise((res) => setTimeout(res, regNextAt(i, 'retry', 0, 0)! ));
  }
}

/** Ends the trip: stops the share link and the server alerts, removes the ongoing notification. */
export async function endLive() {
  const g = cur;
  if (!g) return null;
  if (g.share) api.shareEnd(g.share.id, g.share.key).catch(() => {});
  retryLater(null); wreg.trip = '';
  if (g.watchId || g.regKey) stopServerWatch(g.watchId, g.regKey || null).catch(() => {});
  // Wake alarms still set for this trip never ring after it ends.
  for (const k of Object.keys(g.wakeSet || {})) cancelWake(wakeId(g.id, Number(k))).catch(() => {});
  for (const k of Object.keys(g.offSet || {})) cancelGetOff(getOffId(g.id, k)).catch(() => {});
  for (const k of Object.keys(g.offRegion || {})) cancelGetOff(getOffId(g.id, k)).catch(() => {});
  setTripWatch(null, false);
  setServerGetOffWatch(null);
  setLive(null);
  await clearOngoing();
  return g;
}

/** Android: a quiet channel for the ongoing trip notification, and its Share and End trip buttons. */
export async function setupLiveNotifications() {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Trip alerts', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 200, 120, 200], lightColor: '#0A84FF',
      });
      await Notifications.setNotificationChannelAsync(NOTE, {
        name: 'Trip in progress', description: 'Next stop and arrival time while you are on a trip',
        importance: Notifications.AndroidImportance.DEFAULT, sound: null, vibrationPattern: [0], enableVibrate: false, showBadge: false,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
    }
    await Notifications.setNotificationCategoryAsync(NOTE, [
      { identifier: 'share', buttonTitle: 'Share', options: { opensAppToForeground: true } },
      { identifier: 'end', buttonTitle: 'End trip', options: { opensAppToForeground: true, isDestructive: true } },
    ]);
  } catch {}
  await load();
  if (!cur) await clearOngoing();
}

/** Shows or updates the ongoing notification. Only when notifications are allowed. */
export async function showOngoing(title: string, body: string, color?: string | null) {
  try {
    // An iPhone showing the trip's Live Activity needs no second copy in Notification Centre.
    if (!wantOngoing(Platform.OS, iosNative.activitiesEnabled(), iosNative.activityIds().length)) { await clearOngoing(); return; }
    const p = await Notifications.getPermissionsAsync();
    if (!p.granted) return;
    await Notifications.scheduleNotificationAsync({
      identifier: NOTE,
      content: { title, body, sticky: true, autoDismiss: false, sound: false, categoryIdentifier: NOTE, color: color || '#0A84FF',
        priority: Notifications.AndroidNotificationPriority.DEFAULT, data: { go: 1, ongoing: 1 } },
      trigger: Platform.OS === 'android' ? { channelId: NOTE } : null,
    });
  } catch {}
}

export async function clearOngoing() {
  try { await Notifications.dismissNotificationAsync(NOTE); } catch {}
}

/**
 * A one off alert: next stop, change here, connection at risk, you've arrived. The identifier is stable per trip
 * and alert, so showing it again replaces the first one instead of adding a second.
 */
export async function liveAlert(title: string, body: string, identifier?: string) {
  try {
    const p = await Notifications.getPermissionsAsync();
    if (!p.granted) return false;
    await Notifications.scheduleNotificationAsync({ ...(identifier ? { identifier } : {}), content: { title, body, data: { go: 1 } }, trigger: Platform.OS === 'android' ? { channelId: 'default' } : null });
    return true;
  } catch { return false; }
}
