// Station map: TfNSW's own station map for a stop, read from the stop's page on transportnsw.info (the "Public
// transport maps" list). Only a link that page actually lists is used, so the button shows only where a map exists.

export const TFNSW = 'https://transportnsw.info';
/** The stop's page on transportnsw.info; its "Public transport maps" list holds the station map. */
export const stopPageUrl = (id: string) => `${TFNSW}/stop?q=${encodeURIComponent(id)}`;

export type StationMap = { url: string; label: string };

const clean = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();

/** Every PDF in the page's "Public transport maps" list, with its label. */
export function mapLinks(html: string): StationMap[] {
  if (typeof html !== 'string') return [];
  const i = html.indexOf('Public transport maps');
  if (i < 0) return [];
  const seg = html.slice(i, i + 8000);
  const out: StationMap[] = [];
  const re = /<a\b[^>]*href="(\/document\/\d+\/[a-z0-9._-]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(seg))) {
    const label = clean(m[2]);
    if (label && !out.some((x) => x.url === TFNSW + m![1])) out.push({ url: TFNSW + m[1], label });
  }
  return out;
}

/** The station map from the list: a "station map" first, then a "station guide". Bus, stop and local area guides alone are not one. */
export function pickStationMap(links: StationMap[]): StationMap | null {
  return links.find((l) => /station map/i.test(l.label)) || links.find((l) => /station guide/i.test(l.label)) || null;
}

export const parseStationMap = (html: string) => pickStationMap(mapLinks(html));

/** Kept answers: a found map for 7 days, "no map" for 1 day. */
export function cacheFresh(entry: any, now: number): boolean {
  if (!entry || typeof entry.at !== 'number') return false;
  const ttl = entry.map ? 7 * 86400000 : 86400000;
  return now - entry.at >= 0 && now - entry.at < ttl;
}
