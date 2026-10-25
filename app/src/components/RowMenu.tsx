import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { MenuSpec } from '@/lib/menuCore';
import { PullDownButton } from './HoldMenu';
import type { IconName } from './Icon';
import { Row, T } from './ui';

export type RowMenuProps = { title: string; subtitle?: string; value?: string; icon: IconName; sf: string; iconBg: string; menu: MenuSpec;
  /** A control beside the row, outside the menu (a commute's alert switch). */
  right?: ReactNode; accessibilityHint?: string };

/**
 * A Settings row whose tap opens a menu (Opal fare type, Privacy and data, a commute). Android: the Material 3 menu
 * under the row; the web preview: the iPhone menu's shape; an iPhone build without the SwiftUI menu: the old sheet.
 * iPhone builds that have it use RowMenu.ios.tsx, the system pull-down menu from the row.
 */
export function RowMenuDrawn({ title, subtitle, value, icon, iconBg, menu, right, accessibilityHint }: RowMenuProps) {
  const row = (
    <PullDownButton menu={menu}>
      <Row icon={icon} iconBg={iconBg} title={title} subtitle={subtitle} accessibilityHint={accessibilityHint} chevron={!right}
        right={value ? <T kind="body" tone="text2">{value}</T> : undefined} onPress={() => {}} />
    </PullDownButton>
  );
  if (!right) return row;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <View style={{ flex: 1 }}>{row}</View>
      <View style={{ paddingRight: 16 }}>{right}</View>
    </View>
  );
}

export const RowMenu = RowMenuDrawn;
