// First launch: two questions, home and work. Each is a station or stop search and can be skipped. Kept on this
// phone only, and changed or cleared any time from More > Home and work. Home then shows your commute at once.
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { haptic } from '@/lib/haptic';
import { MODE_BY_CODE, shortName } from '@/lib/format';
import { store, useStore } from '@/lib/store';
import { useStopSearch } from '@/lib/stopSearch';
import { radius, usePalette } from '@/lib/theme';
import type { Place, SearchItem } from '@/lib/types';
import { Icon, I, modeIconName } from '@/components/Icon';
import { Row, Screen, Section, Sep, T, font } from '@/components/ui';

type Step = 'home' | 'work';

export default function Welcome() {
  const c = usePalette();
  const st = useStore();
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const editing = edit === '1';
  const [step, setStep] = useState<Step>('home');
  const [q, setQ] = useState('');
  const input = useRef<any>(null);
  const { items, loading } = useStopSearch(q);
  const cur = (st.places || {})[step];

  // Leaving this screen any way at all (Skip, Done, back) counts as answered, so it is asked once.
  useEffect(() => () => { store.setOnboarded(true); }, []);
  useEffect(() => { setQ(''); const t = setTimeout(() => input.current?.focus(), 350); return () => clearTimeout(t); }, [step]);

  const finish = () => {
    store.setOnboarded(true);
    Keyboard.dismiss();
    if (router.canGoBack()) router.back(); else router.replace('/home');
  };
  const next = () => { if (step === 'home') setStep('work'); else finish(); };
  const pick = (p: Place) => {
    store.setPlace(step, { id: p.id, name: p.name });
    haptic.select();
    next();
  };

  const recents = (st.recents || []).filter((r) => r.id !== cur?.id).slice(0, 4);
  const list: SearchItem[] = q.trim().length >= 2 ? items : [];
  const row = (it: SearchItem | Place, i: number) => (
    <View key={it.id + ':' + i}>
      {i ? <Sep inset={57} /> : null}
      <Row icon={modeIconName(MODE_BY_CODE[(it as SearchItem).modes?.[0] || 0] || 'train')} iconBg={c.tint} title={shortName(it.name)} onPress={() => pick(it)} chevron={false} />
    </View>
  );
  const title = step === 'home' ? "Where's home?" : "Where's work?";
  const body = step === 'home'
    ? 'Pick the station or stop you leave from. Your commute shows on Home with live times and when to leave.'
    : 'Pick the station or stop near work, school or wherever you go most days.';

  return (
    <>
      <Stack.Screen options={{ title: editing ? 'Home and work' : 'Set up', headerBackVisible: editing }} />
      <Screen>
        <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
          <T kind="foot" tone="text2">{step === 'home' ? '1' : '2'} of 2</T>
          <T kind="title2" accessibilityRole="header" style={{ marginTop: 4 }}>{title}</T>
          <T kind="sub" tone="text2" style={{ marginTop: 6 }}>{body}</T>
        </View>

        {cur ? (
          <Section title={step === 'home' ? 'Home now' : 'Work now'}>
            <Row icon={step === 'home' ? I.home : I.briefcase} iconBg={c.indigo} title={shortName(cur.name)} chevron={false}
              right={
                <Pressable onPress={() => { store.setPlace(step, null); haptic.select(); }} accessibilityRole="button" accessibilityLabel={`Clear ${step}`}
                  style={{ minHeight: 48, minWidth: 64, alignItems: 'center', justifyContent: 'center' }}>
                  <T kind="sub" tone="tint" style={{ fontWeight: '600' }}>Clear</T>
                </Pressable>
              } />
          </Section>
        ) : null}

        <View style={[s.field, { backgroundColor: c.card }]}>
          <Icon name={I.search} size={17} color={c.text2} />
          <TextInput ref={input} value={q} onChangeText={setQ} placeholder={step === 'home' ? 'Search for your home station' : 'Search for your work station'}
            placeholderTextColor={c.text2} autoCorrect={false} returnKeyType="search" accessibilityLabel={step === 'home' ? 'Home station' : 'Work station'}
            style={[font.body, s.input, noOutline, { color: c.text }]} />
          {q ? (
            <Pressable onPress={() => setQ('')} accessibilityRole="button" accessibilityLabel="Clear search" style={s.clear}>
              <Icon name={I.close} size={16} color={c.text2} />
            </Pressable>
          ) : null}
        </View>

        {list.length ? <Section>{list.slice(0, 8).map(row)}</Section> : null}
        {q.trim().length >= 2 && !loading && !list.length ? <T kind="sub" tone="text2" style={{ marginHorizontal: 32, marginTop: 16 }}>No stops match that</T> : null}
        {q.trim().length < 2 && recents.length ? <Section title="Recent">{recents.map(row)}</Section> : null}

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 16, marginTop: 24 }}>
          {step === 'work' ? (
            <Pressable onPress={() => setStep('home')} accessibilityRole="button" style={s.text}><T kind="headline" tone="tint">Back</T></Pressable>
          ) : <View />}
          <Pressable onPress={next} accessibilityRole="button" accessibilityLabel={cur ? (step === 'home' ? 'Next' : 'Done') : step === 'home' ? 'Skip home' : 'Skip work'} style={s.text}>
            <T kind="headline" tone="tint">{cur ? (step === 'home' ? 'Next' : 'Done') : 'Skip'}</T>
          </Pressable>
        </View>
        <T kind="foot" tone="text2" style={{ marginHorizontal: 20, marginTop: 12 }}>Kept on this phone only. Change or clear it any time in More, Home and work.</T>
      </Screen>
    </>
  );
}

const noOutline: any = Platform.OS === 'web' ? { outlineWidth: 0, outlineStyle: 'none' } : null;
const s = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 20, paddingLeft: 14, borderRadius: radius, minHeight: 52 },
  input: { flex: 1, marginLeft: 10, paddingVertical: Platform.OS === 'android' ? 12 : 14 },
  clear: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  text: { minHeight: 48, minWidth: 64, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
});
