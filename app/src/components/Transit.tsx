import { memo, useEffect, useRef } from 'react';
import { offlineText, staleText } from '@/lib/offlineCore';
import { packStampText } from '@/lib/timetablePackCore';
import { notStoppingText, notStoppingWhy } from '@/lib/notStoppingCore';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { pressService } from '@/lib/prefetch';
import type { Why } from '@/lib/whyLateCore';
import { WhyLate, withWhyAction } from './WhyLate';
import { LimitedTag } from './LimitedTag';
import { SwipeRow, swipeA11y, type SwipeAct } from './Swipe';
import { HoldMenu } from './HoldMenu';
import { departureMenu } from '@/lib/menuCore';
import { usePalette } from '@/lib/theme';
import { BADGE, badgeLook } from '@/lib/lineStyle';
import { clock, clockSec, delayWords, durText, ms, shortName } from '@/lib/format';
import { rowTime } from '@/lib/rowTime';
import type { Departure, Journey, Leg } from '@/lib/types';
import { Icon, I, modeIconName } from './Icon';
import { stopLabel } from '@/lib/busCore';
import { rowTraffic } from '@/lib/busLiveCore';
import { font, T } from './ui';
import { LiveCountdown, LiveStatus } from './LiveLabel';
import { LIVE_MAX_MS, liveKey, liveState, type LiveState } from '@/lib/liveLabelCore';
import { useFlag } from '@/lib/config';
import { useReduceMotion } from '@/lib/motion';
import { occBusy, occText, quietText } from '@/lib/occupancy';
import type { Vehicle } from '@/lib/types';
import type { Occupancy } from '@/lib/types';

/** A small "Few seats" chip when Transport for NSW sends occupancy for this service; nothing when it does not. */
export function OccupancyChip({ o, style }: { o?: Occupancy; style?: any }) {
  const c = usePalette();
  const on = useFlag('occupancy');
  const text = occText(o, on);
  if (!text) return null;
  const busy = occBusy(o);
  return (
    <View accessible accessibilityLabel={`Crowding: ${text}`} style={[st.occ, { backgroundColor: c.fill }, style]}>
      <Icon name={I.people} size={11} color={busy ? c.lateText : c.text2} />
      <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={[font.caption, { color: busy ? c.lateText : c.text2, fontWeight: '600', marginLeft: 3 }]}>{text}</Text>
    </View>
  );
}

/** Where to stand: "Quieter at the back", from live carriage occupancy where Transport for NSW sends it. */
export function QuietChip({ v, style }: { v?: Vehicle; style?: any }) {
  const c = usePalette();
  const on = useFlag('occupancy');
  const text = quietText(v, on);
  if (!text) return null;
  return (
    <View accessible accessibilityLabel={text} style={[st.occ, { backgroundColor: c.fill }, style]}>
      <Icon name={I.people} size={11} color={c.liveText} />
      <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={[font.caption, { color: c.liveText, fontWeight: '600', marginLeft: 3 }]}>{text}</Text>
    </View>
  );
}

/** The one line badge: "T1", "M1", "333" on the official line or mode colour (bus blue when the feed has no colour,
 *  live data or not), one size, radius and font everywhere. No mode glyph, like Opal and the station signs; only a
 *  badge with no line name shows the mode glyph so it is never empty. small is kept for callers and changes nothing. */
/** kind: on a service's own row, a regional train or coach with only a route number shows Regional or Coach. */
export function LineBadge({ line, mode, color, kind }: { line?: string | null; mode?: string | null; color?: string | null; small?: boolean; kind?: boolean }) {
  const b = badgeLook(line, mode, color, { kind });
  return (
    <View style={[st.badge, { backgroundColor: b.bg }]} accessible accessibilityLabel={b.label}>
      {b.text
        ? <Text maxFontSizeMultiplier={1.3} style={[st.badgeText, { color: b.fg }, b.word ? { fontSize: 11 } : null]} numberOfLines={1}>{b.text}</Text>
        : <Icon name={modeIconName(b.mode)} size={BADGE.glyph} color={b.fg} />}
    </View>
  );
}

/** Pulsing green dot, iOS style, that beats once on each refresh. Still under Reduce Motion. */
export function LiveDot({ beat, size = 7, color }: { beat?: any; size?: number; color?: string }) {
  const c = usePalette();
  const still = useReduceMotion();
  const a = useRef(new Animated.Value(still ? 1 : 0)).current;
  useEffect(() => {
    if (still) { a.setValue(1); return; }
    a.setValue(0);
    Animated.timing(a, { toValue: 1, duration: 1200, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [beat, a, still]);
  const col = color || c.green;
  return (
    <View style={{ width: size * 2.4, height: size * 2.4, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ position: 'absolute', width: size * 2.4, height: size * 2.4, borderRadius: size * 1.2, backgroundColor: col, opacity: a.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }), transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] }} />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: col }} />
    </View>
  );
}

/**
 * A banner over a list showing times kept on the phone: "Offline, showing times from 8:05am" (orange) when the server
 * can't be reached, or "Updated 4 min ago, refreshing" (grey) while the live answer is on its way. Nothing otherwise.
 */
export function KeptBanner({ offlineAt, staleAt, now, style }: { offlineAt?: number | null; staleAt?: number | null; now: number; style?: any }) {
  const c = usePalette();
  if (!offlineAt && !staleAt) return null;
  const text = offlineAt ? offlineText(offlineAt, now) : staleText(staleAt!, now);
  return (
    <View accessibilityRole="text" accessibilityLiveRegion="polite" accessibilityLabel={text}
      style={[{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 12, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: offlineAt ? c.card : 'transparent' }, style]}>
      {offlineAt ? <Icon name={I.warn} size={13} color={c.orange} /> : <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.text3 }} />}
      <T kind="foot" style={{ color: offlineAt ? c.lateText : c.text2, marginLeft: 7, flexShrink: 1, fontVariant: ['tabular-nums'] }}>{text}</T>
    </View>
  );
}

/** The "Live, updated" line is only said of times read within LIVE_MAX_MS (28 Oct liveness pass). */
export const stampTooOld = (updatedAt: number | null | undefined, now: number) => updatedAt != null && Number.isFinite(updatedAt) && now - updatedAt > LIVE_MAX_MS;

export function LiveStamp({ updatedAt, error, offlineAt, staleAt, packAt }: { updatedAt: number | null; error?: string | null; offlineAt?: number | null; staleAt?: number | null; packAt?: number | null }) {
  const c = usePalette();
  if (!offlineAt && !updatedAt && packAt) {
    // Timetable times from the stop's pack (timetablePack.ts) while the live board is on its way: never "Live".
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityLiveRegion="polite">
        <LiveDot beat={packAt} color={error ? c.orange : c.text3} />
        <T kind="foot" tone="text2" style={{ marginLeft: 2, flexShrink: 1 }}>{packStampText(!!error)}</T>
      </View>
    );
  }
  if (!offlineAt && !updatedAt && staleAt) {
    // A kept copy is on screen while the live answer is on its way: say how old it is, never "Live".
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <LiveDot beat={staleAt} color={c.text3} />
        <T kind="foot" tone="text2" style={{ marginLeft: 2, flexShrink: 1 }}>{staleText(staleAt, Date.now())}</T>
      </View>
    );
  }
  if (offlineAt) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <LiveDot beat={offlineAt} color={c.orange} />
        <T kind="foot" tone="text2" style={{ marginLeft: 2, flexShrink: 1 }}>{offlineText(offlineAt, Date.now())}</T>
      </View>
    );
  }
  if (!updatedAt) return <T kind="foot" tone="text2">{error ? 'Live times unavailable right now, trying again' : 'Loading live times'}</T>;
  if (!error && stampTooOld(updatedAt, Date.now())) {
    // Times read longer ago than LIVE_MAX_MS (a kept server copy, or no answer since): their age, never "Live".
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <LiveDot beat={updatedAt} color={c.text3} />
        <T kind="foot" tone="text2" style={{ marginLeft: 2, flexShrink: 1 }}>{staleText(updatedAt, Date.now())}</T>
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <LiveDot beat={updatedAt} color={error ? c.orange : undefined} />
      <T kind="foot" tone="text2" style={{ marginLeft: 2, flexShrink: 1 }}>
        {error ? `Offline, last update ${clock(updatedAt)}` : `Live, updated ${clockSec(updatedAt)}`}
      </T>
    </View>
  );
}

export function StatusLine({ realtime, delayMin, cancelled, state, compact, timetableText }: { realtime?: boolean; delayMin?: number | null; cancelled?: boolean; state?: LiveState; compact?: boolean;
  /** Words for a time with no live data ("Timetable only" on bus rows); "Timetable" when not given. */
  timetableText?: string }) {
  const c = usePalette();
  // With a live state (liveLabelCore.ts) the line says where the time comes from: Live with its age, Timetable, Not tracking.
  if (state) return <LiveStatus state={state} delayMin={delayMin} compact={compact} timetableText={timetableText} />;
  if (!realtime && !cancelled) return <LiveStatus timetableText={timetableText} state={{ kind: 'timetable', label: 'Timetable', age: null, t: NaN, big: '', unit: '', soon: false, counting: false, a11y: '' }} />;
  const d = delayWords(delayMin, realtime, cancelled);
  const color = d.tone === 'green' ? c.liveText : d.tone === 'orange' ? c.lateText : d.tone === 'red' ? c.redText : c.text2;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {realtime && !cancelled ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, marginRight: 5 }} /> : null}
      <Text maxFontSizeMultiplier={1.4} style={[font.foot, { color, fontWeight: realtime ? '600' : '400' }]}>{d.text}</Text>
    </View>
  );
}

/**
 * The big right-hand number, drawn by LiveCountdown (LiveLabel.tsx): live times bold, timetable times grey, and a live
 * time that went stale shows its timetable clock time instead of counting down to "Now" and "Gone".
 */
export function Countdown({ planned, estimated, realtime, cancelled, now, align = 'right', seenAt, vehicleAgeS }: { planned?: string; estimated?: string | null; realtime?: boolean; cancelled?: boolean; now: number; align?: 'right' | 'left'; seenAt?: number | null; vehicleAgeS?: number | null }) {
  const state = liveState({ planned, estimated, realtime, cancelled, seenAt, vehicleAgeS }, now);
  return <LiveCountdown state={state} planned={planned} align={align} />;
}

/** The live state of a departure row (its own answer's age and the vehicle's GPS age). */
export const depState = (d: { planned?: string; estimated?: string | null; realtime?: boolean; cancelled?: boolean; seenAt?: number; liveLead?: number; vehicle?: { ageS?: number; lat?: number } | null; noShow?: Departure['noShow'] }, now: number) => liveState({ planned: d.planned, estimated: d.estimated, realtime: d.realtime, cancelled: d.cancelled, seenAt: d.seenAt, vehicleAgeS: d.vehicle?.ageS, liveLeadMs: d.liveLead, noShow: d.noShow }, now);
const isBusMode = (m?: string) => m === 'bus' || m === 'coach' || m === 'school';
const depKey = (d: Departure, now: number) => liveKey({ planned: d.planned, estimated: d.estimated, realtime: d.realtime, cancelled: d.cancelled, seenAt: d.seenAt, vehicleAgeS: d.vehicle?.ageS, liveLeadMs: d.liveLead, noShow: d.noShow }, now);

export const DepartureRow = memo(DepartureRowView, sameDepartureRow);

/** The row's swipe action, plus "Why it's late" for VoiceOver and TalkBack when the row has a reason (the line itself sits inside the row). */
const rowA11y = (act: SwipeAct | null, why?: Why | null) => withWhyAction(swipeA11y(act) as any, why);

type DepartureRowProps = { d: Departure; now: number; onPress: () => void; onWatch?: () => void; watched?: boolean; showStop?: boolean; alertText?: string | null; stopNo?: boolean;
  /** Why it's late: the reason from this service's own linked alert (whyLateCore.ts); shown instead of alertText. */
  why?: Why | null;
  /** The next service on a board with PAST_NOW (pastNowCore.ts): a faint accent tint instead of the card colour. */
  next?: boolean };

/**
 * A row redraws when its departure, watch state, note or the countdown it shows changes; not on every clock tick.
 * Callers pass fresh arrow functions each render that only close over `d` and `watched`, which are compared here.
 */
function sameDepartureRow(a: DepartureRowProps, b: DepartureRowProps) {
  return a.d === b.d && a.watched === b.watched && a.showStop === b.showStop && a.stopNo === b.stopNo && a.alertText === b.alertText && (a.why?.text || '') === (b.why?.text || '') && !!a.onWatch === !!b.onWatch
    && !!a.next === !!b.next && depKey(a.d, a.now) === depKey(b.d, b.now);
}

function DepartureRowView({ d, now, onPress, onWatch, watched, showStop, alertText, stopNo, why, next }: DepartureRowProps) {
  const c = usePalette();
  const live = depState(d, now);
  // Buses: "Running slow in traffic" when the live delays ahead grow (busLiveCore.ts); live rows only.
  const traffic = live.kind === 'live' ? rowTraffic(d) : null;
  // A bus detour or closed stop from the service's alerts (notStoppingCore.ts): "Not stopping at Main St today".
  const noStop = notStoppingText(d, now);
  const noStopWhy = noStop ? notStoppingWhy(d) : null;
  const extra: string[] = [];
  if (d.platform) extra.push(d.platform.replace(/^Platform /, 'Plat. '));
  // The number on the bus stop sign, unless the screen is that one stop (its number is in the header).
  if (stopNo !== false) { const n = stopLabel(d.stopId, d.mode); if (n) extra.push(n); }
  if (d.stopsAway != null && live.kind === 'live' && d.stopsAway >= 0 && d.stopsAway <= 15) extra.push(d.stopsAway === 0 ? 'At the stop' : `${d.stopsAway} stop${d.stopsAway === 1 ? '' : 's'} away`);
  const act: SwipeAct | null = onWatch
    ? { label: watched ? 'Stop watching' : 'Watch', text: watched ? 'Stop' : 'Watch', icon: watched ? I.bellOff : I.bell, color: watched ? c.text2 : c.indigo, onPress: onWatch }
    : null;
  const body = (
    <Pressable accessibilityRole="button" onPress={onPress} onPressIn={() => pressService(d)} {...rowA11y(act, why)}
      android_ripple={{ color: c.fill }} style={({ pressed }) => [st.depRow, { backgroundColor: pressed && Platform.OS === 'ios' ? c.card2 : next ? c.nextBg : c.card }]}>
      <View style={{ width: 66, alignItems: 'flex-start' }}><LineBadge line={d.line} mode={d.mode} color={d.color} kind /></View>
      <View style={{ flex: 1, marginRight: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <T kind="headline" numberOfLines={2} style={{ flexShrink: 1 }}>{shortName(d.dest)}</T>
          {watched ? <Icon name={I.bell} size={13} color={c.indigo} style={{ marginLeft: 5 }} /> : null}
        </View>
        {showStop && d.stopName ? <T kind="foot" tone="text2" numberOfLines={1}>{shortName(d.stopName)}</T> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3, flexWrap: 'wrap', gap: 6 }}>
          <StatusLine realtime={d.realtime} delayMin={d.delayMin} cancelled={d.cancelled} state={live} compact timetableText={isBusMode(d.mode) ? 'Timetable only' : undefined} />
          {extra.length ? <T kind="foot" tone="text2" numberOfLines={2}>{extra.join(' \u00b7 ')}</T> : null}
          <LimitedTag x={d} />
          <OccupancyChip o={d.occupancy} />
          <QuietChip v={d.vehicle} />
        </View>
        {d.platformChangedFrom ? <T kind="foot" style={{ color: c.lateText, fontWeight: '600', marginTop: 2 }}>Platform changed from {d.platformChangedFrom}</T> : null}
        {noStop ? <T kind="foot" numberOfLines={2} style={{ color: c.lateText, fontWeight: '600', marginTop: 2 }} accessibilityLabel={noStopWhy ? `${noStop}. ${noStopWhy}` : noStop}>{noStop}</T> : null}
        {traffic ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }} accessibilityLabel={traffic}>
            <Icon name={I.traffic} size={12} color={c.orange} />
            <T kind="foot" numberOfLines={1} style={{ color: c.lateText, marginLeft: 4, flex: 1, fontWeight: '600' }}>{traffic}</T>
          </View>
        ) : null}
        {d.pred && live.kind !== 'live' ? <T kind="caption" tone="text2" style={{ marginTop: 2 }}>Prediction: {d.pred.short || d.pred.text} ({d.pred.n} trips)</T> : null}
        {why ? <WhyLate why={why} style={{ marginTop: 3 }} /> : alertText ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
            <Icon name={I.warn} size={12} color={c.orange} />
            <T kind="foot" numberOfLines={1} style={{ color: c.lateText, marginLeft: 4, flex: 1 }}>{alertText}</T>
          </View>
        ) : null}
      </View>
      <LiveCountdown state={live} planned={d.planned} />
    </Pressable>
  );
  // Tap and hold: the system context menu on iPhone (Watch or Stop watching, Show stops), the Material 3 menu on
  // Android, the old sheet on an iPhone build without the native view (components/HoldMenu.tsx, lib/menuCore.ts).
  // A tap on the row still opens the service.
  const held = <HoldMenu menu={departureMenu(d, !!watched, { watch: onWatch, open: onPress })} surface={c.card}>{body}</HoldMenu>;
  if (!act) return held;
  return <SwipeRow act={act}>{held}</SwipeRow>;
}

function legLine(l: Leg) {
  return l.kind === 'walk' ? null : <LineBadge line={l.line} mode={l.mode} color={l.color} />;
}

export function JourneyCard({ j, now, onPress, best }: { j: Journey; now: number; onPress: () => void; best?: boolean }) {
  const c = usePalette();
  const leave = ms(j.leave);
  const mins = Math.round((leave - now) / 60000);
  const first = j.legs.find((l) => l.kind === 'transit');
  const firstLive = first ? liveState({ planned: first.planned, estimated: first.estimated, realtime: first.realtime, cancelled: j.anyCancelled, seenAt: first.seenAt ?? j.seenAt }, now) : undefined;
  const leaveText = mins <= 0 ? 'Leave now' : mins < 60 ? `Leave in ${mins} min` : `Leave ${rowTime(leave)}`;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} android_ripple={{ color: c.fill }} style={({ pressed }) => [st.jRow, pressed && Platform.OS === 'ios' ? { backgroundColor: c.card2 } : null]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text maxFontSizeMultiplier={1.3} style={[font.title3, { color: j.live ? (mins <= 3 ? c.liveText : c.text) : c.text, fontVariant: ['tabular-nums'] }]}>{leaveText}</Text>
            {best ? <View style={[st.tag, { backgroundColor: c.fill }]}><Text maxFontSizeMultiplier={1.3} style={[font.caption, { color: c.tint, fontWeight: '700' }]}>BEST</Text></View> : null}
          </View>
          <T kind="sub" tone="text2" style={{ marginTop: 2, fontVariant: ['tabular-nums'] }}>
            {rowTime(ms(j.board))} to {rowTime(ms(j.arrive))} {'\u00b7'} {durText(j.durationMin)}{j.changes ? ` \u00b7 ${j.changes} change${j.changes > 1 ? 's' : ''}` : ''}
          </T>
        </View>
        <StatusLine realtime={first?.realtime} delayMin={first?.delayMin} cancelled={j.anyCancelled} state={firstLive} compact />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 10, gap: 5 }}>
        {j.legs.map((l, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            {i > 0 ? <Icon name={I.chevron} size={10} color={c.text3} /> : null}
            {l.kind === 'walk' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Icon name={I.walk} size={14} color={c.text2} />
                <T kind="caption" tone="text2">{l.durationMin}</T>
              </View>
            ) : legLine(l)}
          </View>
        ))}
      </View>
      {first?.fromPlatform ? <T kind="foot" tone="text2" style={{ marginTop: 8 }}>From {shortName(first.from)}, {first.fromPlatform}</T> : null}
      {j.risk ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
          <Icon name={I.warn} size={12} color={c.orange} />
          <T kind="foot" style={{ color: c.lateText, marginLeft: 4 }}>{j.riskText || 'Tight change'}</T>
        </View>
      ) : null}
    </Pressable>
  );
}

const st = StyleSheet.create({
  occ: { flexDirection: 'row', alignItems: 'center', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  badge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: BADGE.padX, height: BADGE.height, minWidth: BADGE.minWidth, borderRadius: BADGE.radius, maxWidth: 72 },
  badgeText: { fontSize: BADGE.font, fontWeight: '700', letterSpacing: -0.2 },
  depRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 16, paddingVertical: 11, minHeight: 64 },
  jRow: { paddingHorizontal: 16, paddingVertical: 14 },
  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
});
