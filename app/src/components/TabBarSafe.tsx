import type { ReactNode } from 'react';
import { Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-screens/experimental';

/**
 * Keeps its content above the tab bar inside a tab screen.
 *
 * On iPhone (iOS 26 and 27 Liquid Glass, and the translucent bar before it) a tab screen is laid out under the tab
 * bar: the first scroll view gets an automatic content inset, but anything pinned to the bottom (the Ask field, the
 * Home undo bar) sits behind the bar. This view pads its bottom by the screen's own safe area inset, which UIKit
 * sets to the tab bar's height (plus the home indicator) and updates when the bar changes. It reads the native
 * screen's safe area (react-native-screens 4.30 SafeAreaView, compiled into the builds on runtime 1.0.0 and already
 * used by expo-router on Android), so no height is guessed.
 * Android already wraps tab content in the same view with the bottom inset (expo-router native tabs), so it is a
 * plain view there, and on the web.
 */
export function TabBarSafe({ children, style, overlay }: { children: ReactNode; style?: StyleProp<ViewStyle>; overlay?: boolean }) {
  const pe = overlay ? 'box-none' : undefined;
  if (Platform.OS === 'ios') {
    return <SafeAreaView edges={{ bottom: true }} pointerEvents={pe} style={style}>{children}</SafeAreaView>;
  }
  return <View pointerEvents={pe} style={[{ flex: 1 }, style]}>{children}</View>;
}
