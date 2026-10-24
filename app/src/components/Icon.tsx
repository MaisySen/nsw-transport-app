import { SymbolView } from 'expo-symbols';
import type { ColorValue, StyleProp, ViewStyle } from 'react-native';

export type IconName = { ios: string; android: string };

// One icon component for both platforms: SF Symbols on iPhone, Material Symbols on Android.
export const I = {
  home: { ios: 'house.fill', android: 'home' },
  search: { ios: 'magnifyingglass', android: 'search' },
  bell: { ios: 'bell.fill', android: 'notifications' },
  bellOff: { ios: 'bell.slash', android: 'notifications_off' },
  gear: { ios: 'gearshape.fill', android: 'settings' },
  star: { ios: 'star.fill', android: 'star' },
  starOpen: { ios: 'star', android: 'star_outline' },
  chevron: { ios: 'chevron.right', android: 'chevron_right' },
  location: { ios: 'location.fill', android: 'near_me' },
  pin: { ios: 'mappin.circle.fill', android: 'location_on' },
  swap: { ios: 'arrow.up.arrow.down', android: 'swap_vert' },
  clock: { ios: 'clock', android: 'schedule' },
  warn: { ios: 'exclamationmark.triangle.fill', android: 'warning' },
  info: { ios: 'info.circle', android: 'info' },
  walk: { ios: 'figure.walk', android: 'directions_walk' },
  train: { ios: 'tram.fill', android: 'train' },
  metro: { ios: 'lightrail.fill', android: 'subway' },
  bus: { ios: 'bus.fill', android: 'directions_bus' },
  lightrail: { ios: 'tram', android: 'tram' },
  ferry: { ios: 'ferry.fill', android: 'directions_boat' },
  coach: { ios: 'bus.doubledecker.fill', android: 'airport_shuttle' },
  people: { ios: 'person.2.fill', android: 'group' },
  close: { ios: 'xmark', android: 'close' },
  check: { ios: 'checkmark', android: 'check' },
  trash: { ios: 'trash', android: 'delete' },
  route: { ios: 'point.topleft.down.to.point.bottomright.curvepath', android: 'route' },
  plus: { ios: 'plus', android: 'add' },
  briefcase: { ios: 'briefcase.fill', android: 'work' },
  person: { ios: 'person.fill', android: 'person' },
  dot: { ios: 'circle.fill', android: 'circle' },
  minus: { ios: 'minus', android: 'remove' },
  back: { ios: 'chevron.left', android: 'arrow_back' },
  grip: { ios: 'line.3.horizontal', android: 'drag_handle' },
  up: { ios: 'chevron.up', android: 'expand_less' },
  down: { ios: 'chevron.down', android: 'expand_more' },
} satisfies Record<string, IconName>;

export function modeIconName(mode?: string): IconName {
  switch (mode) {
    case 'train': return I.train;
    case 'metro': return I.metro;
    case 'lightrail': return I.lightrail;
    case 'ferry': return I.ferry;
    case 'coach': return I.coach;
    case 'walk': return I.walk;
    default: return I.bus;
  }
}

export function Icon({ name, size = 20, color, style }: { name: IconName; size?: number; color?: ColorValue; style?: StyleProp<ViewStyle> }) {
  return (
    <SymbolView
      name={{ ios: name.ios as any, android: name.android as any, web: name.android as any }}
      size={size}
      tintColor={color}
      weight="medium"
      style={style}
    />
  );
}
