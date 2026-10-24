// Ask answers, made easy to scan. A trip answer from /api/ask carries its journeys in the trip card,
// so the bubble is built from those fields (time, lines, platform, arrival, status, lift outages, fare)
// instead of the long reply paragraph. Any other answer is split into short paragraphs.
// No React Native imports here, so the unit tests can load this file directly.

export type AskAccessEnd = { outage?: string | null } | null | undefined;
export type AskLeg = {
  kind: string; mode?: string; line?: string; color?: string; fromPlatform?: string | null;
  planned?: string; estimated?: string | null; realtime?: boolean; delayMin?: number; cancelled?: boolean;
  access?: { from?: AskAccessEnd; to?: AskAccessEnd } | null;
};
export type AskFare = {
  typeName?: string; total: number | null; peak?: boolean; capped?: boolean; unknown?: boolean;
  airportFee?: number; offPeak?: { from: string; save: number } | null;
};
export type AskJourney = { leave: string; arrive: string; changes: number; legs: AskLeg[]; fare?: AskFare | null };
export type AskCardLike = { type: string; to?: { name: string } | null; journeys?: AskJourney[] };
export type AskMsgLike = { text: string; kind?: string | null; cards?: AskCardLike[]; fare?: AskFare | null };

export type Tone = 'liveText' | 'lateText' | 'redText' | 'text2';
export type Status = { text: string; tone: Tone };

export type TripSummary = {
  time: string;            // "7:30 am"
  when: string;            // "in 13 min", "Now", "Left"
  whenSpoken: string;      // "in 13 minutes"
  past: boolean;
  live: boolean;
  lines: { line?: string; mode?: string; color?: string }[];
  platform: string | null; // "Platform 2"
  leaveAt: string | null;  // set when the trip starts with a walk: "7:22 am"
  arrive: string;          // "Arrives Kings Cross 7:55 am \u00b7 1 change"
  arriveSpoken: string;
  status: Status;
  outages: string[];       // the full lift and escalator messages
  liftShort: string | null;
  fare: string | null;     // "Fare about $3.76 \u00b7 Adult off peak"
  fareSpoken: string | null;
  extras: string[];        // other lines of the reply (step free note, parking), kept short
  spoken: string;          // the whole card as one sentence for VoiceOver and TalkBack
};

const DOT = ' \u00b7 ';

/** "Strathfield Station" to "Strathfield"; keeps stop names that are not stations as they are. */
export function shortPlace(name?: string | null): string {
  return String(name || '').split(',')[0].replace(/ (Station|Light Rail|Wharf)$/, '').trim();
}

/** "7:30 am" in Sydney time. */
export function clock12(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Australia/Sydney' })
    .replace(/\s?(am|pm)/i, (_m, p) => ' ' + p.toLowerCase());
}

/** Minutes until a time, as shown ("in 13 min") and as read aloud ("in 13 minutes"). */
export function untilWords(iso: string, now: number): { text: string; spoken: string; past: boolean } {
  const m = Math.round((new Date(iso).getTime() - now) / 60000);
  if (m < -1) return { text: 'Left', spoken: 'already left', past: true };
  if (m <= 0) return { text: 'Now', spoken: 'leaving now', past: false };
  if (m < 60) return { text: `in ${m} min`, spoken: `in ${m} minute${m === 1 ? '' : 's'}`, past: false };
  const h = Math.floor(m / 60), r = m % 60;
  return {
    text: `in ${h} h${r ? ` ${r} min` : ''}`,
    spoken: `in ${h} hour${h === 1 ? '' : 's'}${r ? ` ${r} minute${r === 1 ? '' : 's'}` : ''}`,
    past: false,
  };
}

/** Same words and colours as the trip and departure rows. */
export function statusOf(it: { cancelled?: boolean; realtime?: boolean; delayMin?: number }): Status {
  if (it.cancelled) return { text: 'Cancelled', tone: 'redText' };
  if (!it.realtime) return { text: 'Scheduled', tone: 'text2' };
  const d = Math.round(it.delayMin || 0);
  if (d >= 2) return { text: `${d} min late`, tone: 'lateText' };
  if (d <= -2) return { text: `${-d} min early`, tone: 'liveText' };
  return { text: 'On time', tone: 'liveText' };
}

/** "4 min late" read aloud as "4 minutes late". */
export function spokenMin(s: string): string {
  return s.replace(/\b(\d+) min\b/g, (_m, n) => `${n} minute${n === '1' ? '' : 's'}`);
}

/** Every lift or escalator outage on the journey's stations, each once, in trip order. */
export function journeyOutages(j: AskJourney): string[] {
  const out: string[] = [];
  for (const l of j.legs || []) for (const e of [l.access?.from, l.access?.to]) {
    const t = e && e.outage ? String(e.outage).trim() : '';
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** "Kings Cross Station Lift 1 between ..." to { what: "Lift 1", at: "Kings Cross" }. */
export function parseOutage(t: string): { what: string; at: string } | null {
  const m = /^(.+?)\s+(?:(?:Station|Light Rail|Wharf)\s+)?(Lift|Escalator|lift|escalator)\s+([A-Z]?\d+[A-Za-z]?)\b/.exec(String(t || ''));
  if (!m) return null;
  const kind = m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase();
  return { what: `${kind} ${m[3]}`, at: shortPlace(m[1]) };
}

/** A short warning line: "Lift 1 at Kings Cross not working". The full messages stay one tap away. */
export function liftShort(list: string[]): string | null {
  if (!list.length) return null;
  const p = list.map(parseOutage);
  if (list.length === 1) return p[0] ? `${p[0].what} at ${p[0].at} not working` : 'Lift not working on this trip';
  if (list.length === 2 && p[0] && p[1]) {
    return p[0].at === p[1].at
      ? `${p[0].what} and ${p[1].what} at ${p[0].at} not working`
      : `${p[0].what} at ${p[0].at} and ${p[1].what} at ${p[1].at} not working`;
  }
  return `${list.length} lifts not working on this trip`;
}

function money(n: number): string { return '$' + n.toFixed(2); }

/** "Fare about $3.76 \u00b7 Adult off peak", or null when there is no fare. */
export function fareLine(f?: AskFare | null): { text: string; spoken: string } | null {
  if (!f || f.total == null || f.unknown) return null;
  const kind = [f.typeName, f.peak ? 'peak' : 'off peak'].filter(Boolean).join(' ');
  const bits = [`Fare about ${money(f.total)}`, kind];
  if (f.airportFee) bits.push(`includes ${money(f.airportFee)} airport fee`);
  if (f.capped) bits.push('daily cap reached');
  if (f.offPeak && f.offPeak.from && f.offPeak.save) bits.push(`off peak from ${f.offPeak.from} saves ${money(f.offPeak.save)}`);
  return { text: bits.join(DOT), spoken: bits.join(', ') };
}

const ABBR = /(?:^|\s)(?:St|Rd|Ave|Dr|Hwy|Pde|Pl|Cres|Mt|No|Opp|approx|vs|Jr|Sr|e\.g|i\.e|etc)\.$/i;

/** Splits a reply into sentences, keeping times ("7:30am"), prices ("$3.76") and street abbreviations whole. */
export function sentences(text: string): string[] {
  const out: string[] = [];
  for (const para of String(text || '').split(/\n+/)) {
    // No lookbehind (older JS engines): mark each break, then split on the mark.
    const parts = para.trim().replace(/([.!?])\s+(?=["'(\[]?[A-Z0-9$])/g, '$1\u0000').split('\u0000');
    let cur = '';
    for (const p of parts) {
      cur = cur ? cur + ' ' + p : p;
      if (ABBR.test(cur)) continue;
      out.push(cur); cur = '';
    }
    if (cur) out.push(cur);
  }
  return out.filter(Boolean);
}

/** Short paragraphs of at most two sentences, a long sentence on its own. A line break in the reply always starts a new paragraph. */
export function splitPlain(text: string, max = 2, longChars = 140): string[] {
  const out: string[] = [];
  for (const para of String(text || '').split(/\n+/)) {
    let cur: string[] = [];
    for (const s of sentences(para)) {
      const joined = cur.concat(s).join(' ');
      if (cur.length && (cur.length >= max || joined.length > longChars)) { out.push(cur.join(' ')); cur = []; }
      cur.push(s);
    }
    if (cur.length) out.push(cur.join(' '));
  }
  return out;
}

/** Departure time of a journey: its first service, live time first. */
function depOf(j: AskJourney): string {
  const t = (j.legs || []).find((l) => l.kind === 'transit');
  return (t && (t.estimated || t.planned)) || j.leave;
}

// Reply lines the card shows in its own way (lift warning row, fare line).
const SHOWN_IN_CARD = [/^Lift outage on this trip:/i, /^Opal fare estimate/i];

/**
 * The scannable card for a trip answer, or null when the answer is not a "next service" trip answer
 * (then the reply shows as short paragraphs). Picks the first journey that has not left yet.
 */
export function tripSummary(msg: AskMsgLike, now: number): TripSummary | null {
  if (msg.kind && msg.kind !== 'trip') return null;
  const lines = String(msg.text || '').split('\n');
  if (!/\bNext: the\b/.test(lines[0] || '')) return null;
  const trips = (msg.cards || []).filter((c) => c.type === 'trip' && (c.journeys || []).length);
  if (trips.length !== 1) return null;
  const card = trips[0];
  const js = card.journeys || [];
  const j = js.find((x) => new Date(depOf(x)).getTime() >= now - 60000) || js[0];
  const tl = (j.legs || []).filter((l) => l.kind === 'transit');
  if (!tl.length) return null;
  const f = tl[0];
  const dep = f.estimated || f.planned || j.leave;
  const u = untilWords(dep, now);
  const seen: string[] = [];
  const chips = tl.filter((l) => { const k = `${l.line}|${l.mode}`; if (seen.includes(k)) return false; seen.push(k); return true; })
    .map((l) => ({ line: l.line, mode: l.mode, color: l.color }));
  const plat = f.fromPlatform ? String(f.fromPlatform).replace(/^Plat(?:form)?\.?\s*/i, 'Platform ') : null;
  const walkFirst = f.planned && new Date(j.leave).getTime() < new Date(f.planned).getTime() - 60000;
  const to = shortPlace(card.to?.name);
  const ch = j.changes ? `${j.changes} change${j.changes > 1 ? 's' : ''}` : 'Direct';
  const arrive = `Arrives ${to ? to + ' ' : ''}${clock12(j.arrive)}${DOT}${ch}`;
  const arriveSpoken = `Arrives ${to ? to + ' at ' : 'at '}${clock12(j.arrive)}, ${ch.toLowerCase()}`;
  const status = statusOf(f);
  const outages = journeyOutages(j);
  const ls = liftShort(outages);
  const fl = fareLine(j.fare || msg.fare);
  const extras = lines.slice(1).map((x) => x.trim()).filter((x) => x && !SHOWN_IN_CARD.some((r) => r.test(x)));
  const names = chips.map((c) => c.line).filter(Boolean).join(' then ');
  const spoken = [
    `Next ${names ? names + ' ' : ''}at ${clock12(dep)}, ${u.spoken}${plat ? `, from ${plat}` : ''}.`,
    walkFirst ? `Leave at ${clock12(j.leave)}.` : '',
    `${arriveSpoken}.`,
    `${spokenMin(status.text)}.`,
    ls ? `${ls}.` : '',
    fl ? `${fl.spoken}.` : '',
    ...extras,
  ].filter(Boolean).join(' ');
  return {
    time: clock12(dep), when: u.text, whenSpoken: u.spoken, past: u.past, live: !!f.realtime && !f.cancelled,
    lines: chips, platform: plat, leaveAt: walkFirst ? clock12(j.leave) : null,
    arrive, arriveSpoken, status, outages, liftShort: ls, fare: fl ? fl.text : null, fareSpoken: fl ? fl.spoken : null,
    extras, spoken,
  };
}
