// Speak departures: one button that reads the next two services out loud in the best installed voice
// (nativeExtras.speak). Shown only where the phone can speak. The words come from the live data on screen.
import { memo } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { haptic } from '@/lib/haptic';
import { hasSpeech, speak } from '@/lib/nativeExtras';
import { usePalette } from '@/lib/theme';
import { Icon, I } from './Icon';
import { T } from './ui';

const canSpeak = (() => { let v: boolean | null = null; return () => (v ??= hasSpeech()); })();

/** `say` builds the sentence at tap time, so it is always from the newest data. */
function SpeakButtonView({ say, look = 'row', color, bg, border }: { say: () => string; look?: 'row' | 'round'; color?: string; bg?: string; border?: string }) {
  const c = usePalette();
  if (!canSpeak()) return null;
  const go = () => { haptic.select(); const text = say(); if (text) speak(text, { interrupt: true }); };
  if (look === 'round') {
    return (
      <Pressable onPress={go} hitSlop={10} accessibilityRole="button" accessibilityLabel="Speak departures" accessibilityHint="Reads the next two services out loud"
        style={({ pressed }) => ({ width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', borderWidth: 0.5, borderColor: border || c.sep, backgroundColor: bg || c.fill, opacity: pressed ? 0.6 : 1 })}>
        <Icon name={I.speaker} size={19} color={color || c.text} />
      </Pressable>
    );
  }
  return (
    <Pressable onPress={go} accessibilityRole="button" accessibilityLabel="Speak departures" accessibilityHint="Reads the next two services out loud"
      android_ripple={{ color: c.fill }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 16, borderTopWidth: 0.5, borderTopColor: c.sep, backgroundColor: pressed && Platform.OS !== 'android' ? c.fill : 'transparent' })}>
      <View style={{ width: 22, alignItems: 'center' }}><Icon name={I.speaker} size={15} color={c.tint} /></View>
      <T kind="sub" tone="tint" style={{ marginLeft: 6, fontWeight: '600' }}>Speak departures</T>
    </Pressable>
  );
}
export const SpeakButton = memo(SpeakButtonView);
