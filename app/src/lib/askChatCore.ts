// Ask chat history: how much is kept and shown. No React here (test/askchat.test.mjs).

/** Messages kept on the phone; the oldest go first. */
export const ASK_KEEP = 200;
/** Messages shown when Ask opens; Load earlier adds this many more each time. */
export const ASK_PAGE = 30;

/** The newest max messages, oldest dropped. Anything that is not a list (a damaged save) is an empty chat. */
export function capHistory<T>(msgs: T[] | unknown, max = ASK_KEEP): T[] {
  if (!Array.isArray(msgs)) return [];
  return msgs.length > max ? msgs.slice(msgs.length - max) : msgs.slice();
}

/** A saved chat read back: a list of messages with an id, role and text, capped. */
export function parseHistory<T extends { id: string; role: string; text: string }>(raw: string | null | undefined, max = ASK_KEEP): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return capHistory<T>(Array.isArray(v) ? v.filter((m: any) => m && typeof m.id === 'string' && (m.role === 'me' || m.role === 'bot') && typeof m.text === 'string') : [], max);
  } catch { return []; }
}

/** The messages on screen: the last `shown` of them. */
export function shownSlice<T>(msgs: T[], shown: number): T[] {
  const n = Math.max(0, Math.floor(shown));
  return n >= msgs.length ? msgs : msgs.slice(msgs.length - n);
}

/** How many to show after Load earlier, never more than there are. */
export function showMore(shown: number, total: number, page = ASK_PAGE): number {
  return Math.min(total, Math.max(shown, 0) + page);
}

/** "Load 30 earlier messages", or fewer at the start of the chat; '' when everything is shown. */
export function earlierLabel(shown: number, total: number, page = ASK_PAGE): string {
  const left = total - shown;
  if (left <= 0) return '';
  const n = Math.min(page, left);
  return `Load ${n} earlier ${n === 1 ? 'message' : 'messages'}`;
}

/** Words for the Clear chat confirmation. */
export function clearChatWords(count: number): { title: string; message: string; confirm: string } {
  return {
    title: 'Clear chat?',
    message: `This deletes ${count === 1 ? 'the 1 message' : `all ${count} messages`} in Ask on this phone. The chat is only kept on this phone. This cannot be undone.`,
    confirm: 'Clear chat',
  };
}
