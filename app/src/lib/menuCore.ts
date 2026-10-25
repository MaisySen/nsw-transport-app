/**
 * Menus as data: one list of actions, shown as the iPhone system menu (UIMenu context menu on a hold, pull-down
 * from a button), the Material 3 menu on Android, and VoiceOver and TalkBack actions on the row itself.
 * Bidur, 25 Oct 8:42 PM: the action sheet floating in the middle of the screen looked wrong. React Native's
 * ActionSheetIOS uses its anchor only on iPad, so on iPhone every hold menu was that centred panel.
 * Pure logic, no React Native imports, so test/nativemenus.test.mjs runs it in node.
 */

/** One action as callers write it today (React Native AlertButton shape). Cancel rows are dropped. */
export type MenuButton = { text?: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: Function };

/** One menu row: its words, an SF Symbol for iPhone, an icon key for Android (components/Icon.tsx I), and whether it is destructive (red). */
export type MenuAction = { text: string; sf: string; icon: string; destructive: boolean; onPress: () => void };

export type MenuSpec = { title?: string; message?: string; items: MenuAction[] };

/** SF Symbol and Android icon per action, by the action's first words. Plain outline symbols, as in Apple's own menus. */
const ICONS: [RegExp, string, string][] = [
  [/^edit\b/i, 'pencil', 'edit'],
  [/^show first\b/i, 'arrow.up.to.line', 'up'],
  [/^(delete|remove both)\b/i, 'trash', 'trash'],
  [/^remove from recent\b/i, 'clock.badge.xmark', 'close'],
  [/^unstar\b/i, 'star.slash', 'starOpen'],
  [/^(star|save)\b/i, 'star', 'starOpen'],
  [/^(change|set) home\b|^home$/i, 'house', 'home'],
  [/^(change|set) work\b|^work$/i, 'briefcase', 'briefcase'],
  [/^new trip\b/i, 'point.topleft.down.to.point.bottomright.curvepath', 'route'],
  [/^earlier\b/i, 'chevron.up', 'up'],
  [/^later\b/i, 'chevron.down', 'down'],
  [/^(every day|weekdays)\b/i, 'calendar', 'calendar'],
  [/^clear\b/i, 'xmark.circle', 'close'],
  [/^email\b/i, 'envelope', 'share'],
  [/^stop watching\b/i, 'bell.slash', 'bellOff'],
  [/^watch\b/i, 'bell', 'bell'],
  [/^show stops\b/i, 'list.bullet', 'list'],
];

/**
 * Tap and hold on a departure (stop screen, board, Home stop cards): Watch or Stop watching (the same words as the
 * row's swipe, so VoiceOver lists the action once), then Show stops. The title is the service, from live data.
 */
export function departureMenu(d: { line?: string | null; dest?: string | null }, watched: boolean, act: { watch?: (() => void) | null; open: () => void }): MenuSpec {
  const dest = String(d.dest || '').split(',')[0].replace(/ Station$/, '').trim();
  const title = [String(d.line || '').trim(), dest].filter(Boolean).join(' to ');
  const items: MenuAction[] = [];
  if (act.watch) items.push({ text: watched ? 'Stop watching' : 'Watch', ...iconsFor(watched ? 'Stop watching' : 'Watch'), destructive: false, onPress: act.watch });
  items.push({ text: 'Show stops', ...iconsFor('Show stops'), destructive: false, onPress: act.open });
  return { title: title || undefined, items };
}

export function iconsFor(text: string): { sf: string; icon: string } {
  for (const [re, sf, icon] of ICONS) if (re.test(text.trim())) return { sf, icon };
  return { sf: 'circle', icon: 'dot' };
}

/**
 * AlertButtons to menu rows: Cancel goes (a system menu closes with a tap outside, Android with Back or a tap
 * outside), rows with no action go, destructive rows move to the end in their order (Apple HIG: destructive last).
 */
export function menuFrom(buttons: MenuButton[]): MenuAction[] {
  const rows = buttons
    .filter((b) => b && b.style !== 'cancel' && !!b.text && typeof b.onPress === 'function' && !/^cancel$/i.test(b.text.trim()))
    .map((b) => ({ text: b.text!.trim(), ...iconsFor(b.text!), destructive: b.style === 'destructive', onPress: () => { (b.onPress as () => void)(); } }));
  return [...rows.filter((r) => !r.destructive), ...rows.filter((r) => r.destructive)];
}

/** Rows with their own icons (Settings) to menu rows; destructive last. An empty sf means no symbol (the other fare types beside the checked one). */
export function menuOf(items: { text: string; destructive?: boolean; onPress: () => void; sf?: string; icon?: string }[]): MenuAction[] {
  const rows = items.map((it) => { const d = iconsFor(it.text); return { text: it.text, sf: it.sf !== undefined ? it.sf : d.sf, icon: it.icon || d.icon, destructive: !!it.destructive, onPress: it.onPress }; });
  return [...rows.filter((r) => !r.destructive), ...rows.filter((r) => r.destructive)];
}

/** The old sheet's buttons (older builds without the native menu): the rows, then Cancel. */
export function legacyButtons(items: MenuAction[]): MenuButton[] {
  return [...items.map((i) => ({ text: i.text, style: (i.destructive ? 'destructive' : 'default') as MenuButton['style'], onPress: i.onPress })), { text: 'Cancel', style: 'cancel' }];
}

/** Accessibility action names for menu rows, kept apart from the row's own (swipeAction, whyLate). */
export const MENU_ACTION = 'menu:';

type A11yAction = { name: string; label: string };

/**
 * VoiceOver and TalkBack: every menu row is an action on the row itself, so nobody needs a long press. Actions the
 * row already offers (a swipe Delete) keep theirs and the menu row with the same words is not added twice.
 */
export function withMenuActions(existing: A11yAction[] | undefined, items: MenuAction[]): A11yAction[] {
  const base = existing || [];
  const seen = new Set(base.map((a) => a.label.toLowerCase()));
  return [...base, ...items.map((it, i) => ({ it, i })).filter(({ it }) => !seen.has(it.text.toLowerCase())).map(({ it, i }) => ({ name: `${MENU_ACTION}${i}`, label: it.text }))];
}

/** Runs the menu row an accessibility action names; false when the name is not a menu row (the row's own action). */
export function runMenuAction(name: string, items: MenuAction[]): boolean {
  if (!name.startsWith(MENU_ACTION)) return false;
  const it = items[Number(name.slice(MENU_ACTION.length))];
  if (!it) return false;
  it.onPress();
  return true;
}

/** Which menu a phone gets: the system menu, the Material 3 menu, or (iPhone builds without the native view) the old sheet. */
export function menuKind(os: string, nativeViews: boolean): 'native' | 'material' | 'legacy' | 'web' {
  if (os === 'ios') return nativeViews ? 'native' : 'legacy';
  if (os === 'android') return 'material';
  return 'web';
}
