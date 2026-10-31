import { useMemo, useRef } from 'react';
import { Animated, PanResponder, StyleSheet, View } from 'react-native';
import { usePalette } from '@/lib/theme';
import { reduceMotionNow } from '@/lib/motion';

/**
 * The iPhone look for the editors that stay sheets (the time picker, a reminder): attached to the bottom edge with
 * the system's grabber, and a drag down past the threshold closes them, as a native sheet does. Menus are not
 * sheets any more (components/HoldMenu.tsx, components/RowMenu.ios.tsx).
 */
export const SHEET_RADIUS = 16;
/** How far a drag down closes the sheet, in points. */
export const SHEET_CLOSE_AT = 90;

export function useSheetDrag(onClose: () => void) {
  const y = useRef(new Animated.Value(0)).current;
  // A drag that does not close the sheet springs back; under Reduce Motion it goes straight back.
  const back = () => { if (reduceMotionNow()) y.setValue(0); else Animated.spring(y, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start(); };
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_, g) => { y.setValue(Math.max(0, g.dy)); },
    onPanResponderRelease: (_, g) => {
      if (g.dy > SHEET_CLOSE_AT || g.vy > 1.2) { onClose(); y.setValue(0); return; }
      back();
    },
    onPanResponderTerminate: back,
  }), [onClose, y]);
  return { style: { transform: [{ translateY: y }] }, handlers: pan.panHandlers };
}

/** The grabber at the top of the sheet. VoiceOver: an action closes it, so the drag is never the only way. */
export function SheetGrabber({ onClose }: { onClose: () => void }) {
  const c = usePalette();
  return (
    <View accessible accessibilityLabel="Sheet grabber" accessibilityHint="Closes the sheet" accessibilityActions={[{ name: 'activate', label: 'Close' }]}
      onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'activate') onClose(); }} style={g.hit}>
      <View style={[g.bar, { backgroundColor: c.text3 }]} />
    </View>
  );
}

const g = StyleSheet.create({
  hit: { alignItems: 'center', paddingTop: 5, paddingBottom: 3 },
  bar: { width: 36, height: 5, borderRadius: 2.5 },
});
