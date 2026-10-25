// More > Voice: the voice trip guidance and Speak departures use. Automatic picks the best voice installed on the
// phone (Premium, then Enhanced, then Default; en-AU first). Nothing is downloaded and nothing leaves the phone.
import { useEffect, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Stack } from 'expo-router';
import { api } from '@/lib/api';
import { haptic } from '@/lib/haptic';
import { englishVoices, speak, stopSpeaking } from '@/lib/nativeExtras';
import { store, useStore } from '@/lib/store';
import { usePalette } from '@/lib/theme';
import { onlyCompact, sampleSentence, voiceLabel, type RankedVoice } from '@/lib/voiceCore';
import { Icon, I } from '@/components/Icon';
import { Button, Screen, Section, Sep, T } from '@/components/ui';

function Pick({ title, sub, on, onPress }: { title: string; sub?: string; on: boolean; onPress: () => void }) {
  const c = usePalette();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={sub ? `${title}, ${sub}` : title} accessibilityState={{ selected: on }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 11, minHeight: 48, backgroundColor: pressed && Platform.OS === 'ios' ? c.fill : 'transparent' })}>
      <View style={{ flex: 1 }}>
        <T kind="body">{title}</T>
        {sub ? <T kind="foot" tone="text2" style={{ marginTop: 2 }}>{sub}</T> : null}
      </View>
      {on ? <Icon name={I.check} size={16} color={c.tint} /> : null}
    </Pressable>
  );
}

export default function VoiceScreen() {
  const st = useStore();
  const [list, setList] = useState<RankedVoice[] | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => { englishVoices().then(setList).catch(() => setList([])); }, []);
  const chosen = st.voiceId && list?.some((v) => v.identifier === st.voiceId) ? st.voiceId : null;
  const best = list?.[0] || null;
  const shown = all ? list || [] : (list || []).slice(0, 8);

  // The sample is the next service from your home stop (or a starred stop), as the board has it now.
  const sample = async () => {
    haptic.select();
    stopSpeaking();
    const stop = st.places?.home || st.starred?.[0] || null;
    let text = '';
    if (stop) {
      try { const r = await api.departures(stop.id); text = sampleSentence(r.items, Date.now(), r.stop?.name || stop.name); } catch {}
    }
    speak(text || sampleSentence(null, Date.now(), stop?.name), { interrupt: true });
  };
  const choose = (id: string | null) => { haptic.select(); store.setVoiceId(id); };

  const tip = list && onlyCompact(list)
    ? Platform.OS === 'ios'
      ? 'For a more natural voice, download an Enhanced or Premium voice in iPhone Settings > Accessibility > Spoken Content > Voices.'
      : 'For a more natural voice, download a voice in your phone Settings > Text to speech.'
    : undefined;

  return (
    <>
      <Stack.Screen options={{ title: 'Voice' }} />
      <Screen>
        <T kind="sub" tone="text2" style={{ marginHorizontal: 20, marginTop: 8 }}>
          Trip guidance and Speak departures use this voice. It is one of the voices already on your phone.
        </T>
        <View style={{ marginHorizontal: 16, marginTop: 14 }}>
          <Button title="Play sample" icon={I.speaker} kind="tinted" onPress={sample} />
        </View>
        <Section title="Voice" footer={tip}>
          <Pick title="Automatic" sub={best ? `Best on this phone: ${voiceLabel(best)}` : list ? 'The phone\'s own voice' : 'Finding voices'} on={!chosen} onPress={() => choose(null)} />
          {shown.map((v) => (
            <View key={v.identifier}>
              <Sep />
              <Pick title={v.name} sub={voiceLabel(v).split(', ').slice(1).join(', ')} on={chosen === v.identifier} onPress={() => choose(v.identifier)} />
            </View>
          ))}
          {list && list.length > 8 && !all ? (
            <>
              <Sep />
              <Pick title={`Show all ${list.length} voices`} on={false} onPress={() => setAll(true)} />
            </>
          ) : null}
        </Section>
      </Screen>
    </>
  );
}
