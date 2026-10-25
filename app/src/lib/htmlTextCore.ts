// Alert text as plain words. The Trip Planner's alert titles and details can carry web code ("<a href=...>Book your
// seat with NSW TrainLink</a>", seen on the stop screen at Dubbo, 26 Oct). Nothing in the app renders HTML: every
// answer from the server and every kept copy goes through cleanAlertTexts, so the stop screen, trip list, service
// screen, widgets, notifications and Ask all get plain words. A link's words stay; the link itself is dropped (the
// alert's own url field is the tappable one). Pure logic, no imports, unit tested in Node (test/htmltext.test.mjs).

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', ndash: ', ', mdash: ', ', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', hellip: '...' };

const tags = (x: string) => x
  .replace(/<[^>]*>/g, ' ')
  // A tag cut off by a length limit ("<a href=...") has no closing bracket: drop it to the end.
  .replace(/<\/?[a-z][^<]*$/i, ' ');
const code = (n: number) => (n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' ');
const ents = (x: string) => x
  .replace(/&#(\d+);/g, (_m, n) => code(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_m, n) => code(parseInt(n, 16)))
  .replace(/&(nbsp|amp|quot|apos|lt|gt|ndash|mdash|rsquo|lsquo|rdquo|ldquo|hellip);/gi, (_m, n) => ENTITIES[String(n).toLowerCase()]);

/** Plain words from text that may carry HTML tags or entities. Encoded tags ("&lt;b&gt;") are removed too. */
export function plainText(h?: string | null): string {
  return tags(ents(tags(String(h ?? ''))))
    .replace(/\s*[\u2013\u2014]\s*/g, ', ')
    .replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/,(\s*,)+/g, ',').trim();
}

/** True when a string has a tag or an entity in it. */
export const looksHtml = (s: string) => /<\/?[a-z][^>]*>|<\/?[a-z][^<]*$|&(#\d+|#x[0-9a-f]+|[a-z]+);/i.test(s);

// The fields that carry alert words, wherever they sit in an answer (alerts, notices, trackwork, lifts, Ask).
const TEXT_KEYS = new Set(['title', 'text', 'subtitle', 'detail', 'details', 'content', 'body', 'message', 'summary', 'reason', 'h', 'header', 'headline', 'note', 'why', 'urlText', 'short']);

/**
 * The answer with every alert word field made plain, in place (answers are fresh objects from JSON). Only strings
 * that look like HTML change; ids, urls, times and names are left alone. Depth limited.
 */
export function cleanAlertTexts<T>(resp: T): T {
  const walk = (o: any, depth: number) => {
    if (!o || typeof o !== 'object' || depth > 8) return;
    if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) walk(o[i], depth + 1); return; }
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === 'string') { if (TEXT_KEYS.has(k) && looksHtml(v)) o[k] = plainText(v); }
      else if (v && typeof v === 'object') walk(v, depth + 1);
    }
  };
  walk(resp, 0);
  return resp;
}
