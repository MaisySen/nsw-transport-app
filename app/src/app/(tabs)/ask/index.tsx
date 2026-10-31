// Ask tab: chat about trips. The phone reads the question first (lib/askBrain.ts: typos, short forms, time words,
// home and work, follow ups) and either asks one short question with choices or sends a clear question to /api/ask.
// Answers come back as a short reply plus live cards (departures, trips, alerts) that open the stop board, trip or
// live map, with the actions under them (Open trip, Directions, Speak).
import { askFailText, httpError, isNetErr, noAnswerError, noteReach, READ_MS_EMPTY } from '@/lib/netErrCore';
import { spokenTime } from '@/lib/homeCore';
import { prefetchStop } from '@/lib/prefetch';
import { lazy, memo, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, FlatList, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import { TabBarSafe } from '@/components/TabBarSafe';
import { useKeyboardPad } from '@/lib/keyboard';
import { atEnd } from '@/lib/keyboardCore';
import { useSides } from '@/lib/layout';
import { confirmClearChat, clearAskChat, setAskChat, useAskChat } from '@/lib/askChat';
import { ASK_PAGE, earlierLabel, showMore, shownSlice } from '@/lib/askChatCore';
import { ActionSheet } from '@/components/Sheet';
import { Icon, I } from '@/components/Icon';
import { haptic } from '@/lib/haptic';
import { apiBase } from '@/lib/server';
import { getDevice, PROFILE } from '@/lib/device';
import { onColor, usePalette } from '@/lib/theme';
import { C24, PHONE24, durText } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { store, useStore } from '@/lib/store';
import type { Fare } from '@/lib/types';
import { ACC_LABEL, accessKit, outageText, parkBadge, safeUrl, ticketText, type CarPark, type Station } from '@/lib/access';
import { LineBadge } from '@/components/Transit';
import { RemindLastButton } from '@/components/LastHome';
import { askLastHint, canRemind, type LastHomeHint } from '@/lib/lastHomeCore';
import { shortPlace, statusOf, tripSummary, type AskFare } from '@/lib/askFormat';
import { PlainAnswer, TripAnswer } from '@/components/AskAnswer';
import { chipsFor, lastFresh, nextLast, sydMs, sydney, toAction, understand, type Choice, type Ctx, type Last } from '@/lib/askBrain';
import { askPlaces, askPlacesNow } from '@/lib/askPlaces';
import { actionsFor, depCardOf, depItemsFrom, directFirst, journeysFrom, shownTimes, tripCardOf, tripReply, type CardAction } from '@/lib/askAnswerCore';
import { api, departuresAt } from '@/lib/api';
import { hasSpeech, speak } from '@/lib/nativeExtras';
import { departuresSentence, tripSentence } from '@/lib/voiceCore';
import { takeVoicePrompt } from '@/lib/voiceHelp';
import { reduceMotionNow } from '@/lib/motion';
import { freshFix } from '@/lib/where';

// The one time Get a better voice prompt (same rule as the Speak buttons), loaded only when it shows.
const VoiceHelp = lazy(() => import('@/components/VoiceHelp').then((m) => ({ default: m.VoiceHelp })));

type Link = { kind?: string; label?: string; href?: string; id?: string; name?: string; from?: string; to?: string; fn?: string; tn?: string; [k: string]: any };
type Dep = { line: string; color?: string; mode?: string; dest: string; platform?: string | null; planned: string; estimated?: string | null; realtime: boolean; delayMin: number; cancelled: boolean; link?: Link };
type Leg = { kind: string; mode?: string; line?: string; color?: string; fromPlatform?: string | null; realtime: boolean; delayMin: number; cancelled: boolean; planned?: string; link?: Link | null };
type Jny = { leave: string; arrive: string; durationMin: number; changes: number; legs: Leg[]; warn?: string | null; fare?: Fare | null };
type Card = { type: 'departures' | 'trip' | 'alerts' | 'stops' | 'parking' | 'station' | string; station?: Station; title?: string; titleOnly?: boolean; link?: Link | null; items?: any[]; journeys?: Jny[]; from?: { id: string; name: string }; to?: { id: string; name: string } };
type Msg = { id: string; role: 'me' | 'bot'; text: string; heard?: string | null; choices?: Choice[]; kind?: string | null; fare?: AskFare | null; cards?: Card[]; links?: Link[]; suggestions?: string[]; ask?: string | null; t: number; lastHome?: LastHomeHint | null };

function clock(t: string) {
  if (PHONE24() && Number.isFinite(Date.parse(t))) return C24(Date.parse(t));
  return new Date(t).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Australia/Sydney' }).replace(/\s?(am|pm)/i, (_m, p) => ' ' + p.toLowerCase());
}
function cd(t: string, now: number) {
  const m = Math.round((new Date(t).getTime() - now) / 60000);
  if (m < -1) return { big: clock(t), unit: '', past: true };
  if (m <= 0) return { big: 'Now', unit: '' };
  if (m >= 60) return { big: clock(t), unit: '' };
  return { big: String(m), unit: 'min' };
}
const status = statusOf;
/** Opens a server link in the native screens: stop board, trip, live map. */
function open(l?: Link | null) {
  if (!l) return;
  haptic.select();
  if (l.kind === 'stop' && l.id) return router.push({ pathname: '/stop/[id]', params: { id: l.id, name: l.name || '' } });
  // A trip with stops (or a via) carries its legs and opens as a multi leg trip.
  if (l.kind === 'trip' && l.from && l.to) return router.push({ pathname: '/trip', params: { from: l.from, fromName: l.fn || '', to: l.to, toName: l.tn || '', ...(l.legs ? { legs: String(l.legs) } : {}) } });
  if (l.kind === 'saveTrip' && l.legs) return router.push({ pathname: '/new-trip', params: { legs: String(l.legs) } });
  if (l.kind === 'service') return router.push({ pathname: '/service', params: { trip: l.trip || '', line: l.line || '', stop: l.stop || '', planned: l.planned || '', mode: l.mode || '', destId: l.destId || '', color: l.color || '', dest: l.dest || '' } });
  const u = safeUrl(l.href);
  if (u) Linking.openURL(u).catch(() => {});
}

function Row({ onPress, onPressIn, children, dim }: { onPress?: () => void; onPressIn?: () => void; children: any; dim?: boolean }) {
  const c = usePalette();
  return (
    <Pressable onPress={onPress} onPressIn={onPressIn} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} style={({ pressed }) => [st.row, { borderTopColor: c.sep, opacity: dim ? 0.45 : 1, backgroundColor: pressed ? c.fill : 'transparent' }]}>{children}</Pressable>
  );
}
function Count({ t, live, now }: { t: string; live?: boolean; now: number }) {
    const c = usePalette();
    const x = cd(t, now);
    return (
      // Read as "4 minutes", not "4, min" (VoiceOver and TalkBack).
      <View style={st.cd} accessible accessibilityLabel={spokenTime(x)}>
        <Text maxFontSizeMultiplier={1.3} style={[x.unit || x.big === 'Now' ? st.cdBig : st.cdClock, { color: live ? c.liveText : c.text }]}>{x.big}</Text>
        {x.unit ? <Text maxFontSizeMultiplier={1.3} style={[st.cdUnit, { color: c.text2 }]}>{x.unit}</Text> : null}
      </View>
    );
}
function CardView({ card, now }: { card: Card; now: number }) {
  const c = usePalette();
  return (
    <View style={[st.card, { backgroundColor: c.card, borderColor: c.sep }]}>
      {card.type !== 'alerts' && card.type !== 'stops' ? (
        <Pressable onPress={() => open(card.link)} disabled={!card.link} accessibilityRole={card.link ? 'button' : 'header'} style={st.head}>
          <Text maxFontSizeMultiplier={1.6} numberOfLines={1} style={[st.headText, { color: c.text2 }]}>{card.type === 'trip' ? (card.titleOnly && card.title ? card.title : `${card.title ? card.title + ': ' : ''}${shortPlace(card.from?.name)} to ${shortPlace(card.to?.name)}`) : card.type === 'station' ? card.station?.name : card.title}</Text>
          {card.link ? <Text maxFontSizeMultiplier={1.3} style={{ color: c.text3, fontSize: 17 }}>{'\u203a'}</Text> : null}
        </Pressable>
      ) : null}
      {card.type === 'departures' && (card.items as Dep[]).map((it, i) => {
        const s = status(it); const t = it.estimated || it.planned;
        return (
          <Row key={i} onPress={() => open(it.link)} dim={it.cancelled || cd(t, now).past}>
            <LineBadge line={it.line} mode={it.mode} color={it.color} />
            <View style={st.mid}>
              <Text maxFontSizeMultiplier={1.6} numberOfLines={1} style={[st.t1, { color: c.text }]}>{it.dest}</Text>
              <Text maxFontSizeMultiplier={1.6} numberOfLines={1} style={[st.t2, { color: c.text2 }]}>{[it.platform?.replace(/^Platform /, 'Plat '), clock(t)].filter(Boolean).join(' \u00b7 ')}  <Text maxFontSizeMultiplier={1.6} style={{ color: (c as any)[s.tone], fontWeight: '600' }}>{s.text}</Text></Text>
            </View>
            <Count now={now} t={t} live={it.realtime && !it.cancelled} />
          </Row>
        );
      })}
      {card.type === 'trip' && (card.journeys || []).map((j, i) => {
        const tl = j.legs.filter((l) => l.kind === 'transit'); const f = tl[0]; const s = f ? status(f) : null;
        return (
          <Row key={i} onPress={() => open(card.link || f?.link)} dim={cd(j.leave, now).past}>
            <View style={st.mid}>
              <Text maxFontSizeMultiplier={1.6} style={[st.t1, { color: c.text, fontVariant: ['tabular-nums'] }]}>{clock(j.leave)} to {clock(j.arrive)}</Text>
              <View style={st.legs}>
                {tl.map((l, k) => <LineBadge key={k} line={l.line} mode={l.mode} color={l.color} />)}
                <Text maxFontSizeMultiplier={1.6} style={[st.t2, { color: c.text2 }]}>{durText(j.durationMin)} {'\u00b7'} {j.changes ? `${j.changes} change${j.changes > 1 ? 's' : ''}` : 'Direct'}</Text>
              </View>
              {s ? <Text maxFontSizeMultiplier={1.6} style={[st.t2, { color: (c as any)[s.tone], fontWeight: '600' }]}>{s.text}</Text> : null}
              {j.warn ? <Text maxFontSizeMultiplier={1.6} style={[st.t2, { color: c.orange, fontWeight: '600' }]}>{j.warn}</Text> : null}
            </View>
            <Count now={now} t={j.leave} live={f?.realtime} />
          </Row>
        );
      })}
      {card.type === 'alerts' && (card.items || []).map((a: any, i: number) => (
        <Row key={i} onPress={() => { const u = safeUrl(a.url); if (u) Linking.openURL(u).catch(() => {}); }}>
          <Text maxFontSizeMultiplier={1.3} style={{ color: c.orange, fontSize: 16 }}>{'\u26a0\ufe0e'}</Text>
          <View style={st.mid}><Text maxFontSizeMultiplier={1.6} numberOfLines={3} style={[st.t3, { color: c.text }]}>{a.title}</Text></View>
        </Row>
      ))}
      {card.type === 'stops' && (card.items || []).map((s: any, i: number) => (
        <Row key={i} onPress={() => open(s.link)}>
          <View style={st.mid}><Text maxFontSizeMultiplier={1.6} style={[st.t1, { color: c.text }]}>{s.name}</Text><Text maxFontSizeMultiplier={1.6} style={[st.t2, { color: c.text2 }]}>{s.distance} m</Text></View>
        </Row>
      ))}
      {card.type === 'parking' && (card.items || []).map((p: CarPark, i: number) => {
        const b = parkBadge(p);
        return (
          <Row key={i} onPressIn={() => { if (p.station) prefetchStop(p.station); }} onPress={() => p.station && router.push({ pathname: '/stop/[id]', params: { id: p.station, name: '' } })}>
            <View style={st.mid}>
              <Text maxFontSizeMultiplier={1.6} style={[st.t1, { color: c.text }]}>{p.name}</Text>
              <Text maxFontSizeMultiplier={1.6} style={[st.t2, { color: b.tone === 'green' ? c.liveText : b.tone === 'orange' ? c.lateText : b.tone === 'red' ? c.redText : c.text2, fontWeight: '600' }]}>
                {b.text}{p.free != null ? ` \u00b7 ${p.free} of ${p.spots} free` : ` \u00b7 ${p.spots} spaces`}
              </Text>
            </View>
          </Row>
        );
      })}
      {card.type === 'station' && card.station ? (() => {
        const sx = card.station as Station;
        const tk = ticketText(sx.ticket);
        return (
          <>
            <Row onPressIn={() => prefetchStop(sx.id)} onPress={() => router.push({ pathname: '/stop/[id]', params: { id: sx.id, name: sx.name } })}>
              <View style={st.mid}>
                <Text maxFontSizeMultiplier={1.6} style={[st.t1, { color: c.text }]}>{sx.access?.label || ACC_LABEL[sx.access?.level || 'unknown']}</Text>
                <Text maxFontSizeMultiplier={1.6} style={[st.t2, { color: c.text2 }]}>{accessKit(sx.access) || tk.title}</Text>
              </View>
            </Row>
            {(sx.outages || []).map((o, i) => (
              <Row key={i} onPress={() => { const u = safeUrl(o.url); if (u) Linking.openURL(u).catch(() => {}); }}>
                <View style={st.mid}>
                  <Text maxFontSizeMultiplier={1.6} style={[st.t1, { color: c.redText }]}>{o.kind === 'escalator' ? 'Escalator' : 'Lift'} out of service</Text>
                  <Text maxFontSizeMultiplier={1.6} numberOfLines={3} style={[st.t2, { color: c.text2 }]}>{outageText(o.title, sx.name)}</Text>
                </View>
              </Row>
            ))}
            <Row onPressIn={() => prefetchStop(sx.id)} onPress={() => router.push({ pathname: '/stop/[id]', params: { id: sx.id, name: sx.name } })}>
              <View style={st.mid}><Text maxFontSizeMultiplier={1.6} style={[st.t1, { color: c.text }]}>{tk.title}</Text><Text maxFontSizeMultiplier={1.6} style={[st.t2, { color: c.text2 }]}>{tk.sub}</Text></View>
            </Row>
          </>
        );
      })() : null}
    </View>
  );
}
function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  const c = usePalette();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={{ top: 5, bottom: 5 }} style={({ pressed }) => [st.chip, { backgroundColor: pressed ? c.fill : c.card, borderColor: c.sep }]}>
      <Text maxFontSizeMultiplier={1.6} style={{ color: c.tint, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}


const LOCATION_Q = '\u0000location';
// Server links that the action buttons already offer.
const ACT_LABELS = new Set(['Open trip', 'Open board', 'Directions']);
const canSpeak = (() => { let v: boolean | null = null; return () => (v ??= hasSpeech()); })();
/** What Speak reads: the next services from the card on screen, built at tap time from live data. */
function sayFor(item: Msg, now: number): string {
  const t = tripCardOf(item.cards as any);
  if (t && (t.journeys || []).length) return tripSentence(t.journeys as any, now) || item.text;
  const d = depCardOf(item.cards as any);
  if (d && (d.items || []).length) return departuresSentence(d.items as any, now, { stop: d.title || null });
  return item.text;
}
/** The buttons under an answer: Open trip or board, Directions, Speak. */
function Actions({ item, now }: { item: Msg; now: number }) {
  const c = usePalette();
  const [help, setHelp] = useState(false);
  const acts = actionsFor(item.cards as any, Platform.OS).filter((a) => a.kind !== 'speak' || canSpeak());
  if (!acts.length) return null;
  const go = (a: CardAction) => {
    haptic.select();
    if (a.kind === 'open') open(a.link);
    else if (a.kind === 'directions' && a.url) { const u = safeUrl(a.url); if (u) Linking.openURL(u).catch(() => {}); }
    else if (a.kind === 'speak') {
      const words = sayFor(item, Date.now());
      if (words) speak(words, { interrupt: true });
      takeVoicePrompt().then((show) => { if (show) setHelp(true); }).catch(() => {});
    }
  };
  return (
    <View style={st.acts}>
      {acts.map((a) => (
        <Pressable key={a.kind + a.label} onPress={() => go(a)} accessibilityRole="button" accessibilityLabel={a.label}
          accessibilityHint={a.kind === 'speak' ? 'Reads the next services out loud' : a.kind === 'directions' ? 'Opens directions in your maps app' : undefined}
          style={({ pressed }) => [st.act, { backgroundColor: pressed ? c.fill : c.card, borderColor: c.sep }]}>
          <Icon name={a.kind === 'speak' ? I.speaker : a.kind === 'directions' ? I.nav : a.label === 'Open trip' ? I.route : I.list} size={15} color={c.tint} />
          <Text maxFontSizeMultiplier={1.6} style={{ color: c.tint, fontSize: 15, fontWeight: '600' }}>{a.label}</Text>
        </Pressable>
      ))}
      {help ? <Suspense fallback={null}><VoiceHelp visible start="prompt" onClose={() => setHelp(false)} /></Suspense> : null}
    </View>
  );
}
// The last answer, for follow ups ("and the one after", "what about by bus"). Kept for 30 minutes, in memory only.
let brainLast: Last | null = null;

/**
 * One message. Memoized and defined once, so typing, a countdown tick or a new answer does not rebuild every
 * card in the chat (they were made inside the screen and mounted again on every render).
 */
const MsgRow = memo(function MsgRow({ item, last, now, onAsk, onLocation }: { item: Msg; last: boolean; now: number; onAsk: (q: string) => void; onLocation: () => void }) {
  const c = usePalette();
  return item.role === 'me' ? (
    <View style={[st.bubble, st.me, { backgroundColor: c.tint }]}><Text maxFontSizeMultiplier={1.6} style={[st.meText, { color: onColor(c.tint) }]}>{item.text}</Text></View>
  ) : (
    <View style={{ alignItems: 'flex-start', marginTop: 6 }}>
      {item.heard ? <Text maxFontSizeMultiplier={1.6} accessibilityRole="text" style={[st.heard, { color: c.text2 }]}>{item.heard}</Text> : null}
      {(() => { const sum = tripSummary(item, now); return sum ? <TripAnswer s={sum} /> : <PlainAnswer text={item.text} />; })()}
      {(item.cards || []).map((card, i) => <CardView key={i} card={card} now={now} />)}
      {item.lastHome && canRemind(Date.parse(item.lastHome.leave || item.lastHome.svc?.leave || ''), now) ? <RemindLastButton hint={item.lastHome} known={!item.lastHome.svc} acc={store.accOn()} /> : null}
      <Actions item={item} now={now} />
      {item.links && item.links.length ? <View style={st.chips}>{item.links.filter((l) => !ACT_LABELS.has(String(l.label || ''))).map((l, i) => <Chip key={i} label={l.label || 'Open'} onPress={() => open(l)} />)}</View> : null}
      {last && (item.ask === 'location' || (item.suggestions || []).length || (item.choices || []).length) ? (
        <View style={st.chips}>
          {item.ask === 'location' ? <Chip label="Use my location" onPress={onLocation} /> : null}
          {(item.choices || []).map((ch) => <Chip key={'c' + ch.q} label={ch.label} onPress={() => (ch.q === LOCATION_Q ? onLocation() : onAsk(ch.q))} />)}
          {(item.suggestions || []).map((s) => <Chip key={s} label={s.replace(/ (Station|Light Rail|Wharf)\b/g, '')} onPress={() => onAsk(s)} />)}
        </View>
      ) : null}
    </View>
  );
}, (a, b) => a.item === b.item && a.onAsk === b.onAsk && a.onLocation === b.onLocation && (a.item.role === 'me' || (a.last === b.last && a.now === b.now)));

export default function AskScreen() {
  const c = usePalette();
  const now = useNow(15000);
  const side = useSides();
  // The chat is kept on this phone (lib/askChat.ts, at most 200 messages). Ask opens on the last 30; Load earlier
  // (or scrolling to the top) adds 30 more, so a long chat opens as fast as a short one.
  const { msgs } = useAskChat<Msg>();
  const setMsgs = setAskChat as (f: (m: Msg[]) => Msg[]) => void;
  const [shown, setShown] = useState(ASK_PAGE);
  const view = shownSlice(msgs, shown);
  const more = earlierLabel(view.length, msgs.length);
  const [confirm, setConfirm] = useState<{ title: string; message: string; confirm: string } | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useRef<FlatList<Msg>>(null);
  const { places, recentTrips, starred, myTrips } = useStore();
  // What Ask knows about you, for home, work, follow ups and the chips: all from this phone, nothing fixed.
  const brainCtx = useCallback((at: number, hasLocation: boolean): Ctx => ({
    now: at, gaz: askPlacesNow(), last: lastFresh(brainLast, at) ? brainLast : null, places: places || {}, starred: starred || [], recentTrips: recentTrips || [],
    usual: (myTrips || []).map((t) => ({ from: t.from, to: t.to, mode: t.legs?.[0]?.mode || t.modes?.[0] })), hasLocation,
  }), [places, starred, recentTrips, myTrips]);
  // Station and suburb names, kept on the phone after the first time (no wait: Ask works before they arrive).
  // Read when Ask is opened, not at launch (the native tabs mount every tab at start; 27 Oct speed pass 5).
  useFocusEffect(useCallback(() => { askPlaces().catch(() => null); }, []));
  // Chips come from your own trips only: usual and recent trips, home and work, starred stops.
  const starters = chipsFor(brainCtx(now, false), sydney(now).h);

  const ask = useCallback(async (q: string, extra: Record<string, string> = {}) => {
    q = q.trim();
    if (!q || busy) return;
    setMsgs((m) => [...m, { id: 'u' + Date.now(), role: 'me', text: q, t: Date.now() }]);
    setText(''); setBusy(true);
    const bot = (x: Partial<Msg>) => {
      setMsgs((m) => [...m, { id: 'b' + Date.now(), role: 'bot', text: '', t: Date.now(), ...x }]);
      // VoiceOver and TalkBack hear the answer once when it lands (1 Nov polish); never on ticks.
      const said = String(x.text || '').trim();
      if (said) AccessibilityInfo.isScreenReaderEnabled().then((on) => { if (on) AccessibilityInfo.announceForAccessibility(said.slice(0, 240)); }).catch(() => {});
    };
    try {
      let at = Date.now();
      let u = understand(q, brainCtx(at, !!extra.lat));
      // A trip with no start: use where you are if location is already allowed (no prompt, a recent fix only).
      if (!extra.lat && (u.intent === 'trip' || u.intent === 'fare' || u.intent === 'nearby' || u.intent === 'departures') && !u.slots.from && (u.intent !== 'departures' || !u.slots.stop)) {
        try {
          const Location = require('expo-location');
          const perm = await Location.getForegroundPermissionsAsync();
          const pos = perm?.status === 'granted' ? await Location.getLastKnownPositionAsync({ maxAge: 300000 }) : null;
          if (pos) { extra = { ...extra, lat: pos.coords.latitude.toFixed(5), lon: pos.coords.longitude.toFixed(5) }; at = Date.now(); u = understand(q, brainCtx(at, true)); }
        } catch { /* no location module in this build, or no fix */ }
      }
      const bctx = brainCtx(at, !!extra.lat);
      const a = toAction(u, bctx);
      if (a.kind !== 'ask') { bot({ text: a.text, choices: a.choices || [] }); return; }
      const p: Record<string, string> = { q: a.q, profile: PROFILE, device: await getDevice(), fare: store.fareType(), ...(store.accOn() ? { acc: '1' } : {}), ...(a.extra || {}), ...extra };
      if (places?.home?.id) p.home = `${places.home.id}|${places.home.name || ''}`;
      if (places?.work?.id) p.work = `${places.work.id}|${places.work.name || ''}`;
      const qs = Object.entries(p).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      // A slow answer ends after 15 s (netErrCore.ts read deadline), so the chat never waits on a spinner for good. The
      // failure says whether it was the phone's connection or the live data (askFailText below).
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), READ_MS_EMPTY);
      let d: any;
      try {
        const r = await fetch(`${apiBase()}/api/ask?${qs}`, { signal: ctl.signal });
        noteReach();
        if (!r.ok) throw httpError(r.status, await r.json().catch(() => ({})));
        d = await r.json();
      } catch (e: any) {
        throw isNetErr(e) ? noAnswerError(e) : e;
      } finally { clearTimeout(timer); }
      let cards: Card[] = d.cards || [];
      let reply: string = d.reply || d.text || "Sorry, I didn't get that.";
      const rf = a.refine;
      // Another day, a mode on another day, or no changes: the planner's own answer for exactly that.
      const tc = tripCardOf(cards as any);
      if (rf && tc && (rf.date || rf.direct)) {
        try {
          let journeys = (tc.journeys || []) as any[];
          if (rf.date) {
            const r = await api.trip({ id: tc.from!.id, name: tc.from!.name }, { id: tc.to!.id, name: tc.to!.name },
              { count: 6, time: rf.time ? rf.time.replace(':', '') : undefined, arriveBy: !!rf.arriveBy, date: rf.date.replace(/-/g, ''), modes: rf.modes ? [rf.modes] : undefined });
            journeys = journeysFrom(r);
          }
          let note: string | null = null;
          if (rf.direct) ({ journeys, note } = directFirst(journeys));
          const card = { ...tc, journeys };
          cards = cards.map((x: any) => (x === tc ? card : x));
          reply = tripReply(card as any, u.slots.day || null, Date.now()) + (note ? '\n' + note : '');
        } catch (e: any) {
          reply = `${e?.message || "Couldn't plan that day just now."} Showing the next trips instead.\n${reply}`;
        }
      }
      const dc = depCardOf(cards as any);
      const stopId = rf?.stop || (dc?.link?.kind === 'stop' ? dc.link.id : null);
      if (rf && rf.board && dc && stopId && (rf.time || rf.date)) {
        try {
          const today = sydney(Date.now());
          const day = rf.date || `${today.y}-${String(today.mo).padStart(2, '0')}-${String(today.d).padStart(2, '0')}`;
          const r = await departuresAt(stopId, sydMs(day, rf.time || '00:00'));
          const items = depItemsFrom(r).filter((i: any) => !u.slots.mode || i.mode === u.slots.mode || (u.slots.mode === 'bus' && i.mode === 'coach'));
          cards = cards.map((x: any) => (x === dc ? { ...dc, items } : x));
          reply = items.length ? `${a.heard}.` : `${a.heard}: nothing found for that time.`;
        } catch (e: any) {
          reply = `${e?.message || "Couldn't load that time just now."} Showing departures from now.\n${reply}`;
        }
      }
      if (u.intent === 'fare') {
        // Lead with the Opal estimate the trip answer carries; without one, say where to see it.
        const lines = reply.split('\n');
        const fl = lines.findIndex((x) => /\bfare\b/i.test(x) && /\$\d/.test(x));
        reply = fl >= 0 ? [lines[fl], ...lines.filter((_x, i) => i !== fl)].join('\n') : `No fare estimate for this trip right now. Your Opal card's trip history shows what each trip cost.\n${reply}`;
      }
      const shown = shownTimes(cards as any);
      // Follow up chips on a trip or a board: later (and earlier for trips), plus what the server suggests.
      const canFollow = ['trip', 'departures', 'later', 'earlier', 'mybus'].includes(u.intent);
      const follow: Choice[] = !canFollow ? [] : tripCardOf(cards as any) ? [{ label: 'Earlier', q: 'Earlier' }, { label: 'Later', q: 'Later' }] : dc ? [{ label: 'Later', q: 'Later' }] : [];
      bot({ text: reply, heard: a.heard, kind: typeof d.kind === 'string' ? d.kind : null, fare: d.fare || null, cards, links: d.links || [], choices: follow, suggestions: (d.suggestions || []).slice(0, 3), ask: d.ask || null, lastHome: askLastHint(d) });
      brainLast = nextLast(u, shown, Date.now());
    } catch (e: any) {
      // Honest about where the fault is (g16): "check your signal" only when the phone has no connection.
      const text = askFailText(e);
      bot({ text, suggestions: [q] });
    } finally { setBusy(false); }
  }, [busy, places, brainCtx]);

  const askWithLocation = useCallback(async () => {
    const last = [...msgs].reverse().find((m) => m.role === 'me');
    if (!last) return;
    try {
      const Location = require('expo-location');
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') return;
      // A recent fix costs no GPS; otherwise about 100 m is plenty to find the nearest stop.
      const pos = (await Location.getLastKnownPositionAsync({ maxAge: 120000 }).catch(() => null)) || (await freshFix(Location.Accuracy.Balanced));
      ask(last.text, { lat: pos.coords.latitude.toFixed(5), lon: pos.coords.longitude.toFixed(5) });
    } catch { /* expo-location not in this build */ }
  }, [msgs, ask]);

  // The chat stays on its latest message: when you open the tab, when a message or answer arrives, when the keyboard
  // comes up and while the answer's cards lay out. Scrolling up to read older messages stops that until you are back
  // at the end. The list follows its content size, so a long history is shown from the end once it has laid out.
  const stick = useRef(true);
  // Reduce Motion: new answers appear at the bottom without the scroll animation.
  const toEnd = useCallback((animated = false) => { stick.current = true; requestAnimationFrame(() => list.current?.scrollToEnd({ animated: animated && !reduceMotionNow() })); }, []);
  useFocusEffect(useCallback(() => { toEnd(false); }, [toEnd]));
  useEffect(() => { toEnd(true); }, [msgs.length, busy, toEnd]);
  // Only your own scrolling decides (a drag and its glide), not the list's own scroll to the end.
  const onUserScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const n = e.nativeEvent;
    stick.current = atEnd(n.contentOffset.y, n.layoutMeasurement.height, n.contentSize.height, n.contentInset?.bottom || 0);
  }, []);
  const kb = useKeyboardPad(() => toEnd(true));

  // Older messages: Load earlier at the top, or scrolling up to it. The list keeps its place where the phone can.
  const loadEarlier = useCallback(() => { stick.current = false; setShown((s) => showMore(s, msgs.length)); }, [msgs.length]);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (e.nativeEvent.contentOffset.y < 40 && !stick.current && view.length < msgs.length) loadEarlier();
  }, [loadEarlier, view.length, msgs.length]);
  useEffect(() => { if (!msgs.length) setShown(ASK_PAGE); }, [msgs.length]);
  const clear = useCallback(() => { clearAskChat(); setShown(ASK_PAGE); haptic.success(); }, []);
  const askClear = () => { haptic.tap(); confirmClearChat(msgs.length, clear, setConfirm); };
  // Rows only render again when their message, the minute or being last changes; typing does not touch them.
  const askRef = useRef(ask); askRef.current = ask;
  const locRef = useRef(askWithLocation); locRef.current = askWithLocation;
  const onAsk = useCallback((q: string) => askRef.current(q), []);
  const onLocation = useCallback(() => locRef.current(), []);
  const lastId = view.length ? view[view.length - 1].id : '';
  const renderItem = useCallback(({ item }: { item: Msg }) => <MsgRow item={item} last={item.id === lastId} now={now} onAsk={onAsk} onLocation={onLocation} />, [lastId, now, onAsk, onLocation]);

  return (
    // Above the tab bar (iOS 26 and 27 draw the screen under the floating bar), then above the keyboard.
    <TabBarSafe style={{ backgroundColor: c.bg }}>
    <Stack.Screen options={{ headerRight: msgs.length ? () => (
      <Pressable onPress={askClear} accessibilityRole="button" accessibilityLabel="Clear chat" accessibilityHint="Deletes the chat on this phone" hitSlop={10}
        style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed && Platform.OS !== 'android' ? 0.5 : 1 })}>
        <Icon name={I.trash} size={20} color={c.tint} />
      </Pressable>
    ) : undefined }} />
    <View ref={kb.ref} onLayout={kb.onLayout} style={{ flex: 1, paddingBottom: kb.pad }}>
      <FlatList
        ref={list}
        onScrollEndDrag={onUserScroll}
        onMomentumScrollEnd={onUserScroll}
        onContentSizeChange={() => { if (stick.current) list.current?.scrollToEnd({ animated: false }); }}
        // The chips row under the list comes and goes with the answer: stay on the latest message when the list resizes.
        onLayout={() => { if (stick.current) list.current?.scrollToEnd({ animated: false }); }}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        data={view}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={9}
        onScroll={onScroll}
        scrollEventThrottle={100}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        ListHeaderComponent={more ? (
          <Pressable onPress={loadEarlier} accessibilityRole="button" accessibilityLabel={more} hitSlop={6}
            style={({ pressed }) => [st.earlier, { backgroundColor: pressed ? c.fill : 'transparent' }]}>
            <Text maxFontSizeMultiplier={1.6} style={{ color: c.tint, fontSize: 15, fontWeight: '600' }}>{more}</Text>
          </Pressable>
        ) : undefined}
        contentContainerStyle={{ padding: 12, paddingBottom: 16, paddingLeft: 12 + side.left, paddingRight: 12 + side.right }}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 24 }}>
            <Text maxFontSizeMultiplier={1.6} style={[st.helloTitle, { color: c.text }]}>Ask about any trip</Text>
            <Text maxFontSizeMultiplier={1.6} style={[st.helloBody, { color: c.text2 }]}>Type a stop, a line or two places, like next train from one station to another.</Text>
            {starters.length ? <View style={{ alignSelf: 'stretch', alignItems: 'flex-end', gap: 8, marginTop: 18 }}>{starters.map((s) => <Chip key={s} label={s} onPress={() => ask(s)} />)}</View> : null}
          </View>
        }
        ListFooterComponent={busy ? <View style={[st.bubble, st.bot, { backgroundColor: c.dark ? '#26252A' : '#E9E9EB', marginTop: 6 }]}><ActivityIndicator size="small" accessibilityLabel="Looking that up" /></View> : undefined}
      />
      {msgs.length && !text && !busy && starters.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 12 + side.left, paddingVertical: 6 }}>
          {starters.map((q) => <Chip key={'s' + q} label={q} onPress={() => ask(q)} />)}
        </ScrollView>
      ) : null}
      <View style={[st.bar, { backgroundColor: c.card, borderTopColor: c.sep, paddingLeft: 12 + side.left, paddingRight: 12 + side.right, paddingBottom: 8 }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => ask(text)}
          returnKeyType="send"
          accessibilityLabel="Ask about a train, bus or trip"
          placeholder="Ask about a train, bus or trip"
          placeholderTextColor={c.text3}
          style={[st.input, { color: c.text, backgroundColor: c.bg, borderColor: c.sep }]}
        />
        <Pressable accessibilityRole="button" accessibilityLabel="Send" accessibilityState={{ disabled: !text.trim() || busy }} hitSlop={6} disabled={!text.trim() || busy} onPress={() => ask(text)} style={[st.send, { backgroundColor: text.trim() ? c.tint : c.fill }]}>
          <Text maxFontSizeMultiplier={1.2} style={{ color: text.trim() ? onColor(c.tint) : c.text3, fontSize: 18, fontWeight: '700' }}>{'\u2191'}</Text>
        </Pressable>
      </View>
    </View>
    <ActionSheet visible={!!confirm} title={confirm?.title} message={confirm?.message} onClose={() => setConfirm(null)}
      actions={confirm ? [{ text: confirm.confirm, icon: I.trash, destructive: true, onPress: clear }] : []} />
    </TabBarSafe>
  );
}

const st = StyleSheet.create({
  heard: { fontSize: 13, lineHeight: 18, marginBottom: 4, marginLeft: 4 },
  acts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  act: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth },
  bubble: { maxWidth: '80%', paddingHorizontal: 13, paddingVertical: 8, borderRadius: 19 },
  me: { alignSelf: 'flex-end', borderBottomRightRadius: 6, marginTop: 6 },
  bot: { alignSelf: 'flex-start', borderBottomLeftRadius: 6 },
  meText: { color: '#fff', fontSize: 17, lineHeight: 22 },
  botText: { fontSize: 17, lineHeight: 22 },
  card: { alignSelf: 'stretch', maxWidth: 380, marginTop: 6, borderRadius: 14, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8 },
  headText: { flex: 1, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 9, minHeight: 52, borderTopWidth: StyleSheet.hairlineWidth },
  mid: { flex: 1, minWidth: 0 },
  t1: { fontSize: 16, fontWeight: '600' },
  t2: { fontSize: 13, marginTop: 1 },
  t3: { fontSize: 14, lineHeight: 19 },
  legs: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2, flexWrap: 'wrap' },
  cd: { minWidth: 48, alignItems: 'flex-end' },
  cdBig: { fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  cdClock: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  cdUnit: { fontSize: 12, fontWeight: '500' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { minHeight: 34, paddingVertical: 6, paddingHorizontal: 14, borderRadius: 17, justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  helloTitle: { fontSize: 20, fontWeight: '700' },
  helloBody: { fontSize: 15, marginTop: 6, textAlign: 'center', maxWidth: 300 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: 48, borderRadius: 18, paddingHorizontal: 14, fontSize: 17, borderWidth: StyleSheet.hairlineWidth },
  earlier: { alignSelf: 'center', minHeight: 44, paddingHorizontal: 16, borderRadius: 22, justifyContent: 'center', marginBottom: 6 },
  send: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});
