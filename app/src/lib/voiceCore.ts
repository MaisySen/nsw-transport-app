// Voice: which installed voice speaks, and the sentences it says for departures (docs/FEATURES.md, Voice).
// Pure logic with no React Native import, so the tests run it in Node. Everything spoken is built from live data.

export type VoiceInfo = { identifier: string; name: string; quality?: string; language: string };
export type VoiceTier = 'Premium' | 'Enhanced' | 'Default';
export type RankedVoice = VoiceInfo & { tier: VoiceTier; lang: string };

/**
 * The voice's quality. expo-speech reports "Enhanced" or "Default" only (a Premium voice comes back as Default),
 * so the identifier decides too: com.apple.voice.premium.* is Premium, com.apple.voice.enhanced.* is Enhanced.
 */
export function voiceTier(v: Pick<VoiceInfo, 'identifier' | 'quality'>): VoiceTier {
  const id = String(v.identifier || '').toLowerCase();
  if (/\.premium\./.test(id)) return 'Premium';
  if (/\.enhanced\./.test(id) || String(v.quality || '') === 'Enhanced') return 'Enhanced';
  return 'Default';
}

/**
 * Voices that never read an announcement well: Apple's novelty and Eloquence voices (Bubbles, Grandma, Eddy and
 * the like) and Android voices that need the network (those send the words to a server).
 */
export function unfitVoice(v: Pick<VoiceInfo, 'identifier'>): boolean {
  const id = String(v.identifier || '').toLowerCase();
  return /eloquence|speech\.synthesis\.voice|novelty|-network$|#network|network/.test(id);
}

const LANG_RANK = ['en-au', 'en-gb', 'en-us'];
const langOf = (l: string) => String(l || '').replace('_', '-').toLowerCase();
const langScore = (l: string) => { const i = LANG_RANK.indexOf(langOf(l)); return i < 0 ? (/^en-/.test(langOf(l)) ? 3 : 9) : i; };
const tierScore: Record<VoiceTier, number> = { Premium: 0, Enhanced: 1, Default: 2 };

/** English voices, best first: Premium, then Enhanced, then Default; within each, en-AU, then en-GB, then en-US. */
export function rankVoices(list: VoiceInfo[] | null | undefined): RankedVoice[] {
  const seen = new Set<string>();
  return (list || [])
    .filter((v) => v && v.identifier && /^en[-_]/i.test(String(v.language || '')) && !unfitVoice(v) && !seen.has(v.identifier) && (seen.add(v.identifier), true))
    .map((v) => ({ ...v, tier: voiceTier(v), lang: langOf(v.language) }))
    .sort((a, b) => tierScore[a.tier] - tierScore[b.tier] || langScore(a.lang) - langScore(b.lang) || a.name.localeCompare(b.name));
}

/** The voice to speak with: the one picked in Settings when it is still installed, else the best one. */
export function pickVoice(list: VoiceInfo[] | null | undefined, chosen?: string | null): RankedVoice | null {
  const r = rankVoices(list);
  if (chosen) { const c = r.find((v) => v.identifier === chosen); if (c) return c; }
  return r[0] || null;
}

/** True when only the compact (Default) voices are installed, so the natural voice tip is worth showing. */
export function onlyCompact(list: VoiceInfo[] | null | undefined): boolean {
  const r = rankVoices(list);
  return r.length > 0 && r.every((v) => v.tier === 'Default');
}

/** "Lee, Australian, Premium" for the Voice list. */
export function voiceLabel(v: RankedVoice): string {
  const where: Record<string, string> = { 'en-au': 'Australian', 'en-gb': 'British', 'en-us': 'American', 'en-ie': 'Irish', 'en-in': 'Indian', 'en-za': 'South African', 'en-nz': 'New Zealand' };
  return [v.name, where[v.lang] || v.lang, v.tier].join(', ');
}

/** Speech settings: a natural pace (1 is the system's own default rate, 0.5 in AVSpeechSynthesizer terms). */
export function speechPace(os: string): { rate: number; pitch: number } {
  return os === 'ios' ? { rate: 1, pitch: 1 } : { rate: 0.95, pitch: 1 };
}

// ---------- the sentences ----------

export type SayDep = { line?: string | null; mode?: string | null; dest?: string | null; planned?: string | null; estimated?: string | null;
  realtime?: boolean; cancelled?: boolean; delayMin?: number | null; platform?: string | null; departed?: boolean };

const NOUN: Record<string, string> = { train: 'train', metro: 'metro', bus: 'bus', school: 'bus', coach: 'coach', ferry: 'ferry', lightrail: 'light rail' };
const tms = (s?: string | null) => (s ? new Date(s).getTime() : NaN);

/** A destination as it should be heard: no "Station", no suburb after a comma, sign abbreviations spelt out. */
export function sayPlace(n?: string | null): string {
  const words: [RegExp, string][] = [[/\bStn\b/g, 'Station'], [/\bRd\b/g, 'Road'], [/\bSt\b(?!\.)/g, 'Street'], [/\bAve?\b/g, 'Avenue'], [/\bPde\b/g, 'Parade'],
    [/\bHwy\b/g, 'Highway'], [/\bDr\b/g, 'Drive'], [/\bPl\b/g, 'Place'], [/\bCres\b/g, 'Crescent'], [/\bNr\b/g, 'near'], [/\bOpp\b/g, 'opposite']];
  let v = String(n || '').split(',')[0].replace(/ Station$/, '').trim();
  for (const [re, w] of words) v = v.replace(re, w);
  return v;
}

/** "the T1 line", "the 410 bus", "the F1 ferry": a line as an announcer says it (liveCalc.sayLineName says the same). */
function sayLine(d: SayDep): string {
  const line = String(d.line || '').trim();
  const noun = NOUN[String(d.mode || '')] || '';
  if (!line) return noun ? `the ${noun}` : 'the next service';
  if (noun === 'train' || noun === 'metro') return `the ${line} line`;
  return noun ? `the ${line} ${noun}` : `the ${line}`;
}

/** "in 4 minutes", "in 1 minute", "now". Whole minutes, as the countdown shows them. */
export function sayIn(t: number, now: number): string {
  const m = Math.floor((t - now) / 60000);
  if (!Number.isFinite(m) || m <= 0) return 'now';
  if (m >= 60) { const h = Math.floor(m / 60), r = m % 60; return `in ${h} hour${h === 1 ? '' : 's'}${r ? ` ${r} minute${r === 1 ? '' : 's'}` : ''}`; }
  return `in ${m} minute${m === 1 ? '' : 's'}`;
}

/** "platform 1", "stand B". */
export function sayPlatform(p?: string | null): string {
  const v = String(p || '').trim();
  if (!v) return '';
  if (/^(platform|stand|wharf|side)\b/i.test(v)) return v.charAt(0).toLowerCase() + v.slice(1);
  if (/^plat\.?\s*/i.test(v)) return 'platform ' + v.replace(/^plat\.?\s*/i, '');
  return /^\d+[a-z]?$/i.test(v) ? `platform ${v}` : v;
}

/**
 * The next two services in short announcer sentences, from the live board, for example
 * "The T1 line to Emu Plains leaves in 4 minutes, from platform 1. Then the T9 line to Hornsby, in 9 minutes."
 * Services already gone and cancelled ones are left out of the count (a cancelled first one is said as cancelled).
 */
export function departuresSentence(items: SayDep[] | null | undefined, now: number, opts: { stop?: string | null } = {}): string {
  const list = (items || []).filter((d) => !d.departed && Number.isFinite(tms(d.realtime ? d.estimated || d.planned : d.planned)) && tms(d.realtime ? d.estimated || d.planned : d.planned) > now - 30000);
  const at = opts.stop ? ` from ${sayPlace(opts.stop)}` : '';
  if (!list.length) return `No more services${at} right now.`;
  const out: string[] = [];
  const first = list[0];
  if (first.cancelled) out.push(`${cap(sayLine(first))} to ${sayPlace(first.dest)} is cancelled.`);
  const go = list.filter((d) => !d.cancelled).slice(0, 2);
  go.forEach((d, i) => {
    const t = tms(d.realtime ? d.estimated || d.planned : d.planned);
    const plat = sayPlatform(d.platform);
    const late = d.realtime && (d.delayMin || 0) >= 2 ? ` It is running ${d.delayMin} minutes late.` : '';
    if (i === 0) out.push(`${cap(sayLine(d))} to ${sayPlace(d.dest)} leaves ${sayIn(t, now)}${plat ? `, from ${plat}` : ''}.${late}`);
    else out.push(`Then ${sayLine(d)} to ${sayPlace(d.dest)}, ${sayIn(t, now)}.${late}`);
  });
  return out.join(' ');
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The Voice sample: the next service on a board you use, or a plain sample when nothing is loaded. */
export function sampleSentence(items: SayDep[] | null | undefined, now: number, stop?: string | null): string {
  const s = items && items.length ? departuresSentence(items, now) : '';
  return s && !/^No more/.test(s) ? s : `This is how trip guidance will sound${stop ? ` at ${sayPlace(stop)}` : ''}.`;
}

export type SayLeg = { kind?: string; line?: string | null; mode?: string | null; to?: string | null; fromPlatform?: string | null;
  planned?: string | null; estimated?: string | null; realtime?: boolean; cancelled?: boolean; delayMin?: number | null };

/**
 * Speak departures on a trip card: the next two services of the trip, said to where you get off, and where you
 * change on the first one: "The T1 line to Redfern leaves in 4 minutes, from platform 1. Change at Redfern for the
 * T4 line. Then the T1 line to Redfern, in 11 minutes."
 */
export function tripSentence(journeys: { legs: SayLeg[] }[] | null | undefined, now: number): string {
  const rides = (journeys || []).map((j) => (j.legs || []).filter((l) => l.kind !== 'walk' && l.line));
  const deps: SayDep[] = rides.filter((r) => r.length).map((r) => ({ line: r[0].line, mode: r[0].mode, dest: r[0].to, planned: r[0].planned, estimated: r[0].estimated,
    realtime: r[0].realtime, cancelled: r[0].cancelled, delayMin: r[0].delayMin, platform: r[0].fromPlatform }));
  const base = departuresSentence(deps, now);
  const first = rides.find((r) => r.length && !r[0].cancelled);
  if (!first || first.length < 2 || /^No more/.test(base)) return base;
  const n = first[1];
  const lineWord = sayLine({ line: n.line, mode: n.mode });
  const change = ` Change at ${sayPlace(first[0].to)} for ${lineWord}.`;
  const cut = base.indexOf(' Then ');
  return cut < 0 ? base + change : base.slice(0, cut) + change + base.slice(cut);
}
