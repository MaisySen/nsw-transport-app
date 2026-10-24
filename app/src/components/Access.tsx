import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { haptic } from '@/lib/haptic';
import { api } from '@/lib/api';
import { radius, usePalette } from '@/lib/theme';
import { clock } from '@/lib/format';
import { enablePush, getPushState } from '@/lib/push';
import { ACC_COLOR, accChip, accessKit, outageText, parkBadge, parkFill, parkName, parkTotals, safeUrl, ticketText, usualLine, type CarPark, type LegAccess, type Station } from '@/lib/access';
import { Icon, I } from './Icon';
import { Sep, T } from './ui';

type Tone = 'green' | 'orange' | 'red' | 'grey';
function toneColor(c: ReturnType<typeof usePalette>, t: Tone) {
  return t === 'green' ? c.green : t === 'orange' ? c.orange : t === 'red' ? c.red : '#8E8E93';
}

export function Badge({ text, tone }: { text: string; tone: Tone }) {
  const c = usePalette();
  const col = toneColor(c, tone);
  return (
    <View style={[s.badge, { backgroundColor: col + (c.dark ? '33' : '22') }]}>
      <T kind="caption" style={{ color: tone === 'green' ? c.liveText : tone === 'orange' ? c.lateText : tone === 'red' ? c.redText : c.text2, fontWeight: '700' }}>{text}</T>
    </View>
  );
}

/** Square coloured icon at the start of a row. */
function Sym({ icon, bg }: { icon: any; bg: string }) {
  return <View style={s.sym}><View style={[s.symIn, { backgroundColor: bg }]}><Icon name={icon} size={17} color="#fff" /></View></View>;
}

async function watchCarPark(p: CarPark, done: () => void) {
  try {
    let ps = await getPushState();
    if (ps.status !== 'on' && ps.status !== 'local') ps = await enablePush(false);
    if (ps.status === 'denied') {
      Alert.alert('Notifications are off', 'Open Settings, find Transport, and allow notifications.', [{ text: 'Not now', style: 'cancel' }, { text: 'Open Settings', onPress: () => Linking.openSettings() }]);
      return;
    }
    if (ps.status !== 'on' && ps.status !== 'local') { Alert.alert('Turn on alerts first', 'Settings > Alerts.'); return; }
    const r = await api.parkingWatch(p.id);
    haptic.success();
    done();
    const name = r.watch?.name || p.name;
    const st = r.now?.status;
    Alert.alert('Alert set', (st === 'nearly' || st === 'full' ? `${name} is already ${st === 'full' ? 'full' : 'nearly full'}. I'll still tell you.` : `I'll tell you if ${name} gets nearly full in the next 3 hours.`) + (ps.status === 'local' ? ' Alerts need the app open.' : ''));
  } catch (e: any) {
    Alert.alert("Couldn't set the alert", e.message);
  }
}

export function ParkCell({ p, station, watch, onPress, dist }: { p: CarPark; station?: string | null; watch?: boolean; onPress?: () => void; dist?: string }) {
  const c = usePalette();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const b = parkBadge(p);
  const fill = parkFill(p);
  const usual = usualLine(p);
  const barCol = p.status === 'full' ? c.red : p.status === 'nearly' ? c.orange : c.green;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={!onPress} android_ripple={onPress ? { color: c.fill } : undefined} style={({ pressed }) => [s.row, pressed && Platform.OS === 'ios' && onPress ? { backgroundColor: c.fill } : null]}>
      <Sym icon={I.car} bg="#0A84FF" />
      <View style={{ flex: 1 }}>
        <T kind="body" numberOfLines={1}>{parkName(p, station)}</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
          <Badge text={b.text} tone={b.tone} />
          <T kind="foot" tone="text2" style={{ fontVariant: ['tabular-nums'] }}>
            {p.free == null ? `${p.spots} spaces` : `${p.free} of ${p.spots} free`}{p.updated ? ` \u00b7 ${clock(Date.parse(p.updated))}` : ''}
          </T>
        </View>
        <View style={[s.bar, { backgroundColor: c.fill }]}><View style={{ width: `${fill ?? 0}%`, height: '100%', backgroundColor: barCol, borderRadius: 2 }} /></View>
        {usual ? <T kind="foot" tone={p.usual?.state === 'learning' ? 'text3' : 'text2'} style={{ marginTop: 5 }}>{usual}</T> : null}
      </View>
      {watch ? (
        <Pressable hitSlop={6} accessibilityRole="button" accessibilityLabel={`Alert me when ${p.name} is nearly full`} disabled={busy || on}
          onPress={async () => { setBusy(true); await watchCarPark(p, () => setOn(true)); setBusy(false); }}
          android_ripple={{ color: c.fill, borderless: true, radius: 24 }} style={s.bell}>
          {busy ? <ActivityIndicator size="small" color={c.tint} /> : <Icon name={on ? I.bell : I.bellPlus} size={22} color={on ? c.orange : c.tint} />}
        </Pressable>
      ) : onPress ? <>{dist ? <T kind="foot" tone="text2" style={{ fontVariant: ['tabular-nums'] }}>{dist}</T> : null}<Icon name={I.chevron} size={14} color={c.text3} /></> : null}
    </Pressable>
  );
}

const PARK_SRC = 'Live spaces from the Transport for NSW Car Park API, live. Nearly full means 10 percent or fewer spaces left.';

/** "Park and Ride" group: one row per car park, with the bell when watch is on. */
export function ParkGroup({ list, title, station, watch }: { list?: CarPark[] | null; title: string; station?: string | null; watch?: boolean }) {
  const c = usePalette();
  if (!list || !list.length) return null;
  const tot = parkTotals(list);
  return (
    <View style={{ marginTop: 22, marginHorizontal: 16 }}>
      <View style={s.head}>
        <T kind={Platform.OS === 'ios' ? 'foot' : 'sub'} style={[{ flex: 1, color: Platform.OS === 'ios' ? c.text2 : c.tint, fontWeight: Platform.OS === 'ios' ? '400' : '600' }, Platform.OS === 'ios' ? { textTransform: 'uppercase' } : null]}>{title}</T>
        {tot ? <T kind="foot" tone="text2" style={{ fontVariant: ['tabular-nums'] }}>{tot.free} of {tot.spots} free</T> : null}
      </View>
      <View style={{ backgroundColor: c.card, borderRadius: radius, overflow: 'hidden' }}>
        {list.map((p, i) => (
          <View key={p.id}>
            {i ? <Sep inset={61} /> : null}
            <ParkCell p={p} station={station} watch={watch} />
          </View>
        ))}
      </View>
      <T kind="foot" tone="text2" style={s.src}>{PARK_SRC}{watch ? ' Tap the bell to get a notification if it gets nearly full in the next 3 hours.' : ''}</T>
    </View>
  );
}

/** Station screen: Park and Ride, then Access and facilities, then sources. */
export function StationInfo({ st }: { st?: Station | null }) {
  const c = usePalette();
  if (!st || !st.access) return null;
  const a = st.access;
  const kit = accessKit(a);
  const tk = ticketText(st.ticket);
  const outs = st.outages || [];
  return (
    <>
      <ParkGroup list={st.parking} title="Park and Ride" station={st.name} watch />
      <View style={{ marginTop: 22, marginHorizontal: 16 }}>
        <View style={s.head}>
          <T kind={Platform.OS === 'ios' ? 'foot' : 'sub'} style={[{ flex: 1, color: Platform.OS === 'ios' ? c.text2 : c.tint, fontWeight: Platform.OS === 'ios' ? '400' : '600' }, Platform.OS === 'ios' ? { textTransform: 'uppercase' } : null]}>Access and facilities</T>
        </View>
        <View style={{ backgroundColor: c.card, borderRadius: radius, overflow: 'hidden' }}>
          <View style={s.row}>
            <Sym icon={I.access} bg={ACC_COLOR[a.level] || ACC_COLOR.unknown} />
            <View style={{ flex: 1 }}><T kind="body">{a.label}</T>{kit || a.note ? <T kind="foot" tone="text2" style={{ marginTop: 2 }}>{kit || a.note}</T> : null}</View>
          </View>
          {outs.map((o, i) => {
            const u = safeUrl(o.url);
            return (
              <View key={i}>
                <Sep inset={61} />
                <Pressable accessibilityRole="link" disabled={!u} onPress={() => u && Linking.openURL(u)} android_ripple={{ color: c.fill }} style={s.row}>
                  <Sym icon={I.access} bg={c.red} />
                  <View style={{ flex: 1 }}>
                    <T kind="body" style={{ color: c.redText }}>{o.kind === 'escalator' ? 'Escalator' : 'Lift'} out of service</T>
                    <T kind="foot" tone="text2" style={{ marginTop: 2 }}>{outageText(o.title, st.name)}</T>
                  </View>
                  {u ? <Icon name={I.chevron} size={14} color={c.text3} /> : null}
                </Pressable>
              </View>
            );
          })}
          {!outs.length && a.lift ? (
            <><Sep inset={61} /><View style={s.row}><Sym icon={I.check} bg={c.green} /><View style={{ flex: 1 }}><T kind="body">Lifts working</T><T kind="foot" tone="text2" style={{ marginTop: 2 }}>No lift outages reported right now</T></View></View></>
          ) : null}
          <Sep inset={61} />
          <View style={s.row}><Sym icon={I.fare} bg={tk.color} /><View style={{ flex: 1 }}><T kind="body">{tk.title}</T><T kind="foot" tone="text2" style={{ marginTop: 2 }}>{tk.sub}</T></View></View>
          {st.shortPlatform ? (
            <><Sep inset={61} /><View style={s.row}><Sym icon={I.warn} bg={c.orange} /><View style={{ flex: 1 }}><T kind="body">Short platform</T><T kind="foot" tone="text2" style={{ marginTop: 2 }}>Some long trains stop with doors past the platform. Listen for which cars to use.</T></View></View></>
          ) : null}
        </View>
        {st.facilities?.length ? (
          <View style={s.chips}>
            {st.facilities.map((f) => <View key={f} style={[s.chip, { backgroundColor: c.card, borderColor: c.sep }]}><T kind="foot">{f}</T></View>)}
          </View>
        ) : null}
        <T kind="foot" tone="text2" style={s.src}>
          {st.peak?.morning ? `Peak here: ${st.peak.morning} and ${st.peak.afternoon || '3pm-7pm'} weekdays. ` : ''}Facilities from Transport for NSW open data (station facilities){st.read ? `, read ${st.read}` : ''}. Lift status from Transport for NSW service alerts, live.
        </T>
      </View>
    </>
  );
}

/** Two chips under a transit leg: "Central: Step free" or "Central: lift out", plus each outage. */
export function LegAccessChips({ access, from, to }: { access?: LegAccess | null; from?: string; to?: string }) {
  const c = usePalette();
  if (!access || !(access.from || access.to)) return null;
  const chips = [accChip(access.from, from), accChip(access.to, to)].filter(Boolean) as { text: string; tone: Tone }[];
  const outs = [access.from, access.to].filter((x) => x && x.outage).map((x) => x!.outage!);
  return (
    <View style={{ marginTop: 8 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {chips.map((ch, i) => (
          <View key={i} style={[s.accChip, { backgroundColor: toneColor(c, ch.tone) + (c.dark ? '33' : '1F') }]}>
            <Icon name={I.access} size={12} color={ch.tone === 'red' ? c.red : ch.tone === 'green' ? c.liveText : ch.tone === 'orange' ? c.lateText : c.text2} />
            <T kind="caption" style={{ color: ch.tone === 'red' ? c.redText : ch.tone === 'green' ? c.liveText : ch.tone === 'orange' ? c.lateText : c.text2, fontWeight: '600' }}>{ch.text}</T>
          </View>
        ))}
      </View>
      {outs.map((o, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
          <Icon name={I.warn} size={13} color={c.red} style={{ marginTop: 1 }} />
          <T kind="foot" style={{ color: c.redText, flex: 1 }}>{o}</T>
        </View>
      ))}
    </View>
  );
}

/** Red "Lift out: ..." line under a journey with an outage on its stations. */
export function OutageLine({ outages, inset = 82 }: { outages: string[]; inset?: number }) {
  const c = usePalette();
  if (!outages.length) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingLeft: inset, paddingRight: 16, paddingBottom: 10, marginTop: -4 }}>
      <Icon name={I.access} size={13} color={c.red} style={{ marginTop: 2 }} />
      <T kind="foot" numberOfLines={2} style={{ color: c.redText, flex: 1, fontWeight: '500' }}>Lift out: {outages[0]}{outages.length > 1 ? ` (+${outages.length - 1} more)` : ''}</T>
    </View>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 7 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 11, minHeight: 48, gap: 12 },
  sym: { width: 29, alignItems: 'center' },
  symIn: { width: 29, height: 29, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  bar: { height: 4, borderRadius: 2, marginTop: 7, overflow: 'hidden' },
  bell: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', marginRight: -8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10, paddingHorizontal: 4 },
  chip: { borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, borderWidth: StyleSheet.hairlineWidth },
  accChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  src: { marginTop: 7, marginHorizontal: 16 },
});
