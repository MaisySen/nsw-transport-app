// Links the app opens for itself (Siri and Shortcuts "Start my commute", 1 Nov back-nav audit). The link was handed
// to the system (Linking.openURL) as soon as the app started, before the screens were listening, so on a cold start it
// could be lost and the app stayed on Home. Now a link waits here until the root layout is ready, then opens on top of
// the screen in view (router.push), so Back returns there. Pure, no imports, so the tests load it as is.

type Handler = (url: string) => void;
let held: string[] = [];
let handler: Handler | null = null;

/** Opens the app's own link now when the screens are ready, else as soon as they are (the last 3 kept). */
export function openAppLink(url: string): void {
  if (typeof url !== 'string' || !url) return;
  if (handler) { handler(url); return; }
  held = [...held, url].slice(-3);
}

/** The root layout's opener; links that waited open now, in order. Returns the remover. */
export function setAppLinkHandler(fn: Handler): () => void {
  handler = fn;
  const waiting = held;
  held = [];
  waiting.forEach((u) => { try { fn(u); } catch {} });
  return () => { if (handler === fn) handler = null; };
}

/** Links waiting for the screens (tests). */
export function heldAppLinks(): readonly string[] { return held; }

/**
 * The route for one of the app's own links: nswtransport://trip?from=.. is /trip?from=..; nswtransport:// is /.
 * Null for anything else (another scheme, a web link), so nothing outside the app is opened from here.
 */
export function appPath(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const m = /^nswtransport:\/\/([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(url.trim());
  if (!m) return null;
  const p = m[1].replace(/^\/+/, '').replace(/\/+$/, '');
  if (!/^[A-Za-z0-9_\-/.%:]*$/.test(p)) return null;
  return '/' + p + (m[2] && m[2].length > 1 ? m[2] : '');
}
