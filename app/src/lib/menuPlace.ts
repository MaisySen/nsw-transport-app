// Where a menu opened from a button goes: under the button, its right edge lined up with the button's right edge,
// kept inside the screen, and above the button when there is no room below. Pure numbers, so the tests can check it.

export type Rect = { x: number; y: number; w: number; h: number };
export type MenuSpec = { width: number; row: number; pad: number; gap: number; margin: number };

/** iPhone (the drawn menu on the web preview): the system menu's size, 250 pt wide, 44 pt rows, 8 pt under the button. */
export const IOS_MENU: MenuSpec = { width: 250, row: 44, pad: 0, gap: 8, margin: 8 };
/** Android: a Material 3 menu, 48 dp rows, 8 dp top and bottom padding, 112 to 280 dp wide. */
export const M3_MENU: MenuSpec = { width: 220, row: 48, pad: 8, gap: 4, margin: 8 };

export function menuHeight(rows: number, spec: MenuSpec) {
  return rows * spec.row + spec.pad * 2;
}

export function placeMenu(anchor: Rect, screen: { w: number; h: number }, rows: number, spec: MenuSpec, safe: { top: number; bottom: number } = { top: 0, bottom: 0 }) {
  const width = Math.min(spec.width, screen.w - spec.margin * 2);
  const height = menuHeight(rows, spec);
  const rightEdge = anchor.x + anchor.w;
  let left = rightEdge - width;
  left = Math.max(spec.margin, Math.min(left, screen.w - spec.margin - width));
  const below = anchor.y + anchor.h + spec.gap;
  const fitsBelow = below + height <= screen.h - safe.bottom - spec.margin;
  const top = fitsBelow ? below : Math.max(safe.top + spec.margin, anchor.y - spec.gap - height);
  return { top: Math.round(top), left: Math.round(left), width, height, up: !fitsBelow };
}
