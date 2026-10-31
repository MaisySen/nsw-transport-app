// The live trip engine: refreshes the trip you are on every 15 seconds while the app is open, on any screen.
// The decisions are in stepLive (liveCalc.ts, covered by the replay tests); this file fetches the live feed and
// carries out what stepLive returns: the ongoing notification, each trip alert once, the share link, and the end
// of all trip alerts the moment you arrive. The live trip screen only reads its state.
import { useEffect, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { startAppPoll } from './activity';
import * as Haptics from 'expo-haptics';
import { api } from './api';
import { clock, shortName } from './format';
import { clearOngoing, endLive, getLive, liveAlert, loadLive, setLive, showOngoing, useLiveTrip } from './live';
import { LiveState, Pos, nextFlowMoment, progOf as progOfCalc, stepLive } from './liveCalc';
import { backupGetOff, newTripMemory, tripPlanFrom, tripReadingFrom } from './tripState';
import { phone24h } from './rowTime';
import { haptic } from './haptic';

const tapped = new Set<string>();
import { wakeStep } from './smart';
import { hasSpeech, speak } from './nativeExtras';
import { getOffStep, readGetOff, readGetOffSay } from './getOffCore';
import { cancelGetOff, getOffBackup, getOffNow, ownGetOffShown, scheduleGetOff, scheduleQuiet, scheduleRegion, serverGetOffShown, setServerGetOffWatch, setTripFlow2, setTripWatch, sweepRegions, voiceClips } from './getOffNotify';
import { store } from './store';
import { cancelWake } from './smartNotify';
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
/** When the live times were last read without a failure (the quiet get off note needs them at most 5 min old). */
let liveOkAt = 0;
/** When the live answers in svcCache were loaded: the trip state's reading time (its age drives the stale words). */
let svcAt = 0;
// Speech (spec 2.7): when the app last came to the front, refreshes since then, and when the speech queue is free.
let openSince = Date.now();
let refreshes = 0;
let speakingUntil = 0;
// The precise moment the open app steps the trip again (Get off now at the live arrival minus 30 s).
let momentTimer: ReturnType<typeof setTimeout> | null = null;
/** The phone's backup Get off now set when the app went to the background (only when the server has not taken it). */
let backupId: string | null = null;
/** The trip whose leftover location alerts from other trips were last swept (once per trip, and once with none). */
let sweptFor: string | null | undefined;

export async function tickLive(opts: { noFetch?: boolean } = {}) {
  // The saved trip is read first (31 Oct): at launch the engine's first refresh ran before it was loaded, saw no trip
  // and swept the running trip's own location alerts as left over.
  const cur = await loadLive().catch(() => getLive());
  // Location alerts a given up trip left on the phone are taken back (31 Oct): at launch with no trip, and once per trip.
  if (sweptFor !== (cur?.id ?? null)) { sweptFor = cur?.id ?? null; sweepRegions(sweptFor).catch(() => {}); }
  if (!cur) { if (state.gid) put({ gid: null, svc: [], st: null, offline: null, updated: 0 }); return; }
  if (busy) return;
  busy = true;
  try {
    if (cacheFor !== cur.id) { cacheFor = cur.id; svcCache = []; lastFull = 0; liveOkAt = 0; put({ gid: cur.id, svc: [], st: null, offline: null, updated: 0 }); }
    if (!cur.arrivedAt && apiBase() === NEW_API_BASE && cur.legs.some(needsFeed)) await backfillLiveFeeds(cur.id).catch(() => {});
    const L = (getLive() || cur).legs;
    const gen = cacheGen;
    let failed = 0;
    if (!cur.arrivedAt && !opts.noFetch) {
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
      if (!failed) liveOkAt = Date.now();
      if (!failed || !svcAt) svcAt = Date.now();
      refreshes++;
    }
    const g = getLive();
    if (!g || g.id !== cur.id) return;
    const now = Date.now();
    // What the phone already shows for this trip (the server's Get off now, a location alert that rang while the app was
    // closed), read before the refresh so its first pass after opening the app posts and says none of it again.
    const server = !!g.offServer && !!g.watchId;
    const serverRung = server ? await serverGetOffShown(g.watchId) : undefined;
    const rung = Object.keys(g.offRegion || {}).length || Object.keys(g.offSet || {}).some((k) => k.startsWith('quiet')) ? await ownGetOffShown(g.id) : undefined;
    // The new trip flow (phase 2, tripState.ts): one trip state from the live train; the calm sequence and in-app speech
    // (V1 to V5) come from it. The server's push for a moment the app rings itself is shown without sound.
    setTripFlow2(true);
    const r = stepLive(g, svcCache, now, fmt, pos, { ...(serverRung || {}), ...(rung || {}) },
      { asOf: svcAt || now, c24: phone24h(now), voice: { open: AppState.currentState === 'active', silent: false, openSince, refreshes, speakingUntil } });
    if (r.voiceUntil != null) speakingUntil = r.voiceUntil;
    // Wake me before my stop is gone (G9): an alarm an earlier version set for this trip is taken back.
    const w = wakeStep({ id: g.id, legs: g.legs, wake: false, wakeSet: g.wakeSet, alerted: r.g.alerted }, r.s, now, fmt);
    // Get off alert (More stops before, Get off now): set on the phone beside the trip's own alerts (getOffCore.ts).
    // Spoken alert sounds (build 210 and later): the alerts set on the phone ring with a voice, heard with the phone
    // locked, where the app cannot speak. The same choices as reading out (spoken Get off now, Speak alerts).
    const voice = voiceClips() ? { now: readGetOffSay(store.getOffSay()), all: !!g.speak } : null;
    // Get off now from the server (30 Oct, build 210): not set on the phone; one the server already showed is done.
    setServerGetOffWatch(server ? g.watchId : null);
    setTripWatch(g.arrivedAt ? null : g.watchId, !!g.speak && hasSpeech());
    // The phone's own backup (31 Oct): location alerts when location is allowed and precise (build 211+), else the
    // quiet note. Its alerts already shown (a location alert that rang, read above) are done.
    const backup = getOffBackup();
    const o = getOffStep({ id: g.id, legs: g.legs, flow2: true, alerted: w.g.alerted, offSet: g.offSet, speak: g.speak && hasSpeech(), sayNow: readGetOffSay(store.getOffSay()) && hasSpeech(), spoken: r.g.spoken, voice, offVoice: g.offVoice,
      // A server watch sends "Next stop" (its push), else the phone sets its own ahead (31 Oct, getOffCore next<leg>).
      serverNext: !!g.watchId, wake: !!g.wake, backup, offRegion: g.offRegion, rung, liveAt: liveOkAt || null,
      ...(server ? { server: true, serverRung, serverVoice: !!voice && (voice.now || voice.all) } : {}) }, readGetOff(store.getOff()), r.s, now, fmt);
    put({ svc: svcCache.slice(), st: r.s, offline: failed ? 'Connection lost. Showing the last live times.' : null, ...(failed ? {} : { updated: now }) });
    if (r.g !== g || w.g.alerted !== r.g.alerted || w.g.wakeSet !== g.wakeSet || o.g.offSet !== g.offSet || o.g.alerted !== w.g.alerted || o.g.spoken !== r.g.spoken || o.g.offVoice !== g.offVoice || o.g.offRegion !== g.offRegion) {
      setLive({ ...g, alerted: o.g.alerted, watchId: r.g.watchId, rode: r.g.rode, here: r.g.here, arrivedAt: r.g.arrivedAt, wake: false, wakeSet: w.g.wakeSet, spoken: o.g.spoken, offSet: o.g.offSet, offVoice: o.g.offVoice, offRegion: o.g.offRegion, flow: r.g.flow });
    }
    for (const a of o.actions) {
      if (Platform.OS === 'web') (globalThis as any).__tripLog?.({ ...a, at: now });
      if (a.t === 'offSchedule') { if (a.quiet) await scheduleQuiet(a.id, a.at, a.title, a.body); else await scheduleGetOff(a.id, a.at, a.title, a.body, a.sound); }
      else if (a.t === 'regionSchedule') await scheduleRegion(a.id, a.lat, a.lon, a.radius, a.title, a.body, a.sound);
      else if (a.t === 'regionCancel') await cancelGetOff(a.id);
      else if (a.t === 'offDue') { if (await getOffNow(a.id, a.title, a.body, a.sound)) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); }
      else if (a.t === 'offCancel') await cancelGetOff(a.id);
      else if (a.t === 'say') speak(a.text, { alert: true, ...(a.quiet ? { quiet: true } : {}) });
    }
    for (const a of w.actions) if (a.t === 'wakeCancel') await cancelWake(a.id);
    // The open app steps the trip again at the exact Get off now moment (live arrival minus 30 s), not up to 15 s late.
    if (momentTimer) { clearTimeout(momentTimer); momentTimer = null; }
    const due = nextFlowMoment(r.g, r.s, now);
    if (due != null) momentTimer = setTimeout(() => { momentTimer = null; tickLive({ noFetch: true }).catch(() => {}); }, Math.max(0, due - Date.now()) + 50);
    for (const a of r.actions) {
      // The web preview logs every action, so a browser replay can check each alert and the end of the trip.
      if (Platform.OS === 'web') (globalThis as any).__tripLog?.({ ...a, at: now });
      // Spoken trip alerts follow the Silent switch (build 211+, nativeExtras alertAudio).
      if (a.t === 'say') speak(a.text, { alert: true });
      // One light tap for the calm steps (heads-up, Get off now), nothing for the others: never a buzz of scare.
      else if (a.t === 'alert') { liveAlert(a.title, a.body, a.id); if (a.haptic === 'light') { const id = `${g.id}:${a.key}`; if (!tapped.has(id)) { tapped.add(id); haptic.light(); } } }
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

/**
 * The app going to the background or coming back (spec 2.6, 2.7): back in front, speech waits 10 s and two refreshes
 * (V1, V4) and the phone's own backup Get off now is taken back; going away, the backup is set only when the server
 * has not taken Get off now, from a reading under 20 s old and with the live arrival under 5 min away (G39).
 */
export async function onAppState(next: string) {
  const g = getLive();
  if (next === 'active') {
    openSince = Date.now(); refreshes = 0;
    if (backupId) { const id = backupId; backupId = null; await cancelGetOff(id).catch(() => {}); }
    return;
  }
  if (!g || g.arrivedAt || backupId) return;
  const serverTakes = !!g.offServer && !!g.watchId;
  const plan = tripPlanFrom(g.legs, svcCache);
  const reading = tripReadingFrom(plan, g.legs, svcCache, svcAt || 0, { plannerAt: g.started ?? null });
  const M = g.flow && g.flow.legs.length === plan.legs.length ? g.flow : newTripMemory(plan);
  const b = backupGetOff(plan, M, reading, Date.now(), serverTakes);
  if (!b) return;
  const off = short(g.legs[b.li]?.to);
  backupId = `getoff-backup-${g.id}-${b.li}`;
  await scheduleGetOff(backupId, b.at, 'Get off now', `Get off now. ${off}, arriving ${clock(b.arrAt)}.`, 'getoff_now').catch(() => {});
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
    const sub = AppState.addEventListener('change', (s) => { onAppState(s).catch(() => {}); });
    return () => { p.remove(); sub.remove(); };
  }, [g?.id]);
  return null;
}
