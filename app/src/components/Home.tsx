import { useEffect, useState, useSyncExternalStore } from 'react';
import { reportTripLines, tripLinesOf } from '@/lib/myLines';
import { ActivityIndicator, Alert, type AlertButton, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { haptic } from '@/lib/haptic';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { api } from '@/lib/api';
import { useLive } from '@/lib/hooks';
import { cacheKey, offlineText } from '@/lib/offlineCore';
import { foldNear, type NearPick } from '@/lib/nearCore';
import { stopNumber } from '@/lib/busCore';
import { chipTime, makeDeletedNames, thenText, undoableDelete, whereText } from '@/lib/homeCore';
import { radius, usePalette } from '@/lib/theme';
import { bestTime, clock, durText, liveStamp, ms, shortName } from '@/lib/format';
import { clearAllPlan } from '@/lib/planCore';
import type { Departure, Journey, Leg, Place } from '@/lib/types';
import { store, tripKeyOf } from '@/lib/store';
import { directFilter, isChain, planTrip, tLegs, tripKey, viaText } from '@/lib/trips';
import type { TripLeg } from '@/lib/trips';
import { Icon, I, IconName } from './Icon';
import { safeUrl } from '@/lib/access';
import { openService } from './Cards';
import { LineBadge, OccupancyChip } from './Transit';
import { swipeA11y, type SwipeAct } from './Swipe';
import { useReliabilityText } from '@/lib/reliability';
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

/** Time of the newest successful live load on Home, for the "Live 9:52am" stamp. */
export function useLastLive() {
  return useSyncExternalStore((l) => { liveSubs.add(l); return () => { liveSubs.delete(l); }; }, () => lastLive, () => lastLive);
}

// Cards showing times kept on the phone (no signal), for the Offline tag in Home's header.
const offlineCards = new Map<string, number>();
let offlineSnap = 0;
function reportOffline(key: string, at: number | null) {
  if (at) offlineCards.set(key, at); else offlineCards.delete(key);
  const next = offlineCards.size ? Math.min(...offlineCards.values()) : 0;
  if (next === offlineSnap) return;
  offlineSnap = next;
  liveSubs.forEach((f) => f());
}
function useOfflineSince() {
  return useSyncExternalStore((l) => { liveSubs.add(l); return () => { liveSubs.delete(l); }; }, () => offlineSnap, () => offlineSnap);
}

/** useLive at Home's 15 s pace, joined to pull to refresh and the Live stamp. Answers are kept on the phone under `key`. */
function useHomeLive<T>(load: (refresh: boolean) => Promise<T>, deps: any[], key?: string) {
  const live = useLive(load, 15000, deps, { cacheKey: key });
  const { updatedAt, refresh, offlineAt } = live;
  useEffect(() => { if (updatedAt) markLive(); }, [updatedAt]);
  useEffect(() => {
    if (!key) return;
    reportOffline(key, offlineAt);
    return () => reportOffline(key, null);
  }, [key, offlineAt]);
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
// Every alert on the services the Home trip cards show, by trip, for the redesign's single alerts line.
const tripAlerts = new Map<string, string[]>();
const tripAlertSubs = new Set<() => void>();
let tripAlertSnap: string[] = [];
function reportTripAlerts(key: string, list: string[]) {
  const prev = tripAlerts.get(key) || [];
  if (prev.join('\n') === list.join('\n')) return;
  if (list.length) tripAlerts.set(key, list); else tripAlerts.delete(key);
  tripAlertSnap = [...new Set([...tripAlerts.values()].flat())];
  tripAlertSubs.forEach((f) => f());
}
/** The distinct alert titles across the trips on Home. */
export function useTripAlerts(): string[] {
  return useSyncExternalStore((f) => { tripAlertSubs.add(f); return () => { tripAlertSubs.delete(f); }; }, () => tripAlertSnap, () => tripAlertSnap);
}

/** Redesign: all alerts on your trips as one line that opens in place, instead of "N alerts" under every card. */
export function AlertsLine() {
  const c = usePalette();
  const list = useTripAlerts();
  const [open, setOpen] = useState(false);
  if (!list.length) return null;
  return (
    <View style={{ marginHorizontal: 16, marginTop: 12, borderRadius: radius, backgroundColor: c.card, overflow: 'hidden' }}>
      <Pressable onPress={() => { haptic.select(); setOpen(!open); }} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${list.length} ${list.length === 1 ? 'alert' : 'alerts'} on your trips`}
        style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 46 }}>
        <Icon name={I.warn} size={14} color={c.orange} />
        <T kind="sub" style={{ marginLeft: 8, flex: 1, fontWeight: '600' }}>{list.length} {list.length === 1 ? 'alert' : 'alerts'} on your trips</T>
        <Icon name={I.chevron} size={12} color={c.text3} style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }} />
      </Pressable>
      {open ? list.map((a, i) => <View key={i}><Sep inset={16} /><T kind="foot" tone="text2" style={{ paddingHorizontal: 16, paddingVertical: 10 }}>{a}</T></View>) : null}
    </View>
  );
}

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

/** Countdown parts: "4" + "min", "Now", "Left" once gone, or a clock time past an hour. */
const cd = (t: number, now: number) => chipTime(t, now, hm);

/** Countdown chip colour by time left: red at 3 min or less, amber 4 to 9, green 10 plus, grey when cancelled. */
export function cdColor(t: number, now: number, cancelled: boolean, c: { red: string; green: string; text3: string }) {
  if (cancelled) return c.text3;
  const m = Math.floor((t - now) / 60000);
  return m <= 3 ? c.red : m <= 9 ? AMBER : c.green;
}
const AMBER = '#F5A300';
/** Text colour for a countdown chip: the chip's hue, dark enough (light mode) or light enough (dark mode) for 4.5:1 on its tint. */
export function cdText(chip: string, c: { dark: boolean; red: string; green: string; redText: string; liveText: string; text2: string }) {
  if (chip === c.red) return c.redText;
  if (chip === AMBER) return c.dark ? '#FFC94D' : '#8A5A00';
  if (chip === c.green) return c.liveText;
  return c.text2;
}

const plat = (p?: string | null) => (p ? p.replace(/^Platform\s*/i, 'Plat ') : '');

const distText = (m?: number) => (m == null || !Number.isFinite(m) ? '' : m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

// ---------- section header and simple rows ----------

export function HomeSection({ title, children, onClear, clearTitle, footer, action }: { title: string; children: React.ReactNode; onClear?: () => void; clearTitle?: string; footer?: string; action?: { title: string; label?: string; onPress: () => void } }) {
  const c = usePalette();
  return (
    <View style={{ marginTop: 28 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginBottom: 4, minHeight: 32 }}>
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={[font.headline, { fontWeight: '700', color: c.text, flex: 1 }]}>{title}</Text>
        {onClear ? (
          <Pressable onPress={onClear} hitSlop={10} accessibilityRole="button" accessibilityLabel={`${clearTitle || 'Clear'}, ${title}`} style={action ? { marginRight: 14 } : null}>
            <T kind="sub" tone="tint" style={{ fontWeight: '600' }}>{clearTitle || 'Clear'}</T>
          </Pressable>
        ) : null}
        {action ? (
          <Pressable onPress={action.onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={action.label || action.title}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, height: 32, borderRadius: 16, backgroundColor: c.fill, opacity: pressed ? 0.7 : 1 })}>
            <Icon name={I.plus} size={14} color={c.tint} />
            <T kind="sub" tone="tint" style={{ fontWeight: '600' }}>{action.title}</T>
          </Pressable>
        ) : null}
      </View>
      {children}
      {footer ? <T kind="foot" tone="text2" style={{ marginHorizontal: 20, marginTop: 8 }}>{footer}</T> : null}
    </View>
  );
}

/** A Home card. flush: no outer margins, for a card inside a swipe row that already has them (CARD_SWIPE). */
function Card({ children, style, flush }: { children: React.ReactNode; style?: any; flush?: boolean }) {
  const c = usePalette();
  return <View style={[{ backgroundColor: c.card, borderRadius: radius, marginHorizontal: 16, marginTop: 10, overflow: 'hidden' }, flush && { marginHorizontal: 0, marginTop: 0 }, style]}>{children}</View>;
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

function CardHeader({ title, glyph, glyphColor, right, sub, onPress, onLongPress, trailing, act }: { title: string; glyph?: IconName; glyphColor?: string; right?: string; sub?: React.ReactNode; onPress: () => void; onLongPress?: () => void; trailing?: React.ReactNode; act?: SwipeAct }) {
  const c = usePalette();
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} accessibilityRole="button" android_ripple={{ color: c.fill }} {...swipeA11y(act)}
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
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingLeft: 86, paddingRight: 16, paddingBottom: 12, marginTop: -6 }} accessibilityRole="text">
      <Icon name={I.warn} size={13} color={bad ? c.red : c.orange} style={{ marginTop: 2 }} />
      <T kind="foot" style={{ color: bad ? c.redText : c.lateText, flex: 1, fontWeight: '500' }}>{j.warn}</T>
    </View>
  );
}

/** Tap and hold (or swipe) on a Home trip: the actions for that kind of trip. */
/**
 * A hold menu as an alert. Android dialogs show at most 3 buttons (the first ones are dropped), so there Cancel
 * gives way when a menu has 3 actions: tapping outside or Back closes the dialog.
 */
function holdMenu(title: string, message: string | undefined, buttons: AlertButton[]) {
  const list = Platform.OS === 'android' && buttons.length > 3 ? buttons.filter((b) => b.style !== 'cancel') : buttons;
  Alert.alert(title, message, list, { cancelable: true });
}

export function tripMenu(trip: TripItem, route?: string, onTop?: () => void) {
  const { from, to, via } = trip;
  const title = route || `${shortName(from.name)} to ${shortName(to.name)}`;
  haptic.tap();
  const key = tripKeyOf({ from, to, via, legs: trip.legs });
  // Show first: the trip moves to the top of Home, where it is the Next trip card.
  const top: AlertButton[] = onTop ? [{ text: 'Show first', onPress: onTop }] : [];
  const editParams = { from: from.id, fromName: from.name, to: to.id, toName: to.name, ...(trip.modes?.[0] ? { mode: trip.modes[0] } : {}), ...(trip.legs && trip.legs.length > 1 ? { legs: JSON.stringify(trip.legs) } : {}), ...(trip.name ? { name: trip.name } : {}), edit: key };
  if (trip.kind === 'mine') {
    holdMenu(trip.name || title, undefined, [
      { text: 'Edit trip', onPress: () => router.push({ pathname: '/new-trip', params: editParams }) },
      ...top,
      { text: 'Delete trip', style: 'destructive', onPress: () => deleteTrip(trip) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  } else if (trip.kind === 'saved') {
    holdMenu(trip.name || title, 'Saved on your profile.', [
      ...top,
      { text: 'Delete trip', style: 'destructive', onPress: () => deleteTrip(trip) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  } else if (trip.kind === 'commute') {
    holdMenu(trip.name || title, 'Your commute: a leave now alert on the days you set.', [
      ...top,
      { text: 'Delete commute', style: 'destructive', onPress: () => { if (trip.id) api.deleteCommute(trip.id).then(pullHome).catch((e) => Alert.alert("Couldn't delete it", e.message)); } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  } else if (trip.kind === 'place') {
    holdMenu('Home and work', undefined, [
      { text: 'Change home', onPress: () => router.push({ pathname: '/add-trip', params: { place: 'home' } }) },
      { text: 'Change work', onPress: () => router.push({ pathname: '/add-trip', params: { place: 'work' } }) },
      { text: 'Remove both', style: 'destructive', onPress: () => { store.setPlace('home', null); store.setPlace('work', null); } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  } else {
    holdMenu(title, undefined, [
      { text: 'Save trip', onPress: () => router.push({ pathname: '/new-trip', params: { from: from.id, fromName: from.name, to: to.id, toName: to.name } }) },
      { text: 'Remove from Recent', style: 'destructive', onPress: () => store.removeRecentTrip(from.id, to.id) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }
}

/** Delete trip: off this phone, out of the Home order, and the server copy too. */
/** Saved trip names deleted on this phone, hidden from the server list until it catches up. */
export const deletedSaved = makeDeletedNames();

/** Clear all in Your trips: trips kept on the phone, saved trips and commutes, with one haptic and one refresh. */
export async function clearAllTrips(trips: TripItem[]) {
  const plan = clearAllPlan(trips);
  if (plan.mine.length) store.removeMyTrips(plan.mine);
  plan.saved.forEach((n) => deletedSaved.add(n));
  haptic.success();
  await Promise.all([...plan.saved.map((n) => api.deleteSaved(n).catch(() => null)), ...plan.commutes.map((id) => api.deleteCommute(id).catch(() => null))]);
  pullHome();
}

export function deleteTrip(trip: TripItem) {
  const key = tripKeyOf({ from: trip.from, to: trip.to, via: trip.via, legs: trip.legs });
  const d = undoableDelete(() => {
    const mine = store.myTrips(), order = store.getOrder();
    if (trip.kind === 'mine') store.removeMyTrip(key);
    if (order.includes(key)) store.setTripOrder(order.filter((k) => k !== key));
    if (trip.name) deletedSaved.add(trip.name);
    return () => { store.setMyTrips(mine); store.setTripOrder(order); if (trip.name) deletedSaved.remove(trip.name); pullHome(); };
  }, trip.name ? () => { api.deleteSaved(trip.name!).then(pullHome).catch(() => {}); } : null, UNDO_MS + 500);
  haptic.success();
  for (const f of undoSubs) f({ text: `${trip.name ? trip.name.charAt(0).toUpperCase() + trip.name.slice(1) : 'Trip'} deleted`, undo: () => { d.undo(); }, commit: d.commit });
}

/** How long Home's Undo bar stays after a delete. The server copy is deleted just after it goes. */
export const UNDO_MS = 5000;
type UndoBar = { text: string; undo: () => void; commit: () => void };
const undoSubs = new Set<(u: UndoBar) => void>();
/** Home shows the Undo bar (above the tab bar) for every trip deleted from a swipe, a hold menu or VoiceOver. */
export function onTripDeleted(f: (u: UndoBar) => void) { undoSubs.add(f); return () => { undoSubs.delete(f); }; }

/** Home's trip looks: 'hero' is the Next trip card, 'row' every other trip. */
export type TripLook = 'hero' | 'row';

export function TripBoard({ trip, now, handle, allServices, below, aside, flush, act, look = 'row', onTop }: { trip: TripItem; now: number; handle?: React.ReactNode | ((open: () => void) => React.ReactNode); allServices?: boolean;
  look?: TripLook;
  /** Show first: puts this trip on top, where it becomes the Next trip card (offered in the trip's hold menu). */
  onTop?: () => void;
  /** Inside a swipe row: the row has the card's margins, and act is its swipe action, offered to VoiceOver too. */
  flush?: boolean; act?: SwipeAct;
  /** A button beside the header, outside its tap area (the commute swap), so a tap on it never also opens the trip. */
  aside?: React.ReactNode;
  /** Extra content under the header that reads the services shown (the commute card's leave time). */
  below?: (js: Journey[]) => React.ReactNode }) {
  const c = usePalette();
  const { from, to, via } = trip;
  const plan = { from, to, via, conn: trip.conn, legs: trip.legs, modes: trip.modes };
  const chain = isChain(plan);
  const pkey = tripPkey(plan);
  const { data, error, offlineAt } = useHomeLive((r) => planTrip(plan, { refresh: r, count: 6, all: chain && !!allServices }), [pkey, chain && !!allServices], cacheKey('trip', tripCacheId(pkey, chain && !!allServices)));

  // Remember each live reading for the hold.
  useEffect(() => {
    const t = Date.now();
    for (const j of data?.journeys || []) {
      const l = firstLeg(j);
      if (l?.realtime) holds.set(legKey(l), { delay: l.delayMin || 0, at: t });
    }
  }, [data]);

  const js = directFilter((data?.journeys || []).filter((j) => depOf(j) > now - 30000), plan, !!allServices, (j) => j).list.slice(0, 3);
  // The lines this trip uses, for the weekend trackwork card and line status (Home and Work, commutes, saved trips).
  const lineSig = js.map((j) => j.legs.map((l) => (l.kind === 'walk' ? '' : l.line || '')).join('.')).join('|');
  useEffect(() => {
    if (trip.kind === 'recent' || !lineSig) return;
    const hour = trip.tag === 'To work' ? 8 : trip.tag === 'To home' ? 17 : 10;
    const label = trip.name && trip.kind !== 'place' ? trip.name.charAt(0).toUpperCase() + trip.name.slice(1) : `${shortName(from.name).replace(/ Station$/, '')} to ${shortName(to.name).replace(/ Station$/, '')}`;
    reportTripLines(pkey, tripLinesOf(pkey, from.id, to.id, label, js, hour));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkey, lineSig]);
  useEffect(() => () => reportTripLines(pkey, null), [pkey]);
  const arrs = js.map(arrOf);
  const alerts = new Set<string>();
  js.forEach((j) => j.legs.forEach((l) => (l.alerts || []).forEach((a: any) => alerts.add(typeof a === 'string' ? a : a.title))));
  const highKey = (data?.journeys || []).slice(0, 3).map((j) => j.legs.map((l) => (l.alerts || []).map((a: any) => (typeof a === 'string' ? '' : `${a.priority}:${a.title}`)).join()).join()).join();

  const fromName = shortName(from.name).replace(/ Station$/, ''), toName = shortName(to.name).replace(/ Station$/, '');
  const route = `${fromName} to ${toName}`;
  const custom = trip.name && trip.name.toLowerCase() !== route.toLowerCase() ? trip.name.charAt(0).toUpperCase() + trip.name.slice(1) : '';
  const open = (pick?: number) => router.push({ pathname: '/trip', params: { from: from.id, fromName: from.name, to: to.id, toName: to.name, ...(chain ? { legs: JSON.stringify(tLegs(plan)) } : {}), ...(trip.name ? { name: trip.name } : {}), ...(pick != null ? { pick: String(pick) } : {}) } });
  const glyph = trip.kind === 'saved' || trip.kind === 'mine' ? I.star : trip.kind === 'commute' ? I.clock : trip.kind === 'place' ? (trip.tag === 'To work' ? I.briefcase : I.home) : undefined;
  const menu = () => tripMenu(trip, route, onTop);
  useEffect(() => {
    const list: { title: string; url?: string; open: () => void }[] = [];
    for (const j of (data?.journeys || []).slice(0, 3)) for (const l of j.legs) for (const a of (l.alerts || []) as any[]) {
      if (typeof a !== 'string' && /high/i.test(a.priority || '') && !list.some((x) => x.title === a.title)) list.push({ title: a.title, url: a.url, open: () => open() });
    }
    reportHigh(trip.key, list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highKey, trip.key]);
  useEffect(() => () => reportHigh(trip.key, []), [trip.key]);
  const alertSig = [...alerts].join('\n');
  useEffect(() => { reportTripAlerts(trip.key, alertSig ? alertSig.split('\n') : []); }, [alertSig, trip.key]);
  useEffect(() => () => reportTripAlerts(trip.key, []), [trip.key]);


  const note = !data ? (error ? 'Live times unavailable, trying again' : 'Loading live times') : !js.length ? (offlineAt ? 'No kept times left for today' : data.error || 'No more services today') : '';
  const glance = (
    <TripGlance look={look} js={js} arrs={arrs} now={now} title={custom || route} glyph={glyph} glyphColor={trip.kind === 'saved' || trip.kind === 'mine' ? c.yellow : c.tint}
      note={note} onPress={() => open()} onLongPress={menu} act={act} roomRight={aside ? 40 : 0}
      trailing={typeof handle === 'function' ? handle(() => open()) : handle} />
  );
  return (
    <Card flush={flush}>
      {aside ? (
        // The swap button sits over the card's top right corner, outside the card's tap area, so a tap on it never opens the trip.
        <View>
          {glance}
          <View style={{ position: 'absolute', top: 2, right: 2 }}>{aside}</View>
        </View>
      ) : glance}
      {below && js.length ? below(js) : null}
    </Card>
  );
}

/**
 * Home's trip looks. 'hero' is the Next trip card: a big countdown, line badges, where to board, status, leave and
 * arrive, then the next two. 'row' is every other trip: name; badges, status and where to board; the next two;
 * the countdown at the right edge. One tap target per trip; every service is on the trip screen.
 */
function TripGlance({ look, js, arrs, now, title, glyph, glyphColor, note, onPress, onLongPress, act, trailing, roomRight = 0 }: { look: TripLook; js: Journey[]; arrs: number[]; now: number; title: string; glyph?: IconName; glyphColor?: string; note: string; onPress: () => void; onLongPress: () => void; act?: SwipeAct; trailing?: React.ReactNode; roomRight?: number }) {
  const c = usePalette();
  const j = js[0];
  const l = j ? firstLeg(j) : undefined;
  const dep = j ? depOf(j) : 0;
  const stt = j ? statusOf(j, now) : null;
  const tone = !stt ? c.text2 : stt.tone === 'live' ? c.liveText : stt.tone === 'late' ? c.lateText : stt.tone === 'red' ? c.redText : c.text2;
  const cancelled = stt?.tone === 'red';
  const chip = j ? cdColor(dep, now, cancelled, c) : c.text3;
  const t = j ? cd(dep, now) : { big: '', unit: '' };
  const badges: Leg[] = [];
  for (const x of j ? j.legs.filter((y) => y.kind === 'transit') : []) if (x.line && !badges.some((b) => b.line === x.line)) badges.push(x);
  const where = whereText(l?.fromPlatform, l?.stopId, l?.mode, look === 'hero');
  const then = thenText(js.slice(1, 3).map((x) => cd(depOf(x), now)));
  const head = (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {glyph && glyph !== I.star && look === 'hero' ? <Icon name={glyph} size={15} color={glyphColor || c.tint} style={{ marginRight: 6 }} /> : null}
      <T kind={look === 'row' ? 'body' : 'headline'} numberOfLines={2} style={{ flexShrink: 1, fontWeight: '600' }}>{title}</T>
    </View>
  );
  const spoken = (x: { big: string; unit: string }) => (x.unit ? `${x.big} ${x.unit === 'min' ? 'minutes' : x.unit}` : x.big);
  const a11y = j
    ? `${title}. ${spoken(t)}, leaves ${hm(dep)}${where ? ` from ${where}` : ''}, ${stt?.text}, arrives ${hm(arrs[0])}${badges.length ? `, ${badges.map((b) => b.line).join(' and ')}` : ''}${then ? `. ${then}` : ''}`
    : `${title}. ${note}`;
  const press = ({ pressed }: { pressed: boolean }) => [pressed && Platform.OS !== 'android' ? { backgroundColor: c.card2 } : null];

  if (look === 'hero') {
    return (
      <Pressable onPress={onPress} onLongPress={onLongPress} accessibilityRole="button" accessibilityLabel={a11y} accessibilityHint="Opens the trip with every service" android_ripple={{ color: c.fill }} {...swipeA11y(act)} style={(p) => [g.hero, ...press(p)]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingRight: roomRight }}>
          <View style={{ flex: 1 }}>{head}</View>
          {trailing || (roomRight ? null : <Icon name={I.chevron} size={13} color={c.text3} style={{ marginLeft: 6 }} />)}
        </View>
        {j ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
                <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 56, lineHeight: 62, fontWeight: '800', color: cdText(chip, c), fontVariant: ['tabular-nums'], letterSpacing: -1.5 }}>{t.big}</Text>
                {t.unit ? <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 20, fontWeight: '700', color: cdText(chip, c), marginLeft: 5, marginBottom: 10 }}>{t.unit}</Text> : null}
              </View>
              <View style={{ flex: 1, minWidth: 120, alignItems: 'flex-end', marginBottom: 10, marginLeft: 12, gap: 6 }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 4 }}>{badges.slice(0, 3).map((b, i) => <LineBadge key={`${b.line}${i}`} line={b.line} mode={b.mode} color={b.color} />)}</View>
                {where ? <T kind="sub" numberOfLines={2} style={{ fontWeight: '600', textAlign: 'right' }}>{where}</T> : null}
              </View>
            </View>
            <T kind="sub" numberOfLines={2}>
              <T kind="sub" style={{ color: tone }}>{stt?.text}</T>
              <T kind="sub" tone="text2">{` \u00b7 ${hm(dep)} \u2192 ${hm(arrs[0])} \u00b7 ${durText(j.durationMin)}`}</T>
            </T>
            {then ? <T kind="sub" tone="text2" style={{ marginTop: 4 }}>{then}</T> : null}
          </>
        ) : <T kind="foot" tone="text2" style={{ marginTop: 8 }}>{note}</T>}
      </Pressable>
    );
  }

  // 'row': two or three short lines per trip, the next countdown at the right edge.
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} accessibilityRole="button" accessibilityLabel={a11y} android_ripple={{ color: c.fill }} {...swipeA11y(act)} style={(p) => [g.row, ...press(p)]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        {head}
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
          {badges.slice(0, 2).map((b, i) => <LineBadge key={`${b.line}${i}`} line={b.line} mode={b.mode} color={b.color} />)}
          <T kind="foot" numberOfLines={2} style={{ flexShrink: 1 }}>
            {j ? <T kind="foot" style={{ color: tone }}>{stt?.text}</T> : <T kind="foot" tone="text2">{note}</T>}
            {where ? <T kind="foot" tone="text2">{` \u00b7 ${where}`}</T> : null}
          </T>
        </View>
        {then ? <T kind="foot" tone="text2" numberOfLines={1} style={{ marginTop: 2 }}>{then}</T> : null}
      </View>
      {j ? (
        <View style={[g.chip, { marginLeft: 10, backgroundColor: chip + (c.dark ? '33' : '1F') }]}>
          <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={{ color: cdText(chip, c), fontSize: t.unit ? 22 : 14, fontWeight: '700', fontVariant: ['tabular-nums'], letterSpacing: -0.4 }}>{t.big}</Text>
          {t.unit ? <Text maxFontSizeMultiplier={1.3} style={{ color: cdText(chip, c), fontSize: 11, fontWeight: '600', marginTop: -2 }}>{t.unit}</Text> : null}
        </View>
      ) : null}
      {trailing || <Icon name={I.chevron} size={13} color={c.text3} style={{ marginLeft: 8 }} />}
    </Pressable>
  );
}

const g = StyleSheet.create({
  hero: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 12, paddingVertical: 10, minHeight: 64 },
  chip: { minWidth: 52, minHeight: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, paddingVertical: 4 },
});

/** TripView style service row: countdown chip coloured by time left, leave time and status, arrive time with line badges. */
export function ServiceRow({ j, now, arrive, beaten, onPress, showTravel }: { j: Journey; now: number; arrive: number; beaten?: boolean; onPress: () => void; showTravel?: boolean }) {
  const c = usePalette();
  const l = firstLeg(j);
  const dep = depOf(j);
  const stt = statusOf(j, now);
  const relRaw = useReliabilityText(l);
  const t = showTravel ? (j.durationMin >= 60 ? { big: `${Math.floor(j.durationMin / 60)}h ${j.durationMin % 60}`, unit: 'min' } : { big: String(j.durationMin), unit: 'min' }) : cd(dep, now);
  const toneText = stt.tone === 'live' ? c.liveText : stt.tone === 'late' ? c.lateText : stt.tone === 'red' ? c.redText : c.text2;
  const legs = j.legs.filter((x) => x.kind === 'transit');
  const last = legs[legs.length - 1];
  const cancelled = stt.tone === 'red';
  const rel = cancelled ? null : relRaw;
  const chip = showTravel ? (cancelled ? c.text3 : '#8E8E93') : cdColor(dep, now, cancelled, c);
  const badges: Leg[] = [];
  for (const x of legs) if (x.line && !badges.some((b) => b.line === x.line)) badges.push(x);
  const changes = j.changes || Math.max(0, legs.length - 1);
  const boardAt = plat(l?.fromPlatform);
  const bigSize = t.unit ? 22 : t.big === 'Now' ? 16 : 13;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} android_ripple={{ color: c.fill }} accessibilityLabel={`Leaves ${hm(dep)}${boardAt ? ` from ${boardAt}` : ''}, ${t.big} ${t.unit}, arrives ${hm(arrive)}, ${stt.text}${changes ? `, ${changes} change${changes > 1 ? 's' : ''}` : ''}${rel ? `. ${rel}` : ''}`}
      style={({ pressed }) => [s.svc, (beaten || dep < now - 30000) && { opacity: 0.45 }, pressed && Platform.OS !== 'android' ? { backgroundColor: c.card2 } : null]}>
      <View style={[s.block, { backgroundColor: chip + (c.dark ? '33' : '1F') }]}>
        <Text maxFontSizeMultiplier={1.3} style={{ color: cdText(chip, c), fontSize: bigSize, fontWeight: '700', fontVariant: ['tabular-nums'], letterSpacing: -0.4 }} numberOfLines={1} adjustsFontSizeToFit>{t.big}</Text>
        {t.unit ? <Text maxFontSizeMultiplier={1.3} style={{ color: cdText(chip, c), fontSize: 11, fontWeight: '600', marginTop: -2 }}>{t.unit}</Text> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, marginLeft: 14 }}>
        <Text maxFontSizeMultiplier={1.4} style={[font.title3, { color: c.text, fontVariant: ['tabular-nums'], textDecorationLine: cancelled ? 'line-through' : 'none' }]}>{hm(dep)}{' '}<Text style={{ color: c.text3, fontWeight: '400' }}>{'\u2192'}</Text>{' '}{hm(arrive)}</Text>
        <T kind="foot" numberOfLines={1} style={{ marginTop: 2 }}>
          <T kind="foot" style={{ color: toneText }}>{stt.text}</T>
          {boardAt ? <T kind="foot" tone="text2">{` \u00b7 ${boardAt}`}</T> : null}
          <T kind="foot" tone="text2">{` \u00b7 ${durText(j.durationMin)}`}</T>
        </T>
        {l?.platformChangedFrom ? <T kind="foot" numberOfLines={1} style={{ color: c.lateText, marginTop: 1 }}>Platform changed from {plat(l.platformChangedFrom)}</T> : null}
        <OccupancyChip o={l?.occupancy} style={{ marginTop: 3 }} />
        {rel ? <T kind="foot" tone="text2" numberOfLines={1} style={{ marginTop: 2 }}>{rel}</T> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 8 }}>
        {badges.slice(0, 3).map((b, i) => <LineBadge key={`${b.line}${i}`} line={b.line} mode={b.mode} color={b.color} />)}
      </View>
    </Pressable>
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
  const { data, error, offlineAt } = useHomeLive((r) => api.departures(stop.id, r), [stop.id], cacheKey('dep', stop.id));
  const groups = groupDepartures(data?.items || [], now);
  const name = shortName(data?.stop?.name || stop.name);
  // A bus stop shows the number on its sign, as the Opal app does.
  const busOnly = !!data?.items?.length && data.items.every((d) => d.mode === 'bus' || d.mode === 'coach' || d.mode === 'school');
  const sign = busOnly ? stopNumber(stop.id) : null;
  const right = [sign ? `Stop ${sign}` : '', distText(distance) || ''].filter(Boolean).join(' \u00b7 ') || undefined;
  return (
    <Card>
      <CardHeader title={name} glyph={starred ? I.star : undefined} glyphColor={c.yellow} right={right} onLongPress={onLongPress}
        onPress={() => router.push({ pathname: '/stop/[id]', params: { id: stop.id, name: data?.stop?.name || stop.name } })} />
      {!data ? <T kind="foot" tone="text2" style={s.note}>{error ? 'Live times unavailable right now, trying again' : 'Loading live times'}</T> : null}
      {offlineAt ? <OfflineNote at={offlineAt} now={now} /> : null}
      {data && !groups.length ? <T kind="foot" tone="text2" style={s.note}>{offlineAt ? 'No kept times left' : 'No more services right now'}</T> : null}
      {groups.map(({ d, next }, i) => {
        const t = cd(bestTime(d.planned, d.realtime ? d.estimated : null), now);
        const n = next ? cd(bestTime(next.planned, next.realtime ? next.estimated : null), now) : null;
        return (
          <View key={`${d.line}|${d.dest}|${i}`}>
            <Sep inset={16} />
            <Pressable accessibilityRole="button" onPress={() => openService(d)} android_ripple={{ color: c.fill }} accessibilityLabel={`${d.line} to ${d.dest}, ${t.big} ${t.unit}${d.realtime ? ', live' : ', scheduled'}`}
              style={({ pressed }) => [s.dep, pressed && Platform.OS !== 'android' ? { backgroundColor: c.card2 } : null]}>
              <LineBadge line={d.line} mode={d.mode} color={d.color} />
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
  const sorted = [...groups.values()].sort((a, b) => a.distance - b.distance).slice(0, 6);
  const picks: NearPick[] = [];
  for (const g of sorted) {
    let p: Near | null = null;
    if (/(Station|Wharf)$/i.test(g.seg) || g.members.length > 1) p = await parentOf(g.seg);
    const pick: Near = p ? { ...p, distance: g.distance } : g.members.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0))[0];
    picks.push({ ...pick, seg: g.seg, parent: !!p });
  }
  // Up to 5, so Home still has 3 after leaving out starred stops.
  return foldNear(picks, 5).map(({ seg, parent, ...n }) => n);
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

/** The cache id of a trip card: the trip key and the All services switch. The trip screen uses the same one. */
export const tripCacheId = (pkey: string, all: boolean) => `${pkey}|${all ? 1 : 0}|${store.accOn() ? 1 : 0}`;
/** The trip key Home and the trip screen share: from, via or legs, to, and each leg's settings. */
export const tripPkey = (plan: Parameters<typeof tripKey>[0]) => tripKey(plan) + JSON.stringify(isChain(plan) ? tLegs(plan).map((l) => [l.mode, l.conn, l.any, l.walk]) : []);

/** "Offline, times from 8:05am" under a card showing times kept on the phone. */
function OfflineNote({ at, now }: { at: number; now: number }) {
  const c = usePalette();
  return (
    <View style={[s.note, { flexDirection: 'row', alignItems: 'center' }]} accessibilityRole="text">
      <Icon name={I.warn} size={11} color={c.orange} />
      <T kind="foot" style={{ color: c.lateText, marginLeft: 5 }}>{offlineText(at, now)}</T>
    </View>
  );
}

export function LiveTag() {
  const c = usePalette();
  const t = useLastLive();
  const off = useOfflineSince();
  if (off) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityLabel={offlineText(off, Date.now())}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.orange, marginRight: 5 }} />
        <T kind="foot" tone="text2">Offline</T>
      </View>
    );
  }
  if (!t) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityLabel={`Live, updated ${clock(t)}`}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.green, marginRight: 5 }} />
      <T kind="foot" tone="text2" style={{ fontVariant: ['tabular-nums'] }}>{liveStamp(t)}</T>
    </View>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, minHeight: 48 },
  note: { paddingHorizontal: 16, paddingBottom: 13 },
  svc: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 16, paddingVertical: 12 },
  block: { width: 56, alignSelf: 'stretch', minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  dep: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, minHeight: 46 },
  action: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, minHeight: 48 },
  actionIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  banner: { flexDirection: 'row', alignItems: 'flex-start', marginHorizontal: 16, marginTop: 12, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 12 },
  place: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 11, borderRadius: 12, minHeight: 46 },
  search: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 6, paddingHorizontal: 10, paddingVertical: 8 },
});
