// Weekend trackwork card data: asks GET /api/trackwork about the trips on Home, Thursday 6pm to Sunday. A server
// without the route (404, the address in use until api_base moves) gets the same card worked out on the phone from
// its /api/alerts, without the added time (docs/TRACKWORK.md). Also the optional Thursday 6pm heads up.
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiBase, NEW_API_BASE } from './server';
import { isOn, useFlag } from './config';
import { store, useStore } from './store';
import { cancelLocalAlert, canNotify, scheduleLocalAlert } from './smartNotify';
import { headsUpPlan, inWindow, trackworkQuery, weekendFromAlerts, type AlertLite, type TripLines, type TwResp } from './trackworkCore';

const missing = new Set<string>();
const cache = new Map<string, { at: number; r: TwResp }>();
const KEEP = 30 * 60000;

const alertCache = new Map<string, { at: number; items: AlertLite[] }>();
/** Alerts for one line from /api/alerts (kept 30 min). Null when the server does not answer. */
async function lineAlerts(base: string, line: string): Promise<AlertLite[] | null> {
  const k = base + '|' + line;
  const hit = alertCache.get(k);
  if (hit && Date.now() - hit.at < KEEP) return hit.items;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    const res = await fetch(`${base}/api/alerts?q=${encodeURIComponent(line)}`, { signal: ctl.signal }).finally(() => clearTimeout(t));
    if (!res.ok) return null;
    const d: any = await res.json();
    const items: AlertLite[] = (Array.isArray(d?.items) ? d.items : []).filter((a: any) => a && typeof a.title === 'string').map((a: any) => ({ title: a.title, url: a.url || null, lines: Array.isArray(a.lines) ? a.lines : [] }));
    alertCache.set(k, { at: Date.now(), items });
    return items;
  } catch { return null; }
}
/** The card worked out on the phone from alerts, one request per line the trips use (at most 6). */
async function fromAlerts(base: string, trips: TripLines[]): Promise<TwResp | null> {
  const lines = [...new Set(trips.flatMap((t) => t.lines))].slice(0, 6);
  if (!lines.length) return null;
  const got = await Promise.all(lines.map((l) => lineAlerts(base, l)));
  if (got.every((x) => x == null)) return null;
  const byLine: Record<string, AlertLite[]> = {};
  lines.forEach((l, i) => { byLine[l] = got[i] || []; });
  return weekendFromAlerts(byLine, trips, Date.now());
}

async function load(q: string, trips: TripLines[]): Promise<TwResp | null> {
  const base = apiBase();
  if (missing.has(base)) return fromAlerts(base, trips);
  const k = base + '?' + q;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < KEEP) return hit.r;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    const res = await fetch(`${base}/api/trackwork?${q}`, { signal: ctl.signal }).finally(() => clearTimeout(t));
    if (res.status === 404) { missing.add(base); return fromAlerts(base, trips); }
    if (!res.ok) return null;
    const r = (await res.json()) as TwResp;
    cache.set(k, { at: Date.now(), r });
    return r;
  } catch {
    return null;
  }
}

/** The server's answer for these trips, or null outside the window, with the flag off or on an old server. */
export function useTrackwork(trips: TripLines[], now: number): TwResp | null {
  const on = useFlag('weekendTrackwork') && inWindow(now);
  const q = on ? trackworkQuery(trips) : '';
  const tick = Math.floor(now / KEEP);
  const [r, setR] = useState<TwResp | null>(() => (q ? cache.get(apiBase() + '?' + q)?.r || null : null));
  useEffect(() => {
    if (!q) { setR(null); return; }
    let live = true;
    load(q, trips).then((x) => { if (live) setR(x); });
    return () => { live = false; };
  }, [q, tick]);
  return q ? r : null;
}

// ---------- the Thursday heads up (More > Weekend trackwork heads up) ----------

const HU_ID = 'trackwork-weekend';
const HU_KEY = 'twHeadsUpAt';
const HU_EVERY = 6 * 3600000;

/**
 * While Home is open, at most every 6 hours, Monday to Thursday before 6pm: looks at this weekend for the trips on
 * Home and sets (or moves, or cancels) one local notification for Thursday 6pm. Nothing runs in the background.
 * On the new server a trip with a morning check already gets the server's own Thursday push, so it is left out here.
 */
export function useTrackworkHeadsUp(trips: TripLines[], now: number) {
  const flag = useFlag('weekendTrackwork');
  const { twHeadsUp } = useStore();
  const on = !!twHeadsUp && flag;
  const q = on ? trackworkQuery(trips) : '';
  const slot = Math.floor(now / HU_EVERY);
  useEffect(() => {
    if (!on || !q) return;
    let live = true;
    (async () => {
      // Once per 6 hours for the same trips; a new trip on Home looks again.
      const raw = await AsyncStorage.getItem(HU_KEY).catch(() => null);
      const [lastQ, lastAt] = String(raw || '|0').split('|@');
      if (lastQ === q && Date.now() - (Number(lastAt) || 0) < HU_EVERY) return;
      const resp = await load(q, trips);
      // No answer (offline): the notification already set stays as it is.
      if (!live || !resp) return;
      const base = apiBase();
      const checks = base === NEW_API_BASE && isOn('morningCheck') ? store.morningList().filter((c) => c.active !== false) : [];
      const plan = headsUpPlan(resp, trips, Date.now(), (tr) => checks.some((c) => c.from?.id === tr.f && c.to?.id === tr.t));
      if (plan) await scheduleLocalAlert(HU_ID, plan.at, plan.title, plan.body, { trackwork: 1 });
      else await cancelLocalAlert(HU_ID);
      await AsyncStorage.setItem(HU_KEY, `${q}|@${Date.now()}`).catch(() => {});
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, q, slot]);
}

/** The switch in More. Turning it on asks for notifications (and stays off when that is refused). */
export async function setTrackworkHeadsUp(on: boolean): Promise<boolean> {
  if (on && !(await canNotify(true))) return false;
  store.setTwHeadsUp(on);
  await AsyncStorage.removeItem(HU_KEY).catch(() => {});
  if (!on) await cancelLocalAlert(HU_ID);
  return true;
}
