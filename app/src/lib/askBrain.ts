// Ask, understanding: reads a question the way people type or say it (typos, short forms, no punctuation,
// plain time words, follow ups) and turns it into one clear request. Rule based and pure: no network, no
// timers, no model. Place names come from the station and suburb lists the server already publishes
// (/stations/*.json), so every station, wharf, light rail stop and NSW suburb is known, not a local list.
// The answer itself always comes from live data (/api/ask, /api/trip, /api/departures); nothing here
// makes up a time or a number.

export type Mode = 'train' | 'metro' | 'bus' | 'ferry' | 'lightrail' | 'coach';
export type PlaceRef = { name: string; id?: string; mode?: string; kind: 'station' | 'suburb' | 'saved' | 'raw' | 'here'; how?: string; typed?: string };
export type Intent = 'trip' | 'departures' | 'last' | 'later' | 'earlier' | 'status' | 'trackwork' | 'parking' | 'lift' | 'fare'
  | 'mybus' | 'nearby' | 'clarify' | 'help' | 'thanks';
export type Slots = {
  from?: string; to?: string; stop?: string; via?: string; line?: string; mode?: Mode;
  time?: string; date?: string; day?: string; arriveBy?: boolean; direct?: boolean; acc?: boolean; when?: string;
};
export type Choice = { label: string; q: string };
export type Understood = {
  intent: Intent; slots: Slots; places: { from?: PlaceRef; to?: PlaceRef; stop?: PlaceRef; via?: PlaceRef };
  clarify?: { text: string; choices: Choice[] } | null; then?: Intent; text: string;
};
export type Last = { intent: Intent; slots: Slots; places?: Understood['places']; firstLeave?: string | null; lastLeave?: string | null; at?: number };
export type SavedPlace = { id: string; name: string };
export type Ctx = {
  now: number; gaz?: Gaz | null; last?: Last | null; places?: { home?: SavedPlace; work?: SavedPlace };
  starred?: SavedPlace[]; recentTrips?: { from: SavedPlace; to: SavedPlace; at?: number }[];
  usual?: { from: SavedPlace; to: SavedPlace; line?: string; mode?: string }[]; hasLocation?: boolean;
};

// ---------- Text ----------

/** Lower case, plain letters and digits, single spaces. "St." and "Saint" read alike, as do "Mt" and "Mount". */
export function norm(s: string): string {
  return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/['\u2018\u2019]/g, '').replace(/[^a-z0-9:]+/g, ' ')
    .replace(/\bsaint\b/g, 'st').replace(/\bmount\b/g, 'mt').replace(/\s+/g, ' ').trim();
}
const SUFFIX = /\s+(railway station|train station|metro station|light rail station|light rail stop|light rail|ferry wharf|wharf|station|stn|interchange|bus interchange)$/;
/** A place name without "Station", "Wharf" or "Light Rail": the key it is found by. */
export function base(s: string): string {
  let k = norm(s).replace(/:/g, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 2; i++) k = k.replace(SUFFIX, '').trim();
  return k.replace(/^the\s+/, '');
}

// Word fixes: common slips and short forms for the words around place names. Place names themselves are
// matched against the full station and suburb lists below.
const WORD_FIX: Record<string, string> = {
  trian: 'train', tarin: 'train', trn: 'train', trainn: 'train', traiin: 'train', triain: 'train', trains: 'trains', trians: 'trains', tains: 'trains',
  buss: 'bus', bsu: 'bus', buz: 'bus', busses: 'buses', bues: 'buses', ferrys: 'ferries', fery: 'ferry', ferr: 'ferry', metor: 'metro', mtero: 'metro',
  nxt: 'next', nex: 'next', enxt: 'next', nest: 'next', wen: 'when', wn: 'when', whn: 'when', whens: 'when is', wens: 'when is', whats: 'what is', wats: 'what is', wat: 'what',
  wheres: 'where is', whers: 'where is', wher: 'where', hw: 'how', howz: 'how is', hows: 'how is', frm: 'from', fom: 'from', form: 'from',
  tmrw: 'tomorrow', tmr: 'tomorrow', tmrow: 'tomorrow', tomoz: 'tomorrow', tommorow: 'tomorrow', tomorow: 'tomorrow', tomorrw: 'tomorrow',
  tommorrow: 'tomorrow', '2moro': 'tomorrow', '2morrow': 'tomorrow', '2mrw': 'tomorrow', tmrrw: 'tomorrow', tomorro: 'tomorrow',
  arvo: 'afternoon', tonite: 'tonight', '2nite': 'tonight', '2night': 'tonight', tonigt: 'tonight', rn: 'now', u: 'you', r: 'are', ur: 'your', yr: 'your',
  plz: 'please', pls: 'please', pleas: 'please', thx: 'thanks', ta: 'thanks', cheers: 'thanks', thanx: 'thanks', ty: 'thanks',
  thru: 'through', abt: 'about', arnd: 'around', b4: 'before', bfore: 'before', befor: 'before', aftr: 'after', afta: 'after', afer: 'after',
  mins: 'min', minute: 'min', minutes: 'min', mns: 'min', hr: 'hour', hrs: 'hours', statn: 'station', staion: 'station', staton: 'station',
  wkend: 'weekend', wknd: 'weekend', weeknd: 'weekend', weekned: 'weekend', 'w/e': 'weekend', trackwrk: 'trackwork', trakwork: 'trackwork', trackworks: 'trackwork',
  lates: 'late', lat: 'late', runing: 'running', runnin: 'running', delayd: 'delayed', dealyed: 'delayed', delys: 'delays', dealys: 'delays',
  carpark: 'car park', carparks: 'car parks', parkin: 'parking', parkng: 'parking', lifs: 'lifts', elevator: 'lift', elevators: 'lifts',
  hme: 'home', hom: 'home', wrk: 'work', werk: 'work', ofice: 'office', fastes: 'fastest', quickest: 'fastest', quickist: 'fastest',
  dirctions: 'directions', directons: 'directions', gt: 'get', gonna: 'going to', wanna: 'want to', gotta: 'have to', tryna: 'trying to',
  oclock: '', "o'clock": '', approx: 'around', bout: 'about', til: 'until', till: 'until', fare: 'fare', fares: 'fare', opal: 'opal',
};

/** The question with fillers off, slips fixed and short forms spelt out. */
export function clean(raw: string): string {
  let s = String(raw || '').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d"]/g, ' ').toLowerCase();
  s = s.replace(/(\d)\s*(am|pm)\b/g, '$1$2').replace(/\b(\d{1,2})\.(\d{2})\b/g, '$1:$2');
  s = s.replace(/[?!,;]+/g, ' ').replace(/\.(\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.split(' ').map((w) => (Object.prototype.hasOwnProperty.call(WORD_FIX, w) ? WORD_FIX[w] : w)).filter(Boolean).join(' ');
  // "2" as "to" between two words that are not numbers or times: "central 2 bondi".
  s = s.replace(/([a-z]{3,}) 2 ([a-z]{3,})/g, (m, a, b) => (/^(min|hour|hours|stops|am|pm)$/.test(b) ? m : `${a} to ${b}`));
  s = s.replace(/\b(kings|kingz) x\b/g, 'kings cross').replace(/\bx\b(?= (?:station|stn))/g, 'cross');
  for (let i = 0; i < 3; i++) s = s.replace(/^(hey|hi|hello|ok|okay|so|um|umm|uh|yo|g'?day|oi|please|mate|tab|siri)\s+/, '');
  s = s.replace(/^(can|could|would|will) you (please )?(tell me|show me|find|check|let me know|help me)?\s*/, '')
    .replace(/^(i want to know|i wanna know|do you know|tell me|show me|let me know|quick question|question)\s+/, '')
    .replace(/\s+(please|thanks|thank you|mate|cheers|asap)$/, '').replace(/\s+(please|thanks|mate)$/, '');
  return s.replace(/\s+/g, ' ').trim();
}

// ---------- Places ----------

type Entry = { key: string; name: string; id?: string; mode?: string; kind: 'station' | 'suburb'; rank: number; lat?: number; lon?: number };
/** keys: one entry per name; list: every entry; modes: every mode a stop id is listed under (Wynyard: train and light rail). */
export type Gaz = { keys: Map<string, Entry>; list: Entry[]; modes?: Map<string, string[]> };
const MODES = ['train', 'metro', 'lightrail', 'ferry'];

/** Builds the place index from the published lists: stations [id, name, lat, lon] by mode, suburbs [name, lat, lon]. */
export function buildGaz(src: { train?: any[]; metro?: any[]; lightrail?: any[]; ferry?: any[]; places?: any[] }): Gaz {
  const keys = new Map<string, Entry>();
  const list: Entry[] = [];
  const modes = new Map<string, string[]>();
  const num = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  MODES.forEach((m, rank) => {
    for (const row of Array.isArray((src as any)[m]) ? (src as any)[m] : []) {
      if (!Array.isArray(row) || !row[1]) continue;
      const id = String(row[0]);
      const ms = modes.get(id) || [];
      if (!ms.includes(m)) { ms.push(m); modes.set(id, ms); }
      const e: Entry = { key: base(String(row[1])), name: String(row[1]), id, mode: m, kind: 'station', rank, lat: num(row[2]), lon: num(row[3]) };
      if (!e.key || keys.has(e.key)) continue;
      keys.set(e.key, e); list.push(e);
    }
  });
  for (const row of Array.isArray(src.places) ? src.places : []) {
    const name = Array.isArray(row) ? String(row[0] || '') : '';
    const k = base(name);
    if (!k || keys.has(k)) continue;
    const e: Entry = { key: k, name, kind: 'suburb', rank: 9, lat: num(row[1]), lon: num(row[2]) };
    keys.set(k, e); list.push(e);
  }
  return { keys, list, modes };
}

// Short forms people use for places all over the network. Each points at a name in the lists above.
const PLACE_ALIAS: Record<string, string> = {
  'kings x': 'kings cross', kx: 'kings cross', cq: 'circular quay', 'the quay': 'circular quay', quay: 'circular quay', 'circ quay': 'circular quay',
  parra: 'parramatta', parramatta: 'parramatta', 'bondi j': 'bondi junction', 'bondi jn': 'bondi junction', 'bondi jct': 'bondi junction', 'bj': 'bondi junction',
  chatty: 'chatswood', 'chats': 'chatswood', 'syd olympic park': 'sydney olympic park', domestic: 'domestic airport', 'domestic terminal': 'domestic airport',
  international: 'international airport', 'intl airport': 'international airport', 'international terminal': 'international airport', 'airport domestic': 'domestic airport',
  'airport international': 'international airport', 'macq uni': 'macquarie university', 'mq uni': 'macquarie university', 'macquarie uni': 'macquarie university',
  'sydney uni': 'the university of sydney', usyd: 'the university of sydney', 'newy': 'newcastle', 'gong': 'wollongong', 'the gong': 'wollongong',
  'wollongong uni': 'wollongong', 'mascot station': 'mascot', 'olympic park': 'olympic park', 'town hall': 'town hall', 'martin pl': 'martin place',
  'hurstville stn': 'hurstville', 'penno': 'penrith', 'campbelltown stn': 'campbelltown', 'liverpool stn': 'liverpool',
};
// Words that name several places: ask which one rather than guess. Each choice is a real place in the lists.
const PLACE_AMBIG: Record<string, string[]> = {
  airport: ['International Airport', 'Domestic Airport'], 'the airport': ['International Airport', 'Domestic Airport'], 'sydney airport': ['International Airport', 'Domestic Airport'],
  city: ['Central', 'Town Hall', 'Wynyard'], 'the city': ['Central', 'Town Hall', 'Wynyard'], cbd: ['Central', 'Town Hall', 'Wynyard'], 'the cbd': ['Central', 'Town Hall', 'Wynyard'],
  town: ['Central', 'Town Hall', 'Wynyard'], uni: ['UNSW', 'Sydney Uni', 'Macquarie Uni'], university: ['UNSW', 'Sydney Uni', 'Macquarie Uni'], 'the uni': ['UNSW', 'Sydney Uni', 'Macquarie Uni'],
  beach: ['Bondi Beach', 'Manly', 'Cronulla'], 'the beach': ['Bondi Beach', 'Manly', 'Cronulla'], stadium: ['Olympic Park', 'Moore Park'], 'the stadium': ['Olympic Park', 'Moore Park'],
};
const WORD_ABBR: Record<string, string> = { nth: 'north', sth: 'south', st: 'st', mt: 'mt', pt: 'point', jn: 'junction', jct: 'junction', junc: 'junction', hts: 'heights', pk: 'park', rd: 'road', hosp: 'hospital', ck: 'creek', crk: 'creek', bch: 'beach', hbr: 'harbour', pde: 'parade', hwy: 'highway', sq: 'square', uni: 'university', ctr: 'centre', cntr: 'centre', center: 'centre', shps: 'shops', stn: '', stns: '', wharf: '', plz: 'plaza' };

/** Optimal string alignment distance (a swap of two letters is one edit), stopped above cap. */
export function edits(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  if (a === b) return 0;
  const n = a.length, m = b.length;
  let pp: number[] = [], p: number[] = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const c: number[] = [i];
    let low = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, pp[j - 2] + 1);
      c[j] = v; if (v < low) low = v;
    }
    if (low > cap) return cap + 1;
    pp = p; p = c;
  }
  return p[m];
}

function titleCase(s: string): string {
  return s.replace(/\b([a-z])([a-z']*)/g, (_m, a, b) => a.toUpperCase() + b).replace(/\b(Unsw|Uts|Tafe|Rpa|Scg|Cbd|Nsw|Icc)\b/g, (w) => w.toUpperCase());
}
const capFor = (k: string) => (k.length <= 4 ? 0 : k.length <= 7 ? 1 : k.length <= 12 ? 2 : 3);

export type Match = { place?: PlaceRef; options?: string[] };
/** Finds the place a phrase names: saved places, short forms, the exact name, then the closest spelling. */
export function matchPlace(phrase: string, ctx: Pick<Ctx, 'gaz' | 'places' | 'starred'>): Match {
  const typed = String(phrase || '').trim();
  let k = base(typed);
  if (!k) return {};
  if (/^(here|me|my location|current location|where i am|my place now|this stop|nearby)$/.test(k)) return { place: { name: 'Your location', kind: 'here', typed } };
  for (const w of ['home', 'work'] as const) {
    if (k === w || k === 'my ' + w || (w === 'work' && /^(the )?(office|my office|job)$/.test(k)) || (w === 'home' && k === 'my house')) {
      const p = ctx.places?.[w];
      return { place: p ? { name: p.name, id: p.id, kind: 'saved', how: w, typed } : { name: w, kind: 'saved', how: w, typed } };
    }
  }
  if (PLACE_AMBIG[k]) return { options: PLACE_AMBIG[k] };
  if (PLACE_ALIAS[k]) k = PLACE_ALIAS[k];
  else k = k.split(' ').map((w) => (Object.prototype.hasOwnProperty.call(WORD_ABBR, w) ? WORD_ABBR[w] : w)).filter(Boolean).join(' ');
  if (PLACE_ALIAS[k]) k = PLACE_ALIAS[k];
  for (const s of ctx.starred || []) if (base(s.name) === k) return { place: { name: s.name, id: s.id, kind: 'station', how: 'starred', typed } };
  const g = ctx.gaz;
  const out = (e: Entry, how: string): Match => ({ place: { name: e.name, id: e.id, mode: e.mode, kind: e.kind, how, typed } });
  if (g) {
    const hit = g.keys.get(k);
    if (hit) return out(hit, 'exact');
    // Station names inside a longer phrase: "central station platform 3", "bondi junction interchange".
    const cap = capFor(k);
    let best: Entry[] = [], bd = cap + 1;
    if (k.length >= 4) {
      for (const e of g.list) {
        if (Math.abs(e.key.length - k.length) > cap) continue;
        const d = edits(k, e.key, Math.min(cap, bd));
        if (d < bd) { bd = d; best = [e]; } else if (d === bd && d <= cap) best.push(e);
      }
    }
    if (best.length && bd <= cap) {
      best.sort((a, b) => a.rank - b.rank);
      const stations = best.filter((e) => e.kind === 'station');
      const pick = stations.length ? stations : best;
      const names = [...new Set(pick.map((e) => e.name))];
      if (names.length === 1 || bd === 0) return out(pick[0], 'fuzzy');
      // Two different places one slip away: ask, unless one is a station and the rest suburbs.
      return { options: names.slice(0, 3).map((n) => n.replace(/ Station$/, '')) };
    }
    // The start of a station name: "hornsb", "bondi junc", "parramat".
    if (k.length >= 5) {
      const pre = g.list.filter((e) => e.kind === 'station' && e.key.startsWith(k));
      if (pre.length === 1) return out(pre[0], 'prefix');
    }
  }
  return { place: { name: titleCase(typed.replace(/\s+(stn|station)$/i, '')), kind: 'raw', typed } };
}

// ---------- Lines ----------

const LINE_NAMES: [RegExp, string][] = [
  [/\bnorth shore line\b/, 'T1'], [/\bwestern line\b/, 'T1'], [/\binner west line\b/, 'T2'], [/\bleppington line\b/, 'T2'],
  [/\bliverpool( and)? inner west line\b/, 'T3'], [/\billawarra line\b/, 'T4'], [/\beastern suburbs line\b/, 'T4'], [/\bcumberland line\b/, 'T5'],
  [/\blidcombe( and)? bankstown line\b/, 'T6'], [/\bolympic park line\b/, 'T7'], [/\bairport( and)? south line\b|\bairport line\b/, 'T8'], [/\bnorthern line\b/, 'T9'],
  [/\bblue mountains line\b/, 'BMT'], [/\bcentral coast( and newcastle)? line\b/, 'CCN'], [/\bsouth coast line\b/, 'SCO'],
  [/\bsouthern highlands line\b/, 'SHL'], [/\bhunter line\b/, 'HUN'], [/\b(the )?metro( north west)?( line)?\b/, 'M1'],
  [/\bmanly ferry\b/, 'F1'], [/\btaronga( zoo)? ferry\b/, 'F2'], [/\bparramatta river ferry\b|\brivercat\b/, 'F3'], [/\bpyrmont bay ferry\b/, 'F4'],
  [/\bneutral bay ferry\b/, 'F5'], [/\bmosman( bay)? ferry\b/, 'F6'], [/\bdouble bay ferry\b/, 'F7'], [/\bcockatoo island ferry\b/, 'F8'], [/\bwatsons bay ferry\b/, 'F9'],
  [/\bdulwich hill (light rail|line)\b/, 'L1'], [/\brandwick (light rail )?line\b/, 'L2'], [/\bkingsford (light rail )?line\b/, 'L3'], [/\bparramatta light rail\b|\bwestmead light rail\b/, 'L4'],
];
const LINE_TOKEN = /\b(t[1-9]|m1|l[1-4]|f[1-9]|f10|bmt|ccn|sco|shl|hun|bnt|[bmn]\d{1,3}|\d{3}[a-z]?|\d{2}[a-z]|x\d{2,3})\b/;
/** A line or route named in the text: "t1", "the 333", "north shore line", "manly ferry", "b1". */
export function findLine(t: string): string | null {
  const m = t.match(LINE_TOKEN);
  if (m) {
    const tok = m[1];
    const after = t.slice((m.index || 0) + m[0].length);
    const before = t.slice(0, m.index || 0);
    // Not a time, a count or an address: "830", "20 min", "2 stops", "123 george st".
    if (/^\d+$/.test(tok) && (/^\s*(am|pm|min|hour|hours|stops|people|bucks|dollars|:)/.test(after) || /\b(at|by|after|before|around|about|in)\s*$/.test(before) || /^\s+[a-z]+\s+(st|street|rd|road|ave|avenue|pde|parade|hwy|highway|lane|ln)\b/.test(after))) {
      // fall through to names
    } else return tok.toUpperCase();
  }
  for (const [re, line] of LINE_NAMES) if (re.test(t)) return line;
  return null;
}
const MODE_RE: [RegExp, Mode][] = [[/\b(light rail|tram|trams)\b/, 'lightrail'], [/\b(metro)\b/, 'metro'], [/\b(ferry|ferries|boat|wharf)\b/, 'ferry'],
  [/\b(coach)\b/, 'coach'], [/\b(bus|buses)\b/, 'bus'], [/\b(train|trains|rail)\b/, 'train']];
export function findMode(t: string): Mode | undefined {
  for (const [re, m] of MODE_RE) if (re.test(t)) return m;
  return undefined;
}
const lineMode = (l: string): Mode => (/^(T\d|BMT|CCN|SCO|SHL|HUN|BNT)$/.test(l) ? 'train' : l === 'M1' ? 'metro' : /^L\d$/.test(l) ? 'lightrail' : /^F\d+$/.test(l) ? 'ferry' : 'bus');

// ---------- Time ----------

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const SHORT_DAYS: Record<string, string> = { sun: 'sunday', mon: 'monday', tue: 'tuesday', tues: 'tuesday', wed: 'wednesday', thu: 'thursday', thur: 'thursday', thurs: 'thursday', fri: 'friday', sat: 'saturday' };
type Syd = { y: number; mo: number; d: number; h: number; mi: number; dow: number };
/** Sydney's calendar date and clock for an instant. */
export function sydney(ms: number): Syd {
  const f = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'long' } as any);
  const parts: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(ms))) parts[p.type] = p.value;
  return { y: +parts.year, mo: +parts.month, d: +parts.day, h: +parts.hour % 24, mi: +parts.minute, dow: DAYS.indexOf(String(parts.weekday).toLowerCase()) };
}
const pad = (n: number) => String(n).padStart(2, '0');
function addDays(s: Syd, n: number): string {
  const t = new Date(Date.UTC(s.y, s.mo - 1, s.d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
/** The instant a Sydney date (YYYY-MM-DD) and clock (HH:MM) name. */
export function sydMs(date: string, hhmm: string): number {
  const [y, mo, d] = date.split('-').map(Number); const [h, mi] = hhmm.split(':').map(Number);
  let guess = Date.UTC(y, mo - 1, d, h, mi) - 10 * 3600000;
  for (let i = 0; i < 3; i++) {
    const s = sydney(guess);
    const diff = (Date.UTC(y, mo - 1, d, h, mi) - Date.UTC(s.y, s.mo - 1, s.d, s.h, s.mi));
    if (!diff) break;
    guess += diff;
  }
  return guess;
}
export type When = { rest: string; time?: string; date?: string; day?: string; arriveBy?: boolean; when?: string };
const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty five': 45, fifty: 50 };

/**
 * Time and day words: "after 6", "around 8:30", "by 9am", "in 20 min", "tomorrow morning", "tonight",
 * "this weekend", "on friday", "half past 7". A clock time with no am or pm is the next time that clock
 * reads from now. Gives HH:MM (24 hour), a date (YYYY-MM-DD) when it is not today, and the rest of the text.
 */
export function parseWhen(text: string, now: number): When {
  let s = ' ' + text + ' ';
  const nowS = sydney(now);
  const out: When = { rest: '' };
  let dayOff = 0, daySet = false, part: string | null = null;
  const cut = (re: RegExp) => { s = s.replace(re, ' '); };
  // Relative: "in 20 min", "in an hour", "in half an hour", "in twenty minutes".
  let m = s.match(/\bin (?:about |around )?(\d{1,3}|an?|half an|one|two|three|five|ten|fifteen|twenty|thirty|forty five|forty|fifty) ?(min|hour|hours|h)\b/);
  if (m) {
    const n = m[1] === 'half an' ? 30 : /^an?$/.test(m[1]) ? 1 : NUM_WORDS[m[1]] || Number(m[1]);
    const mins = /^h/.test(m[2]) && m[1] !== 'half an' ? n * 60 : n;
    const t = sydney(now + mins * 60000);
    out.time = `${pad(t.h)}:${pad(t.mi)}`;
    if (t.d !== nowS.d) out.date = `${t.y}-${pad(t.mo)}-${pad(t.d)}`;
    cut(m[0] ? new RegExp(m[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : /$^/);
  }
  // Days.
  if (/\b(tomorrow|tmrw)\b/.test(s)) { dayOff = 1; daySet = true; out.day = 'tomorrow'; cut(/\b(tomorrow|tmrw)\b/); }
  else if (/\b(day after tomorrow)\b/.test(s)) { dayOff = 2; daySet = true; out.day = 'the day after tomorrow'; }
  else if (/\btoday\b/.test(s)) { daySet = true; cut(/\btoday\b/); }
  m = s.match(/\b(?:this |next |on )?(?:the )?(weekend)\b/);
  if (m) {
    const toSat = (6 - nowS.dow + 7) % 7;
    dayOff = nowS.dow === 0 ? 0 : toSat; daySet = true; out.day = nowS.dow === 0 || nowS.dow === 6 ? 'this weekend' : 'Saturday'; out.when = 'weekend';
    if (/next weekend/.test(m[0]) && nowS.dow !== 0) dayOff = toSat + 7;
    cut(/\b(this |next |on )?(the )?weekend\b/);
  }
  m = s.match(/\b(?:(this|next|on|coming)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thu|thurs?|fri|sat)\b/);
  if (m && !out.when) {
    const name = SHORT_DAYS[m[2]] || m[2];
    let off = (DAYS.indexOf(name) - nowS.dow + 7) % 7;
    if (m[1] === 'next' && off === 0) off = 7;
    dayOff = off; daySet = true; out.day = name[0].toUpperCase() + name.slice(1);
    cut(new RegExp(`\\b(?:(?:this|next|on|coming)\\s+)?${m[2]}\\b`));
  }
  // Parts of the day.
  m = s.match(/\b(this |tomorrow )?(morning|afternoon|evening|night|tonight|midday|noon|midnight|lunch ?time|peak hour)\b/);
  if (m) { part = m[2]; cut(/\b(this |in the )?(morning|afternoon|evening|night|tonight|lunch ?time|peak hour)\b/); }
  // Clock times.
  const arriveRe = /\b(arrive|arriving|arrival|get there|be there|get in|be at|be in|reach|land|need to be (?:at|in|there)?)\b/;
  let arriveBy = false;
  const clocks: { h: number; mi: number; ap: string; word: string; idx: number; len: number }[] = [];
  const clockRe = /\b(at|by|after|before|around|about|from|for|until|for about|leave at|leaving at|leaving|depart at|departing)?\s*(?:(half past|quarter past|quarter to)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)|(\d{1,2})(?::(\d{2}))?\s*(am|pm)?|(\d{3,4})(am|pm)|(noon|midday|midnight))(?=\s)/g;
  let cm: RegExpExecArray | null;
  while ((cm = clockRe.exec(s))) {
    const word = cm[1] || '';
    let h: number, mi = 0, ap = '';
    if (cm[2]) { h = NUM_WORDS[cm[3]] || Number(cm[3]); mi = cm[2] === 'half past' ? 30 : cm[2] === 'quarter past' ? 15 : 45; if (cm[2] === 'quarter to') h -= 1; }
    else if (cm[9]) { h = cm[9] === 'midnight' ? 0 : 12; mi = 0; ap = cm[9] === 'midnight' ? 'am' : 'pm'; }
    else if (cm[7]) { const v = cm[7]; h = Number(v.slice(0, v.length - 2)); mi = Number(v.slice(-2)); ap = cm[8]; }
    else {
      h = Number(cm[4]); mi = cm[5] ? Number(cm[5]) : 0; ap = cm[6] || '';
      // A bare number counts as a time only with a time word before it or am/pm after it, and not a route number.
      if (!word && !ap && !cm[5]) continue;
      if (!ap && !cm[5] && /^(from|for)$/.test(word)) continue;
    }
    if (h > 23 || mi > 59) continue;
    clocks.push({ h, mi, ap, word, idx: cm.index, len: cm[0].length });
  }
  if (clocks.length) {
    // "leave at 8 arrive by 9": the arrive time wins (the planner takes one).
    let pick = clocks[0];
    for (const c of clocks) {
      const pre = s.slice(Math.max(0, c.idx - 24), c.idx + 3);
      if (/^(by|before|until)$/.test(c.word) || arriveRe.test(pre)) { pick = c; arriveBy = true; }
    }
    let { h } = pick; const { mi, ap } = pick;
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (!ap) {
      if (part && /evening|night|tonight|afternoon/.test(part) && h < 12) h += 12;
      else if (part === 'morning') { if (h === 12) h = 0; }
      else if (h <= 12 && !daySet) {
        // The next time the clock reads h:mi from now.
        const nowMin = nowS.h * 60 + nowS.mi;
        const am = (h % 12) * 60 + mi, pm = am + 720;
        if (am >= nowMin - 30) h = h % 12; else if (pm >= nowMin - 30) h = (h % 12) + 12; else { h = h % 12; dayOff = 1; out.day = out.day || 'tomorrow'; }
      } else if (h < 7 && h !== 0) h += 12;
    }
    out.time = `${pad(h)}:${pad(mi)}`;
    for (const c of clocks) s = s.slice(0, c.idx) + ' '.repeat(c.len) + s.slice(c.idx + c.len);
  } else if (part && !out.time) {
    const start: Record<string, string> = { morning: '06:00', afternoon: '12:00', 'lunch time': '12:00', lunchtime: '12:00', midday: '12:00', noon: '12:00', evening: '18:00', night: '18:00', tonight: '18:00', midnight: '00:00', 'peak hour': '07:00' };
    const t = start[part.replace(/\s+/g, ' ')] || null;
    // "tonight" and "this evening" after 6 mean from now.
    const nowMin = nowS.h * 60 + nowS.mi;
    if (t && !(dayOff === 0 && Number(t.slice(0, 2)) * 60 <= nowMin && /night|evening|tonight/.test(part))) out.time = t;
    if (part === 'tonight' || part === 'night') out.when = out.when || 'tonight';
  }
  if (arriveBy || (out.time && arriveRe.test(s))) out.arriveBy = arriveBy || /\b(arrive|arriving|get there|be there|be at|need to be)\b/.test(s);
  if (out.arriveBy) cut(/\b(and )?(arrive|arriving|arrival|get there|be there|get in|reach|land)\b( at| in)?/);
  s = s.replace(/\b(leave|leaving|depart|departing)\s*(at)?\s*(?=\s(and|then|to)\b|\s*$)/, ' ');
  if (dayOff) out.date = addDays(nowS, dayOff);
  if (dayOff === 1 && !out.day) out.day = 'tomorrow';
  s = s.replace(/\b(now|right now|asap|straight away|soon)\b/g, ' ');
  out.rest = s.replace(/\s+/g, ' ').trim();
  return out;
}

// ---------- Understanding ----------

const FOLLOW_LATER = /^(and |what about |how about |ok |okay |so )?(the )?(one after( that)?|next one|after that|later( ones?| one| trips?| services?)?|any later( ones?)?|the following one|one later|later than that|anything later|after this one|the one after this|then|and then)$/;
const FOLLOW_EARLIER = /^(and |what about |how about |ok |okay |so )?(the )?(one before( that)?|earlier( ones?| one| trips?| services?)?|any earlier( ones?)?|anything earlier|before that|previous( one)?|the one before this|earlier than that)$/;
const PLACE_STOP = /\b(and|then|again|instead|too|please|now|today|tonight|thanks|for me|mate)\b/g;

function placeQ(s: string): string {
  return String(s || '').replace(/\b(by|on|using|via the|taking|with|take)\s+(the\s+)?(trains?|bus(es)?|metro|ferr(y|ies)|light rail|tram|public transport|coach)\b/g, ' ')
    .replace(/\b(trains?|bus(es)?|metro|ferr(y|ies)|light rail|tram)\s*(only)\b/g, ' ')
    .replace(/\b(no changes?|without (a |any )?changes?|direct( only)?|no transfers?|fastest|quickest)\b/g, ' ')
    .replace(/\b(station|stn)\s+(platform \d+)$/, '').replace(/\bplatform \d+$/, '')
    .replace(/^\s*(at|in|to)\s+/, '').replace(/^\s*(the|a)\s+/, '').replace(/\s+(from here|now|today|tonight|please|pls|asap|again|instead|then|thanks)\s*$/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

type TripSplit = { from?: string; to?: string; via?: string };
function splitTrip(t: string): TripSplit | null {
  let s = ' ' + t + ' ';
  let via: string | undefined;
  const vm = s.match(/\s(?:via|through|changing at|change at|stopping at)\s+(.+?)(?=\s(?:to|from)\s|\s*$)/);
  if (vm) { via = vm[1].trim(); s = s.replace(vm[0], ' '); }
  s = s.replace(/\s+/g, ' ').trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^from (.+?) (?:to|->|>|into|towards) (.+)$/))) return { from: m[1], to: m[2], via };
  if ((m = s.match(/^(?:to|towards) (.+?) from (.+)$/))) return { from: m[2], to: m[1], via };
  if ((m = s.match(/^(.+?) (?:to|->|>|into|towards) (.+)$/))) return { from: m[1], to: m[2], via };
  if ((m = s.match(/^(?:to|towards) (.+)$/))) return { to: m[1], via };
  if ((m = s.match(/^(.+?) from (.+)$/))) return { from: m[2], to: m[1], via };
  if ((m = s.match(/^from (.+)$/))) return { from: m[1], via };
  return null;
}
const strip = (s: string, re: RegExp) => s.replace(re, ' ').replace(/\s+/g, ' ').trim();

/** Reads one question. ctx.last carries the previous answer for follow ups. */
export function understand(raw: string, ctx: Ctx): Understood {
  const text = clean(raw);
  const slots: Slots = {};
  const places: Understood['places'] = {};
  const done = (intent: Intent, extra: Partial<Understood> = {}): Understood => ({ intent, slots, places, text, ...extra });
  if (!text) return done('help');
  if (/^(thanks|thank you|ok thanks|great thanks|awesome|perfect|nice|cool|legend|ok|okay|got it|sweet)$/.test(text)) return done('thanks');
  if (/^(help|hi|hello|hey|menu|what can you do|what do you do|start)$/.test(text)) return done('help');

  const last = ctx.last || null;
  const w = parseWhen(text, ctx.now);
  let t = w.rest;
  const putWhen = () => {
    if (w.time) slots.time = w.time;
    if (w.date) slots.date = w.date;
    if (w.day) slots.day = w.day;
    if (w.arriveBy) slots.arriveBy = true;
    if (w.when) slots.when = w.when;
  };
  const resolve = (role: 'from' | 'to' | 'stop' | 'via', phrase?: string): Match | null => {
    const q = placeQ(phrase || '');
    if (!q) return null;
    const r = matchPlace(q, ctx);
    if (r.place) { places[role] = r.place; (slots as any)[role] = r.place.kind === 'saved' ? r.place.how : r.place.kind === 'here' ? 'here' : r.place.name; }
    return r;
  };
  const askWhich = (role: string, opts: string[], build: (o: string) => string, then: Intent): Understood =>
    done('clarify', { then, clarify: { text: role === 'from' ? 'Which one are you leaving from?' : role === 'stop' ? 'Which stop?' : 'Which one do you mean?', choices: opts.slice(0, 3).map((o) => ({ label: o, q: build(o) })) } });
  // Fares: a saved place, your location or an exact name is used as it is; anything else goes through didYouMean.
  const SURE = new Set(['exact', 'home', 'work', 'starred', 'alias', 'landmark']);
  const fareResolve = (role: 'from' | 'to', q: string): (Match & { dym?: Suggestion[] }) | null => {
    if (!q) return null;
    const m = matchPlace(q, ctx);
    const sure = m.place && (m.place.kind === 'here' || m.place.kind === 'saved' || SURE.has(String(m.place.how)));
    if (sure || !ctx.gaz) { if (m.place) { places[role] = m.place; (slots as any)[role] = m.place.kind === 'saved' ? m.place.how : m.place.kind === 'here' ? 'here' : m.place.name; } return m; }
    const d = didYouMean(q, ctx.gaz);
    if (d.pick) {
      const pl: PlaceRef = { name: d.pick.name, id: d.pick.id, mode: d.pick.modes[0], kind: d.pick.kind, how: d.pick.score === 0 ? 'exact' : 'didyoumean', typed: q };
      places[role] = pl; (slots as any)[role] = pl.name;
      return { place: pl };
    }
    if (d.options.length) return { dym: d.options };
    if (m.place) { places[role] = m.place; (slots as any)[role] = m.place.name; }
    return m;
  };
  const fareWhich = (role: 'from' | 'to', opts: Suggestion[], build: (q: string) => string): Understood =>
    done('clarify', { then: 'fare', clarify: { text: role === 'from' ? 'Leaving from? Did you mean:' : 'Did you mean:', choices: opts.slice(0, 5).map((o) => ({ label: o.label, q: build(o.q) })) } });

  const mode = findMode(t);
  const line = findLine(t);
  if (/\b(no changes?|without (a |any )?changes?|direct( only| trip| train| bus)?|no transfers?|one seat)\b/.test(t)) slots.direct = true;
  if (/\b(step free|wheelchair|accessible|no stairs|with a pram|pram friendly)\b/.test(t) && /\s(to|from)\s/.test(' ' + t + ' ')) slots.acc = true;

  // Follow ups on the last answer.
  if (last) {
    const shift = FOLLOW_LATER.test(t) ? 'later' : FOLLOW_EARLIER.test(t) ? 'earlier' : null;
    if (shift) { Object.assign(slots, last.slots); Object.assign(places, last.places || {}); return done(shift as Intent); }
    const mm = t.match(/^(and |ok |okay |so |or )?(what about|how about|and|or|can i go|can i get there|is there one|what if i go|instead)?\s*(by|on|via|with|take|taking|using)?\s*(the |a )?(train|trains|bus|buses|metro|ferry|ferries|light rail|tram|coach)( instead| only)?$/);
    if (mm && (last.intent === 'trip' || last.intent === 'departures' || last.intent === 'last' || last.intent === 'later' || last.intent === 'earlier')) {
      Object.assign(slots, last.slots); Object.assign(places, last.places || {});
      slots.mode = findMode(mm[5]); delete slots.line;
      return done(last.intent === 'later' || last.intent === 'earlier' ? 'trip' : last.intent);
    }
    const dm = !strip(w.rest, /\b(and|what|about|how|same|for|instead|on|then|ok|okay|so|or|at|the|leaving|leave|from|by|is there one|any)\b/g);
    if (dm && (w.date || w.time || w.day)) {
      Object.assign(slots, last.slots); Object.assign(places, last.places || {});
      delete slots.time; delete slots.date; delete slots.day; delete slots.arriveBy; putWhen();
      return done(last.intent === 'later' || last.intent === 'earlier' ? 'trip' : last.intent);
    }
    if (/^(and )?(the )?(way back|return|going back|back home|and back|coming back|return trip|reverse( it)?|other way( round)?)$/.test(t) && last.slots.from && last.slots.to) {
      Object.assign(slots, last.slots, { from: last.slots.to, to: last.slots.from });
      places.from = last.places?.to; places.to = last.places?.from; delete slots.time; delete slots.date; putWhen();
      return done('trip');
    }
    const fm = t.match(/^(and |then |ok |so )?(from there|from that stop|after that|then|and then)( to| on to| onto)? (.+)$/);
    const prevEnd = last.places?.to || last.places?.stop;
    if (fm && prevEnd && !/^(the )?(one|next one)/.test(fm[4])) {
      places.from = prevEnd; slots.from = prevEnd.kind === 'saved' ? prevEnd.how : prevEnd.name;
      const r = resolve('to', fm[4]);
      if (r && r.options) return askWhich('to', r.options, (o) => `${slots.from} to ${o}`, 'trip');
      if (mode) slots.mode = mode; putWhen();
      return done('trip');
    }
    if (/^(and |ok |so )?(from there|whats next from there|departures from there|what leaves from there|next from there)$/.test(t) && prevEnd) {
      places.stop = prevEnd; slots.stop = prevEnd.kind === 'saved' ? prevEnd.how : prevEnd.name; putWhen();
      return done('departures');
    }
    const pm = t.match(/^(and |ok |so |or )?(what about|how about|and|or|same for|same but|instead) (to )?(.+)$/);
    if (pm && (last.intent === 'trip' || last.intent === 'later' || last.intent === 'earlier' || last.intent === 'fare' || last.intent === 'last') && !/\b(time|times|delays?|late|parking|lift)\b/.test(pm[4])) {
      Object.assign(slots, last.slots); Object.assign(places, last.places || {}); delete slots.time; delete slots.date; delete slots.day;
      const r = resolve('to', pm[4]);
      if (r && r.options) return askWhich('to', r.options, (o) => `${last.slots.from || ''} to ${o}`.trim(), 'trip');
      putWhen();
      return done(last.intent === 'later' || last.intent === 'earlier' ? 'trip' : last.intent);
    }
    if (pm && (last.intent === 'parking' || last.intent === 'lift' || last.intent === 'departures')) {
      const r = resolve('stop', pm[4]);
      if (r && r.options) return askWhich('stop', r.options, (o) => `${last.intent === 'parking' ? 'Parking at' : last.intent === 'lift' ? 'Lifts at' : 'Departures'} ${o}`, last.intent);
      if (last.slots.mode) slots.mode = last.slots.mode;
      return done(last.intent);
    }
  } else if (FOLLOW_LATER.test(t) || FOLLOW_EARLIER.test(t)) {
    return done('clarify', { then: 'later', clarify: { text: 'Which trip? Ask one first, then I can show the one after.', choices: tripChoices(ctx) } });
  }

  // Car parks.
  if (/\b(parking|car ?parks?|commuter car ?park|park (and|n|&) ride|park ?n ?ride|(how many|any|free|empty) (spaces|spots)|spaces left|spots left)\b/.test(t) || /\b(where (can|do|should) i park|can i park|park (at|near|my car|the car))\b/.test(t)) {
    const p = strip(t, /\b(is there|are there|any|how many|how much|free|empty|available|left|spaces?|spots?|commuter|car ?parks?|parking|park (and|n|&) ride|park ?n ?ride|park|lot|full|at|near|in|for|the|station|stn|right now|is it|status|whats|what is|where can i|can i|i)\b/g);
    const r = resolve('stop', p);
    if (r && r.options) return askWhich('stop', r.options, (o) => `Parking at ${o}`, 'parking');
    if (!slots.stop) {
      const c = stopChoices(ctx, 'Parking at');
      return done('clarify', { then: 'parking', clarify: { text: 'Which station?', choices: c } });
    }
    return done('parking');
  }
  // Lifts and step free access at a station.
  if (/\b(lifts?|escalators?|ramps?|step free|wheelchair|accessible|accessibility|stairs|pram)\b/.test(t) && !/\s(to)\s/.test(' ' + t + ' ')) {
    const p = strip(t, /\b(is there|are there|any|a|does|do|have|has|got|working|work|out|of order|broken|down|lifts?|escalators?|ramps?|step free|wheelchair|accessible|accessibility|access|stairs|pram|at|in|on|for|the|station|stn|is|are|it|status|whats|what is|ok|with)\b/g);
    const r = resolve('stop', p);
    if (r && r.options) return askWhich('stop', r.options, (o) => `Lifts at ${o}`, 'lift');
    if (!slots.stop) return done('clarify', { then: 'lift', clarify: { text: 'Which station?', choices: stopChoices(ctx, 'Lifts at') } });
    return done('lift');
  }
  // Fares.
  if (/\b(fare|how much|cost|costs|price|opal|cheapest|cheap)\b/.test(t)) {
    const p = strip(t, /\b(how much|is it|does it cost|would it cost|will it cost|it cost|it|is|be|of|for|the|a|an|to go|to get|to travel|trip|ride|journey|opal|fare|cost|costs|price|cheapest|cheap|adult|child|concession|gold|card|what is|whats|with)\b/g);
    const sp = splitTrip(p) || (p ? { to: p } : null);
    if (sp) {
      // Each name is checked against our own station lists: a slip or a part of a name with two or more close
      // matches gets a short "Did you mean" list, one tap each (didYouMean). Nothing is guessed between close ones.
      const fromQ = sp.from ? placeQ(sp.from) : '', toQ = placeQ(sp.to || '');
      const f = fromQ ? fareResolve('from', fromQ) : null;
      const r = fareResolve('to', toQ);
      const fromWords = (o: string) => (f && f.place ? f.place.name : fromQ);
      if (f && f.dym) return fareWhich('from', f.dym, (o) => `Fare from ${o}${toQ ? ` to ${r && r.place ? r.place.name : toQ}` : ''}`);
      if (r && r.dym) return fareWhich('to', r.dym, (o) => `Fare ${fromQ ? `from ${fromWords(o)} ` : ''}to ${o}`);
      if (r && r.options) return askWhich('to', r.options, (o) => `Fare ${sp.from ? sp.from + ' ' : ''}to ${o}`, 'fare');
    }
    if (!slots.to) return done('clarify', { then: 'fare', clarify: { text: 'Fare for which trip?', choices: tripChoices(ctx).map((c) => ({ label: c.label, q: 'Fare ' + c.q })) } });
    return done('fare');
  }
  // Trackwork and planned changes.
  if (/\b(trackwork|track work|planned work|maintenance|works|replacement bus(es)?|buses replac\w*|rail replacement|closures?|closed|shut)\b/.test(t)) {
    if (line) slots.line = line;
    if (mode && !line) slots.mode = mode;
    putWhen();
    if (/\bweekend\b/.test(text)) slots.when = 'weekend';
    const p = strip(t, /\b(any|is there|are there|trackwork|track work|planned work|maintenance|works|replacement bus(es)?|buses replac\w*|rail replacement|closures?|closed|shut|on|at|for|the|line|this|next|coming|what|whats|is|are|trains?|bus(es)?|metro|ferr(y|ies)|light rail|t[1-9]|m1|l[1-4]|f\d+|bmt|ccn|sco|shl|hun)\b/g);
    if (p && !line) { const r = matchPlace(placeQ(p), ctx); if (r.place && r.place.kind !== 'raw') { places.stop = r.place; slots.stop = r.place.name; } }
    return done('trackwork');
  }
  // Last service.
  const lm = t.match(/\b(last|latest|final)\s+(train|bus|metro|ferry|light rail|tram|service|one|way|ride)?\s*(.*)$/);
  if (lm && !/\b(last (time|week|night|answer))\b/.test(t)) {
    if (lm[2] && lm[2] !== 'service' && lm[2] !== 'one' && lm[2] !== 'way' && lm[2] !== 'ride') slots.mode = findMode(lm[2]);
    if (line) slots.line = line;
    putWhen();
    const rest = strip(lm[3] || '', /\b(tonight|today|leaving|leave|is|at what time|what time|when)\b/g);
    const sp = splitTrip(rest) || (rest ? { to: rest } : {});
    if (sp.from) resolve('from', sp.from);
    const r = resolve('to', sp.to || 'home');
    if (r && r.options) return askWhich('to', r.options, (o) => `Last ${slots.mode || 'train'} to ${o}`, 'last');
    return done('last');
  }
  // "Where is my bus", "when does my bus come", "is my train on time".
  if (/\b(my|our)\s+(bus|train|ferry|metro|tram|light rail|ride|service)\b/.test(t) || /\bwhere(s| is)\s+(the|my)\s+(bus|train)\b/.test(t)) {
    slots.mode = findMode(t) || 'bus';
    if (line) slots.line = line;
    putWhen();
    return done('mybus');
  }
  // Nearby.
  if (/\b(near me|nearby|closest|nearest|around me|close to me|around here)\b/.test(t) && !/\s(to)\s/.test(' ' + t + ' ')) {
    if (mode) slots.mode = mode;
    return done('nearby');
  }
  // Delays and disruption on a line or mode.
  const statusWords = /\b(late|delay|delays|delayed|on time|running|disruptions?|disrupted|problems?|issues?|cancel+ed|cancellations?|status|working|slow|stuck|alerts?|anything wrong|whats wrong|what is wrong|going on|ok)\b/;
  if ((statusWords.test(t) || (line && /^how is\b|\b(going|doing|looking)$/.test(t))) && (line || mode || /\b(line|lines|network|services?)\b/.test(t)) && !/^(when|what time)\b/.test(t)) {
    const sp = splitTrip(strip(t, statusWords));
    if (sp && sp.from && sp.to && !line) {
      // "is the train from parramatta to central late": the trip, live.
      resolve('from', sp.from); resolve('to', sp.to); if (mode) slots.mode = mode; putWhen();
      return done('trip');
    }
    if (line) { slots.line = line; slots.mode = lineMode(line); }
    else if (mode) slots.mode = mode;
    return done('status');
  }

  // Trips.
  let tt = t;
  const travel = /\b(how (do|can|would|should|will) i (get|go|travel|reach)|how to (get|go)|how (long|far)( is it| does it take)?( to get)?|get me|take me|directions|route( to)?|plan (a |my )?(trip|journey|route)|i (need|want|have) to (get|go|be|travel|head)|i (wanna|gotta) (get|go)|i(m| am) (going|heading|travelling|traveling|off)|going|heading|travel(ling)?|get( to)?|fastest way|best way|quickest way|way)\b/.test(tt);
  tt = tt.replace(/^(what is |whats |when is |when |what time is |what time does |show me |find |check )?(the )?(next|first|earliest|fastest|quickest|best|upcoming)?\s*(trains?|bus(es)?|metro|ferr(y|ies)|light rail|tram|service|trip|way|ride|one)?\s*/, (m0) => (/\b(from|to)\b/.test(m0) ? m0 : ' '));
  tt = tt.replace(/\b(how (do|can|would|should|will) i (get|go|travel|reach)|how to (get|go)|how (long|far)( is it| does it take)?( to get)?|get me|take me|show me (how to get|the way)|directions|route|plan (a |my )?(trip|journey|route)|i (need|want|have) to (get|go|be|travel|head)|i (wanna|gotta) (get|go)|i(m| am) (going|heading|travelling|traveling|off)|fastest way|best way|quickest way|the way)\b/g, ' ');
  tt = tt.replace(/\b(leave|leaving|depart|departing|does it|do i|should i|i|me|go|get|is|are|it|leaves?|come|comes|coming|arrive|arrives|on|run|runs|going)\s*$/g, '').replace(/\s+/g, ' ').trim();
  tt = tt.replace(/\b(step free|wheelchair( accessible)?|accessible|no stairs|pram friendly|with a pram)\b/g, ' ').replace(/^\s*(a |an |the )?(trip|journey|route|ride)\s+(?=from |to )/, '').replace(/\s+/g, ' ').trim();
  tt = tt.replace(/^(get|go|travel|head|be)\s+/, '').trim();
  // "leave at 8 arrive by 9 at north sydney": with an arrive time, "at X" is where to.
  const am = w.arriveBy ? tt.match(/^(?:leave |leaving )?(?:at|in) (.+)$/) : null;
  if (am && !/\s(to|from)\s/.test(' ' + am[1] + ' ')) tt = 'to ' + am[1];
  if (line && !(line === 'M1' && !/\bm1\b/.test(t))) {
    // A route at a stop: "when is the next 410 from strathfield", "333 bondi beach", "m52 from parramatta".
    slots.line = line; slots.mode = lineMode(line);
    let p = tt.replace(new RegExp(`\\b${line.toLowerCase()}\\b`), ' ');
    for (const [re, l] of LINE_NAMES) if (l === line) p = p.replace(re, ' ');
    p = strip(p, /\b(the|a|next|bus|buses|train|trains|route|line|service|services|ferry|metro|light rail|is|when|what time|leave|leaves|leaving|depart|departs|does|do|come|coming|due|stop|times?|timetable|departures?)\b/g);
    const sp = splitTrip(p);
    if (sp && sp.to && sp.from) { resolve('from', sp.from); resolve('to', sp.to); putWhen(); return done('trip'); }
    if (sp && sp.to && !sp.from) { const r = resolve('to', sp.to); if (r && r.options) return askWhich('to', r.options, (o) => `${line} to ${o}`, 'trip'); putWhen(); return done('trip'); }
    p = sp && sp.from ? sp.from : p.replace(/^(at|from|in)\s+/, '');
    const r = resolve('stop', p);
    if (r && r.options) return askWhich('stop', r.options, (o) => `${line} from ${o}`, 'departures');
    putWhen();
    return done('departures');
  }
  const sp = splitTrip(tt);
  if (sp && (sp.to || (sp.from && travel))) {
    if (mode) slots.mode = mode;
    putWhen();
    const rf = sp.from ? resolve('from', sp.from) : null;
    const rt = sp.to ? resolve('to', sp.to) : null;
    if (sp.via) resolve('via', sp.via);
    if (rf && rf.options) return askWhich('from', rf.options, (o) => `${o} to ${sp.to || ''}`.trim(), 'trip');
    if (rt && rt.options) return askWhich('to', rt.options, (o) => `${sp.from ? sp.from + ' ' : ''}to ${o}`, 'trip');
    if (slots.to) return done('trip');
  }
  if (sp && sp.from && !sp.to) {
    // "trains from central", "next bus from bondi junction": the board.
    if (mode) slots.mode = mode;
    const r = resolve('stop', sp.from);
    if (r && r.options) return askWhich('stop', r.options, (o) => `Departures ${o}`, 'departures');
    putWhen();
    return done('departures');
  }
  // A place on its own: its board. "central", "departures parramatta", "manly wharf".
  const bare = strip(tt, /\b(departures?|board|times?|timetable|services|next|whats|what is|leaving|at|the|trains?|bus(es)?|metro|ferr(y|ies)|light rail|tram|from|stop|station)\b/g);
  if (bare && !/\b(how|why|who|what|when|where|weather|joke|love|hate)\b/.test(bare)) {
    if (mode) slots.mode = mode;
    const r = matchPlace(placeQ(bare), ctx);
    if (r.options) return askWhich('stop', r.options, (o) => travel ? `To ${o}` : `Departures ${o}`, travel ? 'trip' : 'departures');
    if (r.place && (r.place.kind !== 'raw' || travel)) {
      putWhen();
      if (travel) { places.to = r.place; slots.to = r.place.kind === 'saved' ? r.place.how : r.place.name; return done('trip'); }
      places.stop = r.place; slots.stop = r.place.kind === 'saved' ? r.place.how : r.place.name;
      return done('departures');
    }
  }
  return done('clarify', { then: 'help', clarify: { text: "I didn't catch that. Is it one of these?", choices: tripChoices(ctx) } });
}

function sn(n: string) { return String(n || '').split(',')[0].replace(/ (Station|Light Rail)$/, ''); }
/** Choices from your own trips: recent trips first, then home and work. Never a fixed list. */
export function tripChoices(ctx: Ctx): Choice[] {
  const out: Choice[] = [];
  const add = (label: string, q: string) => { if (out.length < 3 && !out.some((c) => c.q === q)) out.push({ label, q }); };
  for (const r of ctx.recentTrips || []) add(`${sn(r.from.name)} to ${sn(r.to.name)}`, `${sn(r.from.name)} to ${sn(r.to.name)}`);
  for (const u of ctx.usual || []) add(`${sn(u.from.name)} to ${sn(u.to.name)}`, `${sn(u.from.name)} to ${sn(u.to.name)}`);
  if (ctx.places?.home) add('Home', ctx.places.work ? `${sn(ctx.places.work.name)} to ${sn(ctx.places.home.name)}` : `To ${sn(ctx.places.home.name)}`);
  if (ctx.places?.work) add('Work', ctx.places.home ? `${sn(ctx.places.home.name)} to ${sn(ctx.places.work.name)}` : `To ${sn(ctx.places.work.name)}`);
  if (!out.length) { add('Near me', 'Near me'); add('Trackwork this weekend', 'Trackwork this weekend'); }
  return out;
}
function stopChoices(ctx: Ctx, verb: string): Choice[] {
  const out: Choice[] = [];
  const add = (n: string) => { const s = sn(n); if (s && out.length < 3 && !out.some((c) => c.label === s)) out.push({ label: s, q: `${verb} ${s}` }); };
  for (const s of ctx.starred || []) add(s.name);
  for (const r of ctx.recentTrips || []) add(r.from.name);
  if (ctx.places?.home) add(ctx.places.home.name);
  if (ctx.places?.work) add(ctx.places.work.name);
  return out;
}

// ---------- The request ----------

export type Action =
  | { kind: 'ask'; q: string; heard: string; refine?: { date?: string; time?: string; arriveBy?: boolean; modes?: string; direct?: boolean; stop?: string; board?: boolean } | null; extra?: Record<string, string> }
  | { kind: 'clarify'; text: string; choices: Choice[] }
  | { kind: 'say'; text: string; choices?: Choice[] };

/** "6:00pm" for the server's question text. */
export function clockWord(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${pad(m)}${h < 12 ? 'am' : 'pm'}`;
}
function clockSay(hhmm: string): string { return clockWord(hhmm).replace(/(am|pm)$/, ' $1'); }
function addMin(hhmm: string, n: number): string {
  const [h, m] = hhmm.split(':').map(Number); const t = ((h * 60 + m + n) % 1440 + 1440) % 1440;
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
}
/** HH:MM in Sydney for an ISO time. */
export function sydClock(iso: string): string | null {
  const ms = Date.parse(iso); if (!Number.isFinite(ms)) return null;
  const s = sydney(ms); return `${pad(s.h)}:${pad(s.mi)}`;
}
const MODE_WORD: Record<string, string> = { train: 'train', metro: 'metro', bus: 'bus', ferry: 'ferry', lightrail: 'light rail', coach: 'coach' };

/** Turns what was understood into one request: a clear question for /api/ask, plus a refine step for a day or a mode. */
export function toAction(u: Understood, ctx: Ctx): Action {
  if (u.clarify) return { kind: 'clarify', text: u.clarify.text, choices: u.clarify.choices };
  const s = u.slots, p = u.places;
  const name = (ref?: PlaceRef, slot?: string) => {
    if (!ref) return slot || '';
    if (ref.kind === 'saved') return ref.id ? sn(ref.name) : ref.how || '';
    if (ref.kind === 'here') return 'here';
    return ref.kind === 'raw' ? ref.name : sn(ref.name);
  };
  const missingSaved = (ref?: PlaceRef) => !!ref && ref.kind === 'saved' && !ref.id;
  const when = () => (s.time ? (s.arriveBy ? ` arrive by ${clockWord(s.time)}` : ` at ${clockWord(s.time)}`) : '');
  const heardWhen = () => [s.day && s.day !== 'today' ? s.day : '', s.time ? (s.arriveBy ? `arrive by ${clockSay(s.time)}` : `from ${clockSay(s.time)}`) : ''].filter(Boolean).join(', ');
  const modeW = s.mode ? MODE_WORD[s.mode] : '';
  const notToday = !!s.date;
  switch (u.intent) {
    case 'help': return { kind: 'say', text: 'Ask about a trip, a stop, a line or a station. Say it any way you like.', choices: tripChoices(ctx) };
    case 'thanks': return { kind: 'say', text: 'Any time.' };
    case 'later': case 'earlier':
      if (!s.to && s.stop) return toAction({ ...u, intent: 'departures', then: u.intent }, ctx);
    // falls through
    case 'trip': case 'fare': {
      for (const r of [p.from, p.to]) if (missingSaved(r)) return { kind: 'say', text: `Set your ${r!.how} place first in Settings, or type the station.`, choices: tripChoices(ctx) };
      let from = name(p.from, s.from), to = name(p.to, s.to);
      if (!to) return { kind: 'clarify', text: 'Where to?', choices: tripChoices(ctx) };
      if (!from || from === 'here') {
        if (!ctx.hasLocation) {
          const ch: Choice[] = [];
          if (ctx.places?.home && sn(ctx.places.home.name) !== to) ch.push({ label: 'From home', q: `${sn(ctx.places.home.name)} to ${to}` });
          if (ctx.places?.work && sn(ctx.places.work.name) !== to) ch.push({ label: 'From work', q: `${sn(ctx.places.work.name)} to ${to}` });
          for (const r of ctx.recentTrips || []) if (ch.length < 2 && sn(r.from.name) !== to && !ch.some((c) => c.q.startsWith(sn(r.from.name) + ' to'))) ch.push({ label: `From ${sn(r.from.name)}`, q: `${sn(r.from.name)} to ${to}` });
          return { kind: 'clarify', text: `Where are you leaving from?`, choices: [{ label: 'Use my location', q: '\u0000location' }, ...ch].slice(0, 3) };
        }
        from = '';
      }
      let time = s.time;
      // "The one after": the service after the first one shown, so each tap moves on by one.
      if (u.intent === 'later' && ctx.last?.firstLeave) { const c = sydClock(ctx.last.firstLeave); if (c) time = addMin(c, 1); }
      if (u.intent === 'earlier' && ctx.last?.firstLeave) { const c = sydClock(ctx.last.firstLeave); if (c) time = addMin(c, -60); }
      const arriveBy = u.intent === 'trip' || u.intent === 'fare' ? !!s.arriveBy : false;
      const tw = time ? (arriveBy ? ` arrive by ${clockWord(time)}` : ` at ${clockWord(time)}`) : '';
      const core = `${from ? from + ' to ' : 'to '}${to}${p.via ? ' via ' + name(p.via, s.via) : ''}${modeW && !notToday ? ' by ' + modeW : ''}${notToday ? '' : tw}`;
      // A fare comes with the trip answer (an Opal estimate from live data); the screen leads with it.
      const q = core;
      const heard = [`${u.intent === 'fare' ? 'Fare, ' : ''}${from ? from + ' to ' : u.intent === 'fare' ? 'to ' : 'To '}${to}`, modeW ? 'by ' + modeW : '', s.direct ? 'no changes' : '',
        u.intent === 'later' ? (time ? `after ${clockSay(time)}` : 'later') : u.intent === 'earlier' ? 'earlier' : heardWhen()].filter(Boolean).join(', ');
      const refine = notToday || s.direct ? { date: s.date, time, arriveBy, modes: s.mode === 'lightrail' ? 'lightrail' : s.mode, direct: s.direct } : null;
      return { kind: 'ask', q, heard, refine, extra: s.acc ? { acc: '1' } : undefined };
    }
    case 'departures': {
      if (missingSaved(p.stop)) return { kind: 'say', text: `Set your ${p.stop!.how} place first in Settings, or type the station.`, choices: tripChoices(ctx) };
      const stop = name(p.stop, s.stop);
      if (!stop || stop === 'here') return ctx.hasLocation ? { kind: 'ask', q: 'Near me', heard: 'Stops near you' } : { kind: 'clarify', text: 'Which stop?', choices: [{ label: 'Use my location', q: '\u0000location' }, ...stopChoices(ctx, 'Departures')].slice(0, 3) };
      const q = s.line ? `${s.line} at ${stop}` : `${modeW ? 'next ' + modeW + ' from ' : 'Departures '}${stop}`;
      if (u.then === 'later' || u.then === 'earlier') {
        // A board follow up: the same stop from just after (or an hour before) the first service shown.
        const c = ctx.last?.firstLeave ? sydClock(ctx.last.firstLeave) : null;
        const t2 = c ? addMin(c, u.then === 'later' ? 1 : -60) : undefined;
        return { kind: 'ask', q, heard: [`${s.line ? s.line + ' at ' + stop : 'Departures from ' + stop}`, t2 ? `from ${clockSay(t2)}` : ''].filter(Boolean).join(', '), refine: t2 ? { time: t2, date: s.date, board: true, stop: p.stop?.id } : null };
      }
      const heard = [s.line ? `${s.line} at ${stop}` : `${modeW ? modeW[0].toUpperCase() + modeW.slice(1) + 's' : 'Departures'} from ${stop}`.replace('Buss', 'Buses').replace('Ferrys', 'Ferries'), heardWhen()].filter(Boolean).join(', ');
      return { kind: 'ask', q, heard, refine: s.time || s.date ? { time: s.time, date: s.date, board: true, stop: p.stop?.id } : null };
    }
    case 'last': {
      if (missingSaved(p.to)) return { kind: 'say', text: 'Set your home place first in Settings, then ask again.', choices: [] };
      const to = p.to?.kind === 'saved' ? 'home' : name(p.to, s.to) || 'home';
      let from = p.from ? name(p.from, s.from) : '';
      const what = `Last ${modeW || (s.line ? '' : 'train')}${s.line ? s.line : ''}`;
      if ((!from || from === 'here') && !ctx.hasLocation) {
        // No start and no location: from work when the way home is asked, else one short question.
        const home = ctx.places?.home ? sn(ctx.places.home.name) : '';
        if (to === 'home' && ctx.places?.work) from = sn(ctx.places.work.name);
        else {
          const ch: Choice[] = [{ label: 'Use my location', q: '\u0000location' }];
          if (ctx.places?.work && to !== sn(ctx.places.work.name)) ch.push({ label: 'From work', q: `${what} from ${sn(ctx.places.work.name)} to ${to}` });
          if (ctx.places?.home && to !== 'home' && to !== home) ch.push({ label: 'From home', q: `${what} from ${home} to ${to}` });
          for (const r of ctx.recentTrips || []) if (ch.length < 3 && sn(r.from.name) !== to && !ch.some((c) => c.q.includes(`from ${sn(r.from.name)} to`))) ch.push({ label: `From ${sn(r.from.name)}`, q: `${what} from ${sn(r.from.name)} to ${to}` });
          return { kind: 'clarify', text: 'Where are you leaving from?', choices: ch.slice(0, 3) };
        }
      }
      if (from === 'here') from = '';
      return { kind: 'ask', q: `${what}${from ? ' from ' + from : ''} to ${to}`.replace(/\s+/g, ' '), heard: `Last ${modeW || 'service'}${from ? ' from ' + from : ''} to ${to === 'home' && ctx.places?.home ? sn(ctx.places.home.name) : to}` };
    }
    case 'status': {
      if (s.line) return { kind: 'ask', q: `Is the ${s.line} late`, heard: `How the ${s.line} is running` };
      return { kind: 'ask', q: `alerts ${modeW ? modeW + 's' : ''}`.trim().replace('buss', 'buses').replace('ferrys', 'ferries'), heard: modeW ? `Delays on ${modeW === 'bus' ? 'buses' : modeW === 'ferry' ? 'ferries' : modeW + 's'}` : 'Delays right now' };
    }
    case 'trackwork': {
      const what = s.line || (s.stop ? sn(s.stop) : modeW ? (modeW === 'bus' ? 'buses' : modeW === 'ferry' ? 'ferries' : modeW + 's') : '');
      return { kind: 'ask', q: `trackwork ${what}`.trim(), heard: ['Trackwork', what ? 'on ' + what : '', s.when === 'weekend' ? 'this weekend' : s.day ? s.day : ''].filter(Boolean).join(' ') };
    }
    case 'parking': return { kind: 'ask', q: `Parking at ${name(p.stop, s.stop)}`, heard: `Car parks at ${name(p.stop, s.stop)}` };
    case 'lift': return { kind: 'ask', q: `Lifts at ${name(p.stop, s.stop)}`, heard: `Lifts at ${name(p.stop, s.stop)}` };
    case 'nearby': return ctx.hasLocation ? { kind: 'ask', q: 'Near me', heard: 'Stops near you' } : { kind: 'clarify', text: 'I need your location for that.', choices: [{ label: 'Use my location', q: '\u0000location' }] };
    case 'mybus': {
      const want = s.mode || 'bus';
      const u2 = (ctx.usual || []).find((x) => !x.mode || x.mode === want || (want === 'bus' && x.mode === 'coach')) || null;
      if (u2) return { kind: 'ask', q: `${u2.line ? u2.line + ' at ' : 'next ' + MODE_WORD[want] + ' from '}${sn(u2.from.name)}`, heard: `Your ${u2.line || MODE_WORD[want]} from ${sn(u2.from.name)}` };
      const ch = stopChoices(ctx, `Next ${MODE_WORD[want]} from`);
      if (ch.length === 1) return { kind: 'ask', q: ch[0].q, heard: `Next ${MODE_WORD[want]} from ${ch[0].label}` };
      return { kind: 'clarify', text: `Which stop is your ${MODE_WORD[want]} from?`, choices: [...ch, ...(ch.length < 3 ? [{ label: 'Use my location', q: '\u0000location' }] : [])].slice(0, 3) };
    }
    default: return { kind: 'clarify', text: "I didn't catch that. Is it one of these?", choices: tripChoices(ctx) };
  }
}

/** What the next question can follow up on: this one's slots plus the first and last times shown. */
export function nextLast(u: Understood, shown: { firstLeave?: string | null; lastLeave?: string | null } = {}, now = Date.now()): Last | null {
  if (u.intent === 'clarify' || u.intent === 'help' || u.intent === 'thanks') return null;
  return { intent: u.intent, slots: u.slots, places: u.places, firstLeave: shown.firstLeave || null, lastLeave: shown.lastLeave || null, at: now };
}
/** A follow up only follows an answer from the last 30 minutes. */
export const lastFresh = (l: Last | null | undefined, now: number) => !!l && typeof l.at === 'number' && now - l.at < 30 * 60000;

/** Chips under the box: your usual trips and recent trips, then home. Nothing fixed or "popular". */
export function chipsFor(ctx: Ctx, nowHour: number): string[] {
  const out: string[] = [];
  const add = (q: string) => { if (q && out.length < 4 && !out.includes(q)) out.push(q); };
  const home = ctx.places?.home, work = ctx.places?.work;
  // Mornings lead with the trip to work, evenings with the way home.
  if (home && work) add(nowHour < 12 ? `${sn(home.name)} to ${sn(work.name)}` : `${sn(work.name)} to ${sn(home.name)}`);
  for (const u of ctx.usual || []) add(u.line ? `${u.line} from ${sn(u.from.name)}` : `${sn(u.from.name)} to ${sn(u.to.name)}`);
  for (const r of ctx.recentTrips || []) add(`${sn(r.from.name)} to ${sn(r.to.name)}`);
  if (home && nowHour >= 17) add('Last train home');
  for (const s of ctx.starred || []) add(`Departures ${sn(s.name)}`);
  return out;
}

// ---------- Did you mean (fares) ----------

export type Suggestion = { name: string; id?: string; kind: 'station' | 'suburb'; modes: string[]; label: string; q: string; score: number };
export type DidYouMean = { pick?: Suggestion; options: Suggestion[] };
const DYM_MODE: Record<string, string> = { train: 'Train', metro: 'Metro', lightrail: 'Light rail', ferry: 'Ferry' };
/** How close a "did you mean" choice must be to the best one to be offered beside it. */
export const DYM_CLOSE = 1;
const dymShort = (n: string) => n.replace(/ (Station|Light Rail|Wharf)$/, '');
const kmBetween = (a: Entry, b: Entry) => {
  if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) return Infinity;
  const r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6371;
};

/**
 * The real stops a typed name may mean, from our own station and suburb lists (works offline once the lists are
 * kept). Rule based: the exact name, the start of a name, a word in a name, then spelling slips (two letters swapped
 * count as one). `pick` only when one place is clearly meant: an exact name, or one candidate with nothing else close.
 * Otherwise up to 5 `options`, best first, each a real station with its modes ("Kings Cross, Train"). A suburb with no
 * station of its name offers its nearest stations and the suburb itself. Nothing is made up: no match, no options.
 */
export function didYouMean(phrase: string, gaz: Gaz | null | undefined, max = 5): DidYouMean {
  const typed = String(phrase || '').trim();
  if (!gaz || !typed) return { options: [] };
  const wantSuburb = /\s+suburb$/i.test(typed);
  let k = base(typed.replace(/\s+suburb$/i, ''));
  if (PLACE_ALIAS[k]) k = PLACE_ALIAS[k];
  else k = k.split(' ').map((w) => (Object.prototype.hasOwnProperty.call(WORD_ABBR, w) ? WORD_ABBR[w] : w)).filter(Boolean).join(' ');
  if (!k) return { options: [] };
  const modesOf = (e: Entry) => (e.id && gaz.modes?.get(e.id)) || (e.mode ? [e.mode] : []);
  const make = (e: Entry, score: number, note = ''): Suggestion => {
    const ms = e.kind === 'station' ? modesOf(e) : [];
    const what = e.kind === 'station' ? ms.map((m) => DYM_MODE[m] || m).join(', ') : 'any stop';
    return { name: e.name, id: e.id, kind: e.kind, modes: ms, label: `${dymShort(e.name)}, ${what}${note}`, q: e.kind === 'suburb' ? `${e.name} suburb` : e.name, score };
  };
  const exact = gaz.list.filter((e) => e.key === k);
  if (wantSuburb) { const sb = exact.find((e) => e.kind === 'suburb') || gaz.list.find((e) => e.kind === 'suburb' && e.key === k); if (sb) return { pick: make(sb, 0), options: [] }; }
  const exactStation = exact.find((e) => e.kind === 'station');
  if (exactStation) return { pick: make(exactStation, 0), options: [] };
  // A suburb with no station of its name: its nearest stations, then the suburb itself (any stop in it).
  const nearOf = (sb: Entry): DidYouMean => {
    const near = gaz.list.filter((e) => e.kind === 'station').map((e) => ({ e, d: kmBetween(sb, e) })).filter((x) => Number.isFinite(x.d) && x.d <= 6)
      .sort((a, b) => a.d - b.d).slice(0, Math.max(0, max - 1));
    const options = near.map((x) => make(x.e, 1 + x.d / 10, `, ${x.d < 1 ? 'under 1' : Math.round(x.d)} km from ${sb.name}`));
    options.push(make(sb, 2));
    return { options };
  };
  const exactSuburb = exact.find((e) => e.kind === 'suburb');
  if (exactSuburb) return nearOf(exactSuburb);
  const cap = k.length <= 3 ? 0 : k.length <= 6 ? 1 : k.length <= 11 ? 2 : 3;
  const words = k.split(' ');
  const scored: Suggestion[] = [];
  for (const e of gaz.list) {
    let sc = Infinity;
    if (k.length >= 3 && e.key.startsWith(k + ' ')) sc = 0.9 + (e.key.length - k.length) / 100;
    else if (k.length >= 3 && e.key.startsWith(k)) sc = 1 + (e.key.length - k.length) / 100;
    else if (k.length >= 4 && words.every((w) => e.key.split(' ').some((t) => t.startsWith(w)))) sc = 1.5 + (e.key.length - k.length) / 100;
    if (cap && Math.abs(e.key.length - k.length) <= cap) {
      const d = edits(k, e.key, cap);
      if (d <= cap) sc = Math.min(sc, 1 + d + (e.key[0] === k[0] ? 0 : 0.5));
    }
    // A slip inside a longer name: "strathfeild station platform 1" still finds Strathfield.
    if (!Number.isFinite(sc) && cap && e.key.length >= 5 && e.key.length < k.length) {
      const head = k.slice(0, e.key.length);
      const d = edits(head, e.key, Math.min(cap, 2));
      if (d <= Math.min(cap, 2) && k[e.key.length] === ' ') sc = 2 + d;
    }
    if (Number.isFinite(sc)) scored.push(make(e, sc + (e.kind === 'suburb' ? 0.6 : e.rank * 0.05)));
  }
  scored.sort((a, b) => a.score - b.score || a.name.length - b.name.length);
  // One place per name: a station beats a suburb of the same name.
  const seen = new Set<string>();
  const uniq = scored.filter((x) => { const n = base(x.name); if (seen.has(n)) return false; seen.add(n); return true; });
  if (!uniq.length) return { options: [] };
  const best = uniq[0];
  const close = uniq.filter((x) => x.score - best.score <= DYM_CLOSE);
  // Exactly one candidate near the top, and a station: that is the one meant (a slip like "strathfeild").
  if (close.length === 1 && best.kind === 'station' && best.score < 3.2) return { pick: best, options: [] };
  // Only a suburb is close ("kings langly"): that suburb's nearest stations.
  if (close.length === 1 && best.kind === 'suburb') { const sb = gaz.list.find((e) => e.kind === 'suburb' && e.name === best.name); if (sb) return nearOf(sb); }
  return { options: uniq.filter((x) => x.score - best.score <= DYM_CLOSE + 1).slice(0, max) };
}
