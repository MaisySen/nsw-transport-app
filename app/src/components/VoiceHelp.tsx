// Get a better voice: a small sheet that takes the person to the phone's own voice download.
// iPhone: three numbered steps and Open Settings (Apple allows no link straight to its voice list, so no private
// settings URL is ever used). Android: one button that opens text to speech output directly, Material 3 dialog.
// Back from Settings, the voices are read again; a new Premium or Enhanced voice plays a sample from live data.
import { useState } from 'react';
import { Animated, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haptic } from '@/lib/haptic';
import { useSides } from '@/lib/layout';
import { useStore } from '@/lib/store';
import { usePalette } from '@/lib/theme';
import { voiceLabel } from '@/lib/voiceCore';
import { iosVoiceSteps, type HelpStep } from '@/lib/voiceHelpCore';
import { openVoiceDownload, openVoiceSettings, playFound, useVoiceReturn } from '@/lib/voiceHelp';
import { SHEET_RADIUS, SheetGrabber, useSheetDrag } from './EditorSheet';
import { Icon, I } from './Icon';
import { Button, T } from './ui';
import { useReduceMotion } from '@/lib/motion';

type Stop = { id: string; name: string } | null | undefined;
const STEP_ICON: Record<HelpStep['icon'], typeof I.gear> = { gear: I.gear, list: I.list, download: I.download };

/**
 * `start`: 'prompt' is the one time question on a Speak button; 'steps' opens straight to the how to.
 * `os` is for the web stand in (it shows the iPhone sheet).
 */
export function VoiceHelp({ visible, onClose, start = 'steps', stop, os = Platform.OS }: { visible: boolean; onClose: () => void; start?: 'prompt' | 'steps'; stop?: Stop; os?: string }) {
  const c = usePalette();
  // Reduce Motion: the sheet fades in instead of sliding up.
  const still = useReduceMotion();
  const ins = useSafeAreaInsets();
  const side = useSides();
  const drag = useSheetDrag(onClose);
  const [view, setView] = useState<'prompt' | 'steps'>(start);
  const st = useStore();
  // The sample is the next service from this stop: the one passed in, else your home stop or a starred stop.
  const from = stop ?? st.places?.home ?? st.starred?.[0] ?? null;
  const back = useVoiceReturn((v) => { haptic.success(); playFound(v, from).catch(() => {}); });
  const android = os === 'android';

  const close = () => { setView(start); onClose(); };
  const go = async (download = false) => {
    haptic.select();
    await back.arm();
    if (download) await openVoiceDownload(); else await openVoiceSettings();
  };

  const result = back.found ? (
    <View style={[s.found, { backgroundColor: c.fill }]} accessible accessibilityLiveRegion="polite" accessibilityLabel={`Better voice found. ${voiceLabel(back.found)}. It is used from now on.`}>
      <Icon name={I.sparkle} size={20} color={c.tint} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <T kind="headline">Better voice found</T>
        <T kind="foot" tone="text2" style={{ marginTop: 2 }}>{voiceLabel(back.found)}. It is used from now on.</T>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Play sample" hitSlop={8} onPress={() => { haptic.select(); if (back.found) playFound(back.found, from).catch(() => {}); }}
        style={({ pressed }) => [s.round, { backgroundColor: c.card, opacity: pressed ? 0.6 : 1 }]}>
        <Icon name={I.speaker} size={16} color={c.tint} />
      </Pressable>
    </View>
  ) : back.missed ? (
    <T kind="foot" tone="text2" style={{ marginTop: 14 }} accessibilityLiveRegion="polite">
      No new voice yet. A download can take a few minutes, and the app uses it as soon as it is ready.
    </T>
  ) : null;

  const intro = 'Your phone is using its basic voice, which sounds robotic. A clearer, more natural voice is a free download in your phone settings.';

  if (android) {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
        <View style={[s.wrap, { justifyContent: 'center' }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" style={[StyleSheet.absoluteFill, s.dim]} onPress={close} />
          <View style={[s.dialog, { backgroundColor: c.dark ? '#22262E' : '#F3F5FA' }]}>
            <Icon name={I.speaker} size={24} color={c.tint} style={{ alignSelf: 'center', marginTop: 24 }} />
            <T kind="title3" accessibilityRole="header" style={{ fontSize: 24, textAlign: 'center', marginTop: 16, marginHorizontal: 24 }}>Get a better voice</T>
            <View style={{ marginHorizontal: 24, marginTop: 16 }}>
              <T kind="sub" tone="text2">{view === 'prompt' ? intro : 'Opens your phone\'s text to speech settings. Tap the gear next to the speech engine, then Install voice data, and pick English.'}</T>
              {result}
            </View>
            <View style={s.actions}>
              <Pressable accessibilityRole="button" onPress={close} android_ripple={{ color: c.fill }} style={s.textBtn}>
                <T kind="sub" tone="tint" style={{ fontWeight: '600' }}>{back.found ? 'Done' : 'Not now'}</T>
              </Pressable>
              {!back.found ? (
                <Pressable accessibilityRole="button" onPress={() => go(false)} android_ripple={{ color: c.fill }} style={s.textBtn}>
                  <T kind="sub" tone="tint" style={{ fontWeight: '600' }}>Open voice settings</T>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  const steps = iosVoiceSteps(Platform.OS === 'ios' ? Platform.Version : null);
  return (
    <Modal visible={visible} transparent animationType={still ? 'fade' : 'slide'} onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
      <View style={s.wrap}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" style={[StyleSheet.absoluteFill, s.dim]} onPress={close} />
        <Animated.View style={[s.sheet, { marginLeft: side.left, marginRight: side.right, backgroundColor: c.card, paddingBottom: Math.max(ins.bottom, 16) }, drag.style]}>
          <View {...drag.handlers}>
            <SheetGrabber onClose={close} />
            <View style={s.bar}>
              <View style={{ minWidth: 60 }} />
              <T kind="headline" accessibilityRole="header">Get a better voice</T>
              <Pressable accessibilityRole="button" onPress={close} hitSlop={10} style={{ minWidth: 60, alignItems: 'flex-end' }}>
                <T kind="body" tone="tint" style={{ fontWeight: '600' }}>{view === 'prompt' && !back.found ? 'Not now' : 'Done'}</T>
              </Pressable>
            </View>
          </View>
          <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8 }}>
            {view === 'prompt' ? (
              <>
                <T kind="body" style={{ marginTop: 8 }}>{intro}</T>
                <T kind="sub" tone="text2" style={{ marginTop: 8 }}>It takes three steps and the app uses it straight away.</T>
                <View style={{ marginTop: 20 }}>
                  <Button title="Show me how" onPress={() => { haptic.select(); setView('steps'); }} />
                </View>
              </>
            ) : (
              <>
                <T kind="sub" tone="text2" style={{ marginTop: 4 }}>Apps can only use voices that are on your phone. Download a natural one once and the app uses it for every announcement.</T>
                {steps.map((st, i) => (
                  <View key={i} style={s.step} accessible accessibilityLabel={st.a11y}>
                    <View style={[s.num, { backgroundColor: c.tint }]}><T kind="headline" style={{ color: '#FFFFFF' }}>{i + 1}</T></View>
                    <View style={{ flex: 1, marginLeft: 14 }}>
                      <T kind="body">{st.text}</T>
                    </View>
                    <Icon name={STEP_ICON[st.icon]} size={22} color={c.text2} style={{ marginLeft: 10 }} />
                  </View>
                ))}
                <View style={{ marginTop: 20 }}>
                  <Button title="Open Settings" icon={I.gear} onPress={() => go(false)} />
                </View>
                <T kind="foot" tone="text2" style={{ marginTop: 10 }}>
                  This opens the app's page in Settings. Go back to the main Settings list from there. Voices are large, so Wi-Fi is best.
                </T>
              </>
            )}
            {result}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end' },
  dim: { backgroundColor: 'rgba(0,0,0,0.32)' },
  sheet: { borderTopLeftRadius: SHEET_RADIUS, borderTopRightRadius: SHEET_RADIUS },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, minHeight: 52 },
  step: { flexDirection: 'row', alignItems: 'center', marginTop: 18, minHeight: 44 },
  num: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  found: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: 14, marginTop: 18 },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  dialog: { marginHorizontal: 24, borderRadius: 28, paddingBottom: 8, overflow: 'hidden' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', paddingHorizontal: 12, paddingTop: 16 },
  textBtn: { minHeight: 48, minWidth: 64, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
});
