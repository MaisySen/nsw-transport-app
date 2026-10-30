import { failWhy, TIMETABLE_TRIPS_NOTE } from '@/lib/netErrCore';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useWhyLate } from '@/lib/whyLate';
import { JourneyWhy, WhyLate, withWhyAction } from '@/components/WhyLate';
import { useUsualText } from '@/lib/usual';
import { TripReminders } from '@/components/TripReminders';
import { plural } from '@/lib/homeCore';
import { Alert, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, useColorScheme, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { PullDownButton } from '@/components/HoldMenu';
import { menuOf, type MenuSpec } from '@/lib/menuCore';
import { arriveByIndex, NOW, whenFromParams, type When } from '@/lib/planCore';
import { WhenPicker } from '@/components/WhenPicker';
import { afterBatch, canLoadEarlier, canLoadLater, chipLabel, chipsToShow, dateNeeded, earlierFloor, earlierSteps, emptyModes, filterModes, hasLeft, keepFrom, modesWords, MODE_CHIPS, nearEnd, normModes, PAGE0, PAGING, pickerDays, pinDay, queryAt, serviceDayEnd, toggleMode, whenAt, whenKeyOf, whenWords, ymd, type ModeK, type PageState } from '@/lib/tripModesCore';
import { LeftRow } from '@/components/LeftRow';
import { EarlierHeader, NextMark, NowDivider, useOpenAtNow, usePastNow } from '@/components/PastNow';
import { cardEdges, nowA11y, nowLabel, pastNowSplit } from '@/lib/pastNowCore';
import { afterPage, canPage, cursorsOf, dayPageOf, dayPrefetchPx, DAY_REVEAL_ROWS, DIR0, earlierSource, isPaged, laterSource, nearBottom, nearTop, PAGE_REACH_MS, plannedDep, type DayInfo, type PageDir } from '@/lib/tripPagesCore';
import { SkeletonRows } from '@/components/SkeletonRows';
import { useOnViewRef } from '@/lib/activity';
import { haptic } from '@/lib/haptic';
import { withTimeout } from '@/lib/gesture';
import { api, isLongPair } from '@/lib/api';
import { LONG_TRIP_KEEP_MS, STILL_SEARCHING_MS } from '@/lib/longTripCore';
import { useCountdownNow, useLive, useReportCountdowns, useStamp } from '@/lib/hooks';
import { peekOffline } from '@/lib/offline';
import { armFresh, armSpec, isPhoneBuilt, phoneBuiltText, tripSeed } from '@/lib/instantPaintCore';
import { ttFirstSeed, ttFirstWanted } from '@/lib/newTripCore';
import { usePalette, radius, modeColor } from '@/lib/theme';
import { bestTime, clock, durText, ms, shortName } from '@/lib/format';
import { plainText } from '@/lib/htmlTextCore';
import { store, tripKeyOf, useStore } from '@/lib/store';
import { safeUrl, stShort } from '@/lib/access';
import { LegAccessChips, ParkGroup } from '@/components/Access';
import { fareKind, fareOf, fareWords, money, offPeakText, TRAINLINK_BOOKING_URL } from '@/lib/fare';
import { getLive, startLive } from '@/lib/live';
import { directFilter, isChain, planTrip, stName, tLegs, tripKey, viaText } from '@/lib/trips';
import { applyWalkPref, readTripWalk, walkKey, walkNote } from '@/lib/walkPrefCore';
import { offPeakHint } from '@/lib/offPeakCore';
import { isPointId } from '@/lib/goHomeCore';
import { isHerePlace } from '@/lib/hereCore';
import { WalkChoice } from '@/components/WalkChoice';
import { StandPin } from '@/components/StandPin';
import type { TripLeg } from '@/lib/trips';
import type { Journey, Leg, Place, TripResp } from '@/lib/types';
import { useFlag } from '@/lib/config';
import { journeyAccess, liftAwareNote } from '@/lib/stepFree';
import { tripSpec } from '@/lib/watch';
import { Icon, I, modeIconName } from '@/components/Icon';
import { openService } from '@/components/Cards';
import { pressService } from '@/lib/prefetch';
import type { SvcRow } from '@/lib/speedCore';
import { KeptBanner, LineBadge, OccupancyChip, StatusLine } from '@/components/Transit';
import { LimitedTag } from '@/components/LimitedTag';
import { liveState } from '@/lib/liveLabelCore';
import { notStoppingText, notStoppingWhy } from '@/lib/notStoppingCore';
import { arrOf, ServiceRow, TightLabel, tripCacheId, tripPkey, WarnLine } from '@/components/Home';
import { cacheKey } from '@/lib/offlineCore';
import { firstLeaveInMs, tripGapMs } from '@/lib/pollCore';
import { rankTrips } from '@/lib/rankCore';
import { planB, problemOf } from '@/lib/planBCore';
import { busLegStatus, rowTraffic, trafficLine } from '@/lib/busLiveCore';
import { startIndex } from '../../platform/intentInboxCore';
import { addToCalendar, hasCalendar } from '@/lib/nativeExtras';
import { leaveByEvent } from '@/lib/leaveByCore';
import { RemindLastButton } from '@/components/LastHome';
import { canRemind, lastTonightIndex, modeOfLegs, slimLast } from '@/lib/lastHomeCore';
import { Button, Empty, Screen, Sep, T } from '@/components/ui';
import { boardWords, stopLabel, stopNumber } from '@/lib/busCore';
import { stableKeys } from '@/lib/rowKeysCore';
import { hasLiveData } from '@/lib/rowTimeCore';
import { rowTime } from '@/lib/rowTime';
import { changeAt } from '@/lib/tightChangeCore';

/** "0745" for the trip API's time parameter, Sydney time. */
function hhmm(t: number) {
  try {
    return new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Australia/Sydney' }).replace(':', '').slice(0, 4);
  } catch {
    const d = new Date(t);
    return `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

/** "8:00:30", Sydney time. */
function hms(t: number) {
  try { return new Date(t).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Australia/Sydney' }).replace(/\s?(am|pm)/i, ''); }
  catch { return new Date(t).toLocaleTimeString(); }
}

const isBus = (m?: string | null) => m === 'bus' || m === 'coach' || m === 'school';

/** " to Strathfield Station, Stand G, Stop 213516": where a walk ends, with the stand and stop number of the bus you walk to. */
function walkTo(l: Leg, next?: Leg) {
  if (next && next.kind !== 'walk' && stopNumber(next.stopId, next.mode)) return ` to ${boardWords(shortName(next.from || l.to), next.fromPlatform, next.stopId, next.mode)}`;
  return l.to ? ` to ${shortName(l.to)}` : '';
}

/** What a trip leg knows for the service view's first frame (its two stops' names and the get off time). */
function legRow(l: Leg): SvcRow {
  return { tripId: l.tripId, feed: l.feed, line: l.line, stopId: l.stopId, planned: l.planned, mode: l.mode, destId: l.destId, color: l.color, dest: l.towards, realtime: l.realtime, estimated: l.estimated, delayMin: l.delayMin, toStopId: l.toStopId,
    stopName: l.from, toName: l.to, arrPlanned: l.arrPlanned, seenAt: (l as any).seenAt };
}

function LegView({ l, next, now }: { l: Leg; next?: Leg; now: number }) {
  const c = usePalette();
  const usual = useUsualText(l);
  // Why it's late: this leg's own linked alert, when the leg is delayed, cancelled or changed (whyLateCore.ts).
  const legRows = useMemo(() => [l], [l]);
  const why = useWhyLate(legRows)(l);
  if (l.kind === 'walk') {
    return (
      <View style={st.walk}>
        <View style={{ width: 36, alignItems: 'center' }}><Icon name={I.walk} size={18} color={c.text2} /></View>
        <T kind="sub" tone="text2" style={{ flex: 1 }}>Walk {l.durationMin} min{l.distanceM ? ` (${Math.round(l.distanceM)} m)` : ''}{walkTo(l, next)}</T>
      </View>
    );
  }
  const color = l.color || modeColor[l.mode || 'bus'];
  const dep = bestTime(l.planned, l.realtime ? l.estimated : null);
  const arr = bestTime(l.arrPlanned, l.realtime ? l.arrEstimated : null);
  const bus = busLegStatus(l);
  // A Live Traffic incident on the route first; else the live delays ahead say the bus is slowing (busLiveCore.ts).
  const traffic = trafficLine(l) || rowTraffic(l);
  // A bus detour or closed stop where you get on or off, from the service's alerts (notStoppingCore.ts).
  const noStop = notStoppingText(l, now);
  const noStopWhy = noStop ? notStoppingWhy(l) : null;
  return (
    <Pressable accessibilityRole="button" {...withWhyAction({}, why)}
      onPress={() => openService(legRow(l))} onPressIn={() => pressService(legRow(l))}
      style={({ pressed }) => [st.leg, pressed ? { opacity: 0.7 } : null]}>
      <View style={{ width: 36, alignItems: 'center' }}>
        <View style={[st.dotBig, { borderColor: color, backgroundColor: c.card }]} />
        <View style={{ flex: 1, width: 5, backgroundColor: color, marginVertical: 2, borderRadius: 3 }} />
        <View style={[st.dotBig, { borderColor: color, backgroundColor: c.card }]} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <T kind="headline" numberOfLines={2}>{shortName(l.from)}</T>
            <T kind="foot" tone="text2">{[l.fromPlatform, stopLabel(l.stopId, l.mode), `${rowTime(dep)}`].filter(Boolean).join(' \u00b7 ')}</T>
            <View style={{ marginTop: 2 }}><StatusLine realtime={hasLiveData(l, now)} delayMin={l.delayMin} cancelled={l.cancelled} state={liveState({ planned: l.planned, estimated: l.estimated, realtime: hasLiveData(l, now), cancelled: l.cancelled, seenAt: l.seenAt, noShow: l.noShow }, now)} /></View>
            {usual ? <T kind="foot" tone="text2" style={{ marginTop: 2 }}>{usual}</T> : null}
          </View>
        </View>
        {l.platformChangedFrom ? <T kind="foot" style={{ color: c.lateText, fontWeight: '600', marginTop: 2 }}>Platform changed from {l.platformChangedFrom}</T> : null}
        {noStop ? (
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }} accessibilityLabel={noStopWhy ? `${noStop}. ${noStopWhy}` : noStop}>
            <Icon name={I.warn} size={13} color={c.orange} />
            <T kind="foot" style={{ color: c.lateText, fontWeight: '600', flex: 1 }} numberOfLines={2}>{noStop}</T>
          </View>
        ) : null}
        <View style={[st.ride, { backgroundColor: c.bg }]}>
          <LineBadge line={l.line} mode={l.mode} color={l.color} />
          <View style={{ flex: 1, minWidth: 0, marginLeft: 8, marginRight: 8 }}>
            <T kind="sub" numberOfLines={2}>Towards {shortName(l.towards)}</T>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <T kind="foot" tone="text2">{durText(l.durationMin)}{l.stops ? `, ${plural(l.stops, 'stop')}` : ''}</T>
              <LimitedTag x={l} />
              <OccupancyChip o={l.occupancy} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <T kind="foot" tone="tint" style={{ fontWeight: '600' }}>Track</T>
            <Icon name={I.chevron} size={12} color={c.tint} />
          </View>
        </View>
        {isBus(l.mode) && l.line ? (
          <Pressable onPress={() => router.push({ pathname: '/route', params: { line: l.line!, mode: l.mode || 'bus', stop: l.stopId || '', towards: l.towards || '', color: l.color || '' } })}
            accessibilityRole="button" accessibilityLabel={`Route ${l.line}, all stops and live buses`} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8, minHeight: 28 }}>
            <Icon name={I.route} size={13} color={c.tint} />
            <T kind="foot" tone="tint" style={{ fontWeight: '600' }}>Route {l.line}: all stops and live buses</T>
          </Pressable>
        ) : null}
        {bus ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }} accessibilityLabel={bus.text}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: bus.tone === 'ok' ? c.green : bus.tone === 'red' ? c.red : c.orange }} />
            <T kind="foot" style={{ color: bus.tone === 'ok' ? c.liveText : bus.tone === 'red' ? c.redText : c.lateText, fontWeight: '600' }}>{bus.text}</T>
          </View>
        ) : null}
        {traffic ? (
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }} accessibilityLabel={traffic}>
            <Icon name={I.warn} size={13} color={c.orange} />
            <T kind="foot" style={{ color: c.lateText, flex: 1 }} numberOfLines={3}>{traffic}</T>
          </View>
        ) : null}
        {why ? <WhyLate why={why} big style={{ marginTop: 8 }} /> : l.alerts?.length ? (
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
            <Icon name={I.warn} size={13} color={c.orange} />
            <T kind="foot" style={{ color: c.lateText, flex: 1 }} numberOfLines={3}>{plainText(l.alerts[0].title)}</T>
          </View>
        ) : null}
        <LegAccessChips access={l.access} from={l.from} to={l.to} />
        <View style={{ marginTop: 10 }}>
          <T kind="headline" numberOfLines={2}>{shortName(l.to)}</T>
          <T kind="foot" tone="text2">{[l.toPlatform, stopLabel(l.toStopId, l.mode), `Arrive ${rowTime(arr)}`].filter(Boolean).join(' \u00b7 ')}</T>
        </View>
      </View>
    </Pressable>
  );
}

function Transfer({ a, b, legs, i }: { a: Leg; b: Leg; legs: Leg[]; i: number }) {
  const c = usePalette();
  const tf: any = (b as any).transfer;
  if (tf && tf.chain) {
    const bad = tf.risk === 'miss', tight = tf.risk === 'tight';
    const text = tf.missed ? `Delays: you miss the ${rowTime(ms(tf.missed.planned))} ${tf.missed.line} at ${shortName(tf.at)}. Next connection: ${Math.max(0, tf.minutes)} min to change`
      : `${Math.max(0, tf.minutes)} min to change at ${shortName(tf.at)}${tight ? ', tight' : `, you allow ${tf.conn}`}`;
    return (
      <View style={[st.walk, { paddingVertical: 6 }]}>
        <View style={{ width: 36, alignItems: 'center' }}><Icon name={I.clock} size={15} color={bad ? c.red : tight ? c.orange : c.text3} /></View>
        <T kind="foot" style={{ flex: 1, color: bad ? c.redText : tight ? c.lateText : c.text2, fontWeight: bad || tight ? '600' : '400' }}>{text}</T>
      </View>
    );
  }
  const gap = Math.round((bestTime(b.planned, b.estimated) - bestTime(a.arrPlanned, a.arrEstimated)) / 60000);
  if (!Number.isFinite(gap)) return null;
  // Tight by the rule in lib/tightChangeCore.ts: under 3 min on the same mode and platform, under 5 min to another
  // mode, platform or stop, or a walk with under 2 min to spare.
  const tight = !!changeAt(legs, i);
  const text = gap <= 0 ? 'Change now' : `${gap} min to change`;
  return (
    <View style={[st.walk, { paddingVertical: 6 }]} accessible accessibilityLabel={tight ? `${text}, tight change` : text}>
      <View style={{ width: 36, alignItems: 'center' }}><Icon name={I.clock} size={15} color={tight ? c.orange : c.text3} /></View>
      <T kind="foot" style={{ color: c.text2 }}>{text}</T>
      {tight ? <TightLabel style={{ marginLeft: 8 }} /> : null}
    </View>
  );
}

/** Opal fare estimate for one journey: total, each leg, transfer discount, airport fee, daily cap, off peak nudge. */
function FareCard({ j }: { j: Journey }) {
  const c = usePalette();
  const kind = fareKind(j);
  if (kind === 'booked') return <TrainLinkFare />;
  return <OpalFareCard j={j} mixed={kind === 'mixed'} />;
}

/** NSW TrainLink regional trains and coaches: a booked seat, not Opal. One tap to their booking page. */
function TrainLinkFare() {
  const c = usePalette();
  return (
    <Pressable onPress={() => Linking.openURL(TRAINLINK_BOOKING_URL).catch(() => {})} accessibilityRole="link" accessibilityHint="Opens NSW TrainLink bookings"
      style={({ pressed }) => [{ marginHorizontal: 16, marginTop: 10, backgroundColor: c.card2, borderRadius: radius, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, minHeight: 48 }, pressed ? { opacity: 0.7 } : null]}>
      <Icon name={I.fare} size={16} color={c.text2} />
      <View style={{ flex: 1, marginLeft: 8 }}>
        <T kind="body">NSW TrainLink fare</T>
        <T kind="foot" tone="text2">Not an Opal trip. Book a seat ahead.</T>
      </View>
      <T kind="foot" tone="tint" style={{ fontWeight: '600' }}>Book</T>
      <Icon name={I.chevron} size={12} color={c.tint} style={{ marginLeft: 4 }} />
    </Pressable>
  );
}

function OpalFareCard({ j, mixed }: { j: Journey; mixed: boolean }) {
  const c = usePalette();
  // Every hook above the no fare return: a trip's fare can arrive on a later refresh (29 Oct crash reports).
  const [more, setMore] = useState(false);
  const f = fareOf(j);
  if (!f) return null;
  const sub = (label: string, val: string, tone?: string) => (
    <View style={{ flexDirection: 'row', paddingLeft: 34, paddingRight: 14, paddingVertical: 3 }}>
      <T kind="foot" tone="text2" style={{ flex: 1 }}>{label}</T>
      <T kind="foot" style={{ color: tone || c.text2, fontVariant: ['tabular-nums'] }}>{val}</T>
    </View>
  );
  const op = offPeakText(f);
  return (
    <View style={{ marginHorizontal: 16, marginTop: 10, backgroundColor: c.card2, borderRadius: radius, paddingVertical: 4 }}>
      <Pressable onPress={() => setMore(!more)} accessibilityRole="button" accessibilityState={{ expanded: more }} accessibilityHint={`An estimate, ${fareWords(f)}. ${more ? 'Hides' : 'Shows'} the fare for each leg.`}
        style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, minHeight: 48 }}>
        <Icon name={I.fare} size={16} color={c.text2} />
        <T kind="body" style={{ flex: 1, marginLeft: 8 }}>Opal fare</T>
        <T kind="foot" tone="text2" style={{ marginRight: 8 }}>{f.typeName}{f.peak ? ', peak' : ''}</T>
        <T kind="headline" style={{ fontVariant: ['tabular-nums'] }}>{money(f.total)}</T>
        <Icon name={I.chevron} size={12} color={c.text3} style={{ marginLeft: 8, transform: [{ rotate: more ? '90deg' : '0deg' }] }} />
      </Pressable>
      {more ? <View style={{ marginTop: 2, paddingBottom: 8 }}>
        {(f.legs || []).map((fl, k) => (
          <View key={k}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 4 }}>
              <View style={{ width: 20 }}><Icon name={modeIconName(fl.mode)} size={14} color={modeColor[fl.mode || 'train'] || c.text2} /></View>
              <T kind="sub" style={{ flex: 1 }} numberOfLines={1}>{fl.line || 'Leg'}{fl.km != null ? `, ${Number(fl.km).toFixed(1)} km` : ''}{fl.amount == null ? '' : fl.peak ? ', Peak' : ', Off peak'}</T>
              <T kind="sub" tone={fl.amount == null || fl.joined ? 'text2' : 'text'} style={{ fontVariant: ['tabular-nums'] }}>
                {fl.amount == null ? 'Not an Opal fare' : fl.joined ? 'Same journey' : money(fl.fare ?? fl.amount)}
              </T>
            </View>
            {fl.joined && fl.amount != null ? sub('Same journey, no extra fare', fl.amount ? `+${money(fl.amount)}` : '') : null}
            {fl.transferOff ? sub('Transfer discount', `-${money(fl.transferOff)}`, c.liveText) : null}
            {fl.airportFee ? sub('Airport station access fee', money(fl.airportFee)) : null}
          </View>
        ))}
        {f.capped ? sub('Daily cap reached', '') : null}
        {op ? <T kind="foot" style={{ color: c.liveText, fontWeight: '600', paddingHorizontal: 14, marginTop: 6 }}>{op}</T> : null}
        {mixed ? <T kind="foot" tone="text2" style={{ paddingHorizontal: 14, marginTop: 6 }}>Plus the NSW TrainLink fare for the regional part, booked ahead.</T> : null}
        <T kind="foot" tone="text2" style={{ paddingHorizontal: 14, marginTop: 6 }}>An estimate from the Opal fare tables, not your card's charge. Fare type is in More.</T>
      </View> : null}
    </View>
  );
}

function JourneyDetail({ j, now, from, to, autoStart, onMapTouch, fresh = true }: { j: Journey; now: number; from: Place; to: Place; autoStart?: boolean; onMapTouch?: (scrollOn: boolean) => void;
  /** R6 (instantPaintCore.armFresh): false while the times on screen are a kept copy, phone built or offline. */
  fresh?: boolean }) {
  const c = usePalette();
  const st2 = useStore();
  const spec = tripSpec(j, from, to);
  const [busy, setBusy] = useState(false);
  const calOK = hasCalendar();
  const begin = () => {
    const go = async () => {
      setBusy(true);
      // R6: from a fresh live answer only; else the trip starts on its timetable times and reads live times itself.
      try { await withTimeout(startLive(armSpec(spec, fresh), j.fare), 5000, null); router.push('/go'); haptic.success(); }
      catch (e: any) { Alert.alert("Couldn't start it", e.message); }
      finally { setBusy(false); }
    };
    const cur = getLive();
    if (cur) Alert.alert('End your current trip?', `${cur.title} is in progress. Starting this one ends it.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Start this trip', onPress: go }]);
    else go();
  };
  // Opened by a start link (the widget's Start button, Siri's "Start my commute", Control Center): start once.
  const autoDone = useRef(false);
  useEffect(() => {
    if (!autoStart || autoDone.current || !spec.legs.length) return;
    autoDone.current = true;
    begin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, spec.legs.length]);
  const legs = j.legs;
  return (
    <View style={{ paddingBottom: 14 }}>
      <Sep />
      <View style={{ paddingHorizontal: 12, paddingTop: 10 }}>
        {legs.map((l, i) => {
          const prevT = legs.slice(0, i).reverse().find((x) => x.kind === 'transit');
          return (
            <View key={i}>
              {l.kind === 'transit' && prevT && (legs[i - 1]?.kind === 'transit' || (l as any).transfer?.chain || changeAt(legs, i)) ? <Transfer a={prevT} b={l} legs={legs} i={i} /> : null}
              {l.kind === 'transit' ? <StandPin leg={l} prev={legs[i - 1]} onScrollChange={onMapTouch} /> : null}
              <LegView l={l} next={legs[i + 1]} now={now} />
            </View>
          );
        })}
      </View>
      <FareCard j={j} />
      <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
        <Button title={busy ? 'Starting' : 'Start trip'} icon={I.nav} kind="filled" disabled={busy || !spec.legs.length}
          onPress={begin} />
        {calOK ? (
          <View style={{ marginTop: 8 }}>
            <Button title="Add to Calendar" icon={I.clock} kind="tinted" onPress={() => {
              const ev = leaveByEvent(j, to.name);
              if (ev) addToCalendar(ev).catch(() => {});
            }} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

export default function TripScreen() {
  const p = useLocalSearchParams<{ from: string; fromName: string; to: string; toName: string; pick?: string; via?: string; viaName?: string; conn?: string; name?: string; legs?: string; time?: string; arriveBy?: string; date?: string; start?: string; at?: string }>();
  // Leave at or Arrive by from Plan (a Sydney clock time), changed here with the time chip; without it the trip is from now.
  // The day is written in when the time is picked (pinDay), so a time in the past stays today's: Leave 6:15pm picked
  // at 6:27pm shows the services from 6:15pm, the gone ones marked Left, and does not turn into tomorrow's later on.
  const [when, setWhen] = useState<When>(() => pinDay(whenFromParams(p.time, p.arriveBy, p.date), Date.now()));
  const [pickOpen, setPickOpen] = useState(false);
  const whenKey = whenKeyOf(when);
  const from = { id: String(p.from), name: String(p.fromName || '') };
  const to = { id: String(p.to), name: String(p.toName || '') };
  const via = p.via ? { id: String(p.via), name: String(p.viaName || p.via) } : null;
  const conn = p.conn != null ? Number(p.conn) : 5;
  const legsP: TripLeg[] | null = (() => { try { const v = p.legs ? JSON.parse(String(p.legs)) : null; return Array.isArray(v) && v.length > 1 ? v : null; } catch { return null; } })();
  const plan = legsP ? { from, to, legs: legsP } : { from, to, via, conn };
  const chain = isChain(plan);
  // A plain A to B trip asks the server for pages (tripPagesCore.ts): about 10 trips each, the next ones loaded
  // before the reader gets to either end. A trip via a stop or with set legs loads batches from a time as before.
  const pageable = !chain && !p.via;
  const tkey = tripKey(plan);
  const stNow = useStore();
  const stAll = stNow.allServices || {};
  const accOn = !!stNow.acc;
  const liftOn = useFlag('liftAwareRouting');
  const allOn = !!stAll[tkey];
  // Mode chips (Any, Train, Metro, Bus, Light rail, Ferry), kept per trip on the phone. A to B trips only: trips with
  // a change stop already have a mode per leg.
  const modesOn = !chain && !via;
  const modes: ModeK[] = modesOn ? normModes((stNow.tripModes || {})[tkey]) : [];
  const modesKey = modes.join(',');
  // Max walk chips (walkPrefCore.ts), kept on the phone for this trip (else the older choice for every trip); sent with
  // the trip request, filtered here. A change asks again (walkKey), so a server that honours it plans least walking.
  const wp = readTripWalk(stNow.tripWalk, tkey, stNow.walkPref);
  const wKey = walkKey(wp);
  // A saved trip (Your trips) can have reminders; they open it again with these params.
  const saved = (stNow.myTrips || []).find((t) => tripKeyOf(t) === tkey) || null;
  const openParams = Object.fromEntries(Object.entries(p).filter(([k, v]) => v != null && v !== '' && ['from', 'fromName', 'to', 'toName', 'via', 'viaName', 'conn', 'name', 'legs'].includes(k)).map(([k, v]) => [k, String(v)]));
  const c = usePalette();
  // Redraws when a shown countdown changes its minute (activity.useCountdownNow), not every 5 s (g10, 26 Oct).
  const now = useCountdownNow();
  const [open, setOpen] = useState<number | null>(p.pick != null ? Number(p.pick) : 0);
  // Instant paint (30 Oct, instantPaintCore.ts): a search with no kept copy of its own (another time, other mode chips)
  // paints timetable trips from the kept copy of this trip from now on the first frame, never as live (R1), never kept
  // (R5); the live answer replaces them in place (R4). Plain A to B trips only; nothing when that copy does not cover it.
  const seedKey = pageable && (whenKey || modesKey) ? cacheKey('trip', tripCacheId(tripPkey(plan), false)) : '';
  const tripSeedNow = useMemo(() => {
    if (!seedKey) return null;
    const t = Date.now();
    return tripSeed(peekOffline(seedKey), { anchor: whenAt(when, t), arriveBy: when.kind === 'arrive', now: t, accessible: accOn });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey, whenKey, modesKey, accOn]);
  // New trip first look (30 Oct, newTripCore.ts): a plain new search with nothing to paint from asks the server's
  // timetable trips beside the live request (when the server serves trip-tt), shown as timetable times until the live
  // answer replaces them in place. useLive asks it only after the phone's own copies came up empty.
  const ttFirstAsk = useMemo(() => {
    if (!ttFirstWanted({ served: true, plain: pageable, accessible: accOn, long: isLongPair(from.id, to.id), painted: !!tripSeedNow })) return null;
    return async (): Promise<TripResp | null> => {
      const t = Date.now();
      const r = await api.tripFirst(from, to, { count: 6, ...queryAt(when, t), modes });
      return ttFirstSeed(r, Date.now(), whenAt(when, t), when.kind === 'arrive');
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from.id, to.id, pageable, accOn, whenKey, modesKey, !!tripSeedNow]);
  const { data, error, updatedAt, offlineAt, staleAt, refreshing, refresh } = useLive((r) => planTrip(plan, { refresh: r, count: 6, all: chain && allOn, ...queryAt(when, Date.now()), modes, walk: wp, ...(pageable ? { page: true, days: true } : {}) }), !chain && !via && isLongPair(from.id, to.id) ? LONG_TRIP_KEEP_MS : (d: TripResp | null) => tripGapMs(firstLeaveInMs(d?.journeys, Date.now())), [from.id, to.id, via?.id, conn, String(p.legs || ''), chain && allOn, accOn, whenKey, modesKey, wKey],
    { cacheKey: cacheKey('trip', tripCacheId(tripPkey(plan), chain && allOn) + (whenKey ? `|${whenKey}` : '') + (modesKey ? `|m:${modesKey}` : '')), seed: tripSeedNow, early: ttFirstAsk });
  useReportCountdowns('trip', (data?.journeys || []).slice(0, 6).map((j) => Date.parse(String(j.board || j.leave || ''))));
  const [extra, setExtra] = useState<Journey[]>([]);
  // Step free on or off, another time or other modes ask again; batches loaded before would be the other kind.
  const [later, setLater] = useState<PageState>(PAGE0);
  const [earlier, setEarlier] = useState<PageState>(PAGE0);
  // Pages from a server that pages, each way.
  const [pgL, setPgL] = useState<PageDir>(DIR0);
  const [pgE, setPgE] = useState<PageDir>(DIR0);
  // Where the trips start in the scroll view, the last scroll position, and whether the reader has scrolled yet (an
  // earlier page loads on a scroll up near the top, never by itself on open).
  const [rowsTop, setRowsTop] = useState(0);
  const lastY = useRef(0);
  const dragged = useRef(false);
  const [anchorOn, setAnchorOn] = useState(false);
  // A batch or Plan B answer still on its way when the trip, time, modes, walking or switches change is dropped (useStamp),
  // and the batches already added for the old ones go.
  const listKey = [from.id, to.id, via?.id, conn, String(p.legs || ''), chain && allOn, accOn, whenKey, modesKey, wKey].join('|');
  const stamp = useStamp(listKey);
  // Whole days from the server's own planner (tripPagesCore.ts dayPageOf): the earliest and latest day loaded, the
  // earlier trips loaded and not yet shown (the days before, and today's trips before now), and how many of them show.
  const [dayLo, setDayLo] = useState<DayInfo | null>(null);
  const [dayHi, setDayHi] = useState<DayInfo | null>(null);
  const [heldDays, setHeldDays] = useState<Journey[]>([]);
  const [revealN, setRevealN] = useState(0);
  useEffect(() => { setExtra([]); setLater(PAGE0); setEarlier(PAGE0); setPgL(DIR0); setPgE(DIR0); setDayLo(null); setDayHi(null); setHeldDays([]); setRevealN(0); }, [listKey]);
  // Modes seen in any answer for this trip, so Metro, Light rail or Ferry show only where they make sense.
  const seenModes = useRef<Set<string>>(new Set());
  const [showTravel, setShowTravel] = useState(false);
  const dark = useColorScheme() === 'dark';
  const firstT = (j: Journey) => j.legs.find((l) => l.kind === 'transit');
  const jKey = (j: Journey) => { const l = firstT(j); return l ? l.tripId || `${l.line}|${l.planned}` : String(j.leave); };
  const depMs = (j: Journey) => { const l = firstT(j); return l ? bestTime(l.planned, l.realtime ? l.estimated : null) : ms(j.leave); };
  // The moment the list is for: now, or the chosen Leave at or Arrive by time (past or not).
  const anchor = whenAt(when, now);
  // Now: main results drop services gone over 2 min ago and ones loaded with Earlier services stay up to 30 min back.
  // A chosen time keeps everything the planner answered for it, gone or not (keepFrom); gone ones show as Left.
  const keep0 = keepFrom(when, anchor, now);
  // Pages go back 7 days (tripPagesCore.ts), and the trips loaded earlier stay, shown as Left.
  const keep = pageable && isPaged(data) ? { ...keep0, extra: anchor - PAGE_REACH_MS } : keep0;
  // A whole day answers the first page: its trips before the list's start wait above, shown a block at a time on a
  // scroll up, with the days before loaded the same way.
  const day0 = pageable ? dayPageOf(data) : null;
  // The list still opens at its time (now, or the chosen Leave at): a day's trips before it wait above.
  const mainCut = day0 ? Math.max(keep.main, anchor - 120000) : keep.main;
  const hiddenPool = day0 ? [...heldDays, ...(data?.journeys || []).filter((x) => ms(x.leave) <= mainCut)].sort((a, b) => plannedDep(a) - plannedDep(b)) : [];
  const shownBack = hiddenPool.slice(Math.max(0, hiddenPool.length - revealN));
  const jsAll = (() => {
    const seen = new Set<string>();
    const out: Journey[] = [];
    for (const j of [...(data?.journeys || []).filter((x) => ms(x.leave) > mainCut), ...extra.filter((x) => ms(x.leave) > keep.extra), ...shownBack.filter((x) => ms(x.leave) > keep.extra)]) {
      for (const l of j.legs) if (l.kind !== 'walk' && l.mode) seenModes.current.add(l.mode);
      const k = jKey(j);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(j);
    }
    // A walk only option would open first with nothing to start; it is left out when there is a service.
    const withT = out.filter((j) => !!firstT(j));
    // Soonest first; a trip with a change that gets there no sooner than a direct one goes under it, and an on demand
    // service shows once (rankTrips).
    return rankTrips(withT.length ? withT : out, depMs, arrOf);
  })();
  // The phone checks the modes too: the older server ignores them, and batches mix with the first answer.
  const df = directFilter(filterModes(jsAll, modes), plan, allOn, (j) => j);
  const chips = modesOn ? chipsToShow([...seenModes.current], modes) : [];
  // Walking choice (Less walking, walkPrefCore.ts): trips with a longer walk are left out on the phone, never all of them.
  const wr = applyWalkPref(df.list, wp);
  const js = wr.list;
  // Off peak hint (offPeakCore.ts): in an Opal peak, one line with the server's off peak saving for the first trip still
  // to leave, only when a trip after the peak is loaded (shown, waiting above or a later page) with the same choices.
  const opHint = offPeakHint(js, applyWalkPref(filterModes([...(data?.journeys || []), ...extra, ...heldDays], modes), wp).list, depMs, now, when.kind === 'arrive');
  const jKeys = stableKeys(js.map(jKey));
  // Past and upcoming apart (PAST_NOW, 30 Oct): gone ones in their own muted card under Earlier, a Now divider, the next
  // one marked, the list opened at Now (pastNowCore.ts). Gone is the same rule the rows already use (hasLeft, minute tick).
  const pastNow = usePastNow();
  const pn = pastNowSplit(pastNow ? js.map((j) => hasLeft(depMs(j), now)) : []);
  const atNow = useOpenAtNow(pastNow, listKey, js.length, pn.divider);
  // A new reminder starts 15 min before the first service shown (phone time, as the reminder rings in phone time).
  const suggest = (() => { const j = js.find((x) => !hasLeft(depMs(x), now)) || js[0]; if (!j) return null; const t = new Date(depMs(j) - 15 * 60000); return { hour: t.getHours(), minute: Math.floor(t.getMinutes() / 5) * 5 }; })();
  // Last way home: the last service tonight, only when the list shows the night gap after it.
  const lastIdx = lastTonightIndex(js.map(depMs));
  // Endless list: the next batch loads by itself near the end of the list, earlier ones on a pull at the top. Capped
  // per visit (PAGING), stopped at 4am (end of the service day) or when a batch brings nothing new, only while this
  // screen is on view with the app in front, and never more than one batch at a time.
  const onView = useOnViewRef();
  // The list is not strictly in time order (rankTrips), so the ends are the earliest and latest times in it.
  const firstDep = js.length ? Math.min(...js.map(depMs)) : null;
  const lastDep = js.length ? Math.max(...js.map(depMs)) : null;
  const dayEnd = serviceDayEnd(data?.journeys?.length ? depMs(data.journeys[0]) : anchor);
  // Earlier services reach back from the chosen time too, into the past (earlierFloor).
  const floor = earlierFloor(when, anchor, now);
  const batch = async (t: number) => {
    const day = dateNeeded(ymd(t), Number(hhmm(t).slice(0, 2)), Number(hhmm(t).slice(2)), now);
    const still = stamp();
    let r: TripResp;
    try {
      r = await planTrip(plan, { time: hhmm(t), count: 6, refresh: true, all: chain && allOn, modes, walk: wp, ...(day ? { date: day } : {}) });
    } catch (e: any) {
      // Over 30 min ago today needs the new server's date (the older one plans that time for tomorrow).
      throw Object.assign(e instanceof Error ? e : new Error(String(e)), { neededDate: !!day && day === ymd(now) });
    }
    if (!still()) return [];
    const have = new Set(jsAll.map(jKey));
    const fresh = (r.journeys || []).filter((j) => !have.has(jKey(j)));
    if (fresh.length) setExtra((e) => [...e, ...fresh]);
    return fresh;
  };
  // Pages (a server that pages answered the first page with its cursors): later and earlier pages of about 10 trips,
  // up to 7 days either way of the time the list is for, asked for while the reader is still a screen and a half
  // from the end, one at a time each way, only while this screen is on view with the app in front.
  const paged = pageable && isPaged(data);
  const reachLo = anchor - PAGE_REACH_MS, reachHi = anchor + PAGE_REACH_MS;
  // Every trip loaded counts for the cursors, also ones left out on the phone (walking, modes), so a page that the
  // phone filters to nothing still moves on.
  const cur = cursorsOf([...(data?.journeys || []), ...extra, ...heldDays]);
  const lo = dayLo || day0, hi = dayHi || day0;
  const hiddenRows = hiddenPool.length - shownBack.length;
  const loadPage = async (fwd: boolean) => {
    const st = fwd ? pgL : pgE;
    const set = fwd ? setPgL : setPgE;
    const edge = fwd ? cur.after : cur.before;
    if (!canPage(st, edge, fwd ? reachHi : reachLo, fwd, onView.current)) return;
    // Earlier trips already loaded: shown at once, no network.
    const src = day0 ? (fwd ? laterSource(hi) : earlierSource(hiddenRows, lo)) : 'pages';
    if (src === 'reveal') {
      setAnchorOn(true);
      setRevealN((n) => n + DAY_REVEAL_ROWS);
      setOpen(null);
      const still = stamp();
      setTimeout(() => { if (still()) setAnchorOn(false); }, 400);
      return;
    }
    set((x) => ({ ...x, busy: true }));
    if (!fwd) setAnchorOn(true);
    const still = stamp();
    try {
      const want = src === 'day' ? (fwd ? hi!.nextDay! : lo!.prevDay!) : null;
      const r = await planTrip(plan, { page: true, modes, walk: wp, ...(want ? { days: true, day: want } : fwd ? { after: cur.after! } : { before: cur.before!, arr: cur.arr ?? undefined }) });
      if (!still()) return;
      const have = new Set([...jsAll, ...hiddenPool].map(jKey));
      const fresh = (r.journeys || []).filter((j) => !have.has(jKey(j)));
      const got = want ? dayPageOf(r) : null;
      if (want && !fwd) {
        // The day before goes above, shown a block at a time like the rest.
        if (fresh.length) setHeldDays((e) => [...fresh, ...e]);
        setRevealN((n) => n + DAY_REVEAL_ROWS);
        setDayLo(got || { day: want, prevDay: null, nextDay: null, windowStart: NaN, windowEnd: NaN });
      } else {
        if (fresh.length) setExtra((e) => [...e, ...fresh]);
        if (want) setDayHi(got || { day: want, prevDay: null, nextDay: null, windowStart: NaN, windowEnd: NaN });
      }
      // Rows put above shift the row numbers, so an open trip closes (as Earlier services always did).
      if (!fwd && fresh.length) setOpen(null);
      const all = [...(r.journeys || [])].map(plannedDep).filter(Number.isFinite);
      const nextEdge = all.length ? (fwd ? Math.max(...all) : Math.min(...all)) : edge;
      set((x) => afterPage(x, fresh.length, nextEdge, fwd ? reachHi : reachLo, fwd));
    } catch {
      if (!still()) return;
      // No retry loop: the next scroll near that end tries once more.
      set((x) => ({ ...x, busy: false, pages: x.pages + 1 }));
    } finally {
      // The rows put above the ones on screen keep the reader's place (maintainVisibleContentPosition), then the
      // list behaves as usual again.
      if (!fwd) setTimeout(() => { if (still()) setAnchorOn(false); }, 400);
    }
  };
  const loadLater = async () => {
    // Phone built trips (instantPaintCore) load nothing more: the live answer is already on its way.
    if (isPhoneBuilt(data)) return;
    if (paged) return loadPage(true);
    if (!canLoadLater(later, lastDep, dayEnd, onView.current)) return;
    setLater((x) => ({ ...x, busy: true }));
    const still = stamp();
    try {
      const fresh = await batch(lastDep! + 60000);
      if (!still()) return;
      const last = fresh.length ? Math.max(...fresh.map(depMs)) : lastDep;
      setLater((x) => afterBatch(x, filterModes(fresh, modes).length ? fresh.length : 0, last, dayEnd));
    } catch {
      if (!still()) return;
      // No retry loop: the next scroll near the end tries once more.
      setLater((x) => ({ ...x, busy: false, pages: x.pages + 1 }));
    }
  };
  const loadEarlier = async () => {
    if (isPhoneBuilt(data)) return;
    if (paged) return loadPage(false);
    if (!canLoadEarlier(earlier, firstDep, floor, onView.current)) return;
    setEarlier((x) => ({ ...x, busy: true }));
    const still = stamp();
    try {
      // One tap or pull: step back 40 min, then further over a quiet stretch, until something earlier comes.
      let added = 0;
      for (const t of earlierSteps(firstDep!, floor)) {
        const fresh = await batch(t);
        if (!still()) return;
        added = fresh.filter((j) => depMs(j) < firstDep!).length;
        if (added) break;
      }
      setEarlier((x) => afterBatch(x, added, null, Infinity));
      if (added) setOpen(null);
    } catch {
      if (!still()) return;
      setEarlier((x) => ({ ...x, busy: false, pages: x.pages + 1 }));
    }
  };
  const pull = () => { refresh(); if (js.length) loadEarlier(); };
  // Arrive by (picked here, or from a calendar leave by line on Home): open the trip that leaves last and still
  // arrives in time, once per time picked, instead of the earliest one at the top.
  // Only an answer for this time counts (the list on screen is the old time's until the new answer lands).
  const arriveOpened = useRef('');
  const whenSince = useRef({ key: whenKey, at: 0 });
  if (whenSince.current.key !== whenKey) whenSince.current = { key: whenKey, at: Date.now() };
  useEffect(() => {
    if (when.kind !== 'arrive' || p.pick != null || !js.length || arriveOpened.current === whenKey) return;
    if (!updatedAt || updatedAt < whenSince.current.at) return;
    arriveOpened.current = whenKey;
    const i = arriveByIndex(js.map((j) => ({ leave: ms(j.leave), arrive: ms(j.arrive) })), anchor + 59999);
    if (i >= 0) setOpen(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [when.kind, whenKey, js.length, updatedAt]);
  // Leave at a time that has passed: the gone services stay as short Left rows and the first one you can still take
  // opens, once per time picked (all gone: none opens).
  const leaveOpened = useRef('');
  useEffect(() => {
    if (when.kind !== 'leave' || p.pick != null || !js.length || leaveOpened.current === whenKey) return;
    if (!updatedAt || updatedAt < whenSince.current.at) return;
    leaveOpened.current = whenKey;
    if (!hasLeft(depMs(js[0]), Date.now())) return;
    const i = js.findIndex((j) => !hasLeft(depMs(j), Date.now()));
    setOpen(i >= 0 ? i : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [when.kind, whenKey, js.length, updatedAt]);
  const [viewH, setViewH] = useState(0);
  // A start link opens the service leaving closest to `at` and starts it, once.
  const [autoStart, setAutoStart] = useState<number | null>(null);
  const startDone = useRef(false);
  useEffect(() => {
    if (p.start !== '1' || startDone.current || !js.length) return;
    startDone.current = true;
    const i = startIndex(js.map(depMs), p.at ? Number(p.at) : null);
    if (i < 0) return;
    setOpen(i);
    setAutoStart(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.start, p.at, js.length]);
  // Plan B: the chosen trip (the open one, else the first) has a cancelled service, a suspended line or a missed change.
  // Gone services are left out: Plan B is for the trip you can still take (the open one, else the next one to leave).
  const openJ = open != null && open < js.length ? js[open] : null;
  const chosen = openJ && !hasLeft(depMs(openJ), now) ? openJ : js.find((j) => !hasLeft(depMs(j), now)) || null;
  const prob = problemOf(chosen);
  const pbShown = prob ? planB(js, chosen, now) : null;
  const pbAll = prob && !pbShown ? planB(jsAll, chosen, now) : null;
  const probKey = prob && chosen ? `${prob.kind}|${jKey(chosen)}` : '';
  const [pbAsked, setPbAsked] = useState('');
  useEffect(() => {
    // Nothing in the results avoids it: ask the planner once for the services leaving from now.
    if (!probKey || pbShown || pbAll || pbAsked === probKey || offlineAt) return;
    setPbAsked(probKey);
    const still = stamp();
    planTrip(plan, { time: hhmm(now), count: 8, refresh: true, all: chain && allOn, modes, walk: wp }).then((r) => { if (still()) setExtra((e) => [...e, ...(r.journeys || [])]); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probKey, !!pbShown, !!pbAll, offlineAt]);
  const [showAlerts, setShowAlerts] = useState(false);
  const arrs = js.map(arrOf);
  const alertList: { title: string; url?: string }[] = [];
  js.forEach((j) => j.legs.forEach((l) => (l.alerts || []).forEach((a: any) => {
    const title = typeof a === 'string' ? a : a?.title;
    if (title && !alertList.some((x) => x.title === title)) alertList.push({ title, url: typeof a === 'string' ? undefined : a.url });
  })));
  const fromName = data?.from?.name || from.name;
  const toName = data?.to?.name || to.name;
  // Remember opened A to B trips for Home's Your trips.
  // Get me home plans from where you are (a point, not a stop): not kept as a recent trip and not saved. Plan's
  // Current location (lib/hereCore.ts) is the same at either end.
  const here = isPointId(from.id) || isHerePlace(to);
  // A stand map open in a trip: while a finger is on it the page does not scroll (components/MapCard.tsx).
  const [scrollOn, setScrollOn] = useState(true);
  useEffect(() => { if (fromName && toName && !via && !here) store.addRecentTrip({ id: from.id, name: fromName }, { id: to.id, name: toName }); }, [from.id, to.id, fromName, toName, via, here]);
  useEffect(() => { setExtra([]); }, [chain && allOn]);

  // Save this trip: New trip's Confirm step (name, extend with a connection, change time), or straight in as Home or Work.
  // A trip with legs has one way to save (New trip), so its star saves at once.
  const doSave = async (name: string) => {
    try { await api.saveTrip(name, from, to); haptic.success(); Alert.alert('Saved', `It's on your Home screen as "${name}".`); }
    catch (e: any) { Alert.alert("Couldn't save it", e.message); }
  };
  const saveMenu: MenuSpec | null = !chain && !here ? { title: 'Save this trip', message: 'Saved trips show live on Home.', items: menuOf([
    { text: 'Save trip', sf: 'star', icon: 'starOpen', onPress: () => save() },
    { text: 'Save as Home', sf: 'house', icon: 'home', onPress: () => doSave('home') },
    { text: 'Save as Work', sf: 'briefcase', icon: 'briefcase', onPress: () => doSave('work') },
  ]) } : null;
  const save = () => {
    // Saving goes through New trip's Confirm step: name, extend with a connection, change time.
    if (chain) { router.push({ pathname: '/new-trip', params: { legs: JSON.stringify(tLegs(plan)), ...(p.name ? { name: String(p.name) } : {}) } }); return; }
    router.push({ pathname: '/new-trip', params: { from: from.id, fromName, to: to.id, toName, mode: modes.length === 1 ? modes[0] : firstT(js[0] || ({ legs: [] } as any))?.mode || '' } });
  };
  // iPhone: Save this trip is a system bar button with its own UIMenu, dropping from the star (no Cancel row).
  const saveInBar = Platform.OS === 'ios' && !!saveMenu && !chain;
  const showSave = !here;
  const saveButton = <Pressable accessibilityRole="button" accessibilityLabel="Save trip" hitSlop={13} onPress={save}><Icon name={I.starOpen} size={22} color={c.tint} /></Pressable>;

  return (
    <>
      <Stack.Screen options={{
        title: `${shortName(fromName).replace(/ Station$/, '')} to ${shortName(toName).replace(/ Station$/, '')}`,
        headerBackTitle: chain ? 'Back' : undefined,
        headerRight: saveInBar || !showSave ? undefined : () => (saveMenu && !chain ? <PullDownButton menu={saveMenu}>{saveButton}</PullDownButton> : saveButton),
      }} />
      {saveInBar && saveMenu ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu icon="star" accessibilityLabel="Save trip" accessibilityHint="Save this trip as Home or Work">
            {saveMenu.items.map((it) => <Stack.Toolbar.MenuAction key={it.text} icon={(it.sf || undefined) as any} destructive={it.destructive} onPress={it.onPress}>{it.text}</Stack.Toolbar.MenuAction>)}
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      ) : null}
      <Screen ref={atNow.ref} scrollEnabled={scrollOn} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pull} />} scrollEventThrottle={100}
        onLayout={(e) => setViewH(e.nativeEvent.layout.height)}
        onScrollBeginDrag={() => { dragged.current = true; atNow.onDrag(); }}
        // The next page loads while the reader is still a screen and a half from either end (prefetch), so scrolling
        // does not wait. Earlier pages only on a scroll up by the reader, never by themselves on open.
        onScroll={(e) => {
          const n = e.nativeEvent, y = n.contentOffset.y, up = y < lastY.current;
          lastY.current = y;
          // The web has no drag start for a wheel or a trackpad, and its scroll events only come from the reader.
          if (up && Platform.OS === 'web') dragged.current = true;
          const at = { layoutH: n.layoutMeasurement.height, offsetY: y, contentH: n.contentSize.height };
          // Whole days: the next day is asked for about 50 rows from either end (tripPagesCore.ts dayPrefetchPx).
          const dpx = day0 ? dayPrefetchPx(at.contentH - rowsTop, js.length, 700) : 700;
          if (paged ? nearBottom(at, dpx) : nearEnd(at)) loadLater();
          if (paged && dragged.current && nearTop(at, rowsTop, up, day0 ? dpx : 400)) loadEarlier();
        }}
        // Rows put above the ones on screen keep the reader's place: the first trip on screen (child 1, after the top
        // part) stays where it is while an earlier page goes in.
        maintainVisibleContentPosition={anchorOn ? { minIndexForVisible: 1 } : undefined}
        // A short list that does not fill the screen cannot be scrolled to its end, so it asks for the next batch itself.
        onContentSizeChange={(_, h) => { if (viewH && js.length && (paged ? nearBottom({ layoutH: viewH, offsetY: lastY.current, contentH: h }) : nearEnd({ layoutH: viewH, offsetY: 0, contentH: h }))) loadLater(); }}>
        <View onLayout={(e) => setRowsTop(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
        <WhenBar when={when} now={now} onOpen={() => setPickOpen(true)} onNow={() => { haptic.select(); setWhen(NOW); }} />
        {alertList.length ? (
          <View style={{ marginHorizontal: 16, marginTop: 12, backgroundColor: c.card, borderRadius: radius, overflow: 'hidden' }}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: showAlerts }} onPress={() => setShowAlerts(!showAlerts)} android_ripple={{ color: c.fill }} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 }}>
              <Icon name={I.warn} size={16} color={c.orange} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <T kind="headline">Service information</T>
                <T kind="foot" tone="text2">{alertList.length} {alertList.length === 1 ? 'alert' : 'alerts'}. Tap for details.</T>
              </View>
              <Icon name={I.chevron} size={13} color={c.text3} style={{ transform: [{ rotate: showAlerts ? '90deg' : '0deg' }] }} />
            </Pressable>
            {showAlerts ? alertList.map((a, k) => (
              <View key={k}>
                <Sep inset={16} />
                <Pressable accessibilityRole="link" disabled={!safeUrl(a.url)} onPress={() => { const u = safeUrl(a.url); if (u) Linking.openURL(u); }} style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
                  <T kind="sub" style={{ color: a.url ? c.tint : c.text }}>{plainText(a.title)}</T>
                </Pressable>
              </View>
            )) : null}
          </View>
        ) : null}
        {data?.parking?.carparks?.length ? (
          <View style={{ marginTop: -10 }}>
            <ParkGroup list={data.parking.carparks} title={`Park and Ride at ${stShort(data.parking.station?.name)}`} station={data.parking.station?.name} watch />
          </View>
        ) : null}
        <StepFreeBar on={accOn} data={data} empty={!!data && !js.length} liftOn={liftOn} />
        {chain ? <T kind="sub" tone="text2" style={{ marginHorizontal: 20, marginTop: 12 }}>{(() => { const L = tLegs(plan); return L.length === 2 && L[1].mode !== 'walk' ? `Via ${stName(shortName(L[0].to.name))}, ${L[1].conn ?? 5} min to change` : `${L.length} legs via ${viaText(plan)}`; })()}</T> : null}
        {jsAll.length ? (
          <View style={{ marginHorizontal: 16, marginTop: 12, backgroundColor: c.card, borderRadius: radius, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 }}>
            <View style={{ flex: 1 }}>
              <T kind="body">Include trips with a change</T>
              {!allOn && (df.none || (chain && (data?.fallback || []).some(Boolean))) ? <T kind="foot" tone="text2" style={{ marginTop: 2 }}>{df.none ? 'No direct service, so all are shown' : 'One leg has no direct service, so all are used there'}</T> : null}
            </View>
            <Switch value={allOn} onValueChange={(v) => { haptic.select(); store.setAllServices(tkey, v); }} accessibilityLabel="Include trips with a change" />
          </View>
        ) : null}
        {chips.length ? <ModeChips chips={chips} modes={modes} onChange={(m) => { haptic.select(); store.setTripModes(tkey, m); setOpen(0); }} /> : null}
        {!chain ? <WalkChoice pref={wp} tripKey={tkey} /> : null}
        {walkNote(wr, wp) && js.length ? <T kind="foot" tone="text2" style={{ marginHorizontal: 20, marginTop: 8 }}>{walkNote(wr, wp)}</T> : null}
        {opHint && js.length ? (
          <Pressable accessibilityRole="button" accessibilityLabel={opHint.a11y} hitSlop={4} onPress={() => {
            haptic.select();
            setWhen({ kind: 'leave', h: opHint.h, m: opHint.m, day: opHint.day });
            setOpen(0);
          }} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginTop: 4, minHeight: 44, opacity: pressed ? 0.6 : 1 })}>
            <Icon name={I.clock} size={14} color={c.text2} />
            <T kind="foot" tone="text2" style={{ marginLeft: 6, flexShrink: 1 }} numberOfLines={2}>{opHint.text}</T>
          </Pressable>
        ) : null}
        {modes.length && data?.modesBy === 'phone' && js.length ? <T kind="foot" tone="text2" style={{ marginHorizontal: 20, marginTop: 8 }}>From the usual results only, so some {modesWords(modes).toLowerCase()} trips may be missing.</T> : null}
        {/* R1: phone built trips say they are timetable times, never an age that reads like live (instantPaintCore). */}
        {data && isPhoneBuilt(data) ? <TimetableFirstNote text={phoneBuiltText(!!error || !!offlineAt)} /> : data ? <KeptBanner offlineAt={offlineAt} staleAt={updatedAt ? null : staleAt} now={now} /> : null}
        {prob ? (
          <View accessibilityRole="summary" style={{ marginHorizontal: 16, marginTop: 12, backgroundColor: c.card, borderRadius: radius, padding: 16, borderLeftWidth: 4, borderLeftColor: c.red }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Icon name={I.warn} size={16} color={c.red} />
              <T kind="headline" style={{ marginLeft: 8 }}>Plan B</T>
            </View>
            <T kind="sub" numberOfLines={3} style={{ color: c.redText, marginTop: 6 }}>{prob.text}</T>
            {pbShown || pbAll ? (
              <>
                <T kind="body" style={{ marginTop: 10 }}>{(pbShown || pbAll)!.label}</T>
                <T kind="foot" tone="text2" style={{ marginTop: 2 }}>{(pbShown || pbAll)!.why}{pbAll ? ', with a change' : ''}</T>
                <Pressable accessibilityRole="button" onPress={() => {
                  haptic.select();
                  if (pbShown) { const i = js.indexOf(pbShown.j); if (i >= 0) setOpen(i); }
                  else store.setAllServices(tkey, true);
                }} style={({ pressed }) => ({ alignSelf: 'flex-start', marginTop: 12, paddingHorizontal: 16, minHeight: 44, borderRadius: 22, justifyContent: 'center', backgroundColor: c.tint, opacity: pressed ? 0.8 : 1 })}>
                  <T kind="sub" style={{ color: '#FFFFFF', fontWeight: '600' }}>{pbShown ? 'Show this trip' : 'Show trips with a change'}</T>
                </Pressable>
              </>
            ) : (
              <T kind="foot" tone="text2" style={{ marginTop: 8 }}>{pbAsked === probKey || offlineAt ? (prob.kind === 'trackwork' ? 'The replacement buses are still the quickest way. Pull down to check again.' : 'No other way found in the next services. Pull down to check again.') : 'Looking for another way'}</T>
            )}
          </View>
        ) : null}
        {/* Earlier (PAST_NOW): in the top part, so an earlier page going in above the gone rows never moves it. */}
        {pn.earlier ? <EarlierHeader count={pn.pastCount} /> : null}
        {(paged ? pgE.busy : earlier.busy) && js.length ? <SkeletonRows count={3} label="Loading earlier services" /> : null}
        </View>
        {/* Each trip is its own child of the scroll view (one card drawn across them), so an earlier page can go in above
            the trip on screen without moving it (maintainVisibleContentPosition above). */}
        {js.map((j, i) => {
          // With PAST_NOW the card splits at Now: gone rows in one card, the rest in another, the divider between.
          const e = cardEdges(i, js.length, pn);
          const gone = hasLeft(depMs(j), now);
          // Gone rows on the recessed past zone, the next one on a faint accent tint, the rest on the card colour.
          const bg = pastNow && gone ? c.pastBg : pn.nextIdx === i && open !== i ? c.nextBg : c.card;
          const card = (
          <View style={{ marginHorizontal: 16, marginTop: i === 0 && !pn.earlier ? 12 : 0, backgroundColor: bg, overflow: 'hidden',
            borderTopLeftRadius: e.top ? radius : 0, borderTopRightRadius: e.top ? radius : 0,
            borderBottomLeftRadius: e.bottom ? radius : 0, borderBottomRightRadius: e.bottom ? radius : 0 }}>
            {e.sep ? <Sep inset={0} /> : null}
            {pn.nextIdx === i ? <NextMark /> : null}
            {gone
              ? <LeftRow j={j} arrive={arrs[i]} muted={pastNow} onPress={() => { haptic.select(); setOpen(open === i ? null : i); }} />
              : <ServiceRow j={j} now={now} showTravel={showTravel} arrive={arrs[i]} beaten={!!(j as any).beaten || arrs.slice(i + 1).some((a) => a < arrs[i])} pressKey={i} onPress={() => { haptic.select(); setOpen((o) => (o === i ? null : i)); }} />}
            <WarnLine j={j} />
            <JourneyWhy j={j} />
            {!chain && i === lastIdx && canRemind(depMs(j), now) ? <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}><T kind="foot" tone="text2">Last service tonight</T><RemindLastButton hint={{ from, to, mode: modeOfLegs(j.legs), svc: slimLast(j) }} acc={accOn} /></View> : null}
            {data?.accessible ? <JourneyAccessLine j={j} liftOn={liftOn} /> : null}
            {open === i ? <View><Sep inset={16} /><JourneyDetail j={j} now={now} from={from} to={to} autoStart={autoStart === i} onMapTouch={setScrollOn} fresh={armFresh({ data, updatedAt, offlineAt, staleAt, now })} /></View> : null}
          </View>
          );
          // One child per trip still (the earlier page anchor counts children): the Now divider rides in the first row to come.
          return pn.divider && i === pn.nowIdx ? (
            <View key={jKeys[i]} onLayout={(ev) => atNow.onDividerLayout(ev.nativeEvent.layout.y)}>
              <NowDivider label={nowLabel(now, clock)} a11y={nowA11y(now, clock, pn.pastCount)} />
              {card}
            </View>
          ) : <View key={jKeys[i]}>{card}</View>;
        })}
        {(paged ? pgL.busy : later.busy) && js.length ? <SkeletonRows count={3} label="Loading later services" /> : null}
        {(() => {
          // The end of the list: pages stop 7 days on or when the planner has nothing more; batches (a trip via a stop)
          // at the end of the service day or after their cap, as before.
          if (!js.length) return null;
          const endText = paged
            ? (pgL.busy || !pgL.done ? null : cur.after != null && cur.after >= reachHi ? 'That is 7 days of services. For later ones, pick a time.' : 'No more services found.')
            : (later.busy || !(later.done || later.pages >= PAGING.maxLater || (lastDep != null && lastDep >= dayEnd)) ? null
              : later.done || (lastDep != null && lastDep >= dayEnd) ? 'No more services found for this day.' : 'For later services, pick a time.');
          return endText ? (
            <View style={{ alignItems: 'center', marginTop: 12, marginHorizontal: 24 }}>
              <T kind="foot" tone="text2" style={{ textAlign: 'center' }}>{endText}</T>
              <Pressable accessibilityRole="button" onPress={() => setPickOpen(true)} hitSlop={8} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                <T kind="sub" tone="tint" style={{ fontWeight: '600' }}>Choose a time</T>
              </Pressable>
            </View>
          ) : null;
        })()}
        {offlineAt ? null : updatedAt ? (
          <T kind="foot" tone={error ? 'lateText' : 'text2'} style={{ textAlign: 'center', marginTop: 14, fontVariant: ['tabular-nums'] }}>
            {error ? `${failWhy() === 'server' ? 'Live data unavailable right now' : 'Offline'}. Live data updated ${hms(updatedAt)}` : (data as any)?.source === 'timetable' ? TIMETABLE_TRIPS_NOTE : `Live data updated ${hms(updatedAt)}`}
          </T>
        ) : null}
        {data && !js.length && modes.length ? (() => { const e = emptyModes(modes, data.modesBy === 'server'); return <Empty icon={I.route} title={e.title} body={e.body} action={<Button title="Any" kind="tinted" onPress={() => { haptic.select(); store.setTripModes(tkey, []); }} />} />; })() : null}
        {data && !js.length && !modes.length ? (error || offlineAt || (staleAt && !updatedAt)
          // A kept copy whose trips have all left while the live answer failed (g16): never "No trips found".
          ? <Empty icon={I.warn} title={error || offlineAt ? "Can't plan this trip right now" : 'Loading live trips'} body={error || (offlineAt ? (failWhy() === 'server' ? 'Live trips are unavailable right now.' : "You're offline. Check your connection.") : 'One moment.')} />
          : <Empty icon={I.route} title="No trips found" body={data.error || 'Try a different time or nearby stop.'} />) : null}
        {!data && error ? <Empty icon={I.warn} title="Can't plan this trip" body={error} /> : null}
        {!data && !error ? <Searching key={`${from.id}>${to.id}|${whenKey}`} long={!chain && !via && isLongPair(from.id, to.id)} /> : null}
        {data?.tomorrow ? <T kind="foot" tone="text2" style={{ marginHorizontal: 32, marginTop: 12 }}>No more trips tonight. These are the first ones tomorrow.</T> : null}
        {saved ? <TripReminders tripKey={tkey} name={saved.name} open={openParams} suggest={suggest} /> : null}
      </Screen>
      <WhenPicker visible={pickOpen} value={when} now={now} days={pickerDays(now, 8)} onClose={() => setPickOpen(false)}
        onDone={(w) => {
          setPickOpen(false);
          if (w.kind === 'now') { setWhen(NOW); return; }
          setWhen(pinDay({ kind: w.kind, h: w.h, m: w.m, ...(w.day ? { day: w.day } : {}) }, Date.now()));
          setOpen(0);
        }} />
    </>
  );
}

/** "Leave now" as a chip that opens the time picker (any time, any day of the next week), and Now one tap back. */
function WhenBar({ when, now, onOpen, onNow }: { when: When; now: number; onOpen: () => void; onNow: () => void }) {
  const c = usePalette();
  const label = whenWords(when, now);
  const ios = Platform.OS === 'ios';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 12, gap: 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}. Change time`} accessibilityHint="Opens Leave at and Arrive by, with any time and day" onPress={onOpen}
        android_ripple={{ color: c.fill, borderless: false }}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 14, borderRadius: ios ? 22 : 8, backgroundColor: c.card, borderWidth: ios ? 0 : 1, borderColor: c.sep, opacity: pressed ? 0.7 : 1, flexShrink: 1 })}>
        <Icon name={I.clock} size={15} color={c.tint} />
        <T kind="sub" numberOfLines={2} style={{ marginLeft: 6, fontWeight: '600', flexShrink: 1 }}>{label}</T>
        <Icon name={I.chevron} size={11} color={c.text3} style={{ marginLeft: 6, transform: [{ rotate: '90deg' }] }} />
      </Pressable>
      {when.kind !== 'now' ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Leave now" onPress={onNow} android_ripple={{ color: c.fill }}
          style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 14, borderRadius: ios ? 22 : 8, justifyContent: 'center', backgroundColor: c.fill, opacity: pressed ? 0.7 : 1 })}>
          <T kind="sub" tone="tint" style={{ fontWeight: '600' }}>Now</T>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Any, Train, Metro, Bus, Light rail, Ferry. Several can be on (Train and Bus); Any clears them. */
function ModeChips({ chips, modes, onChange }: { chips: ModeK[]; modes: ModeK[]; onChange: (m: ModeK[]) => void }) {
  const c = usePalette();
  const ios = Platform.OS === 'ios';
  const chip = (key: string, name: string, on: boolean, press: () => void, mode?: ModeK) => (
    <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={chipLabel(name, on)} onPress={press}
      android_ripple={{ color: c.fill }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 36, paddingHorizontal: 12, borderRadius: ios ? 18 : 8, marginVertical: 4,
        backgroundColor: on ? c.tint : c.card, borderWidth: on || ios ? 0 : 1, borderColor: c.sep, opacity: pressed ? 0.75 : 1 })}>
      {mode ? <Icon name={modeIconName(mode)} size={14} color={on ? '#FFFFFF' : modeColor[mode] || c.text2} /> : null}
      <T kind="sub" style={{ marginLeft: mode ? 5 : 0, color: on ? '#FFFFFF' : c.text, fontWeight: on ? '600' : '400' }}>{name}</T>
    </Pressable>
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }} accessibilityLabel="Modes">
      {chip('any', 'Any', !modes.length, () => onChange([]))}
      {chips.map((k) => chip(k, MODE_CHIPS.find((x) => x.k === k)!.name, modes.includes(k), () => onChange(toggleMode(modes, k, chips)), k))}
    </ScrollView>
  );
}

/** Step free trips only, switchable right here (the same setting as More > Accessible trips), with the lift aware note. */
/** Shown while the first answer is on its way: placeholder trip rows of a fixed height (instant paint, 30 Oct), so the
 * list draws on the first frame and the trips land in place with no jump. Long trips can take the planner up to about
 * 30 seconds. */
function Searching({ long }: { long: boolean }) {
  const [still, setStill] = useState(false);
  useEffect(() => { const t = setTimeout(() => setStill(true), STILL_SEARCHING_MS); return () => clearTimeout(t); }, []);
  return (
    <View accessibilityLiveRegion="polite">
      <SkeletonRows count={4} label={still ? 'Still searching for trips' : 'Finding live trips'} />
      <T kind="foot" tone="text2" style={{ textAlign: 'center', marginTop: 10, marginHorizontal: 24 }}>{still ? 'Still searching' : 'Finding live trips'}</T>
      {still ? <T kind="foot" tone="text2" style={{ textAlign: 'center', marginTop: 4, marginHorizontal: 24 }}>{long ? 'Long distance trips can take up to 30 seconds.' : 'This is taking longer than usual.'}</T> : null}
    </View>
  );
}

/** Above phone built trips (instantPaintCore.tripSeed): timetable times while the live answer is on its way. */
function TimetableFirstNote({ text }: { text: string }) {
  const c = usePalette();
  return (
    <View accessibilityRole="text" accessibilityLiveRegion="polite" accessibilityLabel={text}
      style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 12, paddingHorizontal: 12, paddingVertical: 8 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.text3 }} />
      <T kind="foot" style={{ color: c.text2, marginLeft: 7, flexShrink: 1 }}>{text}</T>
    </View>
  );
}

function StepFreeBar({ on, data, empty, liftOn }: { on: boolean; data: TripResp | null | undefined; empty: boolean; liftOn: boolean }) {
  const c = usePalette();
  const note = liftAwareNote(data, liftOn);
  return (
    <View style={{ marginHorizontal: 16, marginTop: 12, backgroundColor: c.card, borderRadius: radius, paddingHorizontal: 16, paddingVertical: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48 }}>
        <Icon name={I.access} size={18} color={c.tint} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <T kind="body">Step free</T>
          <T kind="foot" tone="text2">{on ? (empty ? 'No step free trips found for this trip.' : 'Only trips with lifts or level access.') : 'Show only trips with lifts or level access.'}</T>
        </View>
        <Switch value={on} onValueChange={(v) => { haptic.select(); store.setAcc(v); }} accessibilityLabel="Step free trips only"
          trackColor={Platform.OS === 'android' ? { true: c.tint, false: c.fill } : undefined}
              thumbColor={Platform.OS === 'android' ? (on ? (c.dark ? '#062E6F' : '#fff') : c.text3) : undefined} />
      </View>
      {on && note ? (
        <View style={{ flexDirection: 'row', gap: 6, paddingVertical: 6 }} accessible accessibilityLabel={note.text}>
          <Icon name={note.tone === 'warn' ? I.warn : I.info} size={14} color={note.tone === 'warn' ? c.orange : c.text2} />
          <T kind="foot" style={{ flex: 1, color: note.tone === 'warn' ? c.lateText : c.text2 }}>{note.text}</T>
        </View>
      ) : null}
    </View>
  );
}

/** Under each step free result: Step free when every station is, and each station with a lift out right now. */
function JourneyAccessLine({ j, liftOn }: { j: Journey; liftOn: boolean }) {
  const c = usePalette();
  const a = journeyAccess(j, liftOn);
  if (!a.stepFree && !a.outages.length) return null;
  const words = [a.stepFree ? 'Step free at every station' : '', ...a.outages.map((o) => `Lift out of service at ${o}`)].filter(Boolean);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, paddingBottom: 10 }} accessible accessibilityLabel={words.join('. ')}>
      {a.stepFree ? (
        <View style={[st.pill, { backgroundColor: c.fill }]}>
          <Icon name={I.access} size={12} color={c.liveText} />
          <T kind="caption" style={{ color: c.liveText, fontWeight: '600', marginLeft: 4 }}>Step free</T>
        </View>
      ) : null}
      {a.outages.map((o) => (
        <View key={o} style={[st.pill, { backgroundColor: c.fill }]}>
          <Icon name={I.warn} size={12} color={c.orange} />
          <T kind="caption" style={{ color: c.lateText, fontWeight: '600', marginLeft: 4 }}>Lift out at {o}</T>
        </View>
      ))}
    </View>
  );
}


const st = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  seg: { flexDirection: 'row', marginHorizontal: 16, marginTop: 12, borderRadius: 9, padding: 2 },
  segBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 6, borderRadius: 7 },
  more: { alignItems: 'center', justifyContent: 'center', paddingVertical: 12, minHeight: 48 },
  walk: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  leg: { flexDirection: 'row', paddingVertical: 8 },
  dotBig: { width: 14, height: 14, borderRadius: 7, borderWidth: 3.5 },
  ride: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, padding: 10, marginTop: 10 },
});
