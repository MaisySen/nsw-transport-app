import { ReactNode, useMemo } from 'react';
import { View, ViewStyle } from 'react-native';
import { scrollLock } from '@/lib/gesture';

/**
 * A map inside a scrolling page. While a finger is on the map the page stops scrolling, so dragging the map
 * moves the map and dragging anywhere else scrolls the page. The page scrolls again when the finger lifts.
 */
export function MapCard({ children, onScrollChange, style, label }: { children: ReactNode; onScrollChange: (on: boolean) => void; style?: ViewStyle; label?: string }) {
  const lock = useMemo(() => scrollLock(onScrollChange), [onScrollChange]);
  return (
    <View style={style} accessibilityLabel={label}
      onTouchStart={() => lock.start()}
      onTouchMove={() => lock.move()}
      onTouchEnd={(e) => lock.end(e.nativeEvent.touches?.length || 0)}
      onTouchCancel={() => lock.cancel()}>
      {children}
    </View>
  );
}
