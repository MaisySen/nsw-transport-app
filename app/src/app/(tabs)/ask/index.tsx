// Ask tab: chat about trips. Questions go to /api/ask; answers come back as a short reply
// plus live cards (departures, trips, alerts) that open the stop board, trip or live map.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { haptic } from '@/lib/haptic';
import { apiBase } from '@/lib/server';
import { getDevice, PROFILE } from '@/lib/device';
import { usePalette } from '@/lib/theme';
import { useNow } from '@/lib/hooks';
import { store, useStore } from '@/lib/store';
import type { Fare } from '@/lib/types';
import { ACC_LABEL, accessKit, outageText, parkBadge, safeUrl, ticketText, type CarPark, type Station } from '@/lib/access';
import { LineBadge } from '@/components/Transit';
import { RemindLastButton } from '@/components/LastHome';
import { canRemind, type LastHomeHint } from '@/lib/lastHomeCore';
import { shortPlace, statusOf, tripSummary, type AskFare } from '@/lib/askFormat';
import { PlainAnswer, TripAnswer } from '@/components/AskAnswer';

type Link = { kind?: string; label?: string; href?: string; id?: string; name?: string; from?: string; to?: string; fn?: string; tn?: string; [k: string]: any };
type Dep = { line: string; color?: string; mode?: string; dest: string; platform?: string | null; planned: string; estimated?: string | null; realtime: boolean; delayMin: number; cancelled: boolean; link?: Link };
type Leg = { kind: string; mode?: string; line?: string; color?: string; fromPlatform?: string | null; realtime: boolean; delayMin: number; cancelled: boolean; planned?: string; link?: Link | null };
type Jny = { leave: string; arrive: string; durationMin: number; changes: number; legs: Leg[]; warn?: string | null; fare?: Fare | null };
type Card = { type: 'departures' | 'trip' | 'alerts' | 'stops' | 'parking' | 'station' | string; station?: Station; title?: string; titleOnly?: boolean; link?: Link | null; items?: any[]; journeys?: Jny[]; from?: { id: string; name: string }; to?: { id: string; name: string } };
type Msg = { id: string; role: 'me' | 'bot'; text: string; kind?: string | null; fare?: AskFare | null; cards?: Card[]; links?: Link[]; suggestions?: string[]; ask?: string | null; t: number; lastHome?: LastHomeHint | null };

const KEY = 'ask_chat_v1';

function clock(t: string) {
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
  if (u) Linking.openURL(u);
}

export default function AskScreen() {
  const c = usePalette();
  const now = useNow(15000);
  const insets = useSafeAreaInsets();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useRef<FlatList<Msg>>(null);
  const { places, recentTrips } = useStore();
  // Suggestions come from your own trips only: your two most recent, and the last train home once home is set.
  const nm = (n: string) => n.split(',')[0].replace(/ Station$/, '');
  const starters = [
    ...(recentTrips || []).slice(0, 2).map((r) => `Next train ${nm(r.from.name)} to ${nm(r.to.name)}`),
    ...(places?.home ? ['Last train home'] : []),
  ];

  useEffect(() => { AsyncStorage.getItem(KEY).then((v) => { if (v) setMsgs(JSON.parse(v)); }).catch(() => {}); }, []);
  useEffect(() => { AsyncStorage.setItem(KEY, JSON.stringify(msgs.slice(-40))).catch(() => {}); }, [msgs]);

  const ask = useCallback(async (q: string, extra: Record<string, string> = {}) => {
    q = q.trim();
    if (!q || busy) return;
    setMsgs((m) => [...m, { id: 'u' + Date.now(), role: 'me', text: q, t: Date.now() }]);
    setText(''); setBusy(true);
    try {
      const p: Record<string, string> = { q, profile: PROFILE, device: await getDevice(), fare: store.fareType(), ...(store.accOn() ? { acc: '1' } : {}), ...extra };
      if (places?.home?.id) p.home = `${places.home.id}|${places.home.name || ''}`;
      if (places?.work?.id) p.work = `${places.work.id}|${places.work.name || ''}`;
      const qs = Object.entries(p).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      // A slow answer ends after 25 s like a dropped one, so the chat never waits on a spinner for good.
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 25000);
      let d: any;
      try {
        const r = await fetch(`${apiBase()}/api/ask?${qs}`, { signal: ctl.signal });
        if (!r.ok) throw Object.assign(new Error(String(r.status)), { http: r.status });
        d = await r.json();
      } finally { clearTimeout(timer); }
      setMsgs((m) => [...m, { id: 'b' + Date.now(), role: 'bot', text: d.reply || d.text || "Sorry, I didn't get that.", kind: typeof d.kind === 'string' ? d.kind : null, fare: d.fare || null, cards: d.cards || [], links: d.links || [], suggestions: d.suggestions || [], ask: d.ask || null, t: Date.now(), lastHome: d.lastHome && d.lastHome.from && d.lastHome.to ? d.lastHome : null }]);
    } catch (e: any) {
      const text = e?.http ? "Ask isn't answering right now. Try again in a minute." : 'No connection right now. Check your signal and try again.';
      setMsgs((m) => [...m, { id: 'b' + Date.now(), role: 'bot', text, suggestions: [q], t: Date.now() }]);
    } finally { setBusy(false); }
  }, [busy, places]);

  const askWithLocation = useCallback(async () => {
    const last = [...msgs].reverse().find((m) => m.role === 'me');
    if (!last) return;
    try {
      const Location = require('expo-location');
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') return;
      // A recent fix costs no GPS; otherwise about 100 m is plenty to find the nearest stop.
      const pos = (await Location.getLastKnownPositionAsync({ maxAge: 120000 }).catch(() => null)) || (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      ask(last.text, { lat: pos.coords.latitude.toFixed(5), lon: pos.coords.longitude.toFixed(5) });
    } catch { /* expo-location not in this build */ }
  }, [msgs, ask]);

  useEffect(() => { setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50); }, [msgs.length, busy]);

  const Row = ({ onPress, children, dim }: { onPress?: () => void; children: any; dim?: boolean }) => (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} style={({ pressed }) => [st.row, { borderTopColor: c.sep, opacity: dim ? 0.45 : 1, backgroundColor: pressed ? c.fill : 'transparent' }]}>{children}</Pressable>
  );
  const Count = ({ t, live }: { t: string; live?: boolean }) => {
    const x = cd(t, now);
    return (
      <View style={st.cd}>
        <Text style={[x.unit || x.big === 'Now' ? st.cdBig : st.cdClock, { color: live ? c.liveText : c.text }]}>{x.big}</Text>
        {x.unit ? <Text style={[st.cdUnit, { color: c.text2 }]}>{x.unit}</Text> : null}
      </View>
    );
  };
  const CardView = ({ card }: { card: Card }) => (
    <View style={[st.card, { backgroundColor: c.card, borderColor: c.sep }]}>
      {card.type !== 'alerts' && card.type !== 'stops' ? (
        <Pressable onPress={() => open(card.link)} disabled={!card.link} accessibilityRole={card.link ? 'button' : 'header'} style={st.head}>
          <Text numberOfLines={1} style={[st.headText, { color: c.text2 }]}>{card.type === 'trip' ? (card.titleOnly && card.title ? card.title : `${card.title ? card.title + ': ' : ''}${shortPlace(card.from?.name)} to ${shortPlace(card.to?.name)}`) : card.type === 'station' ? card.station?.name : card.title}</Text>
          {card.link ? <Text style={{ color: c.text3, fontSize: 17 }}>{'\u203a'}</Text> : null}
        </Pressable>
      ) : null}
      {card.type === 'departures' && (card.items as Dep[]).map((it, i) => {
        const s = status(it); const t = it.estimated || it.planned;
        return (
          <Row key={i} onPress={() => open(it.link)} dim={it.cancelled || cd(t, now).past}>
            <LineBadge line={it.line} mode={it.mode} color={it.color} />
            <View style={st.mid}>
              <Text numberOfLines={1} style={[st.t1, { color: c.text }]}>{it.dest}</Text>
              <Text numberOfLines={1} style={[st.t2, { color: c.text2 }]}>{[it.platform?.replace(/^Platform /, 'Plat '), clock(t)].filter(Boolean).join(' \u00b7 ')}  <Text style={{ color: (c as any)[s.tone], fontWeight: '600' }}>{s.text}</Text></Text>
            </View>
            <Count t={t} live={it.realtime && !it.cancelled} />
          </Row>
        );
      })}
      {card.type === 'trip' && (card.journeys || []).map((j, i) => {
        const tl = j.legs.filter((l) => l.kind === 'transit'); const f = tl[0]; const s = f ? status(f) : null;
        return (
          <Row key={i} onPress={() => open(card.link || f?.link)} dim={cd(j.leave, now).past}>
            <View style={st.mid}>
              <Text style={[st.t1, { color: c.text, fontVariant: ['tabular-nums'] }]}>{clock(j.leave)} to {clock(j.arrive)}</Text>
              <View style={st.legs}>
                {tl.map((l, k) => <LineBadge key={k} small line={l.line} mode={l.mode} color={l.color} />)}
                <Text style={[st.t2, { color: c.text2 }]}>{j.durationMin} min {'\u00b7'} {j.changes ? `${j.changes} change${j.changes > 1 ? 's' : ''}` : 'Direct'}</Text>
              </View>
              {s ? <Text style={[st.t2, { color: (c as any)[s.tone], fontWeight: '600' }]}>{s.text}</Text> : null}
              {j.warn ? <Text style={[st.t2, { color: c.orange, fontWeight: '600' }]}>{j.warn}</Text> : null}
            </View>
            <Count t={j.leave} live={f?.realtime} />
          </Row>
        );
      })}
      {card.type === 'alerts' && (card.items || []).map((a: any, i: number) => (
        <Row key={i} onPress={() => { const u = safeUrl(a.url); if (u) Linking.openURL(u); }}>
          <Text style={{ color: c.orange, fontSize: 16 }}>{'\u26a0\ufe0e'}</Text>
          <View style={st.mid}><Text numberOfLines={3} style={[st.t3, { color: c.text }]}>{a.title}</Text></View>
        </Row>
      ))}
      {card.type === 'stops' && (card.items || []).map((s: any, i: number) => (
        <Row key={i} onPress={() => open(s.link)}>
          <View style={st.mid}><Text style={[st.t1, { color: c.text }]}>{s.name}</Text><Text style={[st.t2, { color: c.text2 }]}>{s.distance} m</Text></View>
        </Row>
      ))}
      {card.type === 'parking' && (card.items || []).map((p: CarPark, i: number) => {
        const b = parkBadge(p);
        return (
          <Row key={i} onPress={() => p.station && router.push({ pathname: '/stop/[id]', params: { id: p.station, name: '' } })}>
            <View style={st.mid}>
              <Text style={[st.t1, { color: c.text }]}>{p.name}</Text>
              <Text style={[st.t2, { color: b.tone === 'green' ? c.liveText : b.tone === 'orange' ? c.lateText : b.tone === 'red' ? c.redText : c.text2, fontWeight: '600' }]}>
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
            <Row onPress={() => router.push({ pathname: '/stop/[id]', params: { id: sx.id, name: sx.name } })}>
              <View style={st.mid}>
                <Text style={[st.t1, { color: c.text }]}>{sx.access?.label || ACC_LABEL[sx.access?.level || 'unknown']}</Text>
                <Text style={[st.t2, { color: c.text2 }]}>{accessKit(sx.access) || tk.title}</Text>
              </View>
            </Row>
            {(sx.outages || []).map((o, i) => (
              <Row key={i} onPress={() => { const u = safeUrl(o.url); if (u) Linking.openURL(u); }}>
                <View style={st.mid}>
                  <Text style={[st.t1, { color: c.redText }]}>{o.kind === 'escalator' ? 'Escalator' : 'Lift'} out of service</Text>
                  <Text numberOfLines={3} style={[st.t2, { color: c.text2 }]}>{outageText(o.title, sx.name)}</Text>
                </View>
              </Row>
            ))}
            <Row onPress={() => router.push({ pathname: '/stop/[id]', params: { id: sx.id, name: sx.name } })}>
              <View style={st.mid}><Text style={[st.t1, { color: c.text }]}>{tk.title}</Text><Text style={[st.t2, { color: c.text2 }]}>{tk.sub}</Text></View>
            </Row>
          </>
        );
      })() : null}
    </View>
  );
  const Chip = ({ label, onPress }: { label: string; onPress: () => void }) => (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [st.chip, { backgroundColor: pressed ? c.fill : c.card, borderColor: c.sep }]}>
      <Text style={{ color: c.tint, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );

  const renderItem = ({ item, index }: { item: Msg; index: number }) => item.role === 'me' ? (
    <View style={[st.bubble, st.me, { backgroundColor: c.tint }]}><Text style={st.meText}>{item.text}</Text></View>
  ) : (
    <View style={{ alignItems: 'flex-start', marginTop: 6 }}>
      {(() => { const sum = tripSummary(item, now); return sum ? <TripAnswer s={sum} /> : <PlainAnswer text={item.text} />; })()}
      {(item.cards || []).map((card, i) => <CardView key={i} card={card} />)}
      {item.lastHome && canRemind(Date.parse(item.lastHome.leave || ''), now) ? <RemindLastButton hint={item.lastHome} known acc={store.accOn()} /> : null}
      {item.links && item.links.length ? <View style={st.chips}>{item.links.map((l, i) => <Chip key={i} label={l.label || 'Open'} onPress={() => open(l)} />)}</View> : null}
      {index === msgs.length - 1 && (item.ask === 'location' || (item.suggestions || []).length) ? (
        <View style={st.chips}>
          {item.ask === 'location' ? <Chip label="Use my location" onPress={askWithLocation} /> : null}
          {(item.suggestions || []).map((s) => <Chip key={s} label={s.replace(/ (Station|Light Rail|Wharf)\b/g, '')} onPress={() => ask(s)} />)}
        </View>
      ) : null}
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <FlatList
        ref={list}
        contentInsetAdjustmentBehavior="automatic"
        data={msgs}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 12, paddingBottom: 16 }}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 24 }}>
            <Text style={[st.helloTitle, { color: c.text }]}>Ask about any trip</Text>
            <Text style={[st.helloBody, { color: c.text2 }]}>Type a stop, a line or two places, like next train from one station to another.</Text>
            {starters.length ? <View style={{ alignSelf: 'stretch', alignItems: 'flex-end', gap: 8, marginTop: 18 }}>{starters.map((s) => <Chip key={s} label={s} onPress={() => ask(s)} />)}</View> : null}
          </View>
        }
        ListFooterComponent={busy ? <View style={[st.bubble, st.bot, { backgroundColor: c.dark ? '#26252A' : '#E9E9EB', marginTop: 6 }]}><ActivityIndicator size="small" /></View> : undefined}
      />
      <View style={[st.bar, { backgroundColor: c.card, borderTopColor: c.sep, paddingBottom: 8 + (Platform.OS === 'android' ? 0 : Math.max(0, insets.bottom - 34)) }]}>
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
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>{'\u2191'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
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
  chip: { height: 34, paddingHorizontal: 14, borderRadius: 17, justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  helloTitle: { fontSize: 20, fontWeight: '700' },
  helloBody: { fontSize: 15, marginTop: 6, textAlign: 'center', maxWidth: 300 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: 48, borderRadius: 18, paddingHorizontal: 14, fontSize: 17, borderWidth: StyleSheet.hairlineWidth },
  send: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});
