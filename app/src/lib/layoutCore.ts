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
