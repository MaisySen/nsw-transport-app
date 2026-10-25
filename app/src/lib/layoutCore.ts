// Fit any window: iPhone apps built with the iOS 27 SDK resize (iPhone Duo folds and unfolds, iPhone Mirroring and
// iPad windows resize freely), and with the iOS 27.1 SDK the status bar and the bars can sit on the right edge.
// Content keeps clear of the left and right safe areas, and on a wide window it stays at a readable width in the
// middle instead of stretching (the UIKit readable content width, 672 pt at the default text size).

export const READABLE_WIDTH = 672;

export type Sides = { left: number; right: number };

/** Left and right padding for a full width container: the safe area on each side, plus equal room on both sides
 *  when the space left is wider than `readable`. Whole points, never negative. */
export function sidePadding(width: number, insetLeft = 0, insetRight = 0, readable = READABLE_WIDTH): Sides {
  const l = Math.max(0, insetLeft || 0);
  const r = Math.max(0, insetRight || 0);
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const room = w - l - r;
  const extra = room > readable ? Math.floor((room - readable) / 2) : 0;
  return { left: Math.round(l + extra), right: Math.round(r + extra) };
}

/** True when the window is wide enough that content is centred (used to cap sheets the same way). */
export function isWide(width: number, insetLeft = 0, insetRight = 0, readable = READABLE_WIDTH): boolean {
  return width - Math.max(0, insetLeft) - Math.max(0, insetRight) > readable;
}

/** Below this shortest side (points) the window is a phone's: screens stay upright. An open iPhone Duo, a fold's
 *  inner screen, a tablet or a large resized window is wider, and there the screens turn and resize freely. */
export const PHONE_SHORT_SIDE = 600;

/** The screen orientation option for the window: upright on a phone sized window, any way on a wide one.
 *  Decided by the window's size alone, never by the device type. */
export function orientationFor(width: number, height: number): 'portrait_up' | 'all' {
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const h = Number.isFinite(height) && height > 0 ? height : 0;
  if (!w || !h) return 'portrait_up';
  return Math.min(w, h) < PHONE_SHORT_SIDE ? 'portrait_up' : 'all';
}
