import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { api } from '@/lib/api';
import { useLive } from '@/lib/hooks';
import { modeColor, radius, usePalette } from '@/lib/theme';
import { bestTime, clock, ms, shortName } from '@/lib/format';
import type { Departure, Journey, Leg, Place } from '@/lib/types';
import { store, tripKeyOf } from '@/lib/store';
import { fareOf, money } from '@/lib/fare';
import { directFilter, isChain, planTrip, stName, tLegs, tripKey, viaText } from '@/lib/trips';
import type { TripLeg } from '@/lib/trips';
import { Icon, I, IconName } from './Icon';
import { OutageLine } from './Access';
import { journeyOutages, safeUrl } from '@/lib/access';
import { openService } from './Cards';
import { LineBadge } from './Transit';
import { font, Sep, T } from './ui';

// ---------- shared refresh signals for every card on Home ----------

const pullers = new Set<() => void>();
const liveSubs = new Set<() => void>();
let lastLive = 0;

/** Pull to refresh on Home asks every card to reload now. */
export function pullHome() { pullers.forEach((f) => f()); }

function markLive() {
  lastLive = Date.now();
  liveSubs.forEach((f) => f());
}

/** Time of the newest successful live load on Home, for the "Live 07:55" stamp. */
export function useLastLive() {
  return useSyncExternalStore((l) => { liveSubs.add(l); return () => { liveSubs.delete(l); }; }, () => lastLive, () => lastLive);
}

/** useLive at Home's 15 s pace, joined to pull to refresh and the Live stamp. */
function useHomeLive<T>(load: (refresh: boolean) => Promise<T>, deps: any[]) {
  const live = useLive(load, 15000, deps);
  const { updatedAt, refresh } = live;
  useEffect(() => { if (updatedAt) markLive(); }, [updatedAt]);
  useEffect(() => {
    pullers.add(refresh);
    return () => { pullers.delete(refresh); };
  }, [refresh]);
  return live;
}

// ---------- high priority alerts reported by the trip cards ----------

const highAlerts = new Map<string, { title: string; url?: string; open: () => void }[]>();
const alertSubs = new Set<() => void>();
let alertSnap: { title: string; url?: string; open: () => void }[] = [];
function reportHigh(key: string, list: { title: string; url?: string; open: () => void }[]) {
  const before = (highAlerts.get(key) || []).map((a) => a.title).join('|');
  if (list.length) highAlerts.set(key, list); else highAlerts.delete(key);
  if (before === list.map((a) => a.title).join('|')) return;
  const seen = new Set<string>();
  alertSnap = [...highAlerts.values()].flat().filter((a) => (seen.has(a.title) ? false : (seen.add(a.title), true)));
  alertSubs.forEach((f) => f());
}
/** Unique high priority alerts across the trips on Home, for the banner. */
export function useHighAlerts() {
  return useSyncExternalStore((l) => { alertSubs.add(l); return () => { alertSubs.delete(l); }; }, () => alertSnap, () => alertSnap);
}

export function AlertBanner() {
  const c = usePalette();
  const list = useHighAlerts();
  if (!list.length) return null;
  const a = list[0];
  return (
    <Pressable onPress={() => { const u = safeUrl(a.url); return u ? Linking.openURL(u).catch(a.open) : a.open(); }} accessibilityRole="button"
      style={({ pressed }) => [s.banner, { backgroundColor: c.orange + '26', opacity: pressed ? 0.7 : 1 }]}>
      <Icon name={I.warn} size={16} color={c.orange} style={{ marginTop: 1 }} />
      <T kind="sub" numberOfLines={2} style={{ flex: 1, marginLeft: 10, color: c.text }}>{a.title}</T>
      {list.length > 1 ? <T kind="foot" style={{ marginLeft: 8, color: c.lateText, fontWeight: '600' }}>+{list.length - 1}</T> : null}
    </Pressable>
  );
}

// ---------- small formatters ----------

/** "7:52" with no am or pm, Sydney time. */
const hm = (t: number) => clock(t).replace(/(am|pm)$/i, '');

/** 24 hour "07:55", Sydney time. */
export function hm24(t: number) {
  try {
    return new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Australia/Sydney' });
  } catch {
    const d = new Date(t);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

/** Countdown parts: "4" + "min", "Now", or a clock time past an hour. */
function cd(t: number, now: number): { big: string; unit: string } {
  const diff = t - now;
  if (!Number.isFinite(diff)) return { big: '', unit: '' };
  if (diff < 60000) return { big: 'Now', unit: '' };
  const m = Math.floor(diff / 60000);
  if (m < 60) return { big: String(m), unit: 'min' };
  return { big: hm(t), unit: '' };
}

/** Countdown chip colour by time left: red at 3 min or less, amber 4 to 9, green 10 plus, grey when cancelled. */
export function cdColor(t: number, now: number, cancelled: boolean, c: { red: string; green: string; text3: string }) {
  if (cancelled) return c.text3;
  const m = Math.floor((t - now) / 60000);
  return m <= 3 ? c.red : m <= 9 ? AMBER : c.green;
}
const AMBER = '#F5A300';

const plat = (p?: string | null) => (p ? p.replace(/^Platform\s*/i, 'Plat ') : '');

const distText = (m?: number) => (m == null || !Number.isFinite(m) ? '' : m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

// ---------- section header and simple rows ----------

export function HomeSection({ title, children, onClear, footer }: { title: string; children: React.ReactNode; onClear?: () => void; footer?: string }) {
  const c = usePalette();
  return (
    <View style={{ marginTop: 24 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginBottom: 2 }}>
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={[font.title3, { fontWeight: '700', color: c.text, flex: 1 }]}>{title}</Text>
        {onClear ? (
          <Pressable onPress={onClear} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Clear ${title}`}>
            <T kind="body" tone="tint">Clear</T>
          </Pressable>
        ) : null}
      </View>
      {children}
      {footer ? <T kind="foot" tone="text2" style={{ marginHorizontal: 20, marginTop: 8 }}>{footer}</T> : null}
    </View>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: any }) {
  const c = usePalette();
  return <View style={[{ backgroundColor: c.card, borderRadius: radius, marginHorizontal: 16, marginTop: 10, overflow: 'hidden' }, style]}>{children}</View>;
}

/** One tappable tinted row in its own card: "Add a trip", "Show stops near me". */
export function ActionRow({ icon, title, onPress, busy }: { icon: IconName; title: string; onPress: () => void; busy?: boolean }) {
  const c = usePalette();
  return (
    <Card>
      <Pressable onPress={onPress} disabled={busy} accessibilityRole="button" android_ripple={{ color: c.fill }}
        style={({ pressed }) => [s.action, pressed && Platform.OS !== 'android' ? { backgroundColor: c.card2 } : null]}>
        <View style={[s.actionIcon, { backgroundColor: c.fill }]}>
          {busy ? <ActivityIndicator size="small" color={c.tint} /> : <Icon name={icon} size={15} color={c.tint} />}
        </View>
        <T kind="body" tone="tint" style={{ flex: 1 }}>{title}</T>
      </Pressable>
    </Card>
  );
}

function CardHeader({ title, glyph, glyphColor, right, sub, onPress, onLongPress, trailing }: { title: string; glyph?: IconName; glyphColor?: string; right?: string; sub?: React.ReactNode; onPress: () => void; onLongPress?: () => void; trailing?: React.ReactNode }) {
  const c = usePalette();
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} accessibilityRole="button" android_ripple={{ color: c.fill }}
      style={({ pressed }) => [s.head, pressed && Platform.OS !== 'android' ? { backgroundColor: c.card2 } : null]}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {glyph ? <Icon name={glyph} size={14} color={glyphColor || c.tint} style={{ marginRight: 6 }} /> : null}
          <T kind="headline" numberOfLines={1} style={{ flexShrink: 1 }}>{title}</T>
        </View>
        {sub}
      </View>
      {right ? <T kind="foot" tone="text2" style={{ marginLeft: 8, fontVariant: ['tabular-nums'] }}>{right}</T> : null}
      {trailing || <Icon name={I.chevron} size={13} color={c.text3} style={{ marginLeft: 6 }} />}
    </Pressable>
  );
}

// ---------- Your trips: TripView style card with the next 3 services ----------

type Hold = { delay: number; at: number };
/** Last live reading per service, so a feed gap shows "Last reported" for 10 minutes instead of flipping to Scheduled. */
const holds = new Map<string, Hold>();
const HOLD_MS = 10 * 60000;

const firstLeg = (j: Journey): Leg | undefined => j.legs.find((l) => l.kind === 'transit');
const legKey = (l?: Leg) => (l ? l.tripId || `${l.line}|${l.planned}` : '');
const depOf = (j: Journey) => { const l = firstLeg(j); return l ? bestTime(l.planned, l.realtime ? l.estimated : null) : ms(j.leave); };
export const arrOf = (j: Journey) => {
  const ts = j.legs.filter((l) => l.kind === 'transit');
  const l = ts[ts.length - 1];
  const a = l ? bestTime(l.arrPlanned, l.realtime ? l.arrEstimated : null) : NaN;
  return Number.isFinite(a) ? a : ms(j.arrive);
};

const lateWords = (d: number) => (d > 0 ? `${d} min late` : d < 0 ? `${-d} min early` : 'On time');

type Status = { text: string; tone: 'live' | 'late' | 'red' | 'grey' };
function statusOf(j: Journey, now: number): Status {
  const l = firstLeg(j);
  if (j.anyCancelled || l?.cancelled) return { text: 'Cancelled', tone: 'red' };
  if (!l) return { text: 'Scheduled', tone: 'grey' };
  if (l.realtime) {
    const d = l.delayMin || 0;
    return { text: lateWords(d), tone: d > 0 ? 'late' : 'live' };
  }
  const h = holds.get(legKey(l));
  if (h && now - h.at < HOLD_MS) {
    const w = h.delay === 0 ? 'on time' : lateWords(h.delay);
    return { text: `Last reported ${w}`, tone: h.delay > 0 ? 'late' : 'grey' };
  }
  if (h) return { text: 'Live data unavailable', tone: 'grey' };
  return { text: 'Scheduled', tone: 'grey' };
}

export type TripItem = { key: string; from: Place; to: Place; kind: 'commute' | 'saved' | 'recent' | 'place' | 'mine'; id?: string; name?: string; tag?: string; via?: Place; conn?: number; okey?: string; legs?: TripLeg[]; modes?: string[] };

/** Warning under a multi leg service: a tight change, or a change missed because of a delay. */
export function WarnLine({ j }: { j: Journey }) {
  const c = usePalette();
  if (!j.warn) return null;
  const bad = j.risk === 'miss' || !!j.anyCancelled;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingLeft: 82, paddingRight: 16, paddingBottom: 10, marginTop: -4 }} accessibilityRole="text">
      <Icon name={I.warn} size={13} color={bad ? c.red : c.orange} style={{ marginTop: 2 }} />
      <T kind="foot" style={{ color: bad ? c.red : c.lateText, flex: 1, fontWeight: '500' }}>{j.warn}</T>
    </View>
  );
}

/** Tap and hold (or swipe) on a Home trip: the actions for that kind of trip. */
export function tripMenu(trip: TripItem, route?: string) {
  const { from, to, via } = trip;
  const title = route || `${shortName(from.name)} to ${shortName(to.name)}`;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  const key = tripKeyOf({ from, to, via, legs: trip.legs });
  const editParams = { from: from.id, fromName: from.name, to: to.id, toName: to.name, ...(trip.modes?.[0] ? { mode: trip.modes[0] } : {}), ...(trip.legs && trip.legs.length > 1 ? { legs: JSON.stringify(trip.legs) } : {}), ...(trip.name ? { name: trip.name } : {}), edit: key };
  if (trip.kind === 'mine') {
    Alert.alert(trip.name || title, undefined, [
      { text: 'Edit trip', onPress: () => router.push({ pathname: '/new-trip', params: editParams }) },
      { text: 'Delete trip', style: 'destructive', onPress: () => deleteTrip(trip) },
      { text: 'Cancel', style: 'cancel' },
    ], { cancelable: true });
  } else if (trip.kind === 'saved') {
    Alert.alert(trip.name || title, 'Saved on your profile.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete trip', style: 'destructive', onPress: () => deleteTrip(trip) },
    ], { cancelable: true });
  } else if (trip.kind === 'commute') {
    Alert.alert(trip.name || title, 'Your commute: a leave now alert on the days you set.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete commute', style: 'destructive', onPress: () => { if (trip.id) api.deleteCommute(trip.id).then(pullHome).catch((e) => Alert.alert("Couldn't delete it", e.message)); } },
    ], { cancelable: true });
  } else if (trip.kind === 'place') {
    Alert.alert('Home and work', undefined, [
      { text: 'Change home', onPress: () => router.push({ pathname: '/add-trip', params: { place: 'home' } }) },
      { text: 'Change work', onPress: () => router.push({ pathname: '/add-trip', params: { place: 'work' } }) },
      { text: 'Remove both', style: 'destructive', onPress: () => { store.setPlace('home', null); store.setPlace('work', null); } },
    ], { cancelable: true });
  } else {
    Alert.alert(title, undefined, [
      { text: 'Save trip', onPress: () => router.push({ pathname: '/new-trip', params: { from: from.id, fromName: from.name, to: to.id, toName: to.name } }) },
      { text: 'Remove from Recent', style: 'destructive', onPress: () => store.removeRecentTrip(from.id, to.id) },
      { text: 'Cancel', style: 'cancel' },
    ], { cancelable: true });
  }
}

/** Delete trip: off this phone, out of the Home order, and the server copy too. */
export function deleteTrip(trip: TripItem) {
  const key = tripKeyOf({ from: trip.from, to: trip.to, via: trip.via, legs: trip.legs });
  if (trip.kind === 'mine') store.removeMyTrip(key);
  const st = store.getOrder();
  if (st.includes(key)) store.setTripOrder(st.filter((k) => k !== key));
  if (trip.name) api.deleteSaved(trip.name).then(pullHome).catch(() => {});
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

export function TripBoard({ trip, now, handle, allServices }: { trip: TripItem; now: number; handle?: React.ReactNode; allServices?: boolean }) {
  const c = usePalette();
  const { from, to, via } = trip;
  const plan = { from, to, via, conn: trip.conn, legs: trip.legs, modes: trip.modes };
  const chain = isChain(plan);
  const pkey = tripKey(plan) + JSON.stringify(chain ? tLegs(plan).map((l) => [l.mode, l.conn, l.any, l.walk]) : []);
  const { data, error } = useHomeLive((r) => planTrip(plan, { refresh: r, count: 6, all: chain && !!allServices }), [pkey, chain && !!allServices]);

  // Remember each live reading for the hold.
  useEffect(() => {
    const t = Date.now();
    for (const j of data?.journeys || []) {
      const l = firstLeg(j);
      if (l?.realtime) holds.set(legKey(l), { delay: l.delayMin || 0, at: t });
    }
  }, [data]);

  const js = directFilter((data?.journeys || []).filter((j) => depOf(j) > now - 30000), plan, !!allServices, (j) => j).list.slice(0, 3);
  const arrs = js.map(arrOf);
  const alerts = new Set<string>();
  js.forEach((j) => j.legs.forEach((l) => (l.alerts || []).forEach((a: any) => alerts.add(typeof a === 'string' ? a : a.title))));
  const highKey = (data?.journeys || []).slice(0, 3).map((j) => j.legs.map((l) => (l.alerts || []).map((a: any) => (typeof a === 'string' ? '' : `${a.priority}:${a.title}`)).join()).join()).join();

  const fromName = shortName(from.name).replace(/ Station$/, ''), toName = shortName(to.name).replace(/ Station$/, '');
  const route = `${fromName} to ${toName}`;
  const viaLine = chain ? `${tLegs(plan).length} legs via ${viaText(plan)}` : '';
  const custom = trip.name && trip.name.toLowerCase() !== route.toLowerCase() ? trip.name.charAt(0).toUpperCase() + trip.name.slice(1) : '';
  const open = (pick?: number) => router.push({ pathname: '/trip', params: { from: from.id, fromName: from.name, to: to.id, toName: to.name, ...(chain ? { legs: JSON.stringify(tLegs(plan)) } : {}), ...(trip.name ? { name: trip.name } : {}), ...(pick != null ? { pick: String(pick) } : {}) } });
  const glyph = trip.kind === 'saved' || trip.kind === 'mine' ? I.star : trip.kind === 'commute' ? I.clock : trip.kind === 'place' ? (trip.tag === 'To work' ? I.briefcase : I.home) : undefined;
  const menu = () => tripMenu(trip, route);
  useEffect(() => {
    const list: { title: string; url?: string; open: () => void }[] = [];
    for (const j of (data?.journeys || []).slice(0, 3)) for (const l of j.legs) for (const a of (l.alerts || []) as any[]) {
      if (typeof a !== 'string' && /high/i.test(a.priority || '') && !list.some((x) => x.title === a.title)) list.push({ title: a.title, url: a.url, open: () => open() });
    }
    reportHigh(trip.key, list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highKey, trip.key]);
  useEffect(() => () => reportHigh(trip.key, []), [trip.key]);

  const stripe = (() => { const l = js.map(firstLeg).find(Boolean); return l ? l.color || modeColor[l.mode || 'train'] : c.tint; })();

  return (
    <Card>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ width: 4, backgroundColor: stripe }} />
        <View style={{ flex: 1 }}>
          <CardHeader title={custom ? `${custom}: ${route}` : route} glyph={glyph} glyphColor={trip.kind === 'saved' || trip.kind === 'mine' ? c.yellow : c.tint} right={trip.tag} onPress={() => open()} onLongPress={menu} trailing={handle}
            sub={alerts.size || viaLine ? (
              <View>
                {viaLine ? <T kind="foot" tone="text2" numberOfLines={1} style={{ marginTop: 2 }}>{viaLine}</T> : null}
                {alerts.size ? (
                  <Pressable onPress={() => open()} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                    <Icon name={I.warn} size={11} color={c.orange} />
                    <T kind="foot" style={{ color: c.lateText, marginLeft: 4 }}>{alerts.size} {alerts.size === 1 ? 'alert' : 'alerts'}</T>
                  </Pressable>
                ) : null}
              </View>
            ) : null} />
        </View>
      </View>
      {!data ? <T kind="foot" tone="text2" style={s.note}>{error ? 'Live times unavailable right now, trying again' : 'Loading live times'}</T> : null}
      {data && !js.length ? <T kind="foot" tone="text2" style={s.note}>{data.error || 'No more services today'}</T> : null}
      {js.map((j, i) => (
        <View key={legKey(firstLeg(j)) + i}>
          <Sep inset={0} />
          <ServiceRow j={j} now={now} arrive={arrs[i]} beaten={!!(j as any).beaten || arrs.slice(i + 1).some((a) => a < arrs[i])} onPress={() => open(i)} />
          <WarnLine j={j} />
          <OutageLine outages={journeyOutages(j)} />
        </View>
      ))}
    </Card>
  );
}

/** Up to 3 small person icons from the first leg's occupancy level. */
function Crowd({ l }: { l?: Leg }) {
  const c = usePalette();
  const lv = (l?.occupancy as any)?.level;
  if (!lv) return null;
  const n = Math.max(1, Math.min(3, Number(lv) || 1));
  return (
    <View style={{ flexDirection: 'row', marginRight: 4 }} accessibilityLabel={(l?.occupancy as any)?.text || `${n} of 3 full`}>
      {[1, 2, 3].map((i) => <Icon key={i} name={I.person} size={10} color={i <= n ? c.text2 : c.text3} style={{ opacity: i <= n ? 1 : 0.45, marginLeft: -1 }} />)}
    </View>
  );
}

/** TripView style service row: countdown chip coloured by time left, leave time and status, arrive time with line badges. */
export function ServiceRow({ j, now, arrive, beaten, onPress, showTravel }: { j: Journey; now: number; arrive: number; beaten?: boolean; onPress: () => void; showTravel?: boolean }) {
  const c = usePalette();
  const l = firstLeg(j);
  const dep = depOf(j);
  const stt = statusOf(j, now);
  const t = showTravel ? { big: String(j.durationMin), unit: 'min' } : cd(dep, now);
  const tone = stt.tone === 'live' ? c.green : stt.tone === 'late' ? c.orange : stt.tone === 'red' ? c.red : c.text3;
  const toneText = stt.tone === 'live' ? c.liveText : stt.tone === 'late' ? c.lateText : stt.tone === 'red' ? c.red : c.text2;
  const legs = j.legs.filter((x) => x.kind === 'transit');
  const last = legs[legs.length - 1];
  const cancelled = stt.tone === 'red';
  const chip = showTravel ? (cancelled ? c.text3 : '#8E8E93') : cdColor(dep, now, cancelled, c);
  const badges: Leg[] = [];
  for (const x of legs) if (x.line && !badges.some((b) => b.line === x.line)) badges.push(x);
  const changes = j.changes || Math.max(0, legs.length - 1);
  const boardAt = [shortName(l?.from || '').replace(/ Station$/, ''), plat(l?.fromPlatform)].filter(Boolean).join(', ');
  const bigSize = t.unit ? 22 : t.big === 'Now' ? 16 : 13;
  return (
    <Pressable onPress={onPress} android_ripple={{ color: c.fill }} accessibilityLabel={`Leaves ${hm(dep)}, ${t.big} ${t.unit}, arrives ${hm(arrive)}, ${stt.text}`}
      style={({ pressed }) => [s.svc, (beaten || dep < now - 30000) && { opacity: 0.45 }, pressed && Platform.OS !== 'android' ? { backgroundColor: c.card2 } : null]}>
      <View style={[s.block, { backgroundColor: chip }]}>
        <Text maxFontSizeMultiplier={1.3} style={{ color: '#fff', fontSize: bigSize, fontWeight: '700', fontVariant: ['tabular-nums'], letterSpacing: -0.4 }} numberOfLines={1} adjustsFontSizeToFit>{t.big}</Text>
        {t.unit ? <Text maxFontSizeMultiplier={1.3} style={{ color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: '600', marginTop: -2 }}>{t.unit}</Text> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
        <T kind="foot" tone="text2" numberOfLines={1}>{boardAt}</T>
        <Text maxFontSizeMultiplier={1.4} style={[font.title3, { color: c.text, fontVariant: ['tabular-nums'], textDecorationLine: cancelled ? 'line-through' : 'none' }]}>{hm(dep)}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 1 }}>
          <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: tone, marginRight: 5 }} />
          <T kind="foot" numberOfLines={1} style={{ color: toneText, flexShrink: 1 }}>{stt.text}</T>
        </View>
        {l?.platformChangedFrom ? <T kind="foot" numberOfLines={1} style={{ color: c.lateText, marginTop: 1 }}>Platform changed from {plat(l.platformChangedFrom)}</T> : null}
      </View>
      <View style={{ alignItems: 'flex-end', marginLeft: 8, maxWidth: '44%' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          {badges.slice(0, 3).map((b, i) => <MiniBadge key={`${b.line}${i}`} line={b.line} color={b.color || modeColor[b.mode || 'train']} />)}
          {changes ? <T kind="foot" tone="text2" numberOfLines={1}>{` \u00b7 ${changes} change${changes > 1 ? 's' : ''}`}</T> : null}
        </View>
        <Text maxFontSizeMultiplier={1.4} style={[font.title3, { color: c.text, fontVariant: ['tabular-nums'] }]}>{hm(arrive)}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Crowd l={l} />
          <T kind="foot" tone="text2" numberOfLines={1} style={{ fontVariant: ['tabular-nums'] }}>{j.durationMin} min</T>
          {fareOf(j) ? (
            <View style={{ backgroundColor: c.fill, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1, marginLeft: 5 }} accessibilityLabel={`Opal fare estimate ${money(j.fare!.total)}`}>
              <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={{ color: c.text2, fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{money(j.fare!.total)}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

/** Small line badge for the right column: "T1" on the line colour. */
function MiniBadge({ line, color }: { line?: string; color: string }) {
  if (!line) return null;
  return (
    <View style={{ backgroundColor: color, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, minWidth: 22, alignItems: 'center' }}>
      <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{line}</Text>
    </View>
  );
}

// ---------- stop boards: header plus up to 3 line rows ----------

type Group = { d: Departure; next?: Departure };
function groupDepartures(items: Departure[], now: number): Group[] {
  const out: Group[] = [];
  const by = new Map<string, Group>();
  const ok = items
    // Skip services already gone: the departures feed keeps ones that left up to a minute ago.
    .filter((d) => !d.cancelled && bestTime(d.planned, d.realtime ? d.estimated : null) > now)
    .sort((a, b) => bestTime(a.planned, a.realtime ? a.estimated : null) - bestTime(b.planned, b.realtime ? b.estimated : null));
  for (const d of ok) {
    const k = `${d.line}|${d.dest}`;
    const g = by.get(k);
    if (g) { if (!g.next) g.next = d; continue; }
    if (out.length >= 3) continue;
    const n = { d };
    by.set(k, n);
    out.push(n);
  }
  return out;
}

export function StopBoard({ stop, now, starred, distance, onLongPress }: { stop: Place; now: number; starred?: boolean; distance?: number; onLongPress?: () => void }) {
  const c = usePalette();
  const { data, error } = useHomeLive((r) => api.departures(stop.id, r), [stop.id]);
  const groups = groupDepartures(data?.items || [], now);
  const name = shortName(data?.stop?.name || stop.name);
  return (
    <Card>
      <CardHeader title={name} glyph={starred ? I.star : undefined} glyphColor={c.yellow} right={distText(distance)} onLongPress={onLongPress}
        onPress={() => router.push({ pathname: '/stop/[id]', params: { id: stop.id, name: data?.stop?.name || stop.name } })} />
      {!data ? <T kind="foot" tone="text2" style={s.note}>{error ? 'Live times unavailable right now, trying again' : 'Loading live times'}</T> : null}
      {data && !groups.length ? <T kind="foot" tone="text2" style={s.note}>No more services right now</T> : null}
      {groups.map(({ d, next }, i) => {
        const t = cd(bestTime(d.planned, d.realtime ? d.estimated : null), now);
        const n = next ? cd(bestTime(next.planned, next.realtime ? next.estimated : null), now) : null;
        return (
          <View key={`${d.line}|${d.dest}|${i}`}>
            <Sep inset={16} />
            <Pressable onPress={() => openService(d)} android_ripple={{ color: c.fill }} accessibilityLabel={`${d.line} to ${d.dest}, ${t.big} ${t.unit}${d.realtime ? ', live' : ', scheduled'}`}
              style={({ pressed }) => [s.dep, pressed && Platform.OS !== 'android' ? { backgroundColor: c.card2 } : null]}>
              <LineBadge small line={d.line} mode={d.mode} color={d.color} />
              <T kind="body" numberOfLines={1} style={{ flex: 1, marginLeft: 10 }}>{shortName(d.dest)}</T>
              <Text maxFontSizeMultiplier={1.4} style={[font.callout, { fontWeight: '600', color: d.realtime ? c.liveText : c.text, fontVariant: ['tabular-nums'], marginLeft: 8 }]}>
                {t.big}{t.unit ? ` ${t.unit}` : ''}
              </Text>
              {n ? <T kind="foot" tone="text2" style={{ marginLeft: 8, minWidth: 22, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{n.big}</T> : null}
            </Pressable>
          </View>
        );
      })}
    </Card>
  );
}

// ---------- Nearby ----------

type Near = Place & { distance?: number; modes?: number[] };
const parents = new Map<string, Near | null>();

async function parentOf(seg: string): Promise<Near | null> {
  if (parents.has(seg)) return parents.get(seg)!;
  let p: Near | null = null;
  try {
    const r = await api.search(seg);
    const it = r.items?.[0];
    if (it && it.name.toLowerCase().startsWith(seg.toLowerCase())) p = { id: it.id, name: it.name, modes: it.modes };
  } catch {}
  parents.set(seg, p);
  return p;
}

/** /api/nearby lists each platform or stand on its own; fold them into the stations and stops a person thinks in. */
export async function nearbyStops(lat: number, lon: number): Promise<Near[]> {
  const r: any = await api.nearby(lat, lon);
  const groups = new Map<string, { seg: string; members: Near[]; distance: number }>();
  for (const x of r.stops || r.items || []) {
    const seg = String(x.name || '').split(',')[0].trim();
    if (!seg) continue;
    const dist = Number(x.distance ?? x.distanceM ?? x.dist);
    const g = groups.get(seg) || { seg, members: [], distance: Infinity };
    g.members.push({ id: String(x.id), name: x.name, distance: dist, modes: x.modes });
    if (Number.isFinite(dist)) g.distance = Math.min(g.distance, dist);
    groups.set(seg, g);
  }
  const sorted = [...groups.values()].sort((a, b) => a.distance - b.distance).slice(0, 5);
  const out: Near[] = [];
  for (const g of sorted) {
    let p: Near | null = null;
    if (/(Station|Wharf)$/i.test(g.seg) || g.members.length > 1) p = await parentOf(g.seg);
    const pick: Near = p ? { ...p, distance: g.distance } : g.members.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0))[0];
    if (!out.some((o) => o.id === pick.id)) out.push(pick);
    if (out.length >= 3) break;
  }
  return out;
}

type NearState = { phase: 'checking' | 'off' | 'loading' | 'on' | 'error'; stops: Near[]; error?: string };

export function useNearby() {
  const [st, setSt] = useState<NearState>({ phase: 'checking', stops: [] });

  const load = async () => {
    setSt((s) => ({ ...s, phase: s.stops.length ? 'on' : 'loading' }));
    try {
      let pos = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60000 }).catch(() => null);
      if (!pos) pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const stops = await nearbyStops(pos.coords.latitude, pos.coords.longitude);
      setSt({ phase: 'on', stops });
    } catch (e: any) {
      setSt((s) => (s.stops.length ? s : { phase: 'error', stops: [], error: String(e?.message || e) }));
    }
  };

  useEffect(() => {
    let alive = true;
    Location.getForegroundPermissionsAsync()
      .then((p) => { if (!alive) return; if (p.granted) load(); else setSt({ phase: 'off', stops: [] }); })
      .catch(() => alive && setSt({ phase: 'off', stops: [] }));
    pullers.add(reload);
    return () => { alive = false; pullers.delete(reload); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function reload() {
    Location.getForegroundPermissionsAsync().then((p) => { if (p.granted) load(); }).catch(() => {});
  }

  const ask = async () => {
    setSt((s) => ({ ...s, phase: 'loading' }));
    try {
      const p = await Location.requestForegroundPermissionsAsync();
      if (p.granted) return load();
      setSt({ phase: 'off', stops: [] });
      if (!p.canAskAgain && Platform.OS !== 'web') {
        Alert.alert('Location is off', 'Allow location for Transport in Settings to see stops near you.', [
          { text: 'Not now', style: 'cancel' },
          { text: 'Settings', onPress: () => Linking.openSettings() },
        ]);
      }
    } catch {
      setSt({ phase: 'off', stops: [] });
    }
  };
  return { ...st, ask };
}

// ---------- search field look-alike ----------

export function SearchField() {
  const c = usePalette();
  return (
    <Pressable accessibilityRole="search" accessibilityLabel="Where to?"
      onPress={() => router.navigate({ pathname: '/search', params: { focus: String(Date.now()) } })}
      style={[s.search, { backgroundColor: Platform.OS === 'android' ? c.card : c.fill, borderRadius: Platform.OS === 'android' ? 28 : 10, height: Platform.OS === 'android' ? 52 : undefined }]}>
      <Icon name={I.search} size={Platform.OS === 'android' ? 20 : 17} color={c.text2} />
      <T kind="body" style={{ color: c.text2, marginLeft: 8, flex: 1 }} numberOfLines={1}>Where to?</T>
    </Pressable>
  );
}

/** "Add home" and "Add work" buttons, shown until both are set. */
export function PlaceBar({ places }: { places: { home?: Place; work?: Place } }) {
  const c = usePalette();
  if (places.home && places.work) return null;
  const btn = (k: 'home' | 'work') => {
    const p = places[k];
    const label = p ? shortName(p.name).replace(/ Station$/, '') : k === 'home' ? 'Add home' : 'Add work';
    return (
      <Pressable key={k} onPress={() => router.push({ pathname: '/add-trip', params: { place: k } })} accessibilityRole="button" android_ripple={{ color: c.fill }}
        style={({ pressed }) => [s.place, { backgroundColor: c.card, opacity: pressed && Platform.OS !== 'android' ? 0.6 : 1 }]}>
        <View style={[s.actionIcon, { backgroundColor: c.fill, marginRight: 10 }]}><Icon name={k === 'home' ? I.home : I.briefcase} size={14} color={c.tint} /></View>
        <T kind="body" numberOfLines={1} style={{ flex: 1, color: p ? c.text : c.tint }}>{label}</T>
      </Pressable>
    );
  };
  return <View style={{ flexDirection: 'row', gap: 10, marginHorizontal: 16, marginTop: 12 }}>{btn('home')}{btn('work')}</View>;
}

/** Small "Live 07:55" stamp with a green dot. */
export function LiveTag() {
  const c = usePalette();
  const t = useLastLive();
  if (!t) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityLabel={`Live, updated ${hm24(t)}`}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.green, marginRight: 5 }} />
      <T kind="foot" tone="text2" style={{ fontVariant: ['tabular-nums'] }}>Live {hm24(t)}</T>
    </View>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 },
  note: { paddingHorizontal: 16, paddingBottom: 13 },
  svc: { flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingRight: 16, paddingVertical: 10 },
  block: { width: 56, alignSelf: 'stretch', minHeight: 56, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  dep: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, minHeight: 46 },
  action: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, minHeight: 48 },
  actionIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  banner: { flexDirection: 'row', alignItems: 'flex-start', marginHorizontal: 16, marginTop: 12, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 12 },
  place: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 11, borderRadius: 12, minHeight: 46 },
  search: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 6, paddingHorizontal: 10, paddingVertical: 8 },
});
