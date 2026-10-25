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
import { LiveState, progOf as progOfCalc, stepLive } from './liveCalc';
import { wakeStep } from './smart';
import { speak } from './nativeExtras';
import { cancelWake, scheduleWake, wakeNow } from './smartNotify';
import { endedWatches } from './push';
import { badgeLook } from './lineStyle';
import type { ServiceResp, WatchLeg } from './types';
import { fillFeeds, needsFeed, stopsToLook } from './feedCore';
import { apiBase, NEW_API_BASE } from './server';

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

let pos: { lat: number; lon: number } | null = null;
/** Your position from the live trip screen, sent with a share link that includes your location. */
export function setEnginePos(p: { lat: number; lon: number } | null) { pos = p; }

let busy = false;
let lastFull = 0;
let svcCache: (ServiceResp | null)[] = [];
let cacheFor: string | null = null;

/** After the trip's legs change (Switch to this), the next refresh reads every leg again. */
export function resetLiveCache() { svcCache = []; lastFull = 0; }

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
    let failed = 0;
    if (!cur.arrivedAt) {
      const full = Date.now() - lastFull > 60000;
      const prev = state.st && !state.st.done ? state.st.cur : 0;
      const next = svcCache.slice();
      await Promise.all(L.map(async (l, i) => {
        if (!(full || i === prev || i === prev + 1)) return;
        try {
          next[i] = await api.service({ trip: l.tripId || undefined, mode: l.mode, line: l.line, stop: l.stopId, destId: l.destId || undefined, planned: l.planned, to: l.toStopId || undefined, dest: l.towards || undefined, stopName: l.from || undefined, color: l.color || undefined, feed: l.feed || undefined });
        } catch { failed++; }
      }));
      if (full) lastFull = Date.now();
      svcCache = next;
    }
    const g = getLive();
    if (!g || g.id !== cur.id) return;
    const now = Date.now();
    const r = stepLive(g, svcCache, now, fmt);
    // Wake me before my stop: one alarm per leg, set on the phone and moved with the live times.
    const w = wakeStep({ id: g.id, legs: g.legs, wake: g.wake, wakeSet: g.wakeSet, alerted: r.g.alerted }, r.s, now, fmt);
    put({ svc: svcCache.slice(), st: r.s, offline: failed ? 'Connection lost. Showing the last live times.' : null, ...(failed ? {} : { updated: now }) });
    if (r.g !== g || w.g.alerted !== r.g.alerted || w.g.wakeSet !== g.wakeSet) setLive({ ...g, alerted: w.g.alerted, watchId: r.g.watchId, rode: r.g.rode, arrivedAt: r.g.arrivedAt, wakeSet: w.g.wakeSet, spoken: r.g.spoken });
    for (const a of w.actions) {
      if (Platform.OS === 'web') (globalThis as any).__tripLog?.({ ...a, ...(a.t === 'wakeSchedule' ? { alarmAt: a.at } : {}), at: now });
      if (a.t === 'wakeSchedule') await scheduleWake(a.id, a.at, a.title, a.body);
      else if (a.t === 'wakeDue') await wakeNow(a.id, a.title, a.body);
      else if (a.t === 'wakeCancel') await cancelWake(a.id);
    }
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
        const p = g.share.pos && pos && !r.s.done ? pos : null;
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
