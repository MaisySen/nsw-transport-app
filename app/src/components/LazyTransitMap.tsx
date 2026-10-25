// The map, loaded only when a screen draws it: the map module (Apple Maps or MapLibre) is not evaluated at app start
// or when the screen opens, but just after the screen's first frame. Until then a plain surface in the map's colour.
import { lazy, Suspense } from 'react';
import { View } from 'react-native';
import type { TransitMapProps } from './TransitMap.types';

const Map = lazy(() => import('./TransitMap'));

export default function LazyTransitMap(p: TransitMapProps) {
  return (
    <Suspense fallback={<View style={[{ flex: 1, backgroundColor: p.dark ? '#1c1c1e' : '#f2f2f7' }, p.style]} accessibilityLabel="Map loading" />}>
      <Map {...p} />
    </Suspense>
  );
}
