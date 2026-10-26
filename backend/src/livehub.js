// Live push for boards on the Trip Planner path (LIVE_PUSH, docs/API.md "GET /api/live"). The board shards push engine
// boards (ENGINE_PUSH, engine.js); while the engine does not serve a stop's boards, a LiveHub object per stop and mode
// keeps the sockets of the phones on that stop's screen and sends them the same board the HTTP path serves: once on
// connect, then again each time it changes. It asks for the board as one more refresh of the 15 s copy (the edge copy
// and the shared Trip Planner call in answerAndStore), so a stop with 1 phone or 1,000 on it costs what one polling phone
// costs. Hibernatable sockets: an object with phones on it and nothing to send is not billed for its wait.
const LIVE_HUB_TICK_MS = 15000; // a board is asked for again this long after the copy it got was made
const LIVE_HUB_MIN_TICK_MS = 3000;
const LIVE_MAX_PER_IP = 4; // sockets from one address on one stop
const LIVE_MAX_SOCKETS = 2000; // sockets on one stop
const LIVE_MAX_AGE_MS = 10 * 60000; // a socket is closed (4000, "renew") after this; a phone still on view opens a new one
function liveOn(env, k) { return String((env && env[k]) || "").toLowerCase() === "on" && !(typeof budgetHeld === "function" && budgetHeld(k)); }
function liveIp(request) { return (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "?").slice(0, 64); }

// The answer to a socket that cannot be opened: JSON, so the app's fallback to polling can log why.
function liveNo(status, error) { return new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" } }); }

// Too many sockets from this address or on this stop: an answer to send instead of opening one, else null. `tag` is
// the address tag the socket gets (state.getWebSockets(tag) counts them). Shared by LiveHub and the board shards.
function liveLimit(state, request, max = {}) {
  let all = [], mine = [];
  const tag = "ip:" + liveIp(request);
  try { all = state.getWebSockets(); mine = state.getWebSockets(tag); } catch (e) { /* no sockets yet */ }
  if (mine.length >= (max.perIp || LIVE_MAX_PER_IP)) return { tag, res: liveNo(429, "Too many live connections from this address.") };
  if (all.length >= (max.total || LIVE_MAX_SOCKETS)) return { tag, res: liveNo(503, "Live updates are busy here, refreshing instead.") };
  return { tag, res: null };
}
// Sockets open longer than LIVE_MAX_AGE_MS are closed with 4000 ("renew"): a phone that is still on the screen opens
// a new one at once, one that is gone (asleep, out of signal, closed without saying) stops costing anything.
function liveSweep(state, now = Date.now(), maxAge = LIVE_MAX_AGE_MS) {
  let n = 0;
  let list = [];
  try { list = state.getWebSockets(); } catch (e) { return 0; }
  for (const ws of list) {
    let a = null;
    try { a = ws.deserializeAttachment(); } catch (e) { a = null; }
    if (a && a.at && now - a.at > maxAge) { try { ws.close(4000, "renew"); n++; } catch (e) { /* already closed */ } }
  }
  return n;
}
// What a board's phones see: its rows, alerts and stop, not the moment it was asked ("now", "dataAt", "seenAt").
function liveSig(body) {
  try {
    const d = JSON.parse(body);
    return JSON.stringify([d.items, d.alerts, d.stop, d.modes, d.source || null]);
  } catch (e) { return body; }
}

// GET /api/live?stop=ID[&mode=] for the Trip Planner path: to the stop's LiveHub (LIVE_PUSH "on"), else null.
function liveHubWanted(env, url) {
  if (!liveOn(env, "LIVE_PUSH") || !env.LIVE) return false;
  // Engine boards (ENGINE_BOARDS on for this stop) are pushed by their shard when ENGINE_PUSH is on.
  if (liveOn(env, "ENGINE_PUSH") && typeof engineWanted === "function" && env.ENGINE && engineWanted(env, url)) return false;
  return true;
}
async function liveHubSocket(request, env, url) {
  if ((request.headers.get("upgrade") || "").toLowerCase() !== "websocket") return liveNo(426, "websocket only");
  const stop = url.searchParams.get("stop") || "", mode = url.searchParams.get("mode") || "";
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(stop) || (mode && !/^[a-z]{1,12}$/.test(mode))) return liveNo(400, "bad stop");
  const stub = env.LIVE.get(env.LIVE.idFromName(stop + "|" + mode), { locationHint: "oc" });
  return stub.fetch("https://live/ws?stop=" + encodeURIComponent(stop) + "&mode=" + encodeURIComponent(mode), request);
}

class LiveHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sig = null; // what the phones hold (liveSig); null after a wake from hibernation: they get the next board
    this.stats = { boards: 0, sent: 0, same: 0, fails: 0, renewed: 0 };
    // "ping" is answered by Cloudflare without waking the object.
    try { state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong")); } catch (e) { /* not on this host */ }
  }
  // The board, as the HTTP path serves it to a polling phone (refresh=1: a copy at most REFRESH_MAX_AGE_MS old, else
  // one shared Trip Planner call that is stored for everyone). { body, at } or null.
  async board(stop, mode) {
    const env = this.env;
    const u = new URL("https://" + (env.API_HOST || "api.transportsydney.app") + "/api/departures");
    u.searchParams.set("stop", stop);
    if (mode) u.searchParams.set("mode", mode);
    u.searchParams.set("refresh", "1");
    const request = new Request(u.toString(), { headers: { "cf-connecting-ip": "live-hub:" + stop } });
    const exec = { waitUntil: (p) => { try { this.state.waitUntil(p); } catch (e) { /* the promise runs anyway */ } } };
    const cache = edgeCache(), key = edgeKey(u);
    const hit = await cache.match(key).catch(() => null);
    const storedAt = hit ? Number(hit.headers.get("x-stored-at")) || 0 : 0;
    if (hit && storedAt && Date.now() - storedAt <= REFRESH_MAX_AGE_MS) return { body: await hit.text(), at: storedAt };
    // inFlight holds sharedJob records (worker.js): a job another request started is waited on with this request's
    // own timers, never by awaiting its promise.
    let job = inFlight.get(key.url), mine = false;
    if (!job) {
      mine = true;
      const run = answerAndStore(request, env, exec, cache, key);
      job = sharedJob(run);
      inFlight.set(key.url, job);
      run.then(() => inFlight.delete(key.url), () => inFlight.delete(key.url));
    }
    const out = await (mine ? job.promise : joinJob(job, SHARED_WAIT_MS)).catch(() => null);
    if (out && out.status === 200) return { body: out.body, at: Date.now() };
    // Refused or failed: a copy kept for a busy upstream, then the engine's labelled timetable board (engineOutage).
    if (hit && storedAt && Date.now() - storedAt <= EDGE_KEEP_S * 1000) return { body: await hit.text(), at: storedAt };
    if (typeof engineOutage === "function") {
      const fb = await engineOutage(request, env, exec, u).catch(() => null);
      if (fb && fb.status === 200) return { body: await fb.text(), at: Date.now() };
    }
    return null;
  }
  frame(b) {
    // The board with when it was made (dataAt) and the server's clock (now), as a copy from the HTTP path says them.
    let body = b.body.replace(/"now":\d{13}/g, '"now":' + Date.now());
    if (/^\{\s*"/.test(body) && !/"dataAt":\d/.test(body)) body = '{"dataAt":' + b.at + "," + body.slice(1);
    return '{"type":"board","board":' + body + "}";
  }
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/status") {
      let n = 0;
      try { n = this.state.getWebSockets().length; } catch (e) { /* none */ }
      return Response.json({ sockets: n, ...this.stats });
    }
    if (u.pathname !== "/ws") return new Response("not found", { status: 404 });
    if ((req.headers.get("upgrade") || "").toLowerCase() !== "websocket") return liveNo(426, "websocket only");
    const lim = liveLimit(this.state, req);
    if (lim.res) return lim.res;
    const stop = u.searchParams.get("stop") || "", mode = u.searchParams.get("mode") || "";
    await this.state.storage.put("stop", { stop, mode });
    const b = await this.board(stop, mode);
    // No board to send (the Trip Planner and every fallback failed): the phone keeps polling.
    if (!b) { this.stats.fails++; return liveNo(503, "No live board right now."); }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server, [lim.tag]);
    try { server.serializeAttachment({ at: Date.now() }); } catch (e) { /* attachments not on this host */ }
    server.send(this.frame(b));
    this.stats.sent++;
    // The phones that were here already get this board too when it differs from theirs.
    this.publish(b, server);
    await this.schedule(b.at);
    return new Response(null, { status: 101, webSocket: client });
  }
  // Sends the board to every socket (but `skip`) when it differs from what they were sent last. Returns how many got it.
  publish(b, skip) {
    const sig = liveSig(b.body);
    if (sig === this.sig) { this.stats.same++; return 0; }
    this.sig = sig;
    this.stats.boards++;
    const msg = this.frame(b);
    let n = 0;
    for (const ws of this.state.getWebSockets()) {
      if (ws === skip) continue;
      try { ws.send(msg); n++; } catch (e) { /* closing */ }
    }
    this.stats.sent += n;
    return n;
  }
  // Next ask: just after the copy it got goes past the HTTP path's 15 s, never sooner than 3 s.
  async schedule(at) {
    const next = Math.max(Date.now() + LIVE_HUB_MIN_TICK_MS, (at || Date.now()) + (Number(this.env.LIVE_TICK_MS) || LIVE_HUB_TICK_MS) + 300);
    await this.state.storage.setAlarm(next);
  }
  async alarm() {
    this.stats.renewed += liveSweep(this.state);
    let open = [];
    try { open = this.state.getWebSockets(); } catch (e) { open = []; }
    if (!open.length) { this.sig = null; return; } // nobody on the stop: no more asks until a phone opens it
    const s = await this.state.storage.get("stop");
    if (!s || !s.stop) return;
    const b = await this.board(s.stop, s.mode).catch(() => null);
    if (b) this.publish(b); else this.stats.fails++;
    await this.schedule(b ? b.at : Date.now());
  }
  async webSocketMessage(ws, msg) {
    // "full": the board on the stop now (the app sends it when it cannot apply what it got).
    // At most once in 10 s per socket, so a phone cannot make the object ask for boards.
    if (msg === "full") {
      let a = null;
      try { a = ws.deserializeAttachment() || {}; } catch (e) { a = {}; }
      if (a.fullAt && Date.now() - a.fullAt < 10000) return;
      try { ws.serializeAttachment({ ...a, fullAt: Date.now() }); } catch (e) { /* attachments not on this host */ }
      const s = await this.state.storage.get("stop");
      const b = s && s.stop ? await this.board(s.stop, s.mode).catch(() => null) : null;
      if (b) { try { ws.send(this.frame(b)); } catch (e) { /* closing */ } }
    }
  }
  async webSocketClose(ws, code) { try { ws.close(code === 1005 ? 1000 : code, "closed"); } catch (e) { /* already closed */ } }
  async webSocketError() { /* the phone falls back to polling */ }
}

export { LiveHub };
