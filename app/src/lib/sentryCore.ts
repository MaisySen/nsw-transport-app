// Pure parts of Sentry crash reporting (sentry.native.ts), kept apart so they can be tested without a phone.
//
// Build 209 (1 Nov) is the first build with the Sentry native module (RNSentry). Builds 201 to 208 run the same
// JavaScript over the air without it, so sentry.native.ts looks the module up first and does nothing when it is
// missing; those builds keep the crash reports to the server's feedback inbox (crash.ts). docs/SENTRY.md.
//
// What may leave the phone: the error, its stack, the app version, build and update, the OS and phone model.
// Never: stop, station, route or place names, positions, search text, query values, install or profile IDs, the
// phone's own name, the IP address (sendDefaultPii false, and IP storage is off in the Sentry project), screenshots,
// the view tree, session replay, profiling or traces.

/** One event or breadcrumb, as loose as the SDK's own types allow; only the fields read here are named. */
export type Loose = Record<string, any>;

const MAX_DEPTH = 6;
const MAX_TEXT = 4000;

/**
 * Takes the parts of a line of text that can say where someone is or where they go: query values, coordinates,
 * stop and route IDs, screen paths with an ID, quoted names and place words. Code words and error text stay.
 */
export function scrubText(input: unknown): string {
  let s = typeof input === 'string' ? input : String(input ?? '');
  if (s.length > MAX_TEXT) s = s.slice(0, MAX_TEXT);
  return s
    // Query strings: keep the names, drop every value (?from=200060&to=x becomes ?from=&to=).
    .replace(/([?&;][\w.\-\[\]]+)=([^&#\s'"]*)/g, '$1=')
    // Trip Planner points and plain coordinate pairs (lon:lat:EPSG:4326, -33.87,151.21, 151.2 -33.8).
    .replace(/-?\d{1,3}\.\d{2,}\s*[:,\s]\s*-?\d{1,3}\.\d{2,}(:EPSG:\d+)?/g, '<pos>')
    .replace(/-?\d{1,3}\.\d{3,}/g, '<num>')
    // Screen and API paths with an ID or a name in them (/stop/200060, /watch/abc123, /profile/x).
    .replace(/\/(stop|stops|trip|trips|watch|profile|shared|route|routes|service|board|carpark|parking|plan|open|s|t)\/[^/\s?#'")]+/gi, '/$1/<id>')
    // Long numbers: stop IDs (6 or 7 digits), trip and run IDs. Line numbers in a stack stay (they follow a colon).
    .replace(/(^|[^:\w.])\d{4,}(?![\w.])/g, '$1<id>')
    // Quoted words in a message can be a stop or place name ("Central Station"); code in quotes keeps its shape.
    .replace(/(["“])([^"”\n]{1,120})(["”])/g, (_m, a, body, b) => a + quotedScrub(body) + b)
    // The same for single quotes that open after a space or a bracket (an apostrophe in "can't" is left alone).
    .replace(/(^|[^\w])'([^'\n]{1,120})'(?!\w)/g, (_m, pre, body) => pre + "'" + quotedScrub(body) + "'")
    // Words that come before a place name in an error or a log line.
    .replace(/(?<![?&;=\w/])\b(stop|station|wharf|platform|stand|route|line|street|st|road|rd|avenue|ave|from|to|near|towards|via|place|suburb|address|location|name)\s*[:=]\s*[^,;)\]}\n]+/gi, '$1: <text>');
}

/** A quoted part stays when it reads as code (an identifier or a property path), else it becomes <text>. */
function quotedScrub(body: string): string {
  return /^[\w$.\[\]()]+$/.test(body) && !/\s/.test(body) && !/^[A-Z][a-z]+$/.test(body) ? body : '<text>';
}

function scrubDeep(v: unknown, depth: number): unknown {
  if (typeof v === 'string') return scrubText(v);
  if (v == null || typeof v !== 'object') return v;
  if (depth >= MAX_DEPTH) return '[deep]';
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => scrubDeep(x, depth + 1));
  const out: Loose = {};
  for (const [k, x] of Object.entries(v as Loose)) {
    if (DROP_KEYS.test(k)) continue;
    out[k] = scrubDeep(x, depth + 1);
  }
  return out;
}

/** Keys that never leave the phone, whatever they hold (any key with one of these words in it). */
const DROP_KEYS = /install|device_?id|profile|push|token|user|e_?mail|^ip$|ip_?address|geo|^lat|latitude|^lon|^lng|longitude|position|coord|location|address|place|stop|station|route|^from$|^to$|query|^q$|search|name|timezone/i;

/** Breadcrumb kinds that carry screen text, addresses or console lines; they are dropped, not cleaned. */
const DROP_CRUMBS = /^(ui\.|touch|console|navigation|xhr|fetch|http|sentry\.transaction|device\.orientation|app\.lifecycle)/;

/** Cleans one breadcrumb, or returns null to drop it. */
export function scrubBreadcrumb<T extends Loose | null | undefined>(b: T): T | null {
  if (!b || typeof b !== 'object') return null;
  const cat = String(b.category || '');
  if (DROP_CRUMBS.test(cat) || b.type === 'navigation' || b.type === 'http' || b.type === 'user') return null;
  const out: Loose = { ...b };
  if (out.message != null) out.message = scrubText(out.message);
  if (out.data) out.data = scrubDeep(out.data, 1);
  return out as T;
}

/**
 * Cleans an event before it is sent (beforeSend). Returns null when reports are switched off.
 * Keeps: exception type, value (cleaned), stack frames, release, dist, environment, OS, model, app and update tags.
 */
export function scrubEvent<T extends Loose | null | undefined>(e: T, on = true): T | null {
  if (!e || typeof e !== 'object' || !on) return null;
  const ev: Loose = { ...e };
  delete ev.user;
  delete ev.request;
  delete ev.server_name;
  delete ev.geo;
  if (typeof ev.message === 'string') ev.message = scrubText(ev.message);
  else if (ev.message && typeof ev.message === 'object') ev.message = scrubDeep(ev.message, 1);
  if (ev.logentry) ev.logentry = scrubDeep(ev.logentry, 1);
  if (typeof ev.transaction === 'string') ev.transaction = scrubText(ev.transaction);
  if (ev.exception && Array.isArray(ev.exception.values)) {
    ev.exception = {
      ...ev.exception,
      values: ev.exception.values.map((x: Loose) => {
        const y: Loose = { ...x };
        if (y.value != null) y.value = scrubText(y.value);
        if (y.stacktrace && Array.isArray(y.stacktrace.frames)) {
          y.stacktrace = { ...y.stacktrace, frames: y.stacktrace.frames.map(scrubFrame) };
        }
        return y;
      }),
    };
  }
  if (ev.threads && Array.isArray(ev.threads.values)) {
    ev.threads = { ...ev.threads, values: ev.threads.values.map((t: Loose) => ({ ...t, name: t.name != null ? scrubText(t.name) : t.name, stacktrace: t.stacktrace && Array.isArray(t.stacktrace.frames) ? { ...t.stacktrace, frames: t.stacktrace.frames.map(scrubFrame) } : t.stacktrace })) };
  }
  if (Array.isArray(ev.breadcrumbs)) ev.breadcrumbs = ev.breadcrumbs.map((b: Loose) => scrubBreadcrumb(b)).filter(Boolean);
  if (ev.contexts && typeof ev.contexts === 'object') {
    const c: Loose = { ...ev.contexts };
    if (c.device) { const d: Loose = { ...c.device }; delete d.name; delete d.timezone; delete d.id; delete d.device_unique_identifier; c.device = d; }
    if (c.app) { const a: Loose = { ...c.app }; delete a.device_app_hash; c.app = a; }
    delete c.culture;
    delete c.geo;
    delete c.user;
    // Anything else the SDK or the app put in contexts is cleaned like the rest.
    for (const k of Object.keys(c)) if (!['device', 'os', 'app', 'runtime', 'react_native_context'].includes(k)) c[k] = scrubDeep(c[k], 1);
    ev.contexts = c;
  }
  if (ev.extra) ev.extra = scrubDeep(ev.extra, 1);
  if (ev.tags) ev.tags = scrubDeep(ev.tags, 1);
  return ev as T;
}

function scrubFrame(f: Loose): Loose {
  const g: Loose = { ...f };
  // A frame can carry local values (vars) on some native crashes; never send them.
  delete g.vars;
  if (typeof g.abs_path === 'string') g.abs_path = g.abs_path.split('?')[0];
  if (typeof g.filename === 'string') g.filename = g.filename.split('?')[0];
  return g;
}

/** release = bundle id @ version + build, dist = build, as Sentry names them; null parts fall back to "unknown". */
export function releaseFor(bundleId: string | null | undefined, version: string | null | undefined, build: string | null | undefined): { release: string; dist: string } {
  const b = String(build || 'unknown');
  return { release: `${bundleId || 'com.maisysen.nswtransport'}@${version || 'unknown'}+${b}`, dist: b };
}

/** True when the phone's build has the Sentry native module. Never throws; never uses the lookup that throws. */
export function hasNativeSentry(lookups: { turbo?: (name: string) => unknown; legacy?: Loose | null }): boolean {
  try {
    if (lookups.turbo) { const m = lookups.turbo('RNSentry'); if (m) return true; }
  } catch { /* a lookup that fails means no module */ }
  try {
    if (lookups.legacy && lookups.legacy.RNSentry) return true;
  } catch {}
  return false;
}

/** At most this many events leave one run of the app (battery, data, and the free plan's monthly events). */
export const MAX_EVENTS_PER_RUN = 10;

/** A DSN looks like https://key@host/project; anything else turns reports off instead of failing. */
export function validDsn(dsn: unknown): string | null {
  return typeof dsn === 'string' && /^https:\/\/[0-9a-f]{16,}@[\w.\-]+\/\d+$/.test(dsn.trim()) ? dsn.trim() : null;
}

/**
 * The init options, battery and privacy first. Only errors and crashes: no sessions, traces, profiling, replay,
 * screenshots, view tree, failed request capture, app hang or frame tracking, and no native network breadcrumbs.
 */
export function sentryOptions(p: { dsn: string; release: string; dist: string; environment: string }): Loose {
  return {
    dsn: p.dsn,
    release: p.release,
    dist: p.dist,
    environment: p.environment,
    debug: false,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    profilesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    enableAutoSessionTracking: false,
    enableAutoPerformanceTracing: false,
    enableAppStartTracking: false,
    enableNativeFramesTracking: false,
    enableStallTracking: false,
    enableUserInteractionTracing: false,
    enableTurboModuleTracking: false,
    enableAppHangTracking: false,
    enableCaptureFailedRequests: false,
    enableNetworkBreadcrumbs: false,
    enableNetworkEventBreadcrumbs: false,
    enableAutoBreadcrumbTracking: false,
    enableActivityLifecycleBreadcrumbs: false,
    enableAppLifecycleBreadcrumbs: false,
    enableSystemEventBreadcrumbs: false,
    enableAppComponentBreadcrumbs: false,
    enableMetricKit: false,
    enableAutoConsoleLogs: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    attachThreads: false,
    spotlight: false,
    maxBreadcrumbs: 20,
    // Offline and cancelled requests are normal on a train; they are not crashes.
    ignoreErrors: [/Network request failed/i, /AbortError/, /Aborted/i, /The operation was aborted/i, /Load failed/i],
    maxCacheItems: 10,
    // Native crashes (iOS and Android, NDK included) are the reason for the native module.
    enableNative: true,
    enableNativeCrashHandling: true,
    enableNdk: true,
    enableNativeNagger: false,
  };
}
