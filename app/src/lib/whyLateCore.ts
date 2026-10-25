// "Why it's late": one short line with the reason a service is delayed or disrupted, taken only from the
// Transport for NSW alerts the server already sends with that service (a departure's alert ids, a leg's alerts)
// and the full alert text from /api/alerts for the same alert. Pure, so it is unit tested (test/whylate.test.mjs).
//
// Rules: a reason shows only when the service itself is delayed (2 min or more, live), cancelled, or has an alert
// of its own trip ("Running late", "Not stopping at", "Now ending at", "Starting from", shown as Changed); the reason must be written
// in an alert linked to that service ("due to signal repairs at Redfern", or an alert that starts with the cause,
// "Police operation at Central"); nothing is guessed from the line, the time or other alerts. No reason, no line.

export type WhyAlert = { id?: string; title?: string; url?: string; priority?: string; body?: string; lines?: string[] };
export type WhyInput = { delayMin?: number | null; realtime?: boolean; cancelled?: boolean; alerts?: (WhyAlert | string)[] | null };
export type Why = { text: string; reason: string; kind: 'delayed' | 'cancelled' | 'changed'; alert: { id: string; title: string; url?: string } };

/** Delays shorter than this are not called delays (the countdown already says the minutes). */
export const WHY_MIN_DELAY = 2;
/** The longest line, before the screen's own one line cut. */
export const WHY_MAX = 80;

/** The alert's id: its own id, else the part after "#/" in its transportnsw.info link. */
export function alertKey(a: WhyAlert | string | null | undefined): string {
  if (!a) return '';
  if (typeof a === 'string') return a;
  if (a.id) return String(a.id);
  const m = /#\/([^/?#]+)\s*$/.exec(String(a.url || ''));
  return m ? m[1] : '';
}

/** The alerts a row or leg links to: ids looked up in the board's list, objects kept. */
export function linkedAlerts(list: (WhyAlert | string)[] | null | undefined, board: WhyAlert[] | null | undefined): WhyAlert[] {
  const out: WhyAlert[] = [];
  for (const a of list || []) {
    if (typeof a === 'string') { const b = (board || []).find((x) => x && alertKey(x) === a); out.push(b ? { ...b, id: alertKey(b) } : { id: a }); }
    else if (a && typeof a === 'object') out.push({ ...a, id: alertKey(a) });
  }
  return out;
}

/** Full alert text by alert id, from /api/alerts answers ({ items: [{ title, url }] }, the title holds the whole text). */
export function alertTexts(answers: ({ items?: any[] } | null | undefined)[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of answers) for (const i of (r && r.items) || []) {
    const k = alertKey(i);
    const t = clean(i && (i.body ? `${i.title || ''} ${i.body}` : i.title));
    if (k && t && !out[k]) out[k] = t;
  }
  return out;
}

const clean = (s: any) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|\u00a0/g, ' ').replace(/&amp;/g, '&').replace(/[\u2012-\u2015]/g, ',').replace(/\s+/g, ' ').trim();

// The titles Transport for NSW gives alerts that belong to one trip (GTFS realtime trip alerts).
const TRIP_TITLE = /^(running late|not stopping at|now (ending|starting|terminating) at|starting from|terminating at|cancelled|diverted)\b/i;
// Alerts that never explain a delay: lifts, accessibility, generic platform notes, timetable testing.
const NOISE = /\b(lifts?|escalators?|wheelchair|accessible|toilets?|opal|car ?park|bike|platforms may change|check indicator|listen for announcements|for testing)\b/i;
// A cause written first: "Police operation at Central", "Signal repairs at Redfern".
const CAUSE_FIRST = /^(police (operation|activity|incident)|signal(ling)? (repairs?|faults?|failures?|equipment|issues?)|track (repairs?|faults?|equipment|issues?)|urgent (track|signal|overhead wiring|maintenance|repairs?)[a-z ]*|overhead wiring|power (supply )?(faults?|outages?|issues?|failures?)|(a |an )?medical (emergency|incident|assistance)|(a |an )?(earlier )?(incident|emergency)|emergency services|(a |an )?(broken down|disabled|faulty) (train|bus|vehicle|ferry|tram)|(a |an )?(train|bus|vehicle|tram) (fault|breakdown)|equipment (faults?|repairs?)|severe weather|(heavy |high )?(rain|winds?|flooding|storms?)|(a |an )?(fire|bushfire|grassfire)|trackwork|track work|roadworks?|road work|road closures?|(a |an )?(traffic )?(crash|accident|collision)|(heavy )?traffic( congestion)?|congestion|(a |an )?(special )?event|(a |an )?protest|industrial action|(a |an )?(person|trespasser)[a-z ]* (on|near) the (tracks?|line)|(a |an )?(fallen )?(tree|powerlines?)[a-z ]*|(a |an )?landslip|(a |an )?(security|safety) (incident|issue)|(a |an )?(signal|track|points) (fault|failure|repairs))\b/i;

const COMMON_FIRST = /^(police|signal|signalling|track|trackwork|urgent|overhead|power|medical|incident|emergency|earlier|broken|disabled|faulty|equipment|severe|heavy|high|rain|wind|winds|flooding|storm|storms|fire|bushfire|grassfire|roadwork|roadworks|road|traffic|crash|accident|collision|congestion|special|event|protest|industrial|person|trespasser|fallen|tree|landslip|security|safety|maintenance|repairs|weather|a|an|the)\b/i;

/** The cause in an alert's text, cleaned to a short phrase, or '' when the text names none. */
export function causeOf(text: string | null | undefined): string {
  const s = clean(text);
  if (!s) return '';
  let c = '';
  const due = /\b(?:due to|because of|caused by|following)\s+(.+?)(?:[.;:!?](?:\s|$)|,\s*(?:and |so |please|allow|plan|check|stops|platforms|trains|buses|services|customers|expect|which)|\s+(?:please|allow|plan|check|expect)\b|$)/i.exec(s);
  if (due && !/^(the|this) (timetable|weekend|holiday)\b/i.test(due[1]) && !/^\d/.test(due[1])) c = due[1];
  if (!c) {
    for (const sent of s.replace(/([.;!?])\s+/g, '$1\n').split('\n')) {
      const m = CAUSE_FIRST.exec(sent.trim());
      if (m) { c = sent.trim().replace(/[.;!?]+$/, ''); break; }
    }
  }
  if (!c) return '';
  c = c.replace(/^(an?|the)\s+/i, '')
    .replace(/\s+(earlier|earlier today|this (morning|afternoon|evening)|today|tonight|yesterday)$/i, '')
    .replace(/[,\s]+$/, '').trim();
  if (!c || NOISE.test(c) || c.length < 4) return '';
  return c;
}

/** Cut at a word boundary, with a full stop free ellipsis. */
export function shorten(s: string, max = WHY_MAX): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,\s]+$/, '')}\u2026`;
}

const rank: Record<string, number> = { veryHigh: 0, high: 1, normal: 2 };

/**
 * The reason line for one service, or null. `texts` is the full text by alert id (alertTexts); a linked alert
 * without full text still counts with its own title.
 */
export function whyLate(s: WhyInput, board: WhyAlert[] | null | undefined, texts: Record<string, string> = {}): Why | null {
  const linked = linkedAlerts(s.alerts, board).filter((a) => a.priority !== 'low' && a.priority !== 'veryLow');
  if (!linked.length) return null;
  const delayed = !!s.realtime && !s.cancelled && (s.delayMin || 0) >= WHY_MIN_DELAY;
  const cancelled = !!s.cancelled;
  const tripAlert = linked.find((a) => TRIP_TITLE.test(clean(a.title)));
  if (!delayed && !cancelled && !tripAlert) return null;
  const ordered = linked.map((a, i) => ({ a, i, trip: TRIP_TITLE.test(clean(a.title)) ? 0 : 1, r: rank[a.priority || 'normal'] ?? 2 }))
    .sort((x, y) => x.trip - y.trip || x.r - y.r || x.i - y.i);
  for (const { a } of ordered) {
    const full = (a.id && texts[a.id]) || clean(a.body ? `${a.title || ''} ${a.body}` : a.title);
    if (!full || NOISE.test(clean(a.title))) continue;
    const reason = causeOf(full);
    if (!reason) continue;
    const late = delayed || /^running late\b/i.test(clean(a.title));
    const kind: Why['kind'] = cancelled ? 'cancelled' : late ? 'delayed' : 'changed';
    const lead = kind === 'cancelled' ? 'Cancelled: ' : kind === 'delayed' ? 'Delayed: ' : 'Changed: ';
    // A common first word follows the lead in lower case ("Delayed: police operation at Central"); a name keeps
    // its capital ("Delayed: Sydney Trains crew shortage").
    const first = reason.charAt(0);
    const fixed = COMMON_FIRST.test(reason) ? first.toLowerCase() + reason.slice(1) : reason;
    return { text: shorten(lead + fixed), reason, kind, alert: { id: a.id || '', title: clean(a.title) || reason, url: a.url } };
  }
  return null;
}

/** The lines whose full alert text is worth fetching: only services that could show a reason and link alerts. */
export function linesToAsk(rows: (WhyInput & { line?: string | null })[], board: WhyAlert[] | null | undefined, max = 3): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const line = String(r.line || '').trim();
    if (!line || out.includes(line) || !/^[A-Za-z]{0,3}\d{1,3}[A-Za-z]?$/.test(line)) continue;
    const linked = linkedAlerts(r.alerts, board).filter((a) => a.priority !== 'low' && a.priority !== 'veryLow');
    if (!linked.length) continue;
    const delayed = !!r.realtime && !r.cancelled && (r.delayMin || 0) >= WHY_MIN_DELAY;
    if (!delayed && !r.cancelled && !linked.some((a) => TRIP_TITLE.test(clean(a.title)))) continue;
    out.push(line.toUpperCase());
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The same reason said for a whole journey, naming the line when the journey has more than one ride, so a card
 * that says On time for its first train does not seem to contradict "Delayed" ("T4 delayed: signal repairs").
 */
export function forJourney(w: Why | null, line: string | null | undefined, rides: number): Why | null {
  if (!w || rides < 2 || !line) return w;
  const lead = `${line} ${w.kind}: `;
  const body = w.text.replace(/^(Delayed|Cancelled|Changed): /, '').replace(/\u2026$/, '');
  return { ...w, text: shorten(lead + body) };
}

/** What VoiceOver and TalkBack read for the line. */
export function whyA11y(w: Why): string {
  return `Why it's late: ${w.text.replace(/\u2026$/, '')}. Opens the full alert.`;
}
