// Pure helpers for screens that keep a field above the keyboard and a chat pinned to its latest message.
// No React Native imports, so the unit tests can run them directly (test/overlap.test.mjs).

/** Points the keyboard covers at the bottom of a view: the view's bottom edge in window coordinates minus the
 *  keyboard's top edge. Zero when the keyboard is hidden (its top is at or below the view) or a value is missing.
 *  Measured in window coordinates on both sides, so it does not depend on where the header or tab bar sit. */
export function keyboardOverlap(viewBottom: number, keyboardTop: number | null | undefined): number {
  if (!Number.isFinite(viewBottom) || keyboardTop == null || !Number.isFinite(keyboardTop) || keyboardTop <= 0) return 0;
  return Math.max(0, Math.round(viewBottom - keyboardTop));
}

/** True when a list is scrolled to (or within `slack` points of) its end, so new content should keep it there. */
export function atEnd(offsetY: number, viewportH: number, contentH: number, insetBottom = 0, slack = 80): boolean {
  if (!(contentH > 0) || !(viewportH > 0)) return true;
  return offsetY + viewportH >= contentH + insetBottom - slack;
}
