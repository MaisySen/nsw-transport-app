// The live trip engine: refreshes the trip you are on every 15 seconds while the app is open, on any screen.
// The decisions are in stepLive (liveCalc.ts, covered by the replay tests); this file fetches the live feed and
// carries out what stepLive returns: the ongoing notification, each trip alert once, the share link, and the end
// of all trip alerts the moment you arrive. The live trip screen only reads its state.
import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { startAppPoll } from './activity';
import * as Haptics from 'expo-haptics';
import { api } from './api';
import { clock, shortName } from './format';
import { clearOngoing, endLive, getLive, liveAlert, setLive, showOngoing, useLiveTrip } from './live';
import { LiveState, Pos, progOf as progOfCalc, stepLive, tapMoments } from './liveCalc';
import { haptic } from './haptic';

const tapped = new Set<string>();
import { wakeStep } from './smart';
import { hasSpeech, speak } from './nativeExtras';
import { getOffStep, readGetOff, readGetOffSay } from './getOffCore';
import { cancelGetOff, getOffNow, scheduleGetOff, serverGetOffShown, setServerGetOffWatch, voiceClips } from './getOffNotify';
import { store } from './store';
import { cancelWake, scheduleWake, wakeNow } from './smartNotify';
import { endedWatches } from './push';
import { badgeLook } from './lineStyle';
import type { ServiceResp, WatchLeg } from './types';
import { fillFeeds, needsFeed, stopsToLook } from './feedCore';
import { apiBase, NEW_API_BASE } from './server';
import { liveServiceQuery } from './liveFreshCore';

export const short = (n?: string | null) => shortName(n || '').replace(/ Station$/, '');
export const plat = (p?: string | null) => (p ? p.replace(/^Platform\s*/i, 'Platform ').replace(/^Stand\s*/i, 'Stand ') : '');
/** The leg's line colour, as on its badge: the official line or mode colour, never a neutral grey. */
export const legColor = (l: WatchLeg) => badgeLook(l.line, l.mode, l.color).bg;
const fmt = { clock, short, plat };
export const progOf = (s: LiveState | null) => progOfCalc(s, fmt);

export type EngineState = { gid: string | null; svc: (ServiceResp | null)[]; st: LiveState | null; offline: string | null; updated: number };
let state: EngineState = { gid: null, svc: [], st: null, offline: null, updated: 0 };
const subs = new Set<() => void>();
function put(p: Partial<EngineState>) { state = { ...state, ...p }; subs.forEach((f) => f()); }

/** The engine's latest state, for the live trip screen. */
export function useLiveEngineState() {
  return useSyncExternalStore((l) => { subs.add(l); return () => { subs.delete(l); }; }, () => state, () => state);
}

let pos: Pos | null = null;
/**
 * Your position from the live trip screen (only with permission, only while it is on view): it moves the trip on when
 * you are at your stop and holds it while you are still before it, and goes with a share link that includes it.
 */
export function setEnginePos(p: Pos | null) { pos = p; }

/**
 * "I'm at Town Hall": you say you got off the leg you are on. It ends that leg now and the trip carries on from there
 * (with a missed change checked against the next leg's live times). Used when there is no live data or location.
 */
export async function markHere(leg: number) {
  const g = getLive();
  if (!g || g.arrivedAt) return;
  setLive({ ...g, here: { ...(g.here || {}), [leg]: Date.now() } });
  await tickLive();
}

let busy = false;
let lastFull = 0;
let svcCache: (ServiceResp | null)[] = [];
let cacheFor: string | null = null;

/** After the trip's legs change (Switch to this), the next refresh reads every leg again. */
// Bumped whenever the legs change, so service answers asked for the old legs are never kept under the new ones.
let cacheGen = 0;
export function resetLiveCache() { svcCache = []; lastFull = 0; cacheGen++; }

// Trips started before legs carried their realtime feed (TrainLink, regional buses, Manly Fast Ferry): look the
// feed up from each stop's departure board, at most every 5 minutes, until every leg has one.
let feedLookAt = 0;
let feedLookFor: string | null = null;
async function backfillLiveFeeds(id: string) {
  const g = getLive();
  if (!g || g.id !== id || !g.legs.some(needsFeed)) return;
  if (feedLookFor === id && Date.now() - feedLookAt < 300000) return;
  feedLookFor = id; feedLookAt = Date.now();
  const boards: Record<string, any[] | null> = {};
  await Promise.all(stopsToLook(g.legs, Date.now()).map(async (s) => {
    try { boards[s] = (await api.departures(s)).items || []; } catch { boards[s] = null; }
  }));
  const g2 = getLive();
  if (!g2 || g2.id !== id) return;
  const r = fillFeeds(g2.legs, boards);
  if (r.changed) { setLive({ ...g2, legs: r.legs }); resetLiveCache(); }
}

/** One refresh of the trip you are on. Safe to call any time; does nothing without a trip. */
export async function tickLive() {
  const cur = getLive();
  if (!cur) { if (state.gid) put({ gid: null, svc: [], st: null, offline: null, updated: 0 }); return; }
  if (busy) return;
  busy = true;
  try {
    if (cacheFor !== cur.id) { cacheFor = cur.id; svcCache = []; lastFull = 0; put({ gid: cur.id, svc: [], st: null, offline: null, updated: 0 }); }
    if (!cur.arrivedAt && apiBase() === NEW_API_BASE && cur.legs.some(needsFeed)) await backfillLiveFeeds(cur.id).catch(() => {});
    const L = (getLive() || cur).legs;
    const gen = cacheGen;
    let failed = 0;
    if (!cur.arrivedAt) {
      const full = Date.now() - lastFull > 60000;
      const prev = state.st && !state.st.done ? state.st.cur : 0;
      const next = svcCache.slice();
      await Promise.all(L.map(async (l, i) => {
        if (!(full || i === prev || i === prev + 1)) return;
        try {
          // A leg already answered asks as a refresh (liveFreshCore.ts): live feed times, not a copy up to a minute old.
          next[i] = await api.service(liveServiceQuery({ trip: l.tripId || undefined, mode: l.mode, line: l.line, stop: l.stopId, destId: l.destId || undefined, planned: l.planned, to: l.toStopId || undefined, dest: l.towards || undefined, stopName: l.from || undefined, color: l.color || undefined, feed: l.feed || undefined }, !!svcCache[i]));
        } catch { failed++; }
      }));
      // The trip or its legs changed while these were on their way (Switch to this, a new trip): drop them; the next
      // tick reads the new legs.
      const g0 = getLive();
      if (gen !== cacheGen || !g0 || g0.id !== cur.id) return;
      if (full) lastFull = Date.now();
      svcCache = next;
    }
    const g = getLive();
    if (!g || g.id !== cur.id) return;
    const now = Date.now();
    const r = stepLive(g, svcCache, now, fmt, pos);
    // Wake me before my stop: one alarm per leg, set on the phone and moved with the live times.
    const w = wakeStep({ id: g.id, legs: g.legs, wake: g.wake, wakeSet: g.wakeSet, alerted: r.g.alerted }, r.s, now, fmt);
    // Get off alert (More stops before, Get off now): set on the phone beside the trip's own alerts (getOffCore.ts).
    // Spoken alert sounds (build 210 and later): the alerts set on the phone ring with a voice, heard with the phone
    // locked, where the app cannot speak. The same choices as reading out (spoken Get off now, Speak alerts).
    const voice = voiceClips() ? { now: readGetOffSay(store.getOffSay()), all: !!g.speak } : null;
    // Get off now from the server (30 Oct, build 210): not set on the phone; one the server already showed is done.
    const server = !!g.offServer && !!g.watchId;
    setServerGetOffWatch(server ? g.watchId : null);
    const serverRung = server ? await serverGetOffShown(g.watchId) : undefined;
    const o = getOffStep({ id: g.id, legs: g.legs, alerted: w.g.alerted, offSet: g.offSet, speak: g.speak && hasSpeech(), sayNow: readGetOffSay(store.getOffSay()) && hasSpeech(), spoken: r.g.spoken, voice, offVoice: g.offVoice,
      ...(server ? { server: true, serverRung, serverVoice: !!voice && (voice.now || voice.all) } : {}) }, readGetOff(store.getOff()), r.s, now, fmt);
    put({ svc: svcCache.slice(), st: r.s, offline: failed ? 'Connection lost. Showing the last live times.' : null, ...(failed ? {} : { updated: now }) });
    if (r.g !== g || w.g.alerted !== r.g.alerted || w.g.wakeSet !== g.wakeSet || o.g.offSet !== g.offSet || o.g.alerted !== w.g.alerted || o.g.spoken !== r.g.spoken || o.g.offVoice !== g.offVoice) {
      setLive({ ...g, alerted: o.g.alerted, watchId: r.g.watchId, rode: r.g.rode, here: r.g.here, arrivedAt: r.g.arrivedAt, wakeSet: w.g.wakeSet, spoken: o.g.spoken, offSet: o.g.offSet, offVoice: o.g.offVoice });
    }
    for (const a of o.actions) {
      if (Platform.OS === 'web') (globalThis as any).__tripLog?.({ ...a, at: now });
      if (a.t === 'offSchedule') await scheduleGetOff(a.id, a.at, a.title, a.body, a.sound);
      else if (a.t === 'offDue') { if (await getOffNow(a.id, a.title, a.body, a.sound)) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); }
      else if (a.t === 'offCancel') await cancelGetOff(a.id);
      else if (a.t === 'say') speak(a.text, a.quiet ? { quiet: true } : {});
    }
    for (const a of w.actions) {
      if (Platform.OS === 'web') (globalThis as any).__tripLog?.({ ...a, ...(a.t === 'wakeSchedule' ? { alarmAt: a.at } : {}), at: now });
      if (a.t === 'wakeSchedule') await scheduleWake(a.id, a.at, a.title, a.body);
      else if (a.t === 'wakeDue') await wakeNow(a.id, a.title, a.body);
      else if (a.t === 'wakeCancel') await cancelWake(a.id);
    }
    // One light tap at "leave now" and on arrival, once each per trip (expo-haptics is in every build).
    for (const k of tapMoments(r.s, now)) { const id = `${g.id}:${k}`; if (!tapped.has(id)) { tapped.add(id); haptic.light(); } }
    let buzzed = false;
    for (const a of r.actions) {
      // The web preview logs every action, so a browser replay can check each alert and the end of the trip.
      if (Platform.OS === 'web') (globalThis as any).__tripLog?.({ ...a, at: now });
      if (a.t === 'say') speak(a.text);
      else if (a.t === 'alert') { liveAlert(a.title, a.body, a.id); if (!buzzed) { buzzed = true; Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); } }
      else if (a.t === 'ongoing') showOngoing(a.title, a.body, legColor(L[a.leg]));
      else if (a.t === 'clearOngoing') await clearOngoing();
      else if (a.t === 'stopWatch') { endedWatches.add(a.id); api.stopWatch(a.id).catch(() => {}); }
      else if (a.t === 'share' && g.share) {
        const p = g.share.pos && pos && !r.s.done ? { lat: pos.lat, lon: pos.lon, ...(pos.acc != null ? { acc: pos.acc } : {}) } : null;
        api.shareUpdate({ id: g.share.id, key: g.share.key, pos: p, prog: a.prog }).catch((e: any) => { if (/not found/i.test(String(e?.message))) { const c3 = getLive(); if (c3) setLive({ ...c3, share: null }); } });
      } else if (a.t === 'end') await endLive();
    }
  } finally { busy = false; }
}

/** Mounted once at the root: runs the engine while a trip is in progress. */
export function LiveTripEngine() {
  const g = useLiveTrip();
  useEffect(() => {
    tickLive();
    if (!g?.id) return;
    // Every 15 seconds while the app is in front; nothing in the background (push moves the lock screen card).
    // Back in front after 5 seconds or more it refreshes at once.
    const p = startAppPoll(async () => { await tickLive(); return true; }, 15000, { runAtStart: false, staleMs: 5000 });
    return () => p.remove();
  }, [g?.id]);
  return null;
}
