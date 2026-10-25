import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sidePadding, type Sides } from './layoutCore';

export { READABLE_WIDTH, sidePadding } from './layoutCore';

/** Left and right padding that keeps content clear of the side safe areas and at a readable width on wide windows.
 *  Follows the window as it resizes (useWindowDimensions), so an unfolded or resized window lays out again. */
export function useSides(readable?: number): Sides {
  const { width } = useWindowDimensions();
  const ins = useSafeAreaInsets();
  return useMemo(() => sidePadding(width, ins.left, ins.right, readable), [width, ins.left, ins.right, readable]);
}
