// Notifications on Home: alerts, weekend trackwork, line problems and extra watched trips as a row of small chips
// under the commute card, each closed until tapped. No React here (test/notices.test.mjs).

export type NoticeTone = 'red' | 'orange' | 'indigo' | 'plain';
/** One line inside an open chip. url opens Transport for NSW's page; watch opens a watched trip; trip opens the trip. */
export type NoticeItem = { key: string; title: string; text?: string; extra?: string | null; url?: string | null; watch?: string; trip?: boolean };
export type Notice = { key: string; label: string; count: number; tone: NoticeTone; a11y: string; items: NoticeItem[]; line?: { line: string; mode?: string; color?: string } };

export type NoticeInput = {
  /** High priority alerts on the trips on Home (the old orange banner). */
  high?: { title: string; url?: string | null }[];
  /** Every distinct alert title on the trips on Home (the old "9 alerts on your trips" line). */
  tripAlerts?: string[];
  /** Weekend trackwork rows (the old Trackwork this weekend card). */
  trackwork?: { key: string; name: string; text: string; extra: string | null; url: string | null }[];
  /** Status of my lines; only lines with a problem become chips. */
  lines?: { line: string; mode?: string; color?: string; status: string; label: string; title: string | null; url: string | null; more: number }[];
  /** Watched trips that the live trip bar does not already show. */
  watches?: { id: string; title: string; sub: string }[];
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** Alert text read out as one sentence each: no doubled stops. */
const said = (t: string) => String(t || '').replace(/\s+/g, ' ').trim().replace(/[\s.]+$/, '');

/** A short chip label from an alert title: the first clause, at most about 28 characters, cut at a word. */
export function shortTitle(t: string, max = 28): string {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  const first = s.split(/(?<=[.:;!?])\s|,\s/)[0].replace(/[.:;,]+$/, '');
  if (first.length <= max) return first;
  const cut = first.slice(0, max + 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.5 ? cut.slice(0, sp) : first.slice(0, max)).replace(/[.:;,]+$/, '') + '\u2026';
}

/** The chips, most urgent first: high alert, line problems, trip alerts, trackwork, watched trips. */
export function noticeChips(x: NoticeInput): Notice[] {
  const out: Notice[] = [];
  const high = (x.high || []).filter((a) => a && a.title);
  if (high.length) {
    const label = shortTitle(high[0].title);
    out.push({ key: 'high', label, count: high.length, tone: 'orange',
      a11y: `Alert${high.length > 1 ? `, ${high.length} in all` : ''}: ${high.map((a) => said(a.title)).join('. ')}`,
      items: high.map((a, i) => ({ key: `h${i}`, title: a.title, url: a.url || null, trip: !a.url })) });
  }
  for (const l of x.lines || []) {
    if (!l || l.status === 'good') continue;
    out.push({ key: `line:${l.line}`, label: l.label, count: 1, tone: l.status === 'suspended' ? 'red' : 'orange', line: { line: l.line, mode: l.mode, color: l.color },
      a11y: `${l.line}: ${l.label}${l.title ? '. ' + l.title : ''}${l.more ? `. ${l.more} more` : ''}`,
      items: [{ key: `l${l.line}`, title: `${l.line}: ${l.label}`, text: l.title ? `${l.title}${l.more ? ` (+${l.more} more)` : ''}` : undefined, url: l.url }] });
  }
  const ta = [...new Set((x.tripAlerts || []).map((t) => String(t || '').trim()).filter(Boolean))];
  if (ta.length) {
    out.push({ key: 'alerts', label: plural(ta.length, 'trip alert', 'trip alerts'), count: ta.length, tone: 'plain',
      a11y: `${plural(ta.length, 'alert', 'alerts')} on your trips: ${ta.map(said).join('. ')}`,
      items: ta.map((t, i) => ({ key: `a${i}`, title: t })) });
  }
  const tw = x.trackwork || [];
  if (tw.length) {
    out.push({ key: 'trackwork', label: 'Trackwork this weekend', count: tw.length, tone: 'orange',
      a11y: `Trackwork this weekend: ${tw.map((r) => `${r.name}. ${r.text}${r.extra ? '. ' + r.extra : ''}`).join('. ')}`,
      items: tw.map((r) => ({ key: r.key, title: r.name, text: r.text, extra: r.extra, url: r.url })) });
  }
  const w = x.watches || [];
  if (w.length) {
    out.push({ key: 'watching', label: w.length === 1 ? 'Watching 1 trip' : `Watching ${w.length} trips`, count: w.length, tone: 'indigo',
      a11y: `Watching now: ${w.map((v) => `${v.title}, ${v.sub}`).join('. ')}`,
      items: w.map((v) => ({ key: v.id, title: v.title, text: v.sub, watch: v.id })) });
  }
  return out;
}

/** The bar above the commute card: the live trip, else a single watched trip. A watch of the live trip shows once. */
export function topBar<W extends { id: string }>(live: { watchId?: string | null } | null, watches: W[]): { live: boolean; watch: W | null; rest: W[] } {
  const others = watches.filter((w) => !(live && live.watchId && w.id === live.watchId));
  if (live) return { live: true, watch: null, rest: others };
  if (others.length === 1) return { live: false, watch: others[0], rest: [] };
  return { live: false, watch: null, rest: others };
}
