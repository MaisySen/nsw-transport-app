// Simple mode (More > Simple mode, off by default). Bidur, 25 Oct 9:37 PM: "User come. Look this to that place. They get
// the list like this. Thats it. For someone minimalistic, slowpace, less tech friendly users. Not this swipe."
// One plain screen headed Plan Your Trip: From and To, your places as big rows, a list of trips,
// and big simple steps (with Speak) for the one you tap. No swiping, no tabs, no maps.
// Battery (docs/PERFORMANCE.md): the list refreshes only while it is on view and the app is in front (useLive);
// countdowns redraw at whole minutes; location is the low accuracy foreground fix, only when already allowed.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { api } from '@/lib/api';
import { haptic } from '@/lib/haptic';
import { useCountdownNow, useLive, useReportCountdowns, useStamp } from '@/lib/hooks';
import { cacheKey, offlineText, staleText } from '@/lib/offlineCore';
import { tripGapMs } from '@/lib/pollCore';
import { NOW, type When } from '@/lib/planCore';
import { hasSpeech, speak, stopSpeaking } from '@/lib/nativeExtras';
import { searchFieldProps } from '@/lib/pickerCore';
import { store, useStore } from '@/lib/store';
import { useStopSearch } from '@/lib/stopSearch';
import { usePalette } from '@/lib/theme';
import { dateNeeded, pickerDays, pinDay, queryAt, whenKeyOf, whenWords, ymd } from '@/lib/tripModesCore';
import { planTrip } from '@/lib/trips';
import { sayPlace } from '@/lib/voiceCore';
import { takeVoicePrompt } from '@/lib/voiceHelp';
import { buildSteps, earlierAt, fillTarget, hhmm, laterAt, nearPlace, shortPlace, simplePlaces, splitStopName, spokenSteps, tripRows,
  type JourneyLike, type PlaceRow, type SimplePlace, type Step, type TripRow } from '@/lib/simpleCore';
import type { Journey, TripResp } from '@/lib/types';
import { LineBadge } from '@/components/Transit';
import { WhenPicker } from '@/components/WhenPicker';
import { Icon, I, modeIconName } from '@/components/Icon';
import { font } from '@/components/ui';
import { EarlierHeader, NowDivider, usePastNow } from '@/components/PastNow';
import { MUTED, nowA11y, nowLabel, pastNowSplit } from '@/lib/pastNowCore';
import { clock } from '@/lib/format';
import { useSides } from '@/lib/layout';
import { friendlyErr } from '@/lib/netErrCore';

type Field = { loc: true } | { place: SimplePlace } | null;
const BIG = 2; // Dynamic Type: big text grows up to twice its size, the layout wraps instead of clipping.
const KINDS: { k: When['kind']; label: string }[] = [{ k: 'now', label: 'Now' }, { k: 'leave', label: 'Leave at' }];

const fieldName = (f: Field, near: SimplePlace | null) => (!f ? '' : 'loc' in f ? 'Current location' : shortPlace(f.place.name) || f.place.name);

function useTone() {
  const c = usePalette();
  return (t: TripRow['tone']) => (t === 'red' ? c.redText : t === 'late' ? c.lateText : t === 'live' ? c.liveText : c.text2);
}

/** One big tappable row: an icon, a title and an optional line under it. At least 56 pt tall. */
function BigRow({ icon, iconColor, title, sub, a11y, hint, onPress, last }: { icon: any; iconColor?: string; title: string; sub?: string; a11y: string; hint?: string; onPress: () => void; last?: boolean }) {
  const c = usePalette();
  return (
    <Pressable onPress={() => { haptic.select(); onPress(); }} accessibilityRole="button" accessibilityLabel={a11y} accessibilityHint={hint} android_ripple={{ color: c.fill }}
      style={({ pressed }) => [s.bigRow, { backgroundColor: pressed && Platform.OS === 'ios' ? c.fill : c.card }, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.sep }]}>
      <View style={[s.rowIcon, { backgroundColor: c.fill }]}><Icon name={icon} size={20} color={iconColor || c.tint} /></View>
      <View style={{ flex: 1, marginLeft: 14 }}>
        <Text maxFontSizeMultiplier={BIG} style={[font.title3, { color: c.text }]}>{title}</Text>
        {sub ? <Text maxFontSizeMultiplier={BIG} style={[font.callout, { color: c.text2, marginTop: 2 }]}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

function Places({ rows, onPick }: { rows: PlaceRow[]; onPick: (p: PlaceRow) => void }) {
  const c = usePalette();
  if (!rows.length) {
    return <Text maxFontSizeMultiplier={BIG} style={[font.body, { color: c.text2, marginHorizontal: 20, marginTop: 20 }]}>Places you search for will show here, so next time they are one tap away.</Text>;
  }
  return (
    <View>
      <Text accessibilityRole="header" maxFontSizeMultiplier={BIG} style={[font.headline, { color: c.text2, marginHorizontal: 20, marginTop: 22, marginBottom: 8 }]}>Your places</Text>
      <View style={[s.group, { backgroundColor: c.card }]}>
        {rows.map((p, i) => (
          <BigRow key={p.key} last={i === rows.length - 1} icon={p.kind === 'home' ? I.home : p.kind === 'work' ? I.briefcase : p.kind === 'star' ? I.star : I.history}
            iconColor={p.kind === 'star' ? c.orange : undefined} title={p.title} sub={p.sub} a11y={p.a11y} hint="Plans a trip" onPress={() => onPick(p)} />
        ))}
      </View>
    </View>
  );
}

/** The From and To fields with the swap button between them. */
function Fields({ from, to, near, onEdit, onSwap, onClearTo }: { from: Field; to: Field; near: SimplePlace | null; onEdit: (w: 'from' | 'to') => void; onSwap: () => void; onClearTo: () => void }) {
  const c = usePalette();
  const one = (w: 'from' | 'to', f: Field) => {
    const label = w === 'from' ? 'From' : 'To';
    const val = fieldName(f, near);
    const sub = f && 'loc' in f && near ? `Near ${shortPlace(near.name)}` : '';
    return (
      <Pressable onPress={() => { haptic.select(); onEdit(w); }} accessibilityRole="button" accessibilityLabel={`${label}, ${val || 'empty'}${sub ? ', ' + sub : ''}`} accessibilityHint={`Choose where you are going ${w === 'from' ? 'from' : 'to'}`}
        android_ripple={{ color: c.fill }} style={({ pressed }) => [s.field, { backgroundColor: pressed && Platform.OS === 'ios' ? c.fill : 'transparent' }]}>
        <Text maxFontSizeMultiplier={BIG} style={[font.sub, { color: c.text2, fontWeight: '600' }]}>{label}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
          {f && 'loc' in f ? <Icon name={I.location} size={17} color={c.tint} /> : null}
          <Text maxFontSizeMultiplier={BIG} numberOfLines={2} style={[font.title3, { color: val ? c.text : c.text3, flexShrink: 1 }]}>{val || (w === 'from' ? 'Where from?' : 'Where to?')}</Text>
        </View>
        {sub ? <Text maxFontSizeMultiplier={BIG} style={[font.foot, { color: c.text2, marginTop: 2 }]}>{sub}</Text> : null}
      </Pressable>
    );
  };
  return (
    <View style={[s.group, { backgroundColor: c.card, flexDirection: 'row', alignItems: 'center', marginTop: 8 }]}>
      <View style={{ flex: 1 }}>
        {one('from', from)}
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.sep, marginLeft: 16 }} />
        {one('to', to)}
      </View>
      <View style={{ paddingHorizontal: 8, gap: 4, alignItems: 'center' }}>
        <Pressable onPress={() => { haptic.select(); onSwap(); }} accessibilityRole="button" accessibilityLabel="Swap From and To"
          style={({ pressed }) => [s.round, { backgroundColor: c.fill, opacity: pressed ? 0.6 : 1 }]}>
          <Icon name={I.swap} size={20} color={c.tint} />
        </Pressable>
        {to ? (
          <Pressable onPress={() => { haptic.select(); onClearTo(); }} accessibilityRole="button" accessibilityLabel="Clear To" accessibilityHint="Shows your places again"
            style={({ pressed }) => [s.round, { opacity: pressed ? 0.6 : 1 }]}>
            <Icon name={I.close} size={18} color={c.text2} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** Choosing From or To: Use my location, search, and your places while nothing is typed. */
function Chooser({ which, places, canLoc, onPick, onLoc, onCancel }: { which: 'from' | 'to'; places: PlaceRow[]; canLoc: boolean; onPick: (p: SimplePlace) => void; onLoc: () => void; onCancel: () => void }) {
  const c = usePalette();
  const [q, setQ] = useState('');
  const { items, loading } = useStopSearch(q);
  // Clear of the side safe areas and at a readable width on a wide window, the same as the other screens.
  const side = useSides();
  return (
    <View style={{ flex: 1, paddingLeft: side.left, paddingRight: side.right }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 52 }}>
        <Text accessibilityRole="header" maxFontSizeMultiplier={BIG} style={[font.title2, { color: c.text, flex: 1 }]}>{which === 'from' ? 'From' : 'To'}</Text>
        <Pressable onPress={() => { haptic.select(); onCancel(); }} accessibilityRole="button" style={{ minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end' }}>
          <Text maxFontSizeMultiplier={BIG} style={[font.body, { color: c.tint }]}>Cancel</Text>
        </Pressable>
      </View>
      <View style={[s.search, { backgroundColor: c.fill }]}>
        <Icon name={I.search} size={20} color={c.text2} />
        <TextInput {...searchFieldProps} autoFocus value={q} onChangeText={setQ} placeholder="Station, stop or wharf" placeholderTextColor={c.text3}
          maxFontSizeMultiplier={BIG} accessibilityLabel={`Search ${which === 'from' ? 'From' : 'To'}`} style={[font.title3, { flex: 1, color: c.text, marginLeft: 10, paddingVertical: 12 }]} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
        {canLoc ? (
          <View style={[s.group, { backgroundColor: c.card, marginTop: 12 }]}>
            <BigRow last icon={I.location} title="Use my location" a11y="Use my location" hint="Plans from the stop nearest you" onPress={onLoc} />
          </View>
        ) : null}
        {q.trim().length >= 2 ? (
          <View style={[s.group, { backgroundColor: c.card, marginTop: 12 }]}>
            {items.slice(0, 10).map((x, i, a) => {
              const { place, stand } = splitStopName(x.name);
              return <BigRow key={x.id} last={i === a.length - 1} icon={I.pin} title={place} sub={stand} a11y={stand ? `${place}, ${stand}` : place} onPress={() => onPick({ id: String(x.id), name: x.name })} />;
            })}
            {!items.length ? <Text maxFontSizeMultiplier={BIG} style={[font.body, { color: c.text2, padding: 16 }]}>{loading ? 'Searching' : 'Nothing found. Try another name.'}</Text> : null}
          </View>
        ) : <Places rows={places} onPick={(p) => onPick(p.place)} />}
      </ScrollView>
    </View>
  );
}

// zone (PAST_NOW, 30 Oct): 'past' draws a gone trip on the recessed past zone (pastBg, pastText, faded times and badges,
// no strikethrough), 'next' puts the first trip still to come on the faint accent tint, as on the full trip list.
// first: no hairline above the first row of a card.
function ResultRow({ r, onPress, zone = null, first = false }: { r: TripRow; onPress: () => void; zone?: 'past' | 'next' | null; first?: boolean }) {
  const c = usePalette();
  const tone = useTone();
  const dim = r.gone || r.tone === 'red';
  const past = zone === 'past';
  const timeColor = past ? c.pastText : dim ? c.text3 : c.text;
  const bg = past ? c.pastBg : zone === 'next' ? c.nextBg : c.card;
  return (
    <Pressable onPress={() => { haptic.select(); onPress(); }} accessible accessibilityRole="button" accessibilityLabel={r.a11y} accessibilityHint="Shows the steps"
      android_ripple={{ color: c.fill }} style={({ pressed }) => [s.result, { borderBottomColor: c.sep, borderTopColor: c.sep, borderTopWidth: first ? 0 : StyleSheet.hairlineWidth, backgroundColor: pressed && Platform.OS === 'ios' ? c.fill : bg }]}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', opacity: past ? MUTED.timeOpacity : 1 }}>
        <Text maxFontSizeMultiplier={BIG} style={[font.title2, { color: timeColor, fontVariant: ['tabular-nums'], textDecorationLine: r.tone === 'red' ? 'line-through' : 'none' }]}>{r.leave}</Text>
        <Text maxFontSizeMultiplier={BIG} style={[font.title3, { color: past ? c.pastText : c.text2, fontWeight: '400' }]}>{'  to  '}</Text>
        <Text maxFontSizeMultiplier={BIG} style={[font.title2, { color: timeColor, fontWeight: '400', fontVariant: ['tabular-nums'] }]}>{r.arrive}</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 6 }}>
        {r.lines.map((l, i) => <View key={i} style={{ opacity: past ? MUTED.badgeOpacity : 1 }}><LineBadge line={l.line} mode={l.mode} color={l.color} /></View>)}
        <Text maxFontSizeMultiplier={BIG} style={[font.callout, { color: past ? c.pastText : c.text2 }]}>{`${r.dur}, ${r.changes.toLowerCase()}`}</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, marginTop: 6 }}>
        <Text maxFontSizeMultiplier={BIG} style={[font.callout, { color: past && r.tone === 'gone' ? c.pastText : tone(r.tone), fontWeight: '600' }]}>{r.status}</Text>
        {r.inText ? <Text maxFontSizeMultiplier={BIG} style={[font.callout, { color: c.text, fontWeight: '600' }]}>{r.inText}</Text> : null}
      </View>
    </Pressable>
  );
}

function ListButton({ title, busy, onPress, a11y, bg }: { title: string; busy?: boolean; onPress: () => void; a11y: string; bg?: string }) {
  const c = usePalette();
  return (
    <Pressable onPress={() => { if (!busy) { haptic.select(); onPress(); } }} accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={{ busy: !!busy }}
      android_ripple={{ color: c.fill }} style={({ pressed }) => [s.listBtn, { backgroundColor: pressed && Platform.OS === 'ios' ? c.fill : bg || c.card }]}>
      {busy ? <ActivityIndicator color={c.tint} /> : <Text maxFontSizeMultiplier={BIG} style={[font.headline, { color: c.tint }]}>{title}</Text>}
    </Pressable>
  );
}

// The one time Get a better voice prompt, loaded only when it shows (the same as SpeakButton).
const VoiceHelp = lazy(() => import('@/components/VoiceHelp').then((m) => ({ default: m.VoiceHelp })));

/** The trip as big plain steps, with Speak. */
function Steps({ j, from, to, onBack, now }: { j: JourneyLike; from: string; to: string; onBack: () => void; now: number }) {
  const c = usePalette();
  const tone = useTone();
  const row = useMemo(() => tripRows([j], now, { keepGone: true }).rows[0], [j, now]);
  const steps = useMemo(() => buildSteps(j), [j]);
  const [talking, setTalking] = useState(false);
  const [help, setHelp] = useState(false);
  const canSpeak = useMemo(() => hasSpeech(), []);
  useEffect(() => () => stopSpeaking(), []);
  const side = useSides();
  const say = () => {
    haptic.select();
    if (talking) { stopSpeaking(); setTalking(false); return; }
    const words = buildSteps(j, { name: sayPlace });
    speak(`Your trip from ${sayPlace(from)} to ${sayPlace(to)}. ${spokenSteps(words)}`, { interrupt: true });
    setTalking(true);
    // The first Speak on a phone with only its basic voice also offers the better voice, once ever (voiceHelpCore).
    takeVoicePrompt().then((show) => { if (show) setHelp(true); }).catch(() => {});
  };
  useEffect(() => { if (!talking) return; const t = setTimeout(() => setTalking(false), 4000 + steps.length * 3500); return () => clearTimeout(t); }, [talking, steps.length]);
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 48, paddingLeft: side.left, paddingRight: side.right }}>
      <Pressable onPress={() => { haptic.select(); onBack(); }} accessibilityRole="button" accessibilityLabel="Back to trips"
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 12, opacity: pressed ? 0.5 : 1, alignSelf: 'flex-start' })}>
        <Icon name={I.back} size={22} color={c.tint} />
        <Text maxFontSizeMultiplier={BIG} style={[font.body, { color: c.tint, marginLeft: 4 }]}>Trips</Text>
      </Pressable>
      <View accessible accessibilityRole="header" accessibilityLabel={row ? row.a11y : `${from} to ${to}`} style={{ marginHorizontal: 20, marginTop: 4 }}>
        <Text maxFontSizeMultiplier={BIG} style={[font.title2, { color: c.text }]}>{`${shortPlace(from)} to ${shortPlace(to)}`}</Text>
        {row ? <Text maxFontSizeMultiplier={BIG} style={[font.title3, { color: c.text, fontWeight: '400', marginTop: 4 }]}>{`${row.leave} to ${row.arrive}, ${row.dur}`}</Text> : null}
        {row ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, marginTop: 4 }}>
            <Text maxFontSizeMultiplier={BIG} style={[font.callout, { color: tone(row.tone), fontWeight: '600' }]}>{row.status}</Text>
            {row.inText ? <Text maxFontSizeMultiplier={BIG} style={[font.callout, { color: c.text, fontWeight: '600' }]}>{row.inText}</Text> : null}
          </View>
        ) : null}
      </View>
      {canSpeak ? (
        <Pressable onPress={say} accessibilityRole="button" accessibilityLabel={talking ? 'Stop speaking' : 'Speak'} accessibilityHint={talking ? undefined : 'Reads the steps out loud'}
          style={({ pressed }) => [s.speak, { backgroundColor: c.tint, opacity: pressed ? 0.75 : 1 }]}>
          <Icon name={talking ? I.speakerStop : I.speaker} size={22} color="#fff" />
          <Text maxFontSizeMultiplier={BIG} style={[font.title3, { color: '#fff', marginLeft: 10 }]}>{talking ? 'Stop' : 'Speak'}</Text>
        </Pressable>
      ) : null}
      {help ? <Suspense fallback={null}><VoiceHelp visible start="prompt" onClose={() => setHelp(false)} /></Suspense> : null}
      <View style={[s.group, { backgroundColor: c.card, marginTop: 16 }]}>
        {steps.map((st: Step, i) => (
          <View key={st.key} accessible accessibilityLabel={`Step ${i + 1}. ${st.say}`}
            style={[s.step, i < steps.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.sep }]}>
            <View style={[s.rowIcon, { backgroundColor: st.icon === 'ride' && st.color ? st.color : c.fill }]}>
              <Icon name={st.icon === 'walk' ? I.walk : st.icon === 'end' ? I.pin : modeIconName(st.mode)} size={20} color={st.icon === 'ride' && st.color ? '#fff' : c.text} />
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text maxFontSizeMultiplier={BIG} style={[font.title3, { color: c.text }]}>{st.text}</Text>
              {st.sub ? <Text maxFontSizeMultiplier={BIG} style={[font.callout, { color: c.text2, marginTop: 3 }]}>{st.sub}</Text> : null}
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

export default function Simple() {
  const c = usePalette();
  const st = useStore();
  const insets = useSafeAreaInsets();
  const side = useSides();
  const tone = useTone();
  const [from, setFrom] = useState<Field>(null);
  const [to, setTo] = useState<Field>(null);
  const [near, setNear] = useState<SimplePlace | null>(null);
  const [locAllowed, setLocAllowed] = useState<boolean | null>(null);
  const [edit, setEdit] = useState<'from' | 'to' | null>(null);
  const [when, setWhen] = useState<When>(NOW);
  const [pickOpen, setPickOpen] = useState(false);
  const [query, setQuery] = useState<{ from: SimplePlace; to: SimplePlace } | null>(null);
  const [pick, setPick] = useState<{ key: string; j: JourneyLike } | null>(null);
  const [extra, setExtra] = useState<Journey[]>([]);
  const [keepGone, setKeepGone] = useState(false);
  const [busy, setBusy] = useState<'earlier' | 'later' | null>(null);
  const [note, setNote] = useState('');
  const now = useCountdownNow();
  const places = useMemo(() => simplePlaces({ home: st.places?.home, work: st.places?.work, recentTrips: st.recentTrips, starred: st.starred }), [st.places, st.recentTrips, st.starred]);

  // Where you are, as the nearest station or stop: the phone's recent fix, else one low accuracy fix. No tracking.
  const locate = useCallback(async (ask: boolean): Promise<SimplePlace | null> => {
    try {
      let p = await Location.getForegroundPermissionsAsync();
      if (!p.granted && ask && p.canAskAgain) p = await Location.requestForegroundPermissionsAsync();
      setLocAllowed(!!p.granted);
      if (!p.granted) return null;
      let pos = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60000 }).catch(() => null);
      if (!pos) pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
      const r = await api.nearby(pos.coords.latitude, pos.coords.longitude);
      const list = [...(r.stops || [])].sort((a: any, b: any) => Number(a.distance ?? a.distanceM ?? a.dist ?? 1e9) - Number(b.distance ?? b.distanceM ?? b.dist ?? 1e9));
      const first = list[0] ? { id: String(list[0].id), name: String(list[0].name || '') } : null;
      if (!first) return null;
      const found = await api.search(splitStopName(first.name).place).then((x) => x.items || []).catch(() => []);
      const p2 = nearPlace(first, found.map((x) => ({ id: String(x.id), name: x.name })));
      setNear(p2);
      return p2;
    } catch { return null; }
  }, []);

  // From is Current location only when location is already allowed; no prompt on launch.
  useEffect(() => {
    Location.getForegroundPermissionsAsync().then((p) => {
      setLocAllowed(!!p.granted);
      if (p.granted) { setFrom((f) => f || { loc: true }); locate(false); }
    }).catch(() => setLocAllowed(false));
  }, [locate]);

  const resolve = useCallback(async (f: Field): Promise<SimplePlace | null> => (!f ? null : 'loc' in f ? near || (await locate(false)) : f.place), [near, locate]);
  const go = useCallback(async (f: Field, t: Field) => {
    if (!f || !t) return;
    const [a, b] = await Promise.all([resolve(f), resolve(t)]);
    if (!a || !b) { Alert.alert('Location not found', 'Choose a station or stop for From instead.'); return; }
    if (a.id === b.id) { setNote('From and To are the same place.'); setQuery(null); return; }
    setNote('');
    setPick(null);
    setQuery({ from: a, to: b });
    store.addRecentTrip({ id: a.id, name: a.name }, { id: b.id, name: b.name });
  }, [resolve]);

  const set = (w: 'from' | 'to', v: Field) => {
    const f = w === 'from' ? v : from, t = w === 'to' ? v : to;
    if (w === 'from') setFrom(v); else setTo(v);
    setEdit(null);
    if (f && t) go(f, t); else if (!f) setEdit('from');
  };
  const onPlace = (p: PlaceRow) => set(fillTarget(from, to), { place: p.place });
  const swap = () => { const f = from, t = to; setFrom(t); setTo(f); if (f && t) go(t, f); };

  // The trips: one request now (or at the chosen time), refreshed only while on view.
  const whenKey = whenKeyOf(when);
  const qKey = query ? `${query.from.id}>${query.to.id}` : '';
  const live = useLive<TripResp | null>((r) => (query ? planTrip(query, { refresh: r, count: 6, ...queryAt(when, Date.now()) }) : Promise.resolve(null)),
    (d) => tripGapMs(d?.journeys?.length ? tripRows(d.journeys as any, Date.now()).rows[0]?.dep - Date.now() : null),
    [qKey, whenKey], { cacheKey: query ? cacheKey('trip', `simple|${qKey}|${whenKey}`) : undefined, enabled: !!query && !edit });
  useEffect(() => { setExtra([]); setKeepGone(false); }, [qKey, whenKey]);
  const stamp = useStamp(`${qKey}|${whenKey}`);
  const all = useMemo(() => [...((live.data?.journeys || []) as JourneyLike[]), ...(extra as JourneyLike[])], [live.data, extra]);
  const { rows, byKey } = useMemo(() => tripRows(all, now, { keepGone }), [all, now, keepGone]);
  useReportCountdowns('simple', rows.filter((r) => !r.gone).slice(0, 6).map((r) => r.dep));
  const shownJ = pick ? (byKey.get(pick.key) || pick.j) : null;
  // Past and upcoming apart (PAST_NOW, 30 Oct), as on the full trip list: gone trips (shown after Earlier) in their own
  // muted card under an Earlier header, the Now band, then the trips to come with the next one tinted. No open at Now
  // here: gone trips only show after the reader taps Earlier to see them.
  const pastNow = usePastNow();
  const pn = pastNowSplit(pastNow ? rows.map((r) => r.gone) : []);

  const more = async (dir: 'earlier' | 'later') => {
    if (!query || !rows.length) return;
    const t = dir === 'earlier' ? earlierAt(rows[0].dep) : laterAt(rows[rows.length - 1].dep);
    const hm = hhmm(t);
    const day = dateNeeded(ymd(t), Number(hm.slice(0, 2)), Number(hm.slice(2)), Date.now());
    setBusy(dir);
    const still = stamp();
    try {
      const r = await planTrip(query, { time: hm, count: 6, refresh: true, ...(day ? { date: day } : {}) });
      // Another trip or time picked while this was on its way: its trips are not added to the new list.
      if (!still()) return;
      setExtra((e) => [...e, ...(r.journeys || [])]);
      if (dir === 'earlier') setKeepGone(true);
    } catch (e: any) { if (still()) Alert.alert(dir === 'earlier' ? 'Could not load earlier trips' : 'Could not load later trips', friendlyErr(e)); }
    finally { setBusy(null); }
  };

  // Android back: steps to list, chooser to the screen.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (pick) { setPick(null); return true; }
      if (edit) { setEdit(null); return true; }
      return false;
    });
    return () => sub.remove();
  }, [pick, edit]);

  const settings = () => {
    haptic.select();
    Alert.alert('Simple mode', 'Turn it off to see the full app with Home, Plan, Ask and More.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Turn off Simple mode', onPress: () => { store.setSimple(false); router.replace('/home'); } },
    ]);
  };
  const fromName = query?.from.name || '', toName = query?.to.name || '';

  let body: React.ReactNode;
  if (edit) {
    body = <Chooser which={edit} places={places} canLoc={locAllowed !== null}
      onCancel={() => setEdit(null)} onPick={(p) => set(edit, { place: p })}
      onLoc={async () => { const p = await locate(true); if (p) set(edit, { loc: true }); else Alert.alert('Location is off', 'Allow location for this app in Settings, or search for a station or stop.'); }} />;
  } else if (pick && shownJ) {
    body = <Steps j={shownJ} from={fromName} to={toName} now={now} onBack={() => setPick(null)} />;
  } else {
    const hasList = !!query;
    body = (
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 48, paddingLeft: side.left, paddingRight: side.right }}
        refreshControl={hasList ? <RefreshControl refreshing={live.refreshing} onRefresh={live.refresh} /> : undefined}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 20, paddingRight: 8, minHeight: 52 }}>
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.6} style={[font.largeTitle, { color: c.text, flex: 1 }]}>Plan Your Trip</Text>
          <Pressable onPress={settings} hitSlop={8} accessibilityRole="button" accessibilityLabel="Settings" accessibilityHint="Turn off Simple mode"
            style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
            <Icon name={I.gear} size={24} color={c.text2} />
          </Pressable>
        </View>
        <Fields from={from} to={to} near={near} onEdit={setEdit} onSwap={swap} onClearTo={() => { setTo(null); setQuery(null); setPick(null); }} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginHorizontal: 16, marginTop: 12 }}>
          <Pressable onPress={() => { haptic.select(); setPickOpen(true); }} accessibilityRole="button" accessibilityLabel={`${whenWords(when, now)}. Change the time`}
            style={({ pressed }) => [s.pill, { backgroundColor: c.card, opacity: pressed ? 0.6 : 1 }]}>
            <Icon name={I.clock} size={18} color={c.tint} />
            <Text maxFontSizeMultiplier={BIG} style={[font.headline, { color: c.tint, marginHorizontal: 8 }]}>{when.kind === 'now' ? 'Leave now' : whenWords(when, now)}</Text>
            <Icon name={I.down} size={14} color={c.tint} />
          </Pressable>
          {when.kind !== 'now' ? (
            <Pressable onPress={() => { haptic.select(); setWhen(NOW); }} accessibilityRole="button" accessibilityLabel="Leave now"
              style={({ pressed }) => [s.pill, { backgroundColor: c.card, opacity: pressed ? 0.6 : 1 }]}>
              <Text maxFontSizeMultiplier={BIG} style={[font.headline, { color: c.tint }]}>Now</Text>
            </Pressable>
          ) : null}
        </View>
        {note ? <Text maxFontSizeMultiplier={BIG} style={[font.body, { color: c.text2, marginHorizontal: 20, marginTop: 16 }]}>{note}</Text> : null}
        {!hasList ? <Places rows={places} onPick={onPlace} /> : (
          <View style={{ marginTop: 18 }}>
            {live.data && (live.offlineAt || (live.staleAt && !live.updatedAt)) ? (
              <Text maxFontSizeMultiplier={BIG} accessibilityLiveRegion="polite" style={[font.callout, { color: live.offlineAt ? c.lateText : c.text2, marginHorizontal: 20, marginBottom: 8, fontVariant: ['tabular-nums'] }]}>
                {live.offlineAt ? offlineText(live.offlineAt, now) : staleText(live.staleAt!, now)}
              </Text>
            ) : null}
            {live.data?.tomorrow ? <Text maxFontSizeMultiplier={BIG} style={[font.callout, { color: c.text2, marginHorizontal: 20, marginBottom: 8 }]}>No more trips tonight. These are the first ones tomorrow.</Text> : null}
            {rows.length && pn.divider ? (
              <View>
                <EarlierHeader count={pn.pastCount} />
                <View style={[s.group, { backgroundColor: c.pastBg }]}>
                  <ListButton title="Earlier" a11y="Earlier trips" bg={c.pastBg} busy={busy === 'earlier'} onPress={() => more('earlier')} />
                  {rows.slice(0, pn.nowIdx).map((r) => <ResultRow key={r.key} r={r} zone="past" onPress={() => setPick({ key: r.key, j: byKey.get(r.key)! })} />)}
                </View>
                <NowDivider label={nowLabel(now, clock)} a11y={nowA11y(now, clock, pn.pastCount)} />
                <View style={[s.group, { backgroundColor: c.card }]}>
                  {rows.slice(pn.nowIdx).map((r, i) => <ResultRow key={r.key} r={r} first={i === 0} zone={i === 0 ? 'next' : r.gone ? 'past' : null} onPress={() => setPick({ key: r.key, j: byKey.get(r.key)! })} />)}
                  <ListButton title="Later" a11y="Later trips" busy={busy === 'later'} onPress={() => more('later')} />
                </View>
              </View>
            ) : rows.length ? (
              <View style={[s.group, { backgroundColor: c.card }]}>
                <ListButton title="Earlier" a11y="Earlier trips" busy={busy === 'earlier'} onPress={() => more('earlier')} />
                {rows.map((r, i) => <ResultRow key={r.key} r={r} zone={pastNow && i === pn.nextIdx ? 'next' : null} onPress={() => setPick({ key: r.key, j: byKey.get(r.key)! })} />)}
                <ListButton title="Later" a11y="Later trips" busy={busy === 'later'} onPress={() => more('later')} />
              </View>
            ) : (
              <View style={{ marginHorizontal: 20, marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {!live.data && !live.error ? <ActivityIndicator color={c.text2} /> : null}
                <Text maxFontSizeMultiplier={BIG} style={[font.body, { color: live.error && !live.data ? tone('red') : c.text2, flex: 1 }]}>
                  {!live.data ? (live.error ? `${live.error} Pull down to try again.` : 'Finding trips') : live.data.error || 'No trips found. Try another time.'}
                </Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      {body}
      <WhenPicker visible={pickOpen} value={when} now={now} days={pickerDays(now, 8)} kinds={KINDS} onClose={() => setPickOpen(false)}
        onDone={(w) => {
          setPickOpen(false);
          haptic.select();
          setPick(null);
          setWhen(w.kind === 'now' ? NOW : pinDay({ kind: 'leave', h: (w as any).h, m: (w as any).m, ...((w as any).day ? { day: (w as any).day } : {}) }, Date.now()));
        }} />
    </View>
  );
}

const s = StyleSheet.create({
  group: { marginHorizontal: 16, borderRadius: Platform.OS === 'android' ? 16 : 12, overflow: 'hidden' },
  bigRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, minHeight: 60 },
  rowIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  field: { paddingHorizontal: 16, paddingVertical: 10, minHeight: 64, justifyContent: 'center' },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 16, borderRadius: 22 },
  search: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, paddingHorizontal: 14, borderRadius: 12, minHeight: 52 },
  result: { paddingHorizontal: 16, paddingVertical: 14, minHeight: 88, borderTopWidth: StyleSheet.hairlineWidth },
  listBtn: { minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  speak: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginHorizontal: 16, marginTop: 18, minHeight: 56, borderRadius: 14 },
  step: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, minHeight: 64 },
});
