// Status of my lines: compact on Home (one chip per line, problems first), a list in More.
// Lines come from the trips on Home; a line with an issue opens Transport for NSW's page for it.
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { usePalette, radius } from '@/lib/theme';
import { useTripLines } from '@/lib/myLines';
import { useLineStatus } from '@/lib/lineStatus';
import { lineRows, myLines, summaryText, type LineRow } from '@/lib/lineStatusCore';
import { safeUrl } from '@/lib/access';
import { useNow } from '@/lib/hooks';
import { LineBadge } from './Transit';
import { Icon, I } from './Icon';
import { Section, Sep, T } from './ui';

export function useLineRows(now: number, max: number): LineRow[] {
  const mine = myLines(useTripLines(), max);
  const resp = useLineStatus(mine.map((m) => m.line), now);
  return lineRows(resp, mine);
}
function tone(c: ReturnType<typeof usePalette>, r: LineRow) {
  return r.status === 'suspended' ? c.redText : r.status === 'delays' ? c.lateText : r.status === 'trackwork' ? c.lateText : c.liveText;
}
const open = (r: LineRow) => { const u = safeUrl(r.url); if (u) Linking.openURL(u).catch(() => {}); };

/** Home: a row of chips, "T1 Good service", with a one line summary. */
export function LineStatusStrip({ now }: { now: number }) {
  const c = usePalette();
  const rows = useLineRows(now, 8);
  if (!rows.length) return null;
  return (
    <View style={{ marginHorizontal: 16, marginTop: 12 }}>
      <T kind="foot" tone="text2" style={{ marginLeft: 4, marginBottom: 6 }} accessibilityRole="header">{summaryText(rows)}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {rows.map((r) => {
          const tap = r.status !== 'good' && !!safeUrl(r.url);
          return (
            <Pressable key={r.line} disabled={!tap} onPress={() => open(r)} accessibilityRole={tap ? 'link' : 'text'}
              accessibilityLabel={`${r.line}: ${r.label}${r.title ? '. ' + r.title : ''}`} android_ripple={tap ? { color: c.fill } : undefined}
              style={({ pressed }) => [st.chip, { backgroundColor: c.card, borderRadius: Platform.OS === 'android' ? 8 : radius, opacity: pressed && Platform.OS !== 'android' ? 0.6 : 1 }]}>
              <LineBadge line={r.line} mode={r.mode} color={r.color} />
              <T kind="foot" style={{ marginLeft: 6, color: tone(c, r), fontWeight: r.status === 'good' ? '400' : '600' }}>{r.label}</T>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** More: one row per line with what is wrong, when something is. */
export function LineStatusSection() {
  const c = usePalette();
  const now = useNow(30000);
  const rows = useLineRows(now, 12);
  if (!rows.length) return null;
  return (
    <Section title="Status of my lines" footer="The lines on your Home trips. From Transport for NSW service alerts.">
      {rows.map((r, i) => {
        const tap = r.status !== 'good' && !!safeUrl(r.url);
        return (
          <View key={r.line}>
            {i ? <Sep inset={16} /> : null}
            <Pressable disabled={!tap} onPress={() => open(r)} accessibilityRole={tap ? 'link' : 'text'} accessibilityLabel={`${r.line}: ${r.label}${r.title ? '. ' + r.title : ''}`}
              android_ripple={tap ? { color: c.fill } : undefined} style={({ pressed }) => [st.row, { opacity: pressed && Platform.OS !== 'android' ? 0.6 : 1 }]}>
              <LineBadge line={r.line} mode={r.mode} color={r.color} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <T kind="body" style={{ color: tone(c, r), fontWeight: r.status === 'good' ? '400' : '600' }}>{r.label}</T>
                {r.title ? <T kind="sub" tone="text2" style={{ marginTop: 2 }} numberOfLines={3}>{r.title}{r.more ? ` (+${r.more} more)` : ''}</T> : null}
              </View>
              {tap ? <Icon name={I.chevron} size={13} color={c.text3} style={{ marginLeft: 8 }} /> : null}
            </Pressable>
          </View>
        );
      })}
    </Section>
  );
}

const st = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6, minHeight: 36 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 11, minHeight: 48 },
});
