// The Ask reply bubble. A trip answer shows as a short card (time, lines, platform, arrival, status,
// one line per warning, fare); anything else shows as short paragraphs in a chat bubble.
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { androidLook, usePalette } from '@/lib/theme';
import { haptic } from '@/lib/haptic';
import { Icon, I } from '@/components/Icon';
import { LineBadge } from '@/components/Transit';
import { splitPlain, type TripSummary } from '@/lib/askFormat';

const md = androidLook || Platform.OS === 'android';

/** Tinted background for a status colour (hex), so the chip reads like the status text in the rows below. */
function tintBg(hex: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(hex) ? hex + '1F' : fallback;
}

export function PlainAnswer({ text }: { text: string }) {
  const c = usePalette();
  const paras = splitPlain(text);
  return (
    <View accessible accessibilityLabel={paras.join(' ')} style={[st.bubble, { backgroundColor: c.dark ? '#26252A' : '#E9E9EB' }]}>
      {paras.map((p, i) => <Text key={i} style={[st.botText, { color: c.text }, i > 0 && st.para]}>{p}</Text>)}
    </View>
  );
}

export function TripAnswer({ s }: { s: TripSummary }) {
  const c = usePalette();
  const [open, setOpen] = useState(false);
  const toggle = () => { haptic.select(); setOpen((o) => !o); };
  const tone = (c as any)[s.status.tone] as string;
  const hasWarn = !!s.liftShort;
  const label = s.spoken + (open && s.outages.length ? ' ' + s.outages.map((o) => o.replace(/\.?$/, '.')).join(' ') : '');
  return (
    <View
      accessible
      accessibilityLabel={label}
      accessibilityRole={hasWarn ? 'button' : 'summary'}
      accessibilityState={hasWarn ? { expanded: open } : undefined}
      accessibilityHint={hasWarn ? (open ? 'Hides the lift details' : 'Shows the full lift details') : undefined}
      accessibilityActions={hasWarn ? [{ name: 'activate' }] : undefined}
      onAccessibilityAction={hasWarn ? (e) => { if (e.nativeEvent.actionName === 'activate') toggle(); } : undefined}
      style={[st.card, md ? st.cardMd : st.cardIos, { backgroundColor: c.card, borderColor: c.sep, opacity: s.past ? 0.6 : 1 }]}
    >
      <View style={st.top}>
        <View style={st.timeRow}>
          <Text maxFontSizeMultiplier={1.6} style={[st.time, { color: c.text }]}>{s.time}</Text>
          <Text maxFontSizeMultiplier={1.8} style={[st.when, { color: s.live ? c.liveText : c.text2 }]}>{s.when}</Text>
        </View>
        <View style={st.chipRow}>
          {s.lines.map((l, i) => <LineBadge key={i} line={l.line} mode={l.mode} color={l.color} />)}
          {s.platform ? <Text style={[st.plat, { color: c.text }]}>{s.platform}</Text> : null}
          <View style={[st.status, { backgroundColor: tintBg(tone, c.fill) }]}>
            <Text maxFontSizeMultiplier={1.8} style={[st.statusText, { color: tone }]}>{s.status.text}</Text>
          </View>
        </View>
        <Text style={[st.arrive, { color: c.text }]}>{s.arrive}</Text>
        {s.leaveAt ? <Text style={[st.small, { color: c.text2 }]}>Leave {s.leaveAt} to walk to the stop</Text> : null}
      </View>
      {hasWarn ? (
        <Pressable accessibilityRole="button"
          accessible={false}
          focusable={false}
          importantForAccessibility="no"
          onPress={toggle}
          style={({ pressed }) => [st.warn, { borderTopColor: c.sep, backgroundColor: pressed ? c.fill : 'transparent' }]}
        >
          <View style={st.warnHead}>
            <Icon name={I.warn} size={17} color={c.orange} />
            <Text style={[st.warnText, { color: c.text }]}>{s.liftShort}</Text>
            <Icon name={open ? I.up : I.down} size={16} color={c.text2} />
          </View>
          {open ? s.outages.map((o, i) => <Text key={i} style={[st.warnFull, { color: c.text2 }]}>{o.replace(/\.?$/, '.')}</Text>) : null}
        </Pressable>
      ) : null}
      {s.fare || s.extras.length ? (
        <View style={[st.foot, { borderTopColor: c.sep }]}>
          {s.fare ? <Text style={[st.small, { color: c.text2 }]}>{s.fare}</Text> : null}
          {s.extras.map((x, i) => <Text key={i} style={[st.small, { color: c.text2 }]}>{x}</Text>)}
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  bubble: { alignSelf: 'flex-start', maxWidth: '85%', paddingHorizontal: 13, paddingVertical: 8, borderRadius: 19, borderBottomLeftRadius: 6 },
  botText: { fontSize: 17, lineHeight: 22 },
  para: { marginTop: 8 },
  card: { alignSelf: 'stretch', maxWidth: 380, overflow: 'hidden' },
  cardIos: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  cardMd: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  top: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, gap: 6 },
  timeRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 10 },
  time: { fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'], letterSpacing: -0.3 },
  when: { fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
  chipRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  plat: { fontSize: 15, fontWeight: '600', marginLeft: 2, marginRight: 2 },
  status: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  statusText: { fontSize: 13, fontWeight: '700' },
  arrive: { fontSize: 16 },
  small: { fontSize: 13, lineHeight: 18 },
  warn: { paddingHorizontal: 14, paddingVertical: 11, minHeight: 48, justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth },
  warnHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  warnText: { flex: 1, fontSize: 15, fontWeight: '500' },
  warnFull: { fontSize: 14, lineHeight: 19, marginTop: 6, marginLeft: 25 },
  foot: { paddingHorizontal: 14, paddingVertical: 10, gap: 2, borderTopWidth: StyleSheet.hairlineWidth },
});
