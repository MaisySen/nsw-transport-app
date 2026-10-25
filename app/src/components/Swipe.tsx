import { useRef } from 'react';
import { StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
// Buttons revealed by a swipe use the gesture handler's Pressable: on Android a React Native Pressable there
// can lose its press to the swipe gesture.
import { Pressable as GHPressable } from 'react-native-gesture-handler';
import Reanimated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { haptic } from '@/lib/haptic';
import { radius } from '@/lib/theme';
import { Icon, type IconName } from './Icon';

/** The action a left swipe shows: Delete on a saved trip, Watch on a departure. */
export type SwipeAct = { label: string; text: string; icon: IconName; color: string; onPress: () => void };

/** The row that is open now. Opening another row closes it, so only one action shows at a time. */
let openRow: SwipeableMethods | null = null;

/** Card rows on Home: the swipe area has the card's own margins and corners, so the action sits exactly behind the
 *  card and is clipped to it. The card inside drops its margins (see Card's flush prop). */
export const CARD_SWIPE: ViewStyle = { marginHorizontal: 16, marginTop: 10, borderRadius: radius, overflow: 'hidden' };

/** VoiceOver and TalkBack: the same action as a custom action on the row, for people who cannot swipe. */
export function swipeA11y(act?: SwipeAct | null) {
  if (!act) return {};
  return {
    accessibilityActions: [{ name: 'swipeAction', label: act.label }],
    onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => { if (e.nativeEvent.actionName === 'swipeAction') act.onPress(); },
  };
}

function Action({ act, progress, close }: { act: SwipeAct; progress: SharedValue<number>; close: () => void }) {
  // At rest the action is not drawn at all, so nothing can peek out from behind the row (a rounding gap, the iOS
  // rubber band or a row narrower than its swipe area). It shows as soon as the row starts to move.
  const shown = useAnimatedStyle(() => ({ opacity: progress.value > 0.001 ? 1 : 0 }));
  return (
    <Reanimated.View style={[s.act, shown]}>
      <GHPressable onPress={() => { close(); act.onPress(); }} accessibilityRole="button" accessibilityLabel={act.label}
        style={[s.btn, { backgroundColor: act.color }]}>
        <Icon name={act.icon} size={20} color="#fff" />
        <Text maxFontSizeMultiplier={1.3} style={s.text}>{act.text}</Text>
      </GHPressable>
    </Reanimated.View>
  );
}

/** Swipe left to show one action. The action is hidden until the row moves, and it never reaches past the row. */
export function SwipeRow({ act, children, style }: { act: SwipeAct; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const sw = useRef<SwipeableMethods | null>(null);
  return (
    <ReanimatedSwipeable ref={sw} friction={2} rightThreshold={40} overshootRight={false}
      containerStyle={style}
      onSwipeableWillOpen={() => {
        if (openRow && openRow !== sw.current) openRow.close();
        openRow = sw.current;
        haptic.select();
      }}
      onSwipeableClose={() => { if (openRow === sw.current) openRow = null; }}
      renderRightActions={(progress) => <Action act={act} progress={progress} close={() => sw.current?.close()} />}>
      {children}
    </ReanimatedSwipeable>
  );
}

const s = StyleSheet.create({
  act: { width: 88 },
  btn: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  text: { color: '#fff', fontSize: 12, fontWeight: '600', marginTop: 3 },
});
