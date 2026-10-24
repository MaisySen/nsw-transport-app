// transportsydney.app/trip/<share id> in a browser: send it to the live trip page on the API, keeping the
// id. Pages rules cannot put a path part into a query string, so this one route is a function. On a phone
// with the app, the link opens the app through .well-known before this runs.
const LIVE = 'https://api.transportsydney.app/live/';

export function onRequest({ params }) {
  const id = String(params.id || '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return Response.redirect('https://transportsydney.app/open/', 302);
  return new Response(null, {
    status: 302,
    headers: { Location: `${LIVE}?t=${encodeURIComponent(id)}`, 'Cache-Control': 'no-store' },
  });
}
