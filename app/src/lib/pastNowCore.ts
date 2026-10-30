// Past and upcoming on lists that mix them (Bidur, 30 Oct, testing build 209: "Hard to differentiate past and current
// list here"). The trip screen's list and a stop's board put gone services (Left rows) above the ones still to come; this
// works out where the two meet so the screens can draw them apart: an "Earlier" header over the gone ones (muted rows in
// their own card), a "Now, 5:08pm" divider, the next service lightly marked, and the list opened at Now (the first
// service still to come at the top), never at the oldest gone one.
//
// Gone is the screens' own rule, unchanged (tripModesCore.hasLeft: over a minute past the best time, phone clock), so
// nothing here decides what is live or adds a timer: the screens pass the minute tick they already have (R1 to R6 hold).
// Pure, so test/pastnow.test.mjs runs it in node. Off: PAST_NOW in features.ts, or the server flag pastNow.

export type PastNowSplit = {
  /** Index of the first service still to come (-1: every row is gone, or there are none). */
  nowIdx: number;
  /** How many rows are gone (a gone row after nowIdx, which ranking can put under a later direct trip, counts too). */
  pastCount: number;
  /** An "Earlier" header goes above the list: its first row is gone. */
  earlier: boolean;
  /** A Now divider goes above row nowIdx: gone rows above it and a service to come. */
  divider: boolean;
  /** The row to mark lightly as the next one (-1 for none). */
  nextIdx: number;
};

export function pastNowSplit(gone: readonly boolean[]): PastNowSplit {
  const nowIdx = gone.findIndex((g) => !g);
  const pastCount = gone.filter(Boolean).length;
  return { nowIdx, pastCount, earlier: gone.length > 0 && !!gone[0], divider: nowIdx > 0, nextIdx: nowIdx };
}

/** The divider's words: "Now, 5:08pm" in the app's own clock (Sydney time). */
export const nowLabel = (now: number, clock: (t: number) => string) => {
  const t = clock(now);
  return t ? `Now, ${t}` : 'Now';
};

/** VoiceOver for the divider: what is above and below it. */
export const nowA11y = (now: number, clock: (t: number) => string, pastCount: number) =>
  `${nowLabel(now, clock)}. ${pastCount === 1 ? '1 service above has' : `${pastCount} services above have`} already gone. Services to come below.`;

/** Which group a row's card edge belongs to: rows 0..nowIdx-1 are one card (gone), nowIdx.. another (to come), so the
 * rounded corners and the gap fall where the divider is. With no divider it is one card, as before. */
export function cardEdges(i: number, len: number, split: Pick<PastNowSplit, 'nowIdx' | 'divider'>) {
  const cut = split.divider ? split.nowIdx : -1;
  return {
    top: i === 0 || i === cut,
    bottom: i === len - 1 || i === cut - 1,
    /** No hairline above the first row of either card. */
    sep: i > 0 && i !== cut,
  };
}

/** Open at Now: once per list (key) and only before the reader has touched it, scroll so the Now divider sits at the
 * top of the screen, just under the header (headerH: the see-through iPhone header the list scrolls under, 0 where the
 * header is solid). Nothing to do when nothing above it is gone. The answer is the scroll view's y offset. */
export function scrollToNow(p: { split: Pick<PastNowSplit, 'divider'>; dividerY: number | null | undefined; done: string | null; key: string; dragged: boolean; headerH?: number }): number | null {
  if (!p.split.divider || p.dragged || p.done === p.key) return null;
  if (p.dividerY == null || !Number.isFinite(p.dividerY)) return null;
  const h = Math.max(0, p.headerH || 0);
  return Math.max(-h, Math.round(p.dividerY - 4 - h));
}

/** Whether the open at Now is settled for this list without a scroll: the switch is off, or the first rows shown had
 * nothing gone above a service to come (a row that goes later, on the minute tick, never moves the list). */
export const openSettled = (on: boolean, rows: number, divider: boolean) => !on || (rows > 0 && !divider);

/** How a gone row is drawn with the switch on: on the recessed past zone (palette pastBg) in its own secondary text
 * (pastText), slightly faded times and line badges, no strikethrough (Off and Cancelled already say it), a little
 * shorter. Grey text alone was not enough: grey already means a timetable time on these lists. */
export const MUTED = { timeOpacity: 0.85, badgeOpacity: 0.4, padV: 9, strike: false } as const;
