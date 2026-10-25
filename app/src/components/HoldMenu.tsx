import { cloneElement, isValidElement, useRef, useState, type ReactElement } from 'react';
import { Platform, View } from 'react-native';
import { Link, type Href } from 'expo-router';
import { haptic } from '@/lib/haptic';
import { canContextMenu } from '@/lib/nativeViews';
import { legacyButtons, menuKind, runMenuAction, withMenuActions, type MenuSpec } from '@/lib/menuCore';
import { AnchoredMenu, type MenuItem, type Rect } from './AnchoredMenu';
import { I, type IconName } from './Icon';
import { nativeMenu } from './Sheet';

/** Menu rows for the drawn menu (Android, the web preview), with the Android icon for each. */
export const drawnItems = (spec: MenuSpec): MenuItem[] => spec.items.map((it) => ({ text: it.text, icon: ((I as Record<string, IconName>)[it.icon] || I.dot), destructive: it.destructive, onPress: it.onPress }));

/**
 * Tap and hold on a row (a Home trip, a starred stop, a Recent row) opens its actions where the row is.
 * - iPhone: the system context menu. The row lifts as the preview and the menu opens under it, SF Symbols,
 *   destructive rows in red, no Cancel row (expo-router Link.Menu, a UIContextMenuInteraction; native code in
 *   builds 201 to 208, looked up first). A build without it keeps the old sheet.
 * - Android: the Material 3 menu under the row (AnchoredMenu). The web preview draws the iPhone menu's shape.
 * - VoiceOver and TalkBack: every row of the menu is also an action on the row, so no long press is needed.
 * The child is the row's own Pressable; its tap, label and other actions stay as they are.
 */
export function HoldMenu({ menu, href = '/', surface, children }: { menu?: MenuSpec | null; href?: Href; surface?: string; children: ReactElement<any> }) {
  const ref = useRef<any>(null);
  const [at, setAt] = useState<Rect | null>(null);
  if (!menu || !menu.items.length || !isValidElement(children)) return children;
  const kind = menuKind(Platform.OS, canContextMenu());
  const p = children.props as any;
  const a11y = {
    accessibilityActions: withMenuActions(p.accessibilityActions, menu.items),
    onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => { if (!runMenuAction(e.nativeEvent.actionName, menu.items)) p.onAccessibilityAction?.(e); },
  };
  if (kind === 'native') {
    // The trigger is a plain view around the row: the system lifts it as the preview. Link only carries the menu
    // here; its own tap is cancelled, so the row's tap keeps doing what it did.
    return (
      <Link href={href} asChild onPress={(e: any) => e?.preventDefault?.()}>
        <Link.Trigger>
          <View collapsable={false} role="none" style={surface ? { backgroundColor: surface } : undefined}>
            {cloneElement(children as ReactElement<any>, { ...a11y, onLongPress: undefined })}
          </View>
        </Link.Trigger>
        <Link.Menu title={menu.title}>
          {menu.items.map((it, i) => (
            <Link.MenuAction key={`${i}:${it.text}`} icon={(it.sf || undefined) as any} destructive={it.destructive} onPress={it.onPress}>{it.text}</Link.MenuAction>
          ))}
        </Link.Menu>
      </Link>
    );
  }
  const open = () => {
    haptic.tap();
    if (kind === 'legacy') { nativeMenu(menu.title || '', menu.message, legacyButtons(menu.items) as any); return; }
    const b = ref.current;
    if (b?.measureInWindow) b.measureInWindow((x: number, y: number, w: number, h: number) => setAt({ x, y, w, h }));
    else setAt({ x: 0, y: 0, w: 0, h: 0 });
  };
  return (
    <>
      {cloneElement(children as ReactElement<any>, { ...a11y, ref, onLongPress: open })}
      {kind !== 'legacy' ? <AnchoredMenu visible={!!at} anchor={at} items={drawnItems(menu)} title={menu.title} label={menu.title || 'Actions'} onClose={() => setAt(null)} /> : null}
    </>
  );
}

/**
 * A button that opens a menu (Save this trip). On iPhone the screens that have one put a system bar button with its
 * own UIMenu in the navigation bar instead (Stack.Toolbar.Menu, as the + on Home); this is the rest: the Material 3
 * menu under the button on Android, the iPhone menu's shape on the web, and the old sheet on an iPhone build that
 * has neither. The child is the button's own Pressable.
 */
export function PullDownButton({ menu, children }: { menu: MenuSpec; children: ReactElement<any> }) {
  const ref = useRef<any>(null);
  const [at, setAt] = useState<Rect | null>(null);
  const open = () => {
    haptic.tap();
    if (Platform.OS === 'ios') { nativeMenu(menu.title || '', menu.message, legacyButtons(menu.items) as any); return; }
    const b = ref.current;
    if (b?.measureInWindow) b.measureInWindow((x: number, y: number, w: number, h: number) => setAt({ x, y, w, h }));
    else setAt({ x: 0, y: 0, w: 0, h: 0 });
  };
  return (
    <>
      {cloneElement(children, { ref, onPress: open, accessibilityState: { expanded: !!at } })}
      {Platform.OS !== 'ios' ? <AnchoredMenu visible={!!at} anchor={at} items={drawnItems(menu)} title={menu.title} label={menu.title || 'Actions'} onClose={() => setAt(null)} /> : null}
    </>
  );
}
