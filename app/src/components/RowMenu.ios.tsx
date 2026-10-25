import { View } from 'react-native';
import { haptic } from '@/lib/haptic';
import { canSwiftUIMenu } from '@/lib/nativeViews';
import { usePalette } from '@/lib/theme';
import { RowMenuDrawn, type RowMenuProps } from './RowMenu';

export type { RowMenuProps };

/**
 * iPhone: a Settings row that is a SwiftUI Menu (@expo/ui 58, compiled into builds 201 to 208 and looked up first).
 * Tapping the row drops the system pull-down menu from it: SF Symbols, destructive rows in red, no Cancel row, the
 * menu's note as a section title. The row itself is drawn in SwiftUI to match the other rows (29 pt icon tile,
 * body text, secondary value). A build without the view keeps the old sheet (RowMenuDrawn).
 */
export function RowMenu(props: RowMenuProps) {
  const c = usePalette();
  if (!canSwiftUIMenu()) return <RowMenuDrawn {...props} />;
  const { Host, Menu, Button, Section, HStack, VStack, Text, Image, Spacer } = require('@expo/ui/swift-ui');
  const { padding, frame, background, shapes, font, foregroundStyle, lineLimit, accessibilityHint, contentShape } = require('@expo/ui/swift-ui/modifiers');
  const { title, subtitle, value, sf, iconBg, menu, right } = props;
  const opt = (f: any, ...a: any[]) => (typeof f === 'function' ? [f(...a)] : []);
  const items = menu.items.map((it, i) => (
    <Button key={`${i}:${it.text}`} label={it.text} systemImage={it.sf || undefined} role={it.destructive ? 'destructive' : 'default'} onPress={() => { haptic.select(); it.onPress(); }} />
  ));
  const label = (
    <HStack spacing={12} modifiers={[padding({ horizontal: 16, vertical: 9 }), frame({ minHeight: 48, maxWidth: 100000, alignment: 'leading' }), ...opt(contentShape, shapes?.rectangle?.())]}>
      <Image systemName={sf} size={16} color="#FFFFFF" modifiers={[frame({ width: 29, height: 29 }), background(iconBg, shapes.roundedRectangle({ cornerRadius: 7, roundedCornerStyle: 'continuous' }))]} />
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[font({ textStyle: 'body' }), foregroundStyle({ type: 'hierarchical', style: 'primary' }), ...opt(lineLimit, 2)]}>{title}</Text>
        {subtitle ? <Text modifiers={[font({ textStyle: 'footnote' }), foregroundStyle({ type: 'hierarchical', style: 'secondary' }), ...opt(lineLimit, 2)]}>{subtitle}</Text> : null}
      </VStack>
      <Spacer />
      {value ? <Text modifiers={[font({ textStyle: 'body' }), foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>{value}</Text> : null}
      {right ? null : <Image systemName="chevron.up.chevron.down" size={13} color={c.text3} />}
    </HStack>
  );
  const host = (
    <Host matchContents={{ vertical: true }} colorScheme={c.dark ? 'dark' : 'light'} style={{ minHeight: 48, flex: right ? 1 : undefined }}
      modifiers={opt(accessibilityHint, props.accessibilityHint || 'Opens a menu')}>
      <Menu label={label}>
        {menu.message ? <Section title={menu.message}>{items}</Section> : items}
      </Menu>
    </Host>
  );
  if (!right) return host;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {host}
      <View style={{ paddingRight: 16 }}>{right}</View>
    </View>
  );
}
