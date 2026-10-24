// Transport web app. Plain JavaScript, no framework.
// Apple style layout: large titles, grouped lists, a tab bar, a live map in a pull up sheet.
// Every view refreshes itself while open, countdowns tick every second, every time is
// marked live or scheduled, and watched trips reach the phone as notifications.
// index.html shows the landing page to first time browser visitors; the app boots when they open it.
window.TBApp = () => {
  "use strict";
  if (window.TBApp.started) return;
  window.TBApp.started = true;
  const TZ = "Australia/Sydney";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const view = $("#view");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const qs = (o) => Object.entries(o).filter(([, v]) => v != null && v !== "").map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");
  const cap = (s) => String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1);
  const short = (n) => String(n || "").split(",")[0].trim();
  // The profile id travels in an x-profile header instead of the address, so it stays out of
  // access logs and shared caches. Every /api call in this file goes through this fetch.
  const fetch = (u, o = {}) => {
    if (typeof u === "string" && u.startsWith("/api/") && u.includes("profile=")) {
      const i = u.indexOf("?"), sp = new URLSearchParams(u.slice(i + 1)), prof = sp.get("profile");
      sp.delete("profile");
      const h = new Headers(o.headers || {});
      if (prof) h.set("x-profile", prof);
      o = { ...o, headers: h };
      u = u.slice(0, i) + (sp.toString() ? "?" + sp : "");
    }
    return window.fetch(u, o);
  };

  // ---------- storage and identity ----------
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  // Random ids from the browser's secure generator: a profile id is the only key to its saved trips.
  const randId = (prefix) => {
    try { return prefix + Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, "0")).join(""); }
    catch (e) { return prefix + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Date.now().toString(36); }
  };
  const PROFILE = (() => {
    const qp = new URLSearchParams(location.search);
    const me = (qp.get("me") || "").toLowerCase().replace(/[^a-z0-9_.:-]/g, "").slice(0, 40);
    if (qp.has("me")) {
      // A ?me= link switches to another set of saved trips. Ask first when this browser already
      // has its own, so a link from someone else cannot quietly move you onto their profile.
      const cur = LS.get("tb_profile", null);
      if (validProfile(me) && me !== cur && (!cur || window.confirm("Open the saved trips from this link? Your current trips stay saved on the server under your old profile."))) LS.set("tb_profile", me);
      qp.delete("me");
      try { history.replaceState(null, "", location.pathname + (qp.toString() ? "?" + qp : "") + location.hash); } catch (e) { /* old browser */ }
    }
    let p = LS.get("tb_profile", null);
    if (!validProfile(p)) {
      // Every browser gets a random profile of its own, so saved trips are never shared. A browser
      // still on an old short or shared profile moves to a new one, and its saved trips are uploaded
      // again under the new id (see migrateSaved below). Everything on this phone stays.
      if (p) LS.set("tb_migrate", 1);
      p = randId("w");
      LS.set("tb_profile", p);
    }
    return p;
  })();
  window.TBApp.profile = PROFILE;
  // Server rule: a profile id is 6 to 40 of a to z, 0 to 9, "_", ".", ":" or "-".
  function validProfile(v) { return typeof v === "string" && /^[a-z0-9_.:-]{6,40}$/.test(v); }
  // After a move to a new profile, upload this phone's saved trips under it (once).
  setTimeout(() => {
    if (!LS.get("tb_migrate", 0)) return;
    const list = saved();
    Promise.all(list.filter((t) => t && t.name).map((t) => {
      const F = tLegs(t);
      return post("/api/saved", F.length > 1 ? { profile: PROFILE, name: t.name, legs: wireLegs(t) } : { profile: PROFILE, name: t.name, from: t.from, to: t.to });
    })).then(() => LS.set("tb_migrate", 0)).catch(() => null);
  }, 1500);
  const DEVICE = (() => {
    let d = LS.get("tb_device", null);
    if (!d) { d = randId("d"); LS.set("tb_device", d); }
    return d;
  })();
  const stars = () => LS.get("tb_stars", []);
  const saved = () => LS.get("tb_saved", []);
  const recents = () => LS.get("tb_recent", []);
  // Opal fare estimates: the fare type is a setting (Adult by default); the server works out the fare.
  const FARE_NAMES = { adult: "Adult", child: "Child or Youth", concession: "Concession", gold: "Gold Senior or Pensioner" };
  const fareT = () => { const t = LS.get("tb_fare", "adult"); return FARE_NAMES[t] ? t : "adult"; };
  const money = (x) => "$" + Number(x).toFixed(2);
  // Accessibility: step free trips only (Settings), station access, lifts, Park and Ride and Opal machines.
  const accOn = () => !!LS.get("tb_acc", false);
  const ACC_LBL = { independent: "Step free", assisted: "Assisted access", none: "Not step free", unknown: "Access not listed" };
  const SRC = { fac: "Transport for NSW open data (station facilities)", park: "Transport for NSW Car Park API, live", lift: "Transport for NSW service alerts, live" };
  const stShort = (n) => String(n || "").replace(/ (Station|Light Rail|Wharf)$/, "");
  const liftStations = () => [...new Set(saved().flatMap((t) => [t.from && t.from.id, t.to && t.to.id, ...tLegs(t).flatMap((l) => [l.from && l.from.id, l.to && l.to.id])]).map(String).filter((x) => /^\d{5,8}$/.test(x)))].slice(0, 40);
  // Keep the server's lift alert list in step with saved trips (once per app open).
  setTimeout(() => { if (LS.get("tb_liftalerts", false)) post("/api/lifts/alerts", { device: DEVICE, profile: PROFILE, on: true, stations: liftStations() }).catch(() => null); }, 4000);
  function accChip(a, name) {
    if (!a) return "";
    const cls = a.outage ? "acc-out" : a.level === "independent" ? "acc-ok" : a.level === "assisted" ? "acc-mid" : "acc-no";
    return `<span class="accchip ${cls}" title="${esc(a.outage || ACC_LBL[a.level] || "")}">${I.access}${esc(stShort(name))}: ${a.outage ? "lift out" : esc(ACC_LBL[a.level] || "")}</span>`;
  }
  function legAccHtml(l) {
    const a = l.access;
    if (!a || !(a.from || a.to)) return "";
    const outs = [a.from, a.to].filter((x) => x && x.outage);
    return `<div class="ls accrow">${accChip(a.from, l.from)}${accChip(a.to, l.to)}</div>${outs.map((x) => `<div class="ls acc-note">${I.alert}${esc(x.outage)}</div>`).join("")}`;
  }
  function journeyOutages(j) {
    const s = new Set();
    for (const l of j.legs || []) for (const x of l.access ? [l.access.from, l.access.to] : []) if (x && x.outage) s.add(x.outage);
    return [...s];
  }
  function parkBar(p) {
    const pct = p.spots && p.free != null ? Math.max(0, Math.min(100, Math.round((p.occupied / p.spots) * 100))) : null;
    return `<div class="pk-bar${p.status === "nearly" ? " nearly" : p.status === "full" ? " full" : ""}"><i style="width:${pct == null ? 0 : pct}%"></i></div>`;
  }
  function parkBadge(p) { return p.status === "full" ? `<span class="badge bad">Full</span>` : p.status === "nearly" ? `<span class="badge late">Nearly full</span>` : p.status === "ok" ? `<span class="badge live">Spaces free</span>` : `<span class="badge sched">No live count</span>`; }
  // "Tallawong P1" on the Tallawong screen reads "Car park P1"; "Kellyville (north)" reads "North car park".
  function parkName(p, station) {
    const base = stShort(station || "");
    let n = base && p.name.toLowerCase().startsWith(base.toLowerCase() + " ") ? p.name.slice(base.length + 1) : p.name;
    if (/^P\d+$/i.test(n)) n = "Car park " + n.toUpperCase();
    else if (/^\((north|south|east|west)\)$/i.test(n)) n = n.slice(1, -1).replace(/^./, (c) => c.toUpperCase()) + " car park";
    return n;
  }
  function parkCell(p, watch, station) {
    return `<div class="cell static pkcell"><span class="sym" style="background:#0a84ff">${I.car}</span><div class="grow"><div class="t1">${esc(parkName(p, station))}</div>
      <div class="t2 num pk-t2">${parkBadge(p)}<span>${p.free == null ? `${p.spots} spaces` : `<b class="pk-free">${p.free}</b> of ${p.spots} free`}${p.updated ? ` \u00b7 ${fmtClock(Date.parse(p.updated))}` : ""}</span></div>${parkBar(p)}</div>
      ${watch ? `<button class="pk-watch" data-pkw="${esc(p.id)}" aria-label="Alert me when ${esc(p.name)} is nearly full" title="Alert me when nearly full">${I.bellPlus || I.bell}</button>` : ""}</div>`;
  }
  function parkGroup(pk, title, watch, station) {
    if (!pk || !pk.length) return "";
    const fr = pk.reduce((n, p) => n + (p.free || 0), 0), sp = pk.reduce((n, p) => n + p.spots, 0);
    return `<div class="group pkgroup"><div class="group-h">${esc(title)}${pk.length > 1 && pk.every((p) => p.free != null) ? `<span class="gh-r num">${fr} of ${sp} free</span>` : ""}</div><div class="list" style="--inset:57px">${pk.map((p) => parkCell(p, watch, station)).join("")}</div>
      <p class="group-f src">Live spaces from the ${SRC.park}. Nearly full means 10 percent or fewer spaces left.${watch ? " Tap the bell to get a notification if it gets nearly full in the next 3 hours." : ""}</p></div>`;
  }
  function wirePark() {
    $$("[data-pkw]").forEach((b) => (b.onclick = async (e) => {
      e.stopPropagation();
      if (pushState() !== "on") { const r = await enablePush(false).catch(() => ({ ok: false })); if (!r.ok) { toast(pushWhyText(r.why) || "Turn on alerts first, in Settings."); return; } }
      try { const r = await post("/api/parking/watch", { device: DEVICE, profile: PROFILE, facility: b.dataset.pkw }); b.classList.add("on"); b.innerHTML = I.bell; b.setAttribute("aria-pressed", "true"); toast(r.now && (r.now.status === "nearly" || r.now.status === "full") ? `${r.watch.name} is already ${r.now.status === "full" ? "full" : "nearly full"}. I'll still tell you.` : `I'll tell you if ${r.watch.name} gets nearly full in the next 3 hours.`); }
      catch (err) { toast(err.message); }
    }));
  }
  function stationHtml(st) {
    if (!st) return "";
    const a = st.access;
    const accCol = a.level === "independent" ? "#34c759" : a.level === "assisted" ? "#ff9500" : "#8e8e93";
    const kit = [a.lift && "Lifts", a.escalator && "Escalators", a.ramp && "Boarding ramp", a.hearingLoop && "Hearing loop", a.tactile && "Tactile edges"].filter(Boolean).join(", ");
    const outs = (st.outages || []).map((o) => `<a class="cell" ${o.url ? `href="${esc(o.url)}" target="_blank" rel="noopener"` : ""}><span class="sym" style="background:#ff3b30">${I.access}</span><div class="grow"><div class="t1 danger-t">${o.kind === "escalator" ? "Escalator" : "Lift"} out of service</div><div class="t2 wrap">${esc(o.title.replace(new RegExp("^" + st.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*", "i"), ""))}</div></div>${o.url ? I.chev : ""}</a>`).join("");
    const tk = st.ticket;
    const tkCol = tk.kind === "cash" || tk.kind === "card" || tk.kind === "topup" ? "#5856d6" : "#8e8e93";
    return `${parkGroup(st.parking, "Park and Ride", true, st.name)}
      <div class="group stgroup" id="stationInfo"><div class="group-h">Access and facilities</div><div class="list" style="--inset:57px">
        <div class="cell static"><span class="sym" style="background:${accCol}">${I.access}</span><div class="grow"><div class="t1">${esc(a.label)}</div><div class="t2 wrap">${esc(kit || a.note || "")}</div></div></div>
        ${outs || (a.lift ? `<div class="cell static"><span class="sym" style="background:#34c759">${I.check}</span><div class="grow"><div class="t1">Lifts working</div><div class="t2">No lift outages reported right now</div></div></div>` : "")}
        <div class="cell static"><span class="sym" style="background:${tkCol}">${I.card}</span><div class="grow"><div class="t1">${tk.kind === "none" ? "No Opal machine" : tk.kind === "unknown" ? "Opal machine not listed" : tk.kind === "topup" ? "Opal top up machine" : "Opal top up and tickets"}</div><div class="t2 wrap">${esc(tk.kind === "cash" ? "Cash or card" : tk.kind === "card" || tk.kind === "topup" ? "Card only" : "Top up in the Opal Travel app or at a retailer")}${tk.extraTopUp ? ", plus a card only top up machine" : ""}</div></div></div>
        ${st.shortPlatform ? `<div class="cell static"><span class="sym" style="background:#ff9500">${I.alert}</span><div class="grow"><div class="t1">Short platform</div><div class="t2 wrap">Some long trains stop with doors past the platform. Listen for which cars to use.</div></div></div>` : ""}
      </div>
      ${st.facilities && st.facilities.length ? `<div class="chips stchips">${st.facilities.map((f) => `<span class="chip static">${esc(f)}</span>`).join("")}</div>` : ""}
      <p class="group-f src">${st.peak && st.peak.morning ? `Peak here: ${esc(st.peak.morning)} and ${esc(st.peak.afternoon || "3pm-7pm")} weekdays. ` : ""}Facilities from ${SRC.fac}${st.read ? `, read ${esc(st.read)}` : ""}. Lift status from ${SRC.lift}.</p></div>`;
  }
  // Peak: Monday to Thursday, 6:30am to 10am and 3pm to 7pm Sydney time (public holidays are off peak; the server knows them).
  function peakNow() {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    const tod = (Number(p.hour) % 24) * 60 + Number(p.minute);
    if (!["Mon", "Tue", "Wed", "Thu"].includes(p.weekday)) return null;
    return tod >= 390 && tod < 600 ? "10am" : tod >= 900 && tod < 1140 ? "7pm" : null;
  }
  function fareChip(f) { return f && f.total != null && !f.unknown ? `<span class="farechip">${money(f.total)}</span>` : ""; }
  function fareBox(f) {
    if (!f || f.total == null) return "";
    const rows = (f.legs || []).map((l) => l.amount == null ? `<div class="fr"><span>${esc(l.line || "Service")}</span><span>Not an Opal fare</span></div>`
      : l.joined ? `<div class="fr"><span>${esc(l.line)}</span><span class="t2">Same journey, no extra fare</span></div>`
      : `<div class="fr"><span>${esc(l.line)} <small>${l.km != null ? Math.round(l.km) + " km · " : ""}${l.peak ? "Peak" : "Off peak"}</small></span><span>${money(l.fare)}</span></div>${l.transferOff ? `<div class="fr sub"><span>Transfer discount</span><span>−${money(l.transferOff)}</span></div>` : ""}${l.airportFee ? `<div class="fr sub"><span>Airport station access fee</span><span>${money(l.airportFee)}</span></div>` : ""}`).join("");
    return `<div class="farebox"><div class="fh"><span>Opal fare estimate <small>${esc(f.typeName)}</small></span><b>${money(f.total)}</b></div>${rows}
      ${f.capped ? `<div class="fr sub"><span>Daily cap reached</span><span></span></div>` : ""}
      ${f.offPeak ? `<div class="fnudge">${I.clock}<span>Off peak from ${esc(f.offPeak.from)}, save ${money(f.offPeak.save)}</span></div>` : ""}
      <p class="fnote">${f.peak ? "Peak fare. " : "Off peak fare. "}An estimate from the Opal fare tables, not your card's charge. Change the fare type in Settings.</p></div>`;
  }
  function addRecent(q) { const r = recents().filter((x) => x.toLowerCase() !== q.toLowerCase()); r.unshift(q); LS.set("tb_recent", r.slice(0, 8)); }
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const pushCapable = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  // ---------- time ----------
  const S = { skew: 0, lastOk: 0, failed: false, timers: [], cleanup: [], watches: LS.get("tb_watch_cache", []), push: LS.get("tb_push", null) };
  const now = () => Date.now() + S.skew;
  const fmtClock = (t) => new Date(t).toLocaleTimeString("en-AU", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).replace(/\s/g, "").toLowerCase();
  const fmtSecs = (t) => new Date(t).toLocaleTimeString("en-AU", { timeZone: TZ, hour: "numeric", minute: "2-digit", second: "2-digit", hour12: false });
  const fmtHM = (t) => new Date(t).toLocaleTimeString("en-AU", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
  const tms = (iso) => (iso == null ? null : typeof iso === "number" ? iso : new Date(iso).getTime());
  function mins(t) { const s = (t - now()) / 1000; if (s <= 30) return 0; return Math.max(1, Math.floor(s / 60)); }
  function minsHtml(t) {
    const m = mins(t);
    if (m === 0) return "Now";
    if (m < 60) return `${m}<small>min</small>`;
    return `${Math.floor(m / 60)}<small>h</small>${m % 60 ? ` ${m % 60}<small>m</small>` : ""}`;
  }
  function bigText(t) {
    const m = mins(t);
    if (m === 0) return { n: "Now", u: "" };
    if (m < 60) return { n: String(m), u: "min" };
    return { n: fmtClock(t), u: "" };
  }

  // ---------- icons ----------
  const P = (d, vb = "0 0 24 24") => `<svg viewBox="${vb}" fill="currentColor" aria-hidden="true">${d}</svg>`;
  const I = {
    access: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="4.2" r="2.1"/><path d="M11.1 7.6h1.8c.6 0 1.1.5 1.1 1.1v3.4h3.2a1 1 0 0 1 0 2h-4.2a1 1 0 0 1-1-1v-1.6H9.2a1 1 0 0 1 0-2H11V8.7c0-.6.1-1.1.1-1.1Z"/><path d="M8.3 11.6a.9.9 0 0 1 .5 1.2 4.2 4.2 0 1 0 7.6 3.5.9.9 0 1 1 1.7.6 6 6 0 1 1-11-5 .9.9 0 0 1 1.2-.3Z"/></svg>',
    car: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7.4 4.5h9.2c.9 0 1.7.6 2 1.4l1.5 4.2c.9.4 1.4 1.2 1.4 2.2v5.2c0 .6-.5 1-1 1h-1.3a1 1 0 0 1-1-1v-1.1H5.8v1.1a1 1 0 0 1-1 1H3.5c-.5 0-1-.4-1-1v-5.2c0-1 .6-1.8 1.4-2.2l1.5-4.2c.3-.8 1.1-1.4 2-1.4Zm.2 2-1.2 3.6h11.2l-1.2-3.6H7.6ZM6.3 12.6a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Zm11.4 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Z"/></svg>',
    card: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4.5 5h15A2.5 2.5 0 0 1 22 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 16.5v-9A2.5 2.5 0 0 1 4.5 5ZM4 9v7.5c0 .3.2.5.5.5h15c.3 0 .5-.2.5-.5V9H4Zm2 4.5c0-.6.4-1 1-1h3a1 1 0 0 1 0 2H7a1 1 0 0 1-1-1Z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    bus: P('<path d="M6 15.5V7a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v8.5a2.5 2.5 0 0 1-2 2.45V20h-2v-2h-4v2H8v-2.05a2.5 2.5 0 0 1-2-2.45ZM8 7v4h8V7H8Zm1 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm6 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"/>'),
    train: P('<path d="M7 3h10a3 3 0 0 1 3 3v9a3 3 0 0 1-2.4 2.94L19 20h-2.3l-1.2-2h-7l-1.2 2H5l1.4-2.06A3 3 0 0 1 4 15V6a3 3 0 0 1 3-3Zm-1 3v4h12V6H6Zm2 9.5a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Zm8 0a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z"/>'),
    ferry: P('<path d="M9 3h6v3h3l1 6-7-2.5L5 12l1-6h3V3Zm-6 15c1.5 0 2.5-1 4-1s2.5 1 4 1 2.5-1 4-1 2.5 1 4 1v2c-1.5 0-2.5-1-4-1s-2.5 1-4 1-2.5-1-4-1-2.5 1-4 1v-2Zm2.3-2.5L12 13l6.7 2.5-1 1.6c-.6-.3-1.2-.6-2-.6-1.5 0-2.5 1-4 1s-2.5-1-4-1c-.7 0-1.3.3-1.9.6l-.5-1.6Z"/>'),
    walk: P('<path d="M13.5 5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3A7.3 7.3 0 0 0 19 13v-2a5.2 5.2 0 0 1-4.6-2.8l-1-1.6a2 2 0 0 0-1.7-1c-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7"/>'),
    chev: '<svg class="chev" viewBox="0 0 8 14" aria-hidden="true"><path d="M1 1l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    back: '<svg viewBox="0 0 13 21" aria-hidden="true"><path d="M11 2 2.5 10.5 11 19" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    star: P('<path d="M12 3.4l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.8l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8L12 3.4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>'),
    starOn: P('<path d="M12 3.4l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.8l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8L12 3.4Z"/>'),
    bell: P('<path d="M12 2.8c.6 0 1 .4 1 1v.6a6.3 6.3 0 0 1 5.2 6.2v3.8l1.5 2.3c.4.7 0 1.6-.9 1.6H5.2c-.8 0-1.3-.9-.9-1.6l1.5-2.3v-3.8A6.3 6.3 0 0 1 11 4.4v-.6c0-.6.4-1 1-1Zm-2.7 16.9h5.4a2.7 2.7 0 0 1-5.4 0Z"/>'),
    bellPlus: P('<path d="M12 2.8c.6 0 1 .4 1 1v.6a6.3 6.3 0 0 1 5.2 6.2v3.8l1.5 2.3c.4.7 0 1.6-.9 1.6H5.2c-.8 0-1.3-.9-.9-1.6l1.5-2.3v-3.8A6.3 6.3 0 0 1 11 4.4v-.6c0-.6.4-1 1-1Zm-2.7 16.9h5.4a2.7 2.7 0 0 1-5.4 0Z"/>'),
    rt: '<svg class="rt" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13a10 10 0 0 1 10-10M3 13a6 6 0 0 1 6-6M3 13a2 2 0 0 1 2-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    alert: P('<path d="M10.3 3.9c.8-1.3 2.6-1.3 3.4 0l7.8 13.4c.8 1.3-.2 3-1.7 3H4.2c-1.5 0-2.5-1.7-1.7-3L10.3 3.9ZM12 8.3c-.6 0-1 .5-1 1.1l.2 4.9c0 .5.4.8.8.8s.8-.3.8-.8l.2-4.9c0-.6-.4-1.1-1-1.1Zm0 9.2a1.1 1.1 0 1 0 0-2.2 1.1 1.1 0 0 0 0 2.2Z"/>'),
    loc: P('<path d="M20.6 3.4c.4.4.5.9.3 1.4l-7.3 15.6c-.5 1-2 .9-2.3-.2l-1.4-5.6-5.6-1.4c-1.1-.3-1.2-1.8-.2-2.3L19.2 3.1c.5-.2 1-.1 1.4.3Z"/>'),
    clock: P('<path d="M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19Zm0 4c-.6 0-1 .4-1 1V12c0 .3.1.5.3.7l3 3c.4.4 1 .4 1.4 0 .4-.4.4-1 0-1.4L13 11.6V7.5c0-.6-.4-1-1-1Z"/>'),
    x: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 1.5l9 9m0-9-9 9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    share: P('<path d="M12 2.6c.3 0 .5.1.7.3l3.5 3.5a1 1 0 0 1-1.4 1.4L13 6v8.5a1 1 0 0 1-2 0V6L9.2 7.8a1 1 0 0 1-1.4-1.4l3.5-3.5c.2-.2.4-.3.7-.3ZM6.5 10H8a1 1 0 0 1 0 2h-1.5v8h11v-8H16a1 1 0 0 1 0-2h1.5c1.1 0 2 .9 2 2v8c0 1.1-.9 2-2 2h-11c-1.1 0-2-.9-2-2v-8c0-1.1.9-2 2-2Z"/>'),
    plusSq: P('<path d="M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm0 2a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H6Zm6 2.5c.6 0 1 .4 1 1V11h2.5a1 1 0 0 1 0 2H13v2.5a1 1 0 0 1-2 0V13H8.5a1 1 0 0 1 0-2H11V8.5c0-.6.4-1 1-1Z"/>'),
    chart: P('<path d="M4 20V10h3v10H4Zm6.5 0V4h3v16h-3ZM17 20v-7h3v7h-3Z"/>'),
    route: P('<path d="M6 3.5a2.5 2.5 0 0 1 1 4.8V15a2 2 0 0 0 2 2h4.6a2.5 2.5 0 1 1 0 2H9a4 4 0 0 1-4-4V8.3a2.5 2.5 0 0 1 1-4.8ZM15 5h1.5a3.5 3.5 0 0 1 0 7H12a1.5 1.5 0 0 0 0 3h.5a1 1 0 0 1 0 2H12a3.5 3.5 0 0 1 0-7h4.5a1.5 1.5 0 0 0 0-3H15a1 1 0 0 1 0-2Z"/>'),
    swap: P('<path d="M7.7 3.3a1 1 0 0 1 0 1.4L6.4 6H17a1 1 0 0 1 0 2H6.4l1.3 1.3a1 1 0 1 1-1.4 1.4l-3-3a1 1 0 0 1 0-1.4l3-3a1 1 0 0 1 1.4 0Zm8.6 10a1 1 0 0 1 1.4 0l3 3a1 1 0 0 1 0 1.4l-3 3a1 1 0 0 1-1.4-1.4l1.3-1.3H7a1 1 0 0 1 0-2h10.6l-1.3-1.3a1 1 0 0 1 0-1.4Z"/>'),
    house: P('<path d="M12 3.1c.3 0 .7.1.9.3l7.9 6.6a1 1 0 0 1-1.3 1.6l-.5-.4v8.2c0 1.4-1.1 2.6-2.6 2.6H7.6C6.1 22 5 20.8 5 19.4v-8.2l-.5.4A1 1 0 0 1 3.2 10l7.9-6.6c.2-.2.6-.3.9-.3Z"/>'),
    sparkle: P('<path d="M12 2.5c.4 0 .7.3.8.7l1 4.3c.3 1.3 1.3 2.3 2.6 2.6l4.3 1c.4.1.7.4.7.8s-.3.7-.7.8l-4.3 1c-1.3.3-2.3 1.3-2.6 2.6l-1 4.3c-.1.4-.4.7-.8.7s-.7-.3-.8-.7l-1-4.3c-.3-1.3-1.3-2.3-2.6-2.6l-4.3-1a.8.8 0 0 1 0-1.6l4.3-1c1.3-.3 2.3-1.3 2.6-2.6l1-4.3c.1-.4.4-.7.8-.7Z"/>'),
    trash: P('<path d="M9.5 3h5a1 1 0 0 1 1 1v1H20a1 1 0 0 1 0 2h-1l-.8 12.2A3 3 0 0 1 15.2 22H8.8a3 3 0 0 1-3-2.8L5 7H4a1 1 0 0 1 0-2h4.5V4a1 1 0 0 1 1-1Z"/>'),
    arrow: '<svg class="arrow" viewBox="0 0 7 11" aria-hidden="true"><path d="M1 1l4.5 4.5L1 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  };
  I.metro = I.train; I.lightrail = I.train; I.coach = I.bus;
  const icon = (mode) => I[mode] || I.bus;
  const noun = (mode) => ({ bus: "bus", coach: "coach", train: "train", metro: "metro", lightrail: "tram", ferry: "ferry" }[mode] || "service");
  // Line badges keep the official line colour; the text is black on light colours so it stays readable (4.5:1).
  const lbInk = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
    if (!m) return "#fff";
    const c = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return 1.05 / (L + 0.05) >= 4.5 ? "#fff" : "#000";
  };
  const lb = (line, color, sm) => `<span class="lb${sm ? " sm" : ""}" style="background:${esc(color || "#6c6c70")};color:${lbInk(color || "#6c6c70")}">${esc(line || "?")}</span>`;


  // ---------- map tiles ----------
  // Vector tiles from OpenFreeMap (free, no key, built for app traffic), drawn with MapLibre GL
  // inside Leaflet and loaded only when a map opens. Light and dark styles follow the phone.
  // Without WebGL the map falls back to OpenStreetMap raster tiles.
  let glLoad = null;
  const loadGL = () => glLoad || (glLoad = new Promise((ok, no) => {
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "/vendor/maplibre-gl.css?v=1"; document.head.appendChild(css);
    const s1 = document.createElement("script"); s1.src = "/vendor/maplibre-gl.js?v=1";
    s1.onload = () => { const s2 = document.createElement("script"); s2.src = "/vendor/leaflet-maplibre-gl.js?v=1"; s2.onload = () => ok(); s2.onerror = no; document.head.appendChild(s2); };
    s1.onerror = no; document.head.appendChild(s1);
  }));
  const hasGL = () => { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (e) { return false; } };
  const TILE_ATTR = '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  function baseTiles(map) {
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    const raster = () => L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, className: dark ? "dk-tiles" : "", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
    if (!hasGL()) { raster(); return; }
    loadGL().then(() => {
      if (!L.maplibreGL) throw new Error("no gl");
      L.maplibreGL({ style: "https://tiles.openfreemap.org/styles/" + (dark ? "dark" : "liberty"), attribution: TILE_ATTR }).addTo(map);
    }).catch(() => raster());
  }
  // ---------- network ----------
  // At most 3 requests in flight, and one quiet retry when the live feed is briefly busy.
  let inFlight = 0; const waiters = [];
  async function slot() { if (inFlight < 3) { inFlight++; return; } await new Promise((r) => waiters.push(r)); inFlight++; }
  function release() { inFlight--; const w = waiters.shift(); if (w) w(); }
  async function fetchRetry(path, opts) {
    await slot();
    try {
      let r = await fetch(path, opts);
      if ((r.status === 502 || r.status === 503 || r.status === 429) && (!opts || !opts.method || opts.method === "GET")) { await new Promise((x) => setTimeout(x, 900)); r = await fetch(path, opts); }
      return r;
    } finally { release(); }
  }
  async function api(path, opts) {
    const r = await fetchRetry(path, opts);
    let d = null;
    try { d = await r.json(); } catch (e) { d = null; }
    if (!r.ok || !d) { S.failed = true; paintLive(); throw new Error((d && (d.text || d.error)) || "No connection right now. Retrying."); }
    if (d.now) S.skew = d.now - Date.now();
    S.lastOk = Date.now(); S.failed = false;
    paintLive(true);
    return d;
  }
  const post = (path, body, method = "POST") => api(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  // ---------- live indicator ----------
  const liveEl = $("#live"), liveText = $("#liveText");
  function paintLive(pulse) {
    const age = (Date.now() - S.lastOk) / 1000;
    liveEl.classList.toggle("stale", !!S.lastOk && age > 45 && !S.failed);
    liveEl.classList.toggle("off", S.failed);
    liveText.textContent = S.failed ? "Offline" : !S.lastOk ? "Live" : `Live ${fmtHM(S.lastOk)}`;
    if (pulse) { liveEl.classList.remove("pulse"); void liveEl.offsetWidth; liveEl.classList.add("pulse"); }
  }
  liveEl.addEventListener("click", () => { if (S.refresh) S.refresh(); });

  // ---------- ticking ----------
  function tick() {
    for (const el of $$("[data-cd]")) {
      const t = Number(el.dataset.cd), m = mins(t);
      el.textContent = m === 0 ? "Now" : m < 60 ? String(m) : fmtClock(t);
      el.classList.toggle("sm", el.textContent.length === 3); el.classList.toggle("xs", el.textContent.length > 3);
      const box = el.parentElement;
      if (box && box.classList.contains("cdb") && !box.classList.contains("cd-x")) box.className = "cdb " + (m <= 3 ? "cd-r" : m <= 9 ? "cd-a" : "cd-g");
      const u = el.nextElementSibling;
      if (u && u.classList.contains("cdb-u")) u.hidden = !(m > 0 && m < 60);
    }
    for (const el of $$("[data-t]")) {
      const t = Number(el.dataset.t);
      if (el.classList.contains("mins-n")) el.innerHTML = minsHtml(t);
      else if (el.classList.contains("big-n")) { const b = bigText(t); el.textContent = b.n; const u = el.nextElementSibling; if (u && u.classList.contains("u")) u.textContent = b.u + (u.dataset.after || ""); }
      const row = el.closest(".dep");
      if (row) row.classList.toggle("gone", t < now() - 60000);
    }
    paintLive(false);
  }
  setInterval(tick, 1000);

  // ---------- view lifecycle ----------
  function clearView() {
    S.timers.forEach(clearInterval); S.timers = [];
    S.cleanup.forEach((f) => { try { f(); } catch (e) { /* ignore */ } }); S.cleanup = [];
    S.refresh = null;
    closeModal(true);
  }
  function every(ms, fn) {
    S.refresh = fn;
    S.timers.push(setInterval(() => { if (!document.hidden) fn(); }, ms));
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { if (S.refresh) S.refresh(); pollWatches(); } });
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.remove("has-act"); t.classList.add("on");
    clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("on"), 2800);
  }
  // A toast with Undo, for clearing history.
  function toastUndo(msg, undo) {
    const t = $("#toast");
    t.innerHTML = `<span>${esc(msg)}</span><button type="button">Undo</button>`;
    t.classList.add("on", "has-act");
    $("button", t).onclick = () => { t.classList.remove("on", "has-act"); undo(); };
    clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("on", "has-act"), 5000);
  }
  const skel = (n = 4) => `<div class="list">${"<div class=\"skel\"></div>".repeat(n)}</div>`;
  const foot = () => `<p class="foot">Live data from Transport for NSW Open Data. Not affiliated with Transport for NSW. Predictions come from times this app has recorded and are never shown as live.</p>`;

  // ---------- navigation bar ----------
  const nav = $("#nav"), navTitle = $("#navTitle"), navLeft = $("#navLeft"), navRight = $("#navRight");
  function setNav({ title = "", back = false, actions = "", solid = false } = {}) {
    navTitle.textContent = title;
    navLeft.innerHTML = back ? `<button class="back" id="backBtn">${I.back}<span>${esc(back === true ? "Back" : back)}</span></button>` : "";
    if (back) $("#backBtn").onclick = () => { if (history.length > 1 && S.navDepth > 0) history.back(); else location.hash = "#/"; };
    $$(".act", navRight).forEach((x) => x.remove());
    if (actions) navRight.insertAdjacentHTML("afterbegin", actions);
    S.navSolid = solid;
    onScroll();
  }
  function onScroll() { nav.classList.toggle("solid", S.navSolid || window.scrollY > 30); }
  window.addEventListener("scroll", onScroll, { passive: true });
  function setTab(name) {
    $$(".tabbar a").forEach((a) => a.classList.toggle("on", a.dataset.tab === name));
    document.body.classList.toggle("full", name === "full");
  }

  // ---------- status words ----------
  function statusLine(it, opts = {}) {
    // Quiet second line: platform, live word, delay, prediction.
    const parts = [];
    if (it.cancelled || it.skipped) parts.push(`<span class="bad-t">${it.skipped ? "Not stopping" : "Cancelled"}</span>`);
    else if (it.realtime) {
      const s = it.status || {};
      if (s.key === "late" || s.key === "early") parts.push(`<span class="late-t">${esc(s.text)}</span>`);
      else parts.push("On time");
    } else parts.push("Scheduled");
    if (it.platform && !opts.noPlatform) parts.push(esc(it.platform.replace(/^Platform /, "Plat. ")));
    if (it.platformChangedFrom) parts.push(`<span class="late-t">changed from ${esc(it.platformChangedFrom.replace(/^Platform /, ""))}</span>`);
    if (it.realtime && it.stopsAway != null && it.vehicle) parts.push(it.stopsAway === 0 ? "arriving" : `${it.stopsAway} stop${it.stopsAway > 1 ? "s" : ""} away`);
    if (it.occupancy && it.occupancy.level >= 2) parts.push(esc(it.occupancy.text));
    if (it.pred && (!it.realtime || mins(tms(it.estimated || it.planned)) >= 15)) parts.push(`<span class="pred-t">${esc(it.pred.short)}*</span>`);
    return parts.join(" \u00b7 ");
  }
  function svcLink(it, extra = {}) {
    return "#/svc?" + qs({ trip: it.tripId, mode: it.mode, line: it.line, stop: it.stopId, destId: it.destId, planned: it.planned, dest: it.dest || it.towards, stopName: it.stopName || it.from, color: it.color, platform: it.platform || it.fromPlatform, ...extra });
  }
  function isWatched(it) {
    return S.watches.some((w) => w.active && w.legs && w.legs.some((l) => (it.tripId && l.tripId === it.tripId) || (l.line === it.line && l.planned === it.planned)));
  }
  let rowSeq = 0;
  const rowData = new Map();
  function depRow(it, opts = {}) {
    const t = tms(it.estimated || it.planned);
    const changed = it.realtime && it.estimated && it.planned && Math.abs(tms(it.estimated) - tms(it.planned)) >= 60000;
    const k = "r" + (++rowSeq);
    rowData.set(k, it);
    const cls = it.cancelled || it.skipped ? "is-bad" : it.realtime ? (it.status && it.status.key === "late" ? "is-late" : "is-live") : "";
    return `<div class="swipe" data-row="${k}"><div class="swipe-actions"><button class="sa-star" data-act="star">${I.starOn}Star stop</button><button class="sa-watch" data-act="watch">${I.bell}Watch</button></div>
      <a class="dep" href="${svcLink(it)}">${isWatched(it) ? '<span class="watching-dot" title="Watching"></span>' : ""}
      ${lb(it.line, it.color)}
      <div class="mid"><div class="dest">${esc(it.dest)}</div><div class="sub">${statusLine(it, opts)}</div></div>
      <div class="when"><div class="mins ${cls}">${it.realtime && !it.cancelled ? I.rt : ""}<span class="mins-n" data-t="${t}">${minsHtml(t)}</span></div>
      <div class="clock">${fmtClock(t)}</div></div></a></div>`;
  }

  // Swipe left on a row to reveal Watch and Star.
  (function swipeRows() {
    let st = null;
    const W = 168;
    const closeAll = (except) => $$(".dep.open").forEach((d) => { if (d !== except) { d.classList.remove("open"); d.style.transform = ""; } });
    view.addEventListener("pointerdown", (e) => {
      const dep = e.target.closest(".swipe .dep");
      if (!dep || e.pointerType === "mouse" && e.button !== 0) return;
      st = { dep, x: e.clientX, y: e.clientY, base: dep.classList.contains("open") ? -W : 0, dx: 0, active: false, id: e.pointerId };
    });
    view.addEventListener("pointermove", (e) => {
      if (!st || e.pointerId !== st.id) return;
      const dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (!st.active) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { st = null; return; }
        if (Math.abs(dx) > 10) { st.active = true; st.dep.classList.add("dragging"); closeAll(st.dep); }
        else return;
      }
      st.dx = dx;
      const x = Math.min(0, Math.max(-W - 40, st.base + dx));
      st.dep.style.transform = `translateX(${x}px)`;
    });
    const end = (e) => {
      if (!st) return;
      const s = st; st = null;
      if (!s.active) return;
      s.dep.classList.remove("dragging");
      const x = s.base + s.dx;
      const open = x < -W / 2.5;
      s.dep.classList.toggle("open", open);
      s.dep.style.transform = open ? `translateX(${-W}px)` : "";
      s.dep.dataset.dragged = "1";
      setTimeout(() => { delete s.dep.dataset.dragged; }, 350);
    };
    view.addEventListener("pointerup", end);
    view.addEventListener("pointercancel", end);
    view.addEventListener("click", (e) => {
      const dep = e.target.closest(".swipe .dep");
      if (dep && (dep.dataset.dragged || dep.classList.contains("open"))) { e.preventDefault(); if (!dep.dataset.dragged) { dep.classList.remove("open"); dep.style.transform = ""; } return; }
      const act = e.target.closest(".swipe-actions button");
      if (act) {
        e.preventDefault();
        const row = act.closest(".swipe");
        const it = rowData.get(row.dataset.row);
        const d = $(".dep", row); d.classList.remove("open"); d.style.transform = "";
        if (!it) return;
        if (act.dataset.act === "watch") openWatchSheet(svcSpec(it));
        else starStop(it.stopId, short(it.stopName || it.from || "Stop " + it.stopId));
      } else if (!e.target.closest(".swipe")) closeAll();
    }, true);
  })();
  // Home items (saved trips, recents, starred stops): tap and hold, right click, or swipe left
  // to open their actions (Edit, Delete, Remove from Recent).
  (function itemGestures() {
    let st = null, timer = 0;
    const cancel = () => { clearTimeout(timer); timer = 0; };
    const fired = (el) => { el.dataset.fired = "1"; setTimeout(() => { delete el.dataset.fired; }, 450); };
    view.addEventListener("pointerdown", (e) => {
      const el = e.target.closest("[data-item]");
      if (!el || !S.itemActions || e.target.closest(".grip, .rm-btn, .gclear") || (e.pointerType === "mouse" && e.button !== 0)) return;
      const mv = el.querySelector(".tcard, .rrow, .sblock") || el;
      st = { el, mv, x: e.clientX, y: e.clientY, dx: 0, active: false, id: e.pointerId };
      timer = setTimeout(() => {
        if (!st || st.active) return;
        const k = st.el.dataset.item; fired(st.el); st = null;
        if (navigator.vibrate) try { navigator.vibrate(12); } catch (err) { /* ignore */ }
        S.itemActions(k);
      }, 550);
    });
    view.addEventListener("pointermove", (e) => {
      if (!st || e.pointerId !== st.id) return;
      const dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (!st.active) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { cancel(); st = null; return; }
        if (Math.abs(dx) <= 10) return;
        cancel();
        if (dx > 0) { st = null; return; }
        st.active = true; st.mv.classList.add("swiping");
      }
      st.dx = Math.min(0, dx);
      st.mv.style.transform = `translateX(${Math.max(-150, st.dx)}px)`;
      st.el.classList.toggle("sw-armed", st.dx < -72);
    });
    const end = () => {
      cancel();
      if (!st) return;
      const s = st; st = null;
      if (!s.active) return;
      s.mv.classList.remove("swiping"); s.mv.style.transform = ""; s.el.classList.remove("sw-armed");
      fired(s.el);
      if (s.dx < -72) S.itemActions(s.el.dataset.item);
    };
    view.addEventListener("pointerup", end);
    view.addEventListener("pointercancel", end);
    view.addEventListener("click", (e) => { const el = e.target.closest("[data-item]"); if (el && el.dataset.fired && !e.target.closest(".rm-btn")) { e.preventDefault(); e.stopPropagation(); } }, true);
    view.addEventListener("dragstart", (e) => { if (e.target.closest && e.target.closest("[data-item]")) e.preventDefault(); });
    view.addEventListener("contextmenu", (e) => { const el = e.target.closest("[data-item]"); if (el && S.itemActions) { e.preventDefault(); cancel(); st = null; S.itemActions(el.dataset.item); } });
  })();
  function starStop(id, name) {
    let s = stars();
    if (s.some((x) => x.id === id)) { toast(`${name} is already starred`); return; }
    s.unshift({ id, name }); LS.set("tb_stars", s.slice(0, 10));
    toast(`Starred ${name}. It's on Home now.`);
  }
  function alertsHtml(alerts) {
    if (!alerts || !alerts.length) return "";
    const items = alerts.map((a) => `<div class="alert${/high/i.test(a.priority) ? " high" : ""}"><span class="ai">${I.alert}</span><div>${a.lines && a.lines.length ? `<b>${esc(a.lines.join(", "))}</b> ` : ""}${esc(a.title)}</div></div>`).join("");
    return `<div class="group"><details class="list alerts"><summary><span class="ai">${I.alert}</span>${alerts.length} service alert${alerts.length > 1 ? "s" : ""}${I.chev}</summary>${items}</details></div>`;
  }

  // ---------- modal sheet ----------
  let modalEl = null, scrimEl = null;
  function openModal({ title, left = "Cancel", right = "", body, onRight, onOpen }) {
    closeModal(true);
    scrimEl = document.createElement("div"); scrimEl.className = "scrim";
    modalEl = document.createElement("div"); modalEl.className = "modal"; modalEl.setAttribute("role", "dialog"); modalEl.setAttribute("aria-label", title);
    modalEl.innerHTML = `<div class="grab"></div><div class="modal-h"><button class="l" data-m="close">${esc(left)}</button><h2>${esc(title)}</h2>${right ? `<button class="r" data-m="right">${esc(right)}</button>` : "<span></span>"}</div><div class="modal-b">${body}</div>`;
    document.body.append(scrimEl, modalEl);
    requestAnimationFrame(() => { scrimEl.classList.add("on"); modalEl.classList.add("on"); });
    scrimEl.onclick = () => closeModal();
    $("[data-m=close]", modalEl).onclick = () => closeModal();
    const r = $("[data-m=right]", modalEl); if (r && onRight) r.onclick = onRight;
    if (onOpen) onOpen(modalEl);
    return modalEl;
  }
  function closeModal(now_) {
    const m = modalEl, s = scrimEl;
    modalEl = scrimEl = null;
    if (!m) return;
    if (now_) { m.remove(); s.remove(); return; }
    m.classList.remove("on"); s.classList.remove("on");
    setTimeout(() => { m.remove(); s.remove(); }, 320);
  }

  // ---------- in app banner (fallback for notifications) ----------
  const banner = $("#banner");
  function showBanner(n) {
    $("#bannerT").textContent = n.title; $("#bannerB").textContent = n.body;
    banner.onclick = () => { banner.classList.remove("on"); if (n.url) location.href = n.url; };
    banner.classList.add("on");
    if (navigator.vibrate) try { navigator.vibrate(60); } catch (e) { /* ignore */ }
    clearTimeout(showBanner.h); showBanner.h = setTimeout(() => banner.classList.remove("on"), 7000);
  }

  // ---------- push notifications ----------
  let swReg = null;
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").then((r) => { swReg = r; syncPush(); }).catch(() => {});
    navigator.serviceWorker.addEventListener("message", (e) => {
      const d = e.data || {};
      if (d.type === "push") { LS.set("tb_last_note", Math.max(LS.get("tb_last_note", 0), d.id || 0)); if (!document.hidden) showBanner(d); pollWatches(); }
    });
  }
  function keyBytes(b64) {
    const p = "=".repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + p).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }
  let vapidKey = null;
  fetch("/api/push/key").then((r) => r.json()).then((d) => { vapidKey = d.publicKey; }).catch(() => {});
  function pushState() {
    if (!pushCapable) return isIOS && !standalone ? "install" : "unsupported";
    if (Notification.permission === "denied") return "denied";
    if (Notification.permission === "granted" && S.push) return "on";
    return "off";
  }
  async function syncPush() {
    // Keep the server copy of this device's subscription fresh.
    if (!pushCapable || Notification.permission !== "granted" || !swReg) return;
    try {
      const sub = await swReg.pushManager.getSubscription();
      if (sub) { S.push = { endpoint: sub.endpoint }; LS.set("tb_push", S.push); await post("/api/push/subscribe", { device: DEVICE, profile: PROFILE, subscription: sub.toJSON() }); }
      else { S.push = null; LS.set("tb_push", null); }
    } catch (e) { /* retry next load */ }
  }
  // Call straight from a tap: iPhone only shows the permission prompt inside a user gesture.
  async function enablePush(welcome = true) {
    if (!pushCapable) return { ok: false, why: pushState() };
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    if (perm !== "granted") return { ok: false, why: "denied" };
    const reg = swReg || (await navigator.serviceWorker.ready);
    if (!vapidKey) vapidKey = (await fetch("/api/push/key").then((r) => r.json())).publicKey;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidKey) });
    await post("/api/push/subscribe", { device: DEVICE, profile: PROFILE, subscription: sub.toJSON(), welcome });
    S.push = { endpoint: sub.endpoint }; LS.set("tb_push", S.push);
    return { ok: true };
  }
  function pushWhyText(why) {
    if (why === "install") return "On iPhone, alerts work once this app is on your Home Screen. Watching anyway: you'll see alerts while the app is open.";
    if (why === "denied") return "Notifications are blocked for this site. Turn them on in your phone's settings. Watching anyway: you'll see alerts while the app is open.";
    return "This browser can't do notifications. Watching anyway: you'll see alerts while the app is open.";
  }

  // ---------- watching ----------
  function svcSpec(it, extra = {}) {
    return {
      kind: "svc", title: `${it.line} to ${short(it.dest || it.towards)}`,
      legs: [{ mode: it.mode, line: it.line, tripId: it.tripId, stopId: it.stopId, toStopId: extra.toStopId || null, from: short(it.stopName || it.from), to: extra.toName || null,
        planned: it.planned, arrPlanned: extra.arrPlanned || null, estimated: it.estimated, fromPlatform: it.platform || it.fromPlatform || "", color: it.color, towards: short(it.dest || it.towards), destId: it.destId }],
      lead: 5, askLead: true, stops: extra.stops || null,
    };
  }
  function tripSpec(j, from, to) {
    const legs = [];
    let walk = 0;
    for (const x of j.legs) {
      if (x.kind === "walk") { walk += x.durationMin; continue; }
      legs.push({ mode: x.mode, line: x.line, tripId: x.tripId, stopId: x.stopId, toStopId: x.toStopId, from: x.from, to: x.to, planned: x.planned, arrPlanned: x.arrPlanned,
        estimated: x.estimated, fromPlatform: x.fromPlatform, toPlatform: x.toPlatform, color: x.color, towards: short(x.towards), destId: x.destId, walkBefore: walk });
      walk = 0;
    }
    return { kind: "trip", title: `${short(from.name)} to ${short(to.name)}`, legs, origin: from, to, lead: null, walkBefore: legs[0] ? legs[0].walkBefore : 0, fare: j.fare || null };
  }
  function openWatchSheet(spec) {
    const L0 = spec.legs[0];
    if (!L0 || !L0.planned) { toast("This one can't be watched."); return; }
    let lead = spec.kind === "trip" ? 0 : 5;
    let toStop = null;
    const leads = spec.kind === "trip" ? [[0, "On time"], [2, "+2 min"], [5, "+5 min"], [10, "+10 min"]] : [[0, "At the stop"], [3, "3 min"], [5, "5 min"], [10, "10 min"], [15, "15 min"]];
    const ps = pushState();
    const later = (spec.stops || []).filter((s, i, a) => i > a.findIndex((x) => x.mine) && a.findIndex((x) => x.mine) >= 0);
    const body = `
      <div class="group"><div class="list"><div class="cell static">${lb(L0.line, L0.color)}<div class="grow"><div class="t1" style="font-weight:600">${esc(spec.title)}</div><div class="t2">${spec.kind === "trip" ? `${spec.legs.length} leg${spec.legs.length > 1 ? "s" : ""} \u00b7 leave ${fmtClock(tms(L0.estimated || L0.planned) - (spec.walkBefore || 0) * 60000)}` : `${esc(L0.from || "")} \u00b7 ${fmtClock(tms(L0.estimated || L0.planned))}`}</div></div></div></div></div>
      <div class="group-h">${spec.kind === "trip" ? `Leave buffer${spec.walkBefore ? ` (walk of ${spec.walkBefore} min included)` : ""}` : "Time to get to the stop"}</div>
      <div class="group"><div class="choice" id="leadChoice">${leads.map(([v, t]) => `<button data-v="${v}" class="${v === lead ? "on" : ""}">${t}</button>`).join("")}</div></div>
      ${later.length ? `<div class="group-h">Remind me before my stop</div><div class="group"><div class="list"><label class="cell static"><div class="grow">Get off at</div><select class="plain" id="alightSel"><option value="">Not needed</option>${later.map((s) => `<option value="${esc(s.id)}" data-t="${esc(s.planned || "")}">${esc(short(s.name))}</option>`).join("")}</select></label></div></div>` : ""}
      <div class="group-h">You'll get</div>
      <div class="group"><div class="list">
        ${[["Leave now", "When it's time to head out"], ["Delays", "When it gets 3 or more minutes later or earlier"], ["Platform changes", "And cancellations, with the next service"], spec.legs.length > 1 ? ["Connection rescue", "If a late leg means a missed change, a new plan"] : null, ["Arriving", "Two minutes before your stop"]].filter(Boolean).map(([a, b]) => `<div class="cell static"><div class="grow"><div class="t1">${a}</div><div class="t2">${b}</div></div></div>`).join("")}
      </div></div>
      <div class="group"><button class="btn" id="startWatch">${I.bell}Start watching</button>
      ${ps === "on" ? "" : `<p class="group-f">${ps === "install" ? "On iPhone, notifications need this app on your Home Screen first (Share, then Add to Home Screen). You'll still get alerts here while it's open." : ps === "denied" ? "Notifications are blocked for this site, so alerts show while the app is open." : ps === "unsupported" ? "This browser can't show notifications, so alerts show while the app is open." : "Your phone will ask to allow notifications. Say Allow so alerts reach your lock screen."}</p>`}</div>`;
    openModal({ title: "Watch trip", body, onOpen: (m) => {
      $$("#leadChoice button", m).forEach((b) => (b.onclick = () => { lead = Number(b.dataset.v); $$("#leadChoice button", m).forEach((x) => x.classList.toggle("on", x === b)); }));
      const sel = $("#alightSel", m);
      if (sel) sel.onchange = () => { const o = sel.selectedOptions[0]; toStop = sel.value ? { id: sel.value, name: o.textContent, t: o.dataset.t } : null; };
      $("#startWatch", m).onclick = async (e) => {
        const btn = e.currentTarget; btn.disabled = true; btn.textContent = "Starting...";
        let note = null;
        if (pushState() === "off") {
          try { const r = await enablePush(false); if (!r.ok) note = pushWhyText(r.why); } catch (err) { note = "Couldn't turn on notifications here. You'll still see alerts while the app is open."; }
        } else if (pushState() !== "on") note = pushWhyText(pushState());
        const legs = spec.legs.map((l) => ({ ...l }));
        if (toStop && spec.kind === "svc") { legs[0].toStopId = toStop.id; legs[0].to = toStop.name; legs[0].arrPlanned = toStop.t || null; }
        try {
          const r = await post("/api/watch", { device: DEVICE, profile: PROFILE, kind: spec.kind, title: spec.title, legs, origin: spec.origin, to: spec.to || (toStop ? { id: toStop.id, name: toStop.name } : null), lead: spec.kind === "trip" ? (spec.walkBefore || 0) + lead : lead });
          closeModal();
          toast(note || "Watching. I'll buzz you.");
          await pollWatches();
          if (r.watch && location.hash.startsWith("#/watching")) route();
        } catch (err) { btn.disabled = false; btn.textContent = "Start watching"; toast(err.message); }
      };
    } });
  }
  async function stopWatch(id) {
    await api("/api/watch?" + qs({ id, device: DEVICE }), { method: "DELETE" }).catch(() => {});
    S.watches = S.watches.map((w) => (w.id === id ? { ...w, active: false } : w));
    paintWatchCount();
  }
  function paintWatchCount() {
    const n = S.watches.filter((w) => w.active).length;
    const c = $("#watchCount"); c.hidden = !n; c.textContent = n;
  }
  async function pollWatches() {
    try {
      const d = await fetch("/api/watches?" + qs({ device: DEVICE, profile: PROFILE, since: LS.get("tb_last_note", 0) })).then((r) => r.json());
      S.watches = d.items || [];
      LS.set("tb_watch_cache", S.watches);
      paintWatchCount();
      const fresh = (d.notes || []).filter((n) => n.id > LS.get("tb_last_note", 0));
      if (fresh.length) {
        LS.set("tb_last_note", Math.max(...fresh.map((n) => n.id)));
        // Phones with notifications on already got these on the lock screen.
        if (!document.hidden && LS.get("tb_seen_init", false)) showBanner(fresh[0]);
      }
      LS.set("tb_seen_init", true);
      return d;
    } catch (e) { return null; }
  }
  setInterval(() => { if (!document.hidden) pollWatches(); }, 20000);

  function watchStatus(w) {
    const sn = w.snap;
    const legs = w.legs || [];
    if (!sn || !legs.length) return { head: "Starting", sub: "", t: null };
    const L = sn.legs || [];
    if (!w.active) return { head: w.ended === "stopped" ? "Stopped" : "Trip ended", sub: "", t: null, done: true };
    const bi = L.findIndex((o) => o.dep > now() - 30000);
    if (bi === -1) {
      const last = L[L.length - 1];
      return { head: last && last.arr ? `Arriving ${fmtClock(last.arr)}` : "On board", sub: legs[legs.length - 1].to ? `at ${short(legs[legs.length - 1].to)}` : "", t: last && last.arr, riding: true };
    }
    const o = L[bi], l = legs[bi];
    const lead = bi === 0 ? (w.lead != null ? w.lead : l.walkBefore || 0) : 0;
    const leave = o.dep - lead * 60000;
    const live = o.depLive ? (o.delay >= 2 ? `${o.delay} min late` : o.delay <= -2 ? `${-o.delay} min early` : "on time") : "scheduled";
    return { head: bi === 0 ? "Leave in" : "Next leg in", t: bi === 0 ? leave : o.dep, line: l, sub: `${l.line} ${fmtClock(o.dep)}${o.platform ? " \u00b7 " + o.platform : ""} \u00b7 ${live}${o.simulated ? " (test)" : ""}`, cls: o.cancelled ? "" : o.depLive ? (o.delay >= 2 ? "is-late" : "is-live") : "", cancelled: o.cancelled, platformFrom: o.platformFrom };
  }
  function watchCard(w) {
    const s = watchStatus(w);
    const b = s.t ? bigText(s.t) : null;
    return `<a class="card" href="#/watch/${esc(w.id)}">
      <div class="card-k"><span class="dot" style="background:#ff9500"></span>Watching${w.replanned ? " \u00b7 new plan" : ""}</div>
      <div class="card-t">${esc(w.title)}</div>
      ${b ? `<div class="big"><span class="u">${esc(s.head)}</span><span class="n big-n ${s.cls || ""}" data-t="${s.t}">${esc(b.n)}</span><span class="u">${esc(b.u)}</span></div>` : `<div class="big"><span class="n" style="font-size:28px">${esc(s.head)}</span></div>`}
      <div class="meta">${s.cancelled ? '<span class="bad-t">Cancelled</span> \u00b7 ' : ""}${s.platformFrom ? `<span class="late-t">Platform changed</span> \u00b7 ` : ""}${esc(s.sub)}</div>
      <div class="chain">${(w.legs || []).map((l) => lb(l.line, l.color, true)).join(I.arrow)}</div></a>`;
  }

  // ---------- home ----------
  // Home is a live board: your trips with their next services, your stops with their
  // next departures, stops near you. It refreshes every 15 s and every countdown ticks.
  const recentStops = () => LS.get("tb_rstops", []);
  function addRecentStop(id, name) { if (!id) return; const r = recentStops().filter((x) => x.id !== id); r.unshift({ id, name }); LS.set("tb_rstops", r.slice(0, 8)); }
  const places = () => LS.get("tb_places", {});
  const recentTrips = () => LS.get("tb_rtrips", []);
  const rtKey = (r) => r.from.id + ">" + r.to.id;
  function removeRecentTrip(key) { LS.set("tb_rtrips", recentTrips().filter((r) => rtKey(r) !== key)); }
  function removeRecentStop(id) { LS.set("tb_rstops", recentStops().filter((s) => s.id !== id)); }
  // A saved trip is deleted on this phone and on the server.
  function deleteSaved(t) {
    const k = tripKey(t);
    LS.set("tb_saved", saved().filter((s) => tripKey(s) !== k));
    LS.set("tb_order", LS.get("tb_order", []).filter((x) => x !== k));
    if (t.name) fetch("/api/saved?" + qs({ profile: PROFILE, name: t.name }), { method: "DELETE" }).catch(() => {});
  }
  // A small iOS style action sheet: a title, actions, and Cancel.
  function actionSheet(title, acts) {
    const m = openModal({ title, body: `<div class="group"><div class="list">${acts.map((x, i) => `<button class="cell sheet-act${x.danger ? " danger-t" : ""}" data-sa="${i}"><div class="grow">${esc(x.label)}</div></button>`).join("")}</div>${acts.note ? `<p class="group-f">${esc(acts.note)}</p>` : ""}</div>` });
    $$("[data-sa]", m).forEach((b) => (b.onclick = () => { closeModal(); acts[Number(b.dataset.sa)].run(); }));
  }
  function addRecentTrip(from, to) { if (!from.id || !to.id) return; const r = recentTrips().filter((x) => !(x.from.id === from.id && x.to.id === to.id)); r.unshift({ from, to }); LS.set("tb_rtrips", r.slice(0, 6)); }
  const SEARCH_ICO = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10.5 3a7.5 7.5 0 0 1 5.96 12.06l4.24 4.24-1.4 1.4-4.24-4.24A7.5 7.5 0 1 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z"/></svg>';
  const PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>';

  // Live data hold: a service that was live keeps its last delay for 10 minutes if the feed drops it.
  const HOLD_MS = 600000;
  const holdMem = LS.get("tb_hold", {});
  function legKey(l) { return l.tripId || `${l.line}|${l.planned}`; }
  function legStatus(l) {
    if (!l) return { w: "Scheduled", c: "sched" };
    if (l.cancelled) return { w: "Cancelled", c: "bad" };
    const k = legKey(l);
    if (l.realtime) {
      holdMem[k] = { d: l.delayMin || 0, at: Date.now() };
      const d = l.delayMin || 0;
      return d >= 1 ? { w: `${d} min late`, c: "late", live: true } : d <= -1 ? { w: `${-d} min early`, c: "ok", live: true } : { w: "On time", c: "ok", live: true };
    }
    const h = holdMem[k];
    if (h && Date.now() - h.at < HOLD_MS) return { w: h.d >= 1 ? `Last reported ${h.d} min late` : h.d <= -1 ? `Last reported ${-h.d} min early` : "Last reported on time", c: h.d >= 1 ? "late" : "sched", held: true, delay: h.d };
    if (h) return { w: "Live data unavailable", c: "sched" };
    return { w: "Scheduled", c: "sched" };
  }
  function saveHold() { const cut = Date.now() - 3 * HOLD_MS; for (const k of Object.keys(holdMem)) if (holdMem[k].at < cut) delete holdMem[k]; LS.set("tb_hold", holdMem); }
  const platShort = (p) => String(p || "").replace(/^Platform\s*/i, "Plat ").replace(/^Stand\s*/i, "Stand ").replace(/^Wharf\s*/i, "Wharf ");

  function journeyTimes(j) {
    const legs = j.legs || [];
    const first = legs.find((x) => x.kind === "transit");
    const last = [...legs].reverse().find((x) => x.kind === "transit");
    const walkBefore = legs.slice(0, Math.max(0, legs.indexOf(first))).reduce((a, l) => a + (l.durationMin || 0), 0);
    let dep = first ? tms(first.estimated || first.planned) : tms(j.leave);
    const st = legStatus(first);
    if (first && st.held && !first.realtime) dep = tms(first.planned) + st.delay * 60000;
    const leave = dep - walkBefore * 60000;
    const arr = last ? tms(last.arrEstimated || last.arrPlanned) : tms(j.arrive);
    return { first, leave, dep, arr, st, dur: Math.round((arr - leave) / 60000), changes: j.changes || 0 };
  }
  // Countdown chip colour by time left: red when it is about to go, amber soon, green with time to spare.
  function cdClass(t, st) { if (st && st.c === "bad") return "cd-x"; const m = mins(t); return m <= 3 ? "cd-r" : m <= 9 ? "cd-a" : "cd-g"; }
  function crowd(l) {
    const lv = l && l.occupancy && l.occupancy.level;
    if (!lv) return "";
    const n = Math.max(1, Math.min(3, lv));
    const p = '<svg viewBox="0 0 10 16" aria-hidden="true"><circle cx="5" cy="3" r="2.6"/><path d="M1 15V9a4 4 0 0 1 8 0v6Z"/></svg>';
    return `<span class="crowd" title="${esc(l.occupancy.text || "")}" aria-label="${esc(l.occupancy.text || "")}">${[1, 2, 3].map((i) => `<i class="${i <= n ? "on" : ""}">${p}</i>`).join("")}</span>`;
  }
  function svcRow(j, x, beaten, lead, origin) {
    const tl = (j.legs || []).filter((l) => l.kind === "transit");
    const m = mins(x.leave);
    const cdn = m === 0 ? "Now" : m < 60 ? String(m) : fmtClock(x.leave);
    const fromStop = x.first ? short(x.first.from || "") : "";
    const plat = x.first && x.first.fromPlatform ? String(x.first.fromPlatform) : "";
    const from = fromStop && origin && fromStop !== short(origin) ? `${fromStop}${plat ? ", " + platShort(plat) : ""}` : plat || fromStop;
    const plc = x.first && x.first.platformChangedFrom ? `<div class="svc-note">Platform changed from ${esc(platShort(x.first.platformChangedFrom))}</div>` : "";
    return `<div class="svc${beaten ? " beaten" : ""}${lead ? " lead" : ""}${x.st.c === "bad" ? " cancelled" : ""}">
      <div class="cdb ${cdClass(x.leave, x.st)}"><span class="cdb-n${cdn.length > 3 ? " xs" : cdn.length > 2 ? " sm" : ""}" data-cd="${x.leave}">${esc(cdn)}</span><span class="cdb-u"${m > 0 && m < 60 ? "" : " hidden"}>min</span></div>
      <div class="svc-l"><div class="svc-k">${esc(from)}</div><div class="svc-t">${fmtClock(x.dep)}</div><div class="stw st-${x.st.c}"><i class="sq"></i>${esc(x.st.w)}</div>${plc}</div>
      <div class="svc-r"><div class="svc-k">${tl.map((l) => lb(l.line, l.color, true)).join("")}${x.changes ? ` \u00b7 ${x.changes} change${x.changes > 1 ? "s" : ""}` : ""}</div><div class="svc-t">${fmtClock(x.arr)}</div><div class="svc-k">${crowd(x.first)}${x.dur} min${fareChip(j.fare)}</div></div></div>${j.warn ? `<div class="svc-warn${j.risk === "miss" || j.anyCancelled ? " bad" : ""}">${I.alert}<span>${esc(j.warn)}</span></div>` : ""}`;
  }
  function tripCard(t, d) {
    const href = tripHref(t);
    const js0 = d && d.journeys ? d.journeys.map((j) => ({ j, x: journeyTimes(j) })).filter((o) => o.x.leave > now() - 30000) : [];
    const js = directFilter(js0, t).list.slice(0, 3);
    const alerts = new Set();
    js.forEach((o) => (o.j.legs || []).forEach((l) => (l.alerts || []).forEach((a) => alerts.add(a.title))));
    const stripe = (js[0] && js[0].x.first && js[0].x.first.color) || "var(--tint)";
    let rows = "";
    if (js.length) rows = js.map((o, i) => svcRow(o.j, o.x, js.slice(i + 1).some((p) => p.x.arr < o.x.arr - 30000), i === 0, t.from.name)).join("");
    else rows = `<div class="svc-empty">${d ? "No services found right now" : "Loading live times"}</div>`;
    const tag = t.tag ? t.tag : t.kind === "commute" ? (t.todText || "Commute") : t.kind === "saved" && t.name && !/ to /.test(t.name) ? cap(t.name) : "";
    return `<div class="tcard" data-tk="${esc(t.okey || tripKey(t))}"><a class="tcard-h" href="${href}"><span class="stripe" style="background:${esc(stripe)}"></span><span class="tname"><b>${esc(short(t.from.name))}</b><b>${esc(short(t.to.name))}</b>${isChain(t) ? `<small class="tvia">${tLegs(t).length} legs via ${esc(viaText(t))}</small>` : ""}</span>${tag ? `<span class="tsub">${esc(tag)}</span>` : ""}${t.grip ? "" : I.chev}</a>${t.grip ? `<button class="grip" aria-label="Drag to reorder" title="Drag to reorder">${MI.grip}</button>` : ""}
      ${alerts.size ? `<a class="talerts" href="${href}">${I.alert}<span>${alerts.size} alert${alerts.size > 1 ? "s" : ""}</span></a>` : ""}
      <a class="tcard-b" href="${href}">${rows}</a></div>`;
  }
  function chainHtml(j) {
    const parts = [];
    j.legs.forEach((l) => {
      if (l.kind === "walk") { if (l.durationMin >= 2) parts.push(`<span class="walk">${I.walk}${l.durationMin}</span>`); }
      else parts.push(lb(l.line, l.color, true));
    });
    return `<div class="chain">${parts.join(I.arrow)}</div>`;
  }
  // One stop: header with its name, then the next services grouped by line and destination.
  function stopBlock(s, d, extra) {
    const href = `#/stop/${encodeURIComponent(s.id)}?${qs({ name: s.name })}`;
    let rows = "";
    if (d && d.items) {
      const groups = [];
      for (const it of d.items) {
        if (it.cancelled || it.skipped) continue;
        const t = tms(it.estimated || it.planned);
        if (t < now() - 5000) continue;
        const k = `${it.line}|${it.dest}`;
        let g = groups.find((x) => x.k === k);
        if (!g) { if (groups.length >= 3) continue; g = { k, it, ts: [] }; groups.push(g); }
        if (g.ts.length < 2) g.ts.push({ t, live: it.realtime, late: it.realtime && it.delayMin >= 2 });
      }
      rows = groups.map((g) => `<div class="sdep">${lb(g.it.line, g.it.color, true)}<span class="sdest">${esc(short(g.it.dest))}</span>
        <span class="stimes"><span class="cd1 ${g.ts[0].live ? (g.ts[0].late ? "st-late" : "st-ok") : ""}">${g.ts[0].live ? I.rt : ""}<span class="mins-n" data-t="${g.ts[0].t}">${minsHtml(g.ts[0].t)}</span></span>${g.ts[1] ? `<span class="cd2"><span class="mins-n" data-t="${g.ts[1].t}">${minsHtml(g.ts[1].t)}</span></span>` : ""}</span></div>`).join("") || `<div class="svc-empty">No services in the next hour</div>`;
    } else rows = `<div class="svc-empty">${d === null ? "Live times are slow to load, trying again" : "Loading live times"}</div>`;
    return `<a class="sblock" href="${href}"><div class="sblock-h">${s.star ? `<span class="tico saved">${I.starOn}</span>` : ""}<span class="tname">${esc(short(s.name))}</span>${extra ? `<span class="tsub">${esc(extra)}</span>` : ""}${I.chev}</div>${rows}</a>`;
  }

  // Nearby: the live feed can list each platform of a station; group them and find the station id.
  const parentMem = LS.get("tb_parent", {});
  async function nearbyStations(c) {
    const d = await api("/api/nearby?" + qs({ lat: c.latitude.toFixed(5), lon: c.longitude.toFixed(5) }));
    const groups = [];
    for (const s of d.stops || []) {
      const base = String(s.name || "").split(",")[0].trim();
      let g = groups.find((x) => x.base === base);
      if (!g) { g = { base, id: s.id, name: s.name, distance: s.distance, n: 0 }; groups.push(g); }
      g.n++;
    }
    const top = groups.slice(0, 3);
    await Promise.all(top.map(async (g) => {
      if (!(g.n > 1 || /(Station|Wharf)$/.test(g.base))) return;
      if (parentMem[g.base]) { g.id = parentMem[g.base]; g.name = g.base; return; }
      try {
        const r = await fetch("/api/search?" + qs({ q: g.base })).then((x) => x.json());
        const hit = (r.items || [])[0];
        if (hit && String(hit.name).toLowerCase().startsWith(g.base.toLowerCase())) { g.id = hit.id; g.name = g.base; parentMem[g.base] = hit.id; LS.set("tb_parent", parentMem); }
      } catch (e) { /* keep the platform id */ }
    }));
    return top.map((g) => ({ id: g.id, name: g.name, distance: g.distance }));
  }
  const distText = (m) => (m == null ? "" : m < 1000 ? `${Math.round(m / 10) * 10 || m} m` : `${(m / 1000).toFixed(1)} km`);

  function openAddTrip() {
    const pick = { from: null, to: null };
    const fieldHtml = (k, label) => `<div class="cell static pick"><span class="pk">${label}</span><input id="pk_${k}" type="search" autocomplete="off" placeholder="Stop or station" aria-label="${label}"></div>`;
    const m = openModal({ title: "Search any stop", right: "Next", body: `<div class="group"><div class="list">${fieldHtml("from", "From")}${fieldHtml("to", "To")}</div><div id="pkres"></div></div>
`,
      onOpen: (el) => setTimeout(() => $("#pk_from", el).focus(), 350),
      onRight: () => {
        if (!pick.from || !pick.to) { toast("Choose where from and where to"); return; }
        openConfirmTrip({ legs: [{ mode: "", from: pick.from, to: pick.to }] });
      } });
    const res = $("#pkres", m);
    let timer = null, active = "from";
    const showNear = async () => {
      if (!LS.get("tb_loc_ok", 0)) return;
      try {
        const c = await locate(); const near = await nearbyStations(c);
        if (!near.length || $("#pk_" + active, m).value.trim()) return;
        res.innerHTML = `<div class="group-h" style="margin-top:14px">Near you</div><div class="list">${near.map((s, i) => `<button class="cell" data-ni="${i}"><span class="s-ico tintbg">${I.loc}</span><div class="grow"><div class="t1">${esc(short(s.name))}</div><div class="t2">${distText(s.distance)}</div></div></button>`).join("")}</div>`;
        $$("[data-ni]", res).forEach((b) => (b.onclick = () => { const s = near[Number(b.dataset.ni)]; pick[active] = { id: s.id, name: s.name }; $("#pk_" + active, m).value = short(s.name); res.innerHTML = ""; if (active === "from" && !pick.to) $("#pk_to", m).focus(); }));
      } catch (e) { /* location not shared */ }
    };
    showNear();
    ["from", "to"].forEach((k) => {
      const inp = $("#pk_" + k, m);
      inp.addEventListener("focus", () => { active = k; });
      inp.addEventListener("input", () => {
        pick[k] = null; clearTimeout(timer);
        const v = inp.value.trim();
        if (v.length < 2) { res.innerHTML = ""; return; }
        timer = setTimeout(async () => {
          try {
            const d = await fetch("/api/search?" + qs({ q: v })).then((r) => r.json());
            res.innerHTML = (d.items || []).length ? `<div class="list" style="margin-top:12px">${d.items.slice(0, 6).map((s, i) => `<button class="cell" data-pi="${i}"><span class="s-ico">${I.loc}</span><div class="grow"><div class="t1">${esc(s.name)}</div></div></button>`).join("")}</div>` : `<p class="group-f">No stops match that</p>`;
            $$("[data-pi]", res).forEach((b) => (b.onclick = () => {
              const s = d.items[Number(b.dataset.pi)];
              pick[active] = { id: s.id, name: s.name }; $("#pk_" + active, m).value = s.name; res.innerHTML = "";
              if (active === "from" && !pick.to) $("#pk_to", m).focus();
            }));
          } catch (e) { res.innerHTML = ""; }
        }, 220);
      });
    });
  }

  function openPlacePick(kind, after) {
    const label = kind === "home" ? "Home" : "Work";
    const m = openModal({ title: `Set ${label.toLowerCase()}`, body: `<div class="group"><div class="list"><div class="cell static pick"><span class="pk">${label}</span><input id="pp_q" type="search" autocomplete="off" placeholder="Nearest stop or station" aria-label="${label} stop"></div></div><div id="ppres"></div><p class="group-f">Pick the stop or station you use. Your trip between home and work then shows here, home to work in the morning and back in the afternoon.</p></div>`,
      onOpen: (el) => setTimeout(() => $("#pp_q", el).focus(), 350) });
    const inp = $("#pp_q", m), res = $("#ppres", m);
    let timer = null;
    inp.addEventListener("input", () => {
      clearTimeout(timer);
      const v = inp.value.trim();
      if (v.length < 2) { res.innerHTML = ""; return; }
      timer = setTimeout(async () => {
        try {
          const d = await fetch("/api/search?" + qs({ q: v })).then((r) => r.json());
          res.innerHTML = (d.items || []).length ? `<div class="list" style="margin-top:12px">${d.items.slice(0, 6).map((s, i) => `<button class="cell" data-pi="${i}"><span class="s-ico">${I.loc}</span><div class="grow"><div class="t1">${esc(s.name)}</div></div></button>`).join("")}</div>` : `<p class="group-f">No stops match that</p>`;
          $$("[data-pi]", res).forEach((b) => (b.onclick = () => {
            const s = d.items[Number(b.dataset.pi)];
            const p = places(); p[kind] = { id: s.id, name: s.name }; LS.set("tb_places", p);
            closeModal(); toast(`${label} set to ${short(s.name)}`); if (after) after();
          }));
        } catch (e) { res.innerHTML = ""; }
      }, 220);
    });
  }


  // ---------- trips with a connection leg, and direct services ----------
  // A trip can be extended with a second leg: each first leg is joined to the first second leg
  // that leaves at least the connection time after it arrives.
  // A trip is one or more legs, each with its own mode, change time before it, direct services switch and walk time.
  // Trips saved before multi leg trips have from, to and an optional via with conn; tLegs reads both shapes.
  const tLegs = (t) => {
    if (t.legs && t.legs.length) return t.legs;
    const md = t.modes || [];
    return t.via ? [{ mode: md[0] || "", from: t.from, to: t.via }, { mode: md[1] || "", from: t.via, to: t.to, conn: t.conn == null ? 5 : t.conn }] : [{ mode: md[0] || "", from: t.from, to: t.to }];
  };
  const isChain = (t) => tLegs(t).length > 1;
  const tripKey = (t) => [t.from.id, ...tLegs(t).slice(0, -1).map((l) => l.to.id), t.to.id].join(">");
  const wireLegs = (t) => tLegs(t).map((l) => ({ f: l.from.id, fn: l.from.name, t: l.to.id, tn: l.to.name, m: l.mode || "", c: l.conn == null ? 5 : l.conn, a: l.any ? 1 : 0, w: l.walk == null ? 5 : l.walk }));
  const stopsOf = (t) => tLegs(t).slice(0, -1).map((l) => l.to);
  const viaText = (t) => stopsOf(t).map((s) => stName(short(s.name))).join(", ");
  // Link to the trip screen; a multi leg trip carries its legs.
  function tripHref(t, extra = {}) {
    const L = tLegs(t);
    const o = { from: t.from.id, to: t.to.id, fn: t.from.name, tn: t.to.name, name: t.name, ...extra };
    if (L.length > 1) o.legs = JSON.stringify(L.map((l) => ({ mode: l.mode || "", from: l.from, to: l.to, conn: l.conn, any: l.any ? 1 : undefined, walk: l.walk })));
    return "#/trip?" + qs(o);
  }
  // Reverse a trip: legs in the other order, each change time stays with its change stop.
  function reverseTrip(t) {
    const L = tLegs(t), n = L.length;
    const legs = L.map((l, i) => ({ ...L[n - 1 - i], from: L[n - 1 - i].to, to: L[n - 1 - i].from, conn: i ? L[n - i].conn : undefined }));
    return { ...t, from: t.to, to: t.from, legs, via: null };
  }
  const hhmmOf = (t) => { const p = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(t)); return (p.find((x) => x.type === "hour").value % 24).toString().padStart(2, "0") + p.find((x) => x.type === "minute").value; };
  const transitCount = (j) => (j.legs || []).filter((l) => l.kind === "transit").length;
  const isDirect = (j, t) => transitCount(j) <= (t ? tLegs(t).length : 1);
  const allSvc = () => LS.get("tb_allsvc", {});
  // Default: only services that stop at both ends. Falls back to every service when none do.
  function directFilter(list, t, getJ = (o) => o.j) {
    const all = !!allSvc()[tripKey(t)];
    if (all) return { list, all, none: false };
    // Multi leg trips are filtered per leg on the server.
    if (isChain(t)) return { list, all, none: false, chain: true };
    const d = list.filter((o) => isDirect(getJ(o), t));
    return d.length || !list.length ? { list: d, all, none: false } : { list, all, none: true };
  }
  async function planTrip(t, opt = {}) {
    const count = opt.count || 5;
    if (isChain(t)) return api("/api/plan?" + qs({ legs: JSON.stringify(wireLegs(t)), count, time: opt.time, all: allSvc()[tripKey(t)] ? 1 : null, fare: fareT(), acc: accOn() ? 1 : null }));
    if (!t.via) return api("/api/trip?" + qs({ from: t.from.id, to: t.to.id, fromName: t.from.name, toName: t.to.name, count, fare: fareT(), acc: accOn() ? 1 : null, time: opt.time, device: opt.device, profile: opt.profile, refresh: opt.refresh == null ? 1 : opt.refresh }));
    const conn = Math.max(0, Number(t.conn == null ? 5 : t.conn)) * 60000;
    const d1 = await api("/api/trip?" + qs({ from: t.from.id, to: t.via.id, fromName: t.from.name, toName: t.via.name, count, time: opt.time, refresh: 1 }));
    const j1 = (d1.journeys || []).filter((j) => isDirect(j)).map((j) => ({ j, x: journeyTimes(j) }));
    if (!j1.length) return { from: d1.from, to: { id: t.to.id, name: t.to.name }, journeys: [] };
    const firstArr = Math.min(...j1.map((o) => o.x.arr));
    const d2 = await api("/api/trip?" + qs({ from: t.via.id, to: t.to.id, fromName: t.via.name, toName: t.to.name, count: 8, time: hhmmOf(firstArr + conn), refresh: 1 }));
    const j2 = (d2.journeys || []).filter((j) => isDirect(j)).map((j) => ({ j, x: journeyTimes(j) })).sort((a, b) => a.x.leave - b.x.leave);
    const journeys = [];
    for (const a of j1) {
      const b = j2.find((o) => o.x.leave >= a.x.arr + conn);
      if (!b) continue;
      const legs2 = (b.j.legs || []).map((l) => ({ ...l }));
      const f2 = legs2.find((l) => l.kind === "transit");
      const gap = Math.round((b.x.dep - a.x.arr) / 60000);
      if (f2) f2.transfer = { minutes: gap, at: short(t.via.name), risk: gap < conn / 60000 ? "tight" : "" };
      journeys.push({ ...a.j, legs: [...(a.j.legs || []), ...legs2], changes: (a.j.changes || 0) + (b.j.changes || 0) + 1, arrive: b.j.arrive, durationMin: Math.round((b.x.arr - a.x.leave) / 60000) });
    }
    return { from: d1.from, to: d2.to || { id: t.to.id, name: t.to.name }, via: d1.to, journeys };
  }

  // ---------- new trip by mode ----------
  const MODES = [
    { k: "train", name: "Train", color: "#f18a1f", sub: "Sydney Trains and NSW TrainLink" },
    { k: "metro", name: "Metro", color: "#16888c", sub: "Sydney Metro" },
    { k: "bus", name: "Bus", color: "#009ed8", sub: "Route number or stop" },
    { k: "ferry", name: "Ferry", color: "#4fa62e", sub: "Every wharf" },
    { k: "lightrail", name: "Light rail", color: "#dd1e3a", sub: "Sydney, Parramatta and Newcastle" },
  ];
  const MI = {
    metro: P('<path d="M8 3h8a4 4 0 0 1 4 4v8a3 3 0 0 1-2.2 2.9L19 20h-2.2l-1.2-2H8.4l-1.2 2H5l1.2-2.1A3 3 0 0 1 4 15V7a4 4 0 0 1 4-4Zm-2 5v3h12V8H6Zm3 7.5a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Zm6 0a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Z"/>'),
    lightrail: P('<path d="M9 2h6v2h-2l-.5 1H16a3 3 0 0 1 3 3v8a3 3 0 0 1-2 2.83L18.5 21h-2.2l-1.2-2H8.9l-1.2 2H5.5L7 18.83A3 3 0 0 1 5 16V8a3 3 0 0 1 3-3h3.5L11 4H9V2Zm-1 6v4h8V8H8Zm1 9a1.2 1.2 0 1 0 0-2.4A1.2 1.2 0 0 0 9 17Zm6 0a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Z"/>'),
    minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    grip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14M5 12h14M5 16h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  const modeOf = (k) => MODES.find((m) => m.k === k) || { k: "", name: "Any", color: "#8e8e93", sub: "" };
  const modeIco = (k) => MI[k] || I[k] || I.route;
  const mico = (k, sm) => `<span class="mico${sm ? " sm" : ""}" style="background:${modeOf(k).color}">${modeIco(k)}</span>`;
  const stName = (n) => String(n || "").replace(/ (Station|Light Rail|Wharf)$/i, "");
  const stationMem = {};
  const getStations = (mode, route) => {
    const k = mode + (route ? ":" + route : "");
    return stationMem[k] || (stationMem[k] = fetch("/api/stations?" + qs({ mode, route })).then((r) => { if (!r.ok) throw new Error("Could not load the list, check your connection"); return r.json(); }).catch((e) => { delete stationMem[k]; throw e; }));
  };
  const geoDist = (a, b, c, d) => { const R = 6371000, r = Math.PI / 180, x = (d - b) * r * Math.cos(((a + c) / 2) * r), y = (c - a) * r; return Math.sqrt(x * x + y * y) * R; };
  const natCmp = (a, b) => { const na = parseInt(a, 10), nb = parseInt(b, 10); if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb; if (isNaN(na) !== isNaN(nb)) return isNaN(na) ? 1 : -1; return a.localeCompare(b); };

  function openNewTrip(ext) {
    const rows = MODES.map((m) => `<button class="cell" data-mode="${m.k}">${mico(m.k)}<div class="grow"><div class="t1">${m.name}</div><div class="t2">${esc(m.sub)}</div></div>${I.chev}</button>`).join("");
    const m = openModal({ title: ext ? "Extend trip" : "New trip",
      body: `${ext ? `<p class="pkstep">From ${esc(stName(short(ext.from.name)))}, how do you travel on?</p>` : ""}<div class="group"><div class="list" style="--inset:62px">${rows}</div></div>
      ${ext && ext.walk ? `<div class="group"><div class="list" style="--inset:62px"><button class="cell" data-walk><span class="mico" style="background:#8e8e93">${I.walk}</span><div class="grow"><div class="t1">Walk</div><div class="t2">To a stop nearby, then carry on</div></div>${I.chev}</button></div></div>` : ""}
      ${ext ? "" : `<div class="group"><div class="list" style="--inset:62px"><button class="cell" data-any><span class="mico" style="background:#8e8e93">${SEARCH_ICO}</span><div class="grow"><div class="t1">Search any stop</div><div class="t2">Mixed modes or a change</div></div>${I.chev}</button></div></div>`}` });
    $$("[data-mode]", m).forEach((b) => (b.onclick = () => pickFlow(b.dataset.mode, ext)));
    const any = $("[data-any]", m); if (any) any.onclick = () => openAddTrip();
    const wk = $("[data-walk]", m); if (wk) wk.onclick = async () => { const to = await pickWalkStop(ext.from); if (to) ext.done({ mode: "walk", from: ext.from, to, walk: 5 }); else if (ext.cancel) ext.cancel(); };
    if (ext && ext.cancel) $("[data-m=close]", m).onclick = () => ext.cancel();
  }
  async function pickFlow(mode, ext) {
    const from = ext ? { ...ext.from } : await pickStation(mode, "from");
    if (!from) return;
    const to = await pickStation(mode, "to", from);
    if (!to) { if (ext && ext.cancel) ext.cancel(); return; }
    const leg = { mode, from: { id: from.id, name: from.name }, to: { id: to.id, name: to.name } };
    if (ext) ext.done(leg); else openConfirmTrip({ legs: [leg] });
  }

  // Walk leg: search for the stop you walk to.
  function pickWalkStop(from) {
    return new Promise((resolve) => {
      let done = false;
      const fin = (v) => { if (done) return; done = true; resolve(v); };
      const m = openModal({ title: "Walk to", left: "Cancel",
        body: `<p class="pkstep"><span class="mico sm" style="background:#8e8e93">${I.walk}</span><span>From ${esc(stName(short(from.name)))}, which stop do you walk to?</span></p>
          <div class="sfield pk-s">${SEARCH_ICO}<input id="wk_q" type="search" autocomplete="off" placeholder="Stop or station name" aria-label="Stop or station name"></div>
          <div id="wk_res" class="group" style="margin-top:12px"></div>` });
      $("[data-m=close]", m).onclick = () => { closeModal(); fin(null); };
      const q = $("#wk_q", m), res = $("#wk_res", m);
      let timer = null;
      q.oninput = () => {
        clearTimeout(timer);
        const v = q.value.trim();
        if (v.length < 2) { res.innerHTML = ""; return; }
        timer = setTimeout(async () => {
          res.innerHTML = `<div class="svc-empty">Searching</div>`;
          try {
            const d = await fetch("/api/search?" + qs({ q: v })).then((r) => r.json());
            const items = (d.items || []).filter((s) => String(s.id) !== String(from.id)).slice(0, 8);
            res.innerHTML = items.length ? `<div class="list">${items.map((s, i) => `<button class="cell" data-wi="${i}"><span class="s-ico">${I.loc}</span><div class="grow"><div class="t1">${esc(s.name)}</div></div>${I.chev}</button>`).join("")}</div>` : `<div class="svc-empty">No stops found</div>`;
            $$("[data-wi]", res).forEach((b) => (b.onclick = () => { const s = items[Number(b.dataset.wi)]; fin({ id: String(s.id), name: s.name }); }));
          } catch (e) { res.innerHTML = `<div class="svc-empty">Could not search, check your connection</div>`; }
        }, 250);
      };
      setTimeout(() => q.focus(), 350);
    });
  }
  function pickStation(mode, step, from) {
    return new Promise((resolve) => {
      const M = modeOf(mode);
      const isBus = mode === "bus";
      let tab = "az", coords = null, map = null;
      const prompt = step === "from" ? `Where do you get on the ${M.name.toLowerCase()}?` : `From ${stName(short(from.name))}. Where do you get off?`;
      const m = openModal({ title: step === "from" ? "From" : "To", left: "Cancel",
        body: `<div class="pk-top"><p class="pkstep">${mico(mode, true)}<span>${esc(prompt)}</span></p>
          ${isBus ? "" : `<div class="seg pkseg" role="tablist"><button class="on" role="tab" aria-selected="true" data-tab="az">A to Z</button><button role="tab" aria-selected="false" data-tab="dist">By distance</button><button role="tab" aria-selected="false" data-tab="map">By map</button></div>`}
          <div class="sfield pk-s">${SEARCH_ICO}<input id="st_q" type="search" autocomplete="off" placeholder="${isBus ? "Route number or stop name" : `Filter ${M.name.toLowerCase()} stations`}" aria-label="Filter"></div></div>
          <div id="st_body" class="st-body"><div class="svc-empty" style="border:0">Loading</div></div>` });
      m.classList.add("tall");
      const idx = document.createElement("div"); idx.className = "azidx"; idx.setAttribute("aria-hidden", "true"); m.append(idx);
      const body = $("#st_body", m), inp = $("#st_q", m), scroller = $(".modal-b", m);
      const choose = (s, ctx) => { if (navigator.vibrate) navigator.vibrate(8); resolve({ id: s[0] || s.id, name: s[1] || s.name, ctx }); };
      const row = (s, extra) => `<button class="cell" data-sid="${esc(s[0])}"><div class="grow"><div class="t1">${esc(stName(s[1]))}</div>${extra ? `<div class="t2">${esc(extra)}</div>` : ""}</div></button>`;
      const wireRows = (list) => $$("[data-sid]", body).forEach((b) => (b.onclick = () => { const s = list.find((x) => x[0] === b.dataset.sid); if (s) choose(s); }));

      if (isBus) return busPicker();
      let all = [];
      getStations(mode).then((l) => { all = l.filter((s) => !from || s[0] !== from.id).sort((x, y) => stName(x[1]).localeCompare(stName(y[1]))); render(); }).catch((e) => { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
      const match = (s, q) => !q || s[1].toLowerCase().split(/[\s,()]+/).some((w) => w.startsWith(q)) || s[1].toLowerCase().includes(q);
      function render() {
        const q = inp.value.trim().toLowerCase();
        const list = all.filter((s) => match(s, q));
        if (map) { map.remove(); map = null; }
        idx.innerHTML = "";
        idx.hidden = tab !== "az";
        if (tab === "az") {
          const groups = [];
          list.forEach((s) => { const L0 = stName(s[1]).charAt(0).toUpperCase(); const g = groups[groups.length - 1]; if (g && g.k === L0) g.items.push(s); else groups.push({ k: L0, items: [s] }); });
          body.innerHTML = groups.length ? groups.map((g) => `<div class="az-h" data-az="${esc(g.k)}">${esc(g.k)}</div><div class="list">${g.items.map((s) => row(s)).join("")}</div>`).join("") : `<p class="group-f">No ${esc(M.name.toLowerCase())} stations match that</p>`;
          idx.innerHTML = groups.map((g) => `<span data-l="${esc(g.k)}">${esc(g.k)}</span>`).join("");
          wireRows(list);
        } else if (tab === "dist") {
          if (!coords) {
            body.innerHTML = `<div class="list"><div class="cell static"><span class="s-ico tintbg">${I.loc}</span><div class="grow"><div class="t1">Finding where you are</div></div></div></div>`;
            locate().then((c) => { coords = c; LS.set("tb_loc_ok", 1); render(); }).catch(() => {
              body.innerHTML = `<div class="list"><button class="cell" data-retry><span class="s-ico tintbg">${I.loc}</span><div class="grow"><div class="t1 tint-t">Allow location to sort by distance</div><div class="t2">Or use A to Z or the map</div></div></button></div>`;
              const r = $("[data-retry]", body); if (r) r.onclick = () => render();
            });
            return;
          }
          const near = list.map((s) => ({ s, d: geoDist(coords.latitude, coords.longitude, s[2], s[3]) })).sort((a, b) => a.d - b.d).slice(0, 40);
          body.innerHTML = `<div class="list">${near.map((o) => row(o.s, distText(Math.round(o.d)))).join("")}</div>`;
          wireRows(list);
        } else {
          body.innerHTML = `<div id="st_map" class="st-map"></div><p class="group-f">Tap a station, then Choose.</p>`;
          if (!window.L) { body.innerHTML = `<div class="empty">The map could not load. Use A to Z instead.</div>`; return; }
          map = L.map($("#st_map", body), { zoomControl: false, attributionControl: true });
          baseTiles(map);
          const pts = [];
          list.forEach((s) => {
            const mk = L.circleMarker([s[2], s[3]], { radius: 7, weight: 2, color: "#fff", fillColor: M.color, fillOpacity: 1 }).addTo(map);
            mk.bindPopup(`<div class="mpop"><b>${esc(stName(s[1]))}</b><button class="pillbtn solid" data-choose="${esc(s[0])}">Choose</button></div>`, { closeButton: false });
            mk.on("popupopen", (e) => { const b = e.popup.getElement().querySelector("[data-choose]"); if (b) b.onclick = () => choose(s); });
            pts.push([s[2], s[3]]);
          });
          const syd = list.filter((s) => s[2] > -34.2 && s[2] < -33.5 && s[3] > 150.5 && s[3] < 151.4);
          if (coords) map.setView([coords.latitude, coords.longitude], 13);
          else if (syd.length) map.fitBounds(syd.map((s) => [s[2], s[3]]), { padding: [20, 20] });
          else if (pts.length) map.fitBounds(pts, { padding: [20, 20] });
          setTimeout(() => map && map.invalidateSize(), 350);
        }
      }
      $$("[data-tab]", m).forEach((b) => (b.onclick = () => { tab = b.dataset.tab; $$("[data-tab]", m).forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", String(x === b)); }); scroller.scrollTop = 0; render(); }));
      inp.addEventListener("input", () => { if (tab === "map") return render(); render(); });
      const jump = (ev) => {
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const l = el && el.dataset && el.dataset.l;
        if (!l) return;
        const h = $(`[data-az="${CSS.escape(l)}"]`, body);
        if (h) scroller.scrollTop += h.getBoundingClientRect().top - scroller.getBoundingClientRect().top - $(".pk-top", m).offsetHeight;
        if (idx.dataset.last !== l && navigator.vibrate) navigator.vibrate(4);
        idx.dataset.last = l;
      };
      idx.addEventListener("pointerdown", (e) => { e.preventDefault(); idx.setPointerCapture(e.pointerId); idx.classList.add("on"); jump(e); });
      idx.addEventListener("pointermove", (e) => { if (idx.classList.contains("on")) jump(e); });
      const endIdx = () => idx.classList.remove("on");
      idx.addEventListener("pointerup", endIdx); idx.addEventListener("pointercancel", endIdx);

      // Bus: a route number shows its stops in order; a name searches stops.
      function busPicker() {
        idx.hidden = true;
        let routes = {}, timer = null;
        const ctx = from && from.ctx;
        const stopList = (dir, startAfter, label) => {
          const st = dir.stops.slice(startAfter + 1);
          body.innerHTML = `<div class="group-h">${esc(label)}</div><div class="list rline" style="--c:${M.color}">${st.map((s, i) => `<button class="cell" data-si="${i}"><i class="rdot"></i><div class="grow"><div class="t1">${esc(s[1])}</div></div></button>`).join("")}</div>`;
          $$("[data-si]", body).forEach((b) => (b.onclick = () => { const i = Number(b.dataset.si); choose(st[i], { route: dir.route, dir, at: startAfter + 1 + i }); }));
        };
        const openRoute = async (r) => {
          body.innerHTML = `<div class="svc-empty" style="border:0">Loading route ${esc(r)}</div>`;
          try {
            const dirs = (await getStations("bus", r)).map((d) => ({ ...d, route: r }));
            if (dirs.length === 1) return stopList(dirs[0], -1, `Route ${r} to ${dirs[0].to}`);
            body.innerHTML = `<div class="group-h">Route ${esc(r)}, which way?</div><div class="list">${dirs.map((d, i) => `<button class="cell" data-di="${i}"><span class="lb" style="background:${M.color}">${esc(r)}</span><div class="grow"><div class="t1">To ${esc(short(d.to))}</div><div class="t2">${d.stops.length} stops, from ${esc(short((d.stops[0] || [])[1] || ""))}</div></div>${I.chev}</button>`).join("")}</div>`;
            $$("[data-di]", body).forEach((b) => (b.onclick = () => { const d = dirs[Number(b.dataset.di)]; stopList(d, -1, `Route ${r} to ${short(d.to)}`); }));
          } catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
        };
        const routeRows = (keys) => keys.map((r) => `<button class="cell" data-route="${esc(r)}"><span class="lb" style="background:${M.color}">${esc(r)}</span><div class="grow"><div class="t2" style="color:var(--label)">${esc(routes[r])}</div></div>${I.chev}</button>`).join("");
        const wireRoutes = () => $$("[data-route]", body).forEach((b) => (b.onclick = () => openRoute(b.dataset.route)));
        const renderBus = () => {
          const q = inp.value.trim();
          if (!q && ctx && ctx.dir) return stopList(ctx.dir, ctx.at, `Stops after ${short(from.name)} on route ${ctx.route}`);
          const keys = Object.keys(routes).sort(natCmp);
          if (!q) { body.innerHTML = `<div class="group-h">All routes</div><div class="list">${routeRows(keys)}</div>`; wireRoutes(); return; }
          const up = q.toUpperCase(), lo = q.toLowerCase();
          const byNum = keys.filter((r) => r.toUpperCase().startsWith(up));
          const byName = /[a-z]{3}/i.test(q) ? keys.filter((r) => !byNum.includes(r) && routes[r].toLowerCase().includes(lo)).slice(0, 12) : [];
          const rk = [...byNum, ...byName].slice(0, 40);
          body.innerHTML = `${rk.length ? `<div class="group-h">Routes</div><div class="list">${routeRows(rk)}</div>` : ""}<div id="bstops"></div>${!rk.length && q.length < 2 ? "" : ""}`;
          wireRoutes();
          clearTimeout(timer);
          if (q.length >= 2 && /[a-z]/i.test(q)) timer = setTimeout(async () => {
            try {
              const d = await fetch("/api/search?" + qs({ q })).then((r) => r.json());
              const bs = $("#bstops", body); if (!bs) return;
              const items = (d.items || []).slice(0, 8);
              bs.innerHTML = items.length ? `<div class="group-h" style="margin-top:18px">Stops</div><div class="list">${items.map((s, i) => `<button class="cell" data-bi="${i}"><span class="s-ico">${I.loc}</span><div class="grow"><div class="t1">${esc(s.name)}</div></div></button>`).join("")}</div>` : rk.length ? "" : `<p class="group-f">No routes or stops match that</p>`;
              $$("[data-bi]", bs).forEach((b) => (b.onclick = () => { const s = items[Number(b.dataset.bi)]; choose([s.id, s.name]); }));
            } catch (e) { /* offline */ }
          }, 220);
          else if (!rk.length) body.innerHTML = `<p class="group-f">No routes match that</p>`;
        };
        inp.addEventListener("input", renderBus);
        getStations("bus").then((r) => { routes = r; renderBus(); }).catch((e) => { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
        if (ctx && ctx.dir) renderBus();
      }
    });
  }

  // Confirm a trip before it is saved: name it, add, remove and reorder legs, set each change time.
  // The sheet keeps the start stop and each leg's end stop; every leg starts where the one before it ends.
  function openConfirmTrip(st) {
    const L0 = st.legs;
    let start = L0[0].from;
    let legs = L0.map((l, i) => ({ mode: l.mode || "", to: l.to, conn: i ? (l.conn == null ? (st.conn != null && i === 1 ? st.conn : 5) : l.conn) : undefined, any: !!l.any, walk: l.walk == null ? 5 : l.walk }));
    let nameTouched = st.name != null;
    const full = () => legs.map((l, i) => ({ ...l, from: i ? legs[i - 1].to : start, conn: i && l.mode !== "walk" ? l.conn : undefined, walk: l.mode === "walk" ? l.walk : undefined, any: l.any ? 1 : undefined }));
    const defName = () => `${stName(short(start.name))} to ${stName(short(legs[legs.length - 1].to.name))}`;
    const m = openModal({ title: st.replace ? "Edit trip" : "Confirm trip", right: "Save", body: `<div id="ct_body"></div>` });
    let nameVal = st.name != null ? st.name : defName();
    const step = (k, val, lbl) => `<div class="stepper"><button data-s="${k}" data-d="-1" aria-label="Less ${lbl}">${MI.minus}</button><span>${val} min</span><button data-s="${k}" data-d="1" aria-label="More ${lbl}">${PLUS}</button></div>`;
    const paint = () => {
      const F = full();
      const n = F.length;
      const bad = F.some((l) => l.from.id === l.to.id);
      const legGroup = (l, i) => {
        const walk = l.mode === "walk";
        const rows = [`<div class="cell static legrow">${walk ? `<span class="mico" style="background:#8e8e93">${I.walk}</span>` : mico(l.mode)}<div class="grow"><div class="t1">${esc(stName(short(l.from.name)))} to ${esc(stName(short(l.to.name)))}</div><div class="t2">${n > 1 ? `Leg ${i + 1}, ` : ""}${esc(walk ? "Walk" : l.mode ? modeOf(l.mode).name : "Any service")}</div></div>
          ${n > 1 ? `<div class="legbtns"><button class="icon-btn" data-up="${i}" aria-label="Move leg ${i + 1} up"${i ? "" : " disabled"}>${MI.up}</button><button class="icon-btn" data-down="${i}" aria-label="Move leg ${i + 1} down"${i < n - 1 ? "" : " disabled"}>${MI.down}</button><button class="icon-btn danger-t" data-rm="${i}" aria-label="Remove leg ${i + 1}">${I.trash}</button></div>` : ""}</div>`];
        if (walk) rows.push(`<div class="cell static"><div class="grow"><div class="t1">Walk time</div><div class="t2">From ${esc(stName(short(l.from.name)))}</div></div>${step("w" + i, l.walk, "walking time")}</div>`);
        else {
          if (i) rows.push(`<div class="cell static"><div class="grow"><div class="t1">Connection time</div><div class="t2">Change at ${esc(stName(short(l.from.name)))}</div></div>${step("c" + i, l.conn, "connection time")}</div>`);
          rows.push(`<div class="cell static"><div class="grow"><div class="t1">Direct services only</div><div class="t2">${l.any ? "Services with a change are used too" : "One service for this leg"}</div></div><label class="switch"><input type="checkbox" data-direct="${i}" ${l.any ? "" : "checked"} aria-label="Direct services only, leg ${i + 1}"><span></span></label></div>`);
        }
        return `<div class="group"><div class="list" style="--inset:62px">${rows.join("")}</div></div>`;
      };
      const last = F[n - 1].to;
      $("#ct_body", m).innerHTML = `${F.map(legGroup).join("")}
        ${bad ? `<p class="group-f" style="color:var(--red)">A leg starts and ends at the same stop. Remove it or move it.</p>` : ""}
        <div class="group"><div class="list" style="--inset:62px"><button class="cell" data-add><span class="mico" style="background:var(--tint)">${PLUS}</span><div class="grow"><div class="t1 tint-t">${n > 1 ? "Add another leg" : "Extend trip"}</div><div class="t2">Add a leg from ${esc(stName(short(last.name)))}</div></div>${I.chev}</button></div></div>
        <div class="group-h">Name</div><div class="group"><div class="list"><div class="cell static pick"><input id="ct_name" maxlength="24" value="${esc(nameVal)}" aria-label="Trip name"></div></div></div>
        <p class="group-f">${n > 1 ? "Each service on the first leg is paired with the first connection you can make on every next leg, after your connection time. Late services that break a change are flagged." : "Only services that stop at both ends are shown, with a switch for all services on the trip screen."}</p>`;
      const nm = $("#ct_name", m);
      nm.oninput = () => { nameVal = nm.value; nameTouched = true; };
      const keepName = () => { if (!nameTouched) nameVal = defName(); };
      $$("[data-s]", m).forEach((b) => (b.onclick = () => {
        const k = b.dataset.s, i = Number(k.slice(1)), d = Number(b.dataset.d);
        if (k[0] === "w") legs[i].walk = Math.max(1, Math.min(60, legs[i].walk + d));
        else legs[i].conn = Math.max(0, Math.min(30, legs[i].conn + d));
        paint();
      }));
      $$("[data-direct]", m).forEach((c) => (c.onchange = () => { legs[Number(c.dataset.direct)].any = !c.checked; paint(); }));
      const fixConn = () => legs.forEach((l, i) => { if (i && l.conn == null) l.conn = legs[i - 1].mode === "walk" ? 2 : 5; if (!i) l.conn = undefined; });
      $$("[data-up]", m).forEach((b) => (b.onclick = () => { const i = Number(b.dataset.up); [legs[i - 1], legs[i]] = [legs[i], legs[i - 1]]; fixConn(); keepName(); paint(); }));
      $$("[data-down]", m).forEach((b) => (b.onclick = () => { const i = Number(b.dataset.down); [legs[i + 1], legs[i]] = [legs[i], legs[i + 1]]; fixConn(); keepName(); paint(); }));
      $$("[data-rm]", m).forEach((b) => (b.onclick = () => {
        const i = Number(b.dataset.rm);
        if (i === 0) start = legs[0].to;
        legs.splice(i, 1); fixConn(); keepName(); paint();
      }));
      $("[data-add]", m).onclick = () => {
        const from = full()[legs.length - 1].to;
        const reopen = (more) => { keepName(); openConfirmTrip({ legs: [...full(), ...more], name: nameTouched ? nameVal : null, after: st.after, replace: st.replace }); };
        openNewTrip({ from, walk: true, cancel: () => reopen([]), done: (leg) => reopen([{ mode: leg.mode, from, to: leg.to, conn: leg.mode === "walk" ? undefined : legs[legs.length - 1].mode === "walk" ? 2 : 5, walk: leg.walk || 5 }]) });
      };
    };
    paint();
    $("[data-m=right]", m).onclick = () => {
      const F = full();
      if (F.some((l) => l.from.id === l.to.id)) { toast("A leg starts and ends at the same stop"); return; }
      const name = (nameVal || "").trim().toLowerCase() || defName().toLowerCase();
      const t = { name, from: start, to: F[F.length - 1].to, modes: F.map((l) => l.mode || "") };
      if (F.length > 1) t.legs = F;
      if (F.length === 2 && F[1].mode !== "walk") { t.via = F[0].to; t.conn = F[1].conn; }
      const k = tripKey(t);
      // Editing a saved trip replaces it, also when its name or stops changed.
      const old = st.replace;
      if (old && old.name && old.name !== name) fetch("/api/saved?" + qs({ profile: PROFILE, name: old.name }), { method: "DELETE" }).catch(() => {});
      const s = saved().filter((x) => tripKey(x) !== k && x.name !== name && !(old && tripKey(x) === tripKey(old)));
      s.unshift(t);
      LS.set("tb_saved", s.slice(0, 12));
      post("/api/saved", F.length > 1 ? { profile: PROFILE, name, legs: wireLegs(t) } : { profile: PROFILE, name, from: t.from, to: t.to }).catch(() => {});
      closeModal(); toast("Trip saved");
      if (st.after) st.after(t);
      else if (!/^#\/(home)?$/.test(location.hash || "#/")) location.hash = "#/";
      else if (S.refresh) S.refresh(true);
    };
  }

  function homeView() {
    setTab("home"); setNav({ title: "Trips", actions: `<button class="icon-btn act plus-btn" id="addTripBtn" aria-label="Add a trip">${PLUS}</button>` });
    $("#addTripBtn").onclick = () => openNewTrip();
    let editing = false;
    const tok = S.homeTok = {};
    S.itemActions = (k) => itemActions(k);
    let commutes = LS.get("tb_commutes", []), suggestion = null, near = null, nearState = "unknown", coords = null, coordsAt = 0;
    const data = {};
    const showInstall = !standalone && !LS.get("tb_install_seen", 0) && !S.installShown;
    if (showInstall) { S.installShown = true; LS.set("tb_install_seen", Date.now()); }
    const trips = () => {
      const list = [];
      const has = (f, t, v) => list.some((x) => x.from.id === f && x.to.id === t && ((x.via && x.via.id) || "") === (v || ""));
      const pl = places();
      if (pl.home && pl.work && pl.home.id !== pl.work.id) {
        const hw = { kind: "place", from: pl.home, to: pl.work, tag: "To work", okey: "places" }, wh = { kind: "place", from: pl.work, to: pl.home, tag: "To home", okey: "places" };
        const am = Number(new Intl.DateTimeFormat("en-AU", { timeZone: TZ, hour: "2-digit", hour12: false }).format(new Date())) % 24 < 12;
        list.push(...(am ? [hw, wh] : [wh, hw]));
      }
      commutes.forEach((c) => { if (!has(c.from.id, c.to.id)) list.push({ kind: "commute", from: c.from, to: c.to, name: c.name, todText: c.todText }); });
      saved().forEach((s) => { if (!list.some((x) => tripKey(x) === tripKey(s))) list.push({ ...s, kind: "saved", grip: false }); });
      // Your own order from dragging wins; home and work move together and keep their morning and evening order.
      const order = LS.get("tb_order", []);
      const pos = (t, i) => { const k = order.indexOf(t.okey || tripKey(t)); return k < 0 ? 1000 + i : k; };
      const out = list.map((t, i) => ({ t, p: pos(t, i), i })).sort((a, b) => a.p - b.p || a.i - b.i).map((o) => o.t).slice(0, 8);
      if (out.length > 1) out.forEach((t) => (t.grip = true));
      return out;
    };
    // Starred stops are saved by you. Recent trips and stops are only history: shown below,
    // labelled Recent, and each can be removed or cleared.
    const stopsList = () => {
      const out = [];
      stars().forEach((s) => { if (!out.some((x) => x.id === s.id)) out.push({ ...s, star: true }); });
      return out.slice(0, 6);
    };
    const recentStopList = () => recentStops().filter((s) => !stars().some((x) => x.id === s.id)).slice(0, 3);
    const recentTripList = () => { const tl = trips(); return recentTrips().filter((r) => !tl.some((t) => t.from.id === r.from.id && t.to.id === r.to.id && !isChain(t))).slice(0, 3); };
    const itemOf = (key) => {
      const [kind, ...rest] = key.split("|"), id = rest.join("|");
      if (kind === "saved") { const t = saved().find((s) => tripKey(s) === id); return t && { kind, t }; }
      if (kind === "place") return { kind };
      if (kind === "commute") { const c = commutes.find((x) => x.id === id); return c && { kind, c }; }
      if (kind === "rtrip") { const r = recentTrips().find((x) => rtKey(x) === id); return r && { kind, r }; }
      if (kind === "rstop") { const s = recentStops().find((x) => x.id === id); return s && { kind, s }; }
      if (kind === "star") { const s = stars().find((x) => x.id === id); return s && { kind, s }; }
      return null;
    };
    const after = () => { paint(); loadAll(); };
    const itemActions = (key) => {
      const it = itemOf(key);
      if (!it) return;
      if (it.kind === "saved") return actionSheet(cap(it.t.name || short(it.t.from.name) + " to " + short(it.t.to.name)), [
        { label: "Edit trip", run: () => openConfirmTrip({ legs: tLegs(it.t), conn: it.t.conn, name: it.t.name || null, replace: it.t, after }) },
        { label: "Delete trip", danger: true, run: () => { deleteSaved(it.t); toast("Trip deleted"); after(); } },
      ]);
      if (it.kind === "place") return actionSheet("Home and Work", [
        { label: "Change home", run: () => openPlacePick("home", after) },
        { label: "Change work", run: () => openPlacePick("work", after) },
        { label: "Remove home and work", danger: true, run: () => { LS.set("tb_places", {}); LS.set("tb_order", LS.get("tb_order", []).filter((x) => x !== "places")); toast("Home and work removed"); after(); } },
      ]);
      if (it.kind === "commute") return actionSheet(it.c.name || "Commute", [
        { label: "Edit commute", run: () => openCommuteSheet(it.c) },
        { label: "Delete commute", danger: true, run: () => { fetch("/api/commutes?" + qs({ profile: PROFILE, id: it.c.id }), { method: "DELETE" }).catch(() => {}); commutes = commutes.filter((x) => x.id !== it.c.id); LS.set("tb_commutes", commutes); toast("Commute deleted"); after(); } },
      ]);
      if (it.kind === "rtrip") return actionSheet(short(it.r.from.name) + " to " + short(it.r.to.name), [
        { label: "Save trip", run: () => openConfirmTrip({ legs: [{ mode: "", from: it.r.from, to: it.r.to }], name: null, after }) },
        { label: "Remove from Recent", danger: true, run: () => { removeRecentTrip(rtKey(it.r)); after(); } },
      ]);
      if (it.kind === "rstop") return actionSheet(short(it.s.name), [
        { label: "Star stop", run: () => { starStop(it.s.id, short(it.s.name)); after(); } },
        { label: "Remove from Recent", danger: true, run: () => { removeRecentStop(it.s.id); after(); } },
      ]);
      if (it.kind === "star") return actionSheet(short(it.s.name), [
        { label: "Unstar stop", danger: true, run: () => { LS.set("tb_stars", stars().filter((x) => x.id !== it.s.id)); after(); } },
      ]);
    };
    const itemKey = (t) => t.kind === "saved" ? "saved|" + tripKey(t) : t.kind === "place" ? "place|" : t.kind === "commute" ? "commute|" + (commutes.find((c) => c.from.id === t.from.id && c.to.id === t.to.id) || {}).id : "";
    const rmBtn = (key, label) => `<button class="rm-btn" data-rm="${esc(key)}" aria-label="${esc(label)}"><span></span></button>`;
    const tk = (t) => "t:" + tripKey(t);
    let dirty = false;
    const paint = () => {
      if (S.homeTok !== tok) return;
      if (S.dragging) { dirty = true; return; }
      const active = S.watches.filter((w) => w.active);
      const tl = trips(), sl = stopsList(), rt = recentTripList(), rs = recentStopList();
      const canEdit = tl.length || sl.length || rt.length || rs.length;
      if (!canEdit) editing = false;
      navLeft.innerHTML = canEdit ? `<button class="back navedit" id="editBtn" aria-pressed="${editing}"><span>${editing ? "Done" : "Edit"}</span></button>` : "";
      if (canEdit) $("#editBtn").onclick = () => { editing = !editing; paint(); };
      let h = `<h1 class="large">Trips</h1>
        <a class="sfield homesearch" href="#/search?focus=1" aria-label="Search stops, stations and trips">${SEARCH_ICO}<span>Where to?</span></a>`;
      const pl = places();
      const goT = goGet(); if (goT) h += goBanner(goT);
      if (!pl.home || !pl.work) h += `<div class="placebar">${["home", "work"].map((k) => `<button class="place${pl[k] ? " set" : ""}" data-place="${k}"><span class="pico">${k === "home" ? I.house : I.route}</span><span class="pl-t">${pl[k] ? esc(short(pl[k].name)) : k === "home" ? "Add home" : "Add work"}</span></button>`).join("")}</div>`;
      const big = [];
      tl.forEach((t) => { const d = data[tk(t)]; ((d && d.journeys) || []).slice(0, 3).forEach((j) => (j.legs || []).forEach((l) => (l.alerts || []).forEach((a) => { if (/high/i.test(a.priority || "") && !big.some((b) => b.title === a.title)) big.push(a); }))); });
      if (big.length) h += `<a class="abanner" href="#/alerts">${I.alert}<span>${esc(big[0].title)}</span>${big.length > 1 ? `<small>+${big.length - 1}</small>` : ""}</a>`;
      if (active.length) h += `<div class="group"><div class="group-h big">Watching</div>${active.map(watchCard).join("")}</div>`;
      if (suggestion) {
        h += `<div class="group"><div class="card"><button class="x" data-dismiss aria-label="Not now">${I.x}</button><div class="prompt"><span class="sym" style="background:#5856d6">${I.sparkle}</span><div><h2>Make this your ${esc(suggestion.name.toLowerCase())}?</h2>
          <p>${esc(short(suggestion.from.name))} to ${esc(short(suggestion.to.name))}, around ${esc(suggestion.todText)} on ${suggestion.days} days. I'll tell you when to leave each weekday.</p>
          <div class="card-actions"><button class="pillbtn solid" data-accept>Yes, every weekday</button><button class="pillbtn" data-dismiss>Not now</button></div></div></div></div></div>`;
      }
      const addRow = `<button class="addtrip" data-addtrip><span class="addico">${PLUS}</span><span>Add a trip</span></button>`;
      const wrapItem = (key, label, html) => key ? `<div class="itemw${editing ? " editing" : ""}" data-item="${esc(key)}">${editing ? rmBtn(key, label) : ""}${html}</div>` : html;
      h += `<div class="group trips${editing ? " is-editing" : ""}">${tl.map((t) => wrapItem(itemKey(t), "Remove " + short(t.from.name) + " to " + short(t.to.name), tripCard(t, data[tk(t)]))).join("")}${tl.length ? "" : addRow}</div>`;
      if (!tl.length && !rt.length && !sl.length) h += `<p class="group-f empty-hint">Save the trips you take, like home to work. They show here with live times. Nothing is added for you.</p>`;
      if (sl.length) h += `<div class="group"><div class="group-h big">Starred stops</div>${sl.map((s) => wrapItem("star|" + s.id, "Unstar " + short(s.name), stopBlock(s, data["s:" + s.id]))).join("")}</div>`;
      if (rt.length) h += `<div class="group recent"><div class="group-h big">Recent trips<button class="gclear" data-clear="tb_rtrips">Clear</button></div><div class="list">${rt.map((r) => `<div class="swrow" data-item="${esc("rtrip|" + rtKey(r))}">${editing ? rmBtn("rtrip|" + rtKey(r), "Remove from Recent") : ""}<a class="cell rrow" href="${tripHref({ from: r.from, to: r.to })}"><span class="s-ico">${I.clock}</span><div class="grow"><div class="t1">${esc(stName(short(r.from.name)))} to ${esc(stName(short(r.to.name)))}</div></div>${I.chev}</a></div>`).join("")}</div><p class="group-f">Trips you looked at. Tap and hold, or swipe left, to remove one.</p></div>`;
      if (rs.length) h += `<div class="group recent"><div class="group-h big">Recent stops<button class="gclear" data-clear="tb_rstops">Clear</button></div>${rs.map((s) => wrapItem("rstop|" + s.id, "Remove from Recent", stopBlock(s, data["s:" + s.id]))).join("")}</div>`;
      let nh = "";
      if (nearState === "granted" && near) nh = near.length ? near.map((s) => stopBlock(s, data["s:" + s.id], distText(s.distance))).join("") : `<div class="list"><div class="cell static"><div class="grow"><div class="t2">No stops within 800 m</div></div></div></div>`;
      else if (nearState === "granted" || nearState === "asking") nh = `<div class="list"><div class="cell static"><span class="s-ico tintbg">${I.loc}</span><div class="grow"><div class="t1">Finding stops near you</div></div></div></div>`;
      else if (nearState !== "denied") nh = `<div class="list"><button class="cell" data-near><span class="s-ico tintbg">${I.loc}</span><div class="grow"><div class="t1 tint-t">Show stops near me</div></div>${I.chev}</button></div>`;
      if (nh) h += `<div class="group"><div class="group-h big">Nearby</div>${nh}</div>`;
      if (showInstall && !LS.get("tb_install_x", 0)) h += `<div class="slim"><span>Add Transport to your Home Screen</span><a href="#/settings">How</a><button data-x-install aria-label="Dismiss">${I.x}</button></div>`;
      h += foot();
      view.innerHTML = h;
      wire();
    };
    // Drag a trip by its handle to reorder.
    const wireDrag = () => $$(".trips .grip").forEach((g) => g.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const tcard = g.closest(".tcard"), card = tcard.closest(".itemw") || tcard, box = card.parentElement;
      const cards = Array.from(box.children).filter((c) => c.matches(".tcard, .itemw")), rects = cards.map((c) => c.getBoundingClientRect());
      const idx = cards.indexOf(card), startY = e.clientY, startScroll = window.scrollY, shift = rects[idx].height + 12;
      let target = idx, lastY = e.clientY, raf = 0;
      const edge = () => { const vh = window.innerHeight; const v = lastY < 120 ? -8 : lastY > vh - 140 ? 8 : 0; if (v) { window.scrollBy(0, v); move({ clientY: lastY }); } raf = requestAnimationFrame(edge); };
      raf = requestAnimationFrame(edge);
      S.dragging = true; card.classList.add("dragging"); box.classList.add("sorting");
      try { g.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
      if (navigator.vibrate) navigator.vibrate(10);
      const move = (ev) => {
        lastY = ev.clientY;
        const dy = ev.clientY - startY + (window.scrollY - startScroll);
        card.style.transform = `translateY(${dy}px) scale(1.02)`;
        const mid = rects[idx].top + rects[idx].height / 2 + dy;
        target = idx;
        rects.forEach((r, i) => { if (i < idx && mid < r.top + r.height / 2) target = Math.min(target, i); if (i > idx && mid > r.top + r.height / 2) target = Math.max(target, i); });
        cards.forEach((c, i) => { if (c === card) return; const s = idx < target && i > idx && i <= target ? -shift : idx > target && i < idx && i >= target ? shift : 0; c.style.transform = s ? `translateY(${s}px)` : ""; });
      };
      const up = () => {
        g.removeEventListener("pointermove", move); g.removeEventListener("pointerup", up); g.removeEventListener("pointercancel", up);
        cancelAnimationFrame(raf);
        S.dragging = false; box.classList.remove("sorting");
        cards.forEach((c) => { c.style.transform = ""; c.classList.remove("dragging"); });
        if (target !== idx) {
          const arr = cards.slice(); arr.splice(idx, 1); arr.splice(target, 0, card);
          const tkOf = (c) => (c.matches(".tcard") ? c : $(".tcard", c)).dataset.tk;
          const k = tkOf(card);
          const keys = [...new Set(arr.filter((c) => c === card || tkOf(c) !== k).map(tkOf))];
          LS.set("tb_order", keys); if (navigator.vibrate) navigator.vibrate(6);
        }
        dirty = false; paint();
      };
      g.addEventListener("pointermove", move); g.addEventListener("pointerup", up); g.addEventListener("pointercancel", up);
    }));
    const wire = () => {
      wireDrag();
      $$("[data-clear]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); const k = b.dataset.clear; const was = LS.get(k, []); LS.set(k, []); paint(); toastUndo(k === "tb_rtrips" ? "Recent trips cleared" : "Recent stops cleared", () => { LS.set(k, was); after(); }); }));
      $$("[data-rm]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); itemActions(b.dataset.rm); }));
      if (editing) $$("[data-item] a").forEach((x) => x.addEventListener("click", (e) => { if (!e.target.closest(".grip")) { e.preventDefault(); itemActions(x.closest("[data-item]").dataset.item); } }));
      const xi = $("[data-x-install]"); if (xi) xi.onclick = () => { LS.set("tb_install_x", 1); paint(); };
      $$("[data-place]").forEach((b) => (b.onclick = () => openPlacePick(b.dataset.place, () => { paint(); loadAll(); })));
      $$("[data-addtrip]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); openNewTrip(); }));
      const nb = $("[data-near]"); if (nb) nb.onclick = () => { nearState = "asking"; paint(); findNear(true); };
      $$("[data-dismiss]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); const k = suggestion.key; suggestion = null; post("/api/commutes/dismiss?" + qs({ profile: PROFILE }), { key: k }).catch(() => {}); paint(); }));
      const ac = $("[data-accept]"); if (ac) ac.onclick = async (e) => {
        e.preventDefault();
        const s = suggestion; suggestion = null;
        try { await post("/api/commutes?" + qs({ profile: PROFILE }), { from: s.from, to: s.to, tod: s.tod, days: "12345", name: s.name }); toast(`Done. Your ${s.name.toLowerCase()} is set for weekdays around ${s.todText}.`); } catch (err) { toast(err.message); }
        loadCommutes();
      };
    };
    let pending = 0;
    const done = () => { if (--pending <= 0) { saveHold(); paint(); } };
    const loadStop = (s) => { pending++; api("/api/departures?" + qs({ stop: s.id })).then((d) => { data["s:" + s.id] = d; }).catch(() => { if (!data["s:" + s.id]) data["s:" + s.id] = null; }).finally(done); };
    const loadAll = () => {
      trips().forEach((t) => { pending++; planTrip(t, { count: 6 }).then((d) => { data[tk(t)] = d; }).catch(() => {}).finally(done); });
      const ids = new Set();
      const sl = stopsList();
      const all = [...sl, ...recentStopList(), ...(near || [])];
      all.forEach((s) => { if (!ids.has(s.id)) { ids.add(s.id); loadStop(s); } });
    };
    const findNear = async (ask) => {
      try {
        if (!ask && Date.now() - coordsAt < 120000 && coords) { /* reuse */ } else { coords = await locate(); coordsAt = Date.now(); LS.set("tb_loc_ok", 1); }
        nearState = "granted";
        near = await nearbyStations(coords);
        near.forEach((s) => loadStop(s));
        paint();
      } catch (e) { nearState = ask ? "denied" : "prompt"; if (ask) toast(e.message); paint(); }
    };
    const loadCommutes = () => api("/api/commutes?" + qs({ profile: PROFILE, device: DEVICE })).then((d) => {
      commutes = d.items || []; LS.set("tb_commutes", commutes); suggestion = d.suggestion || null; paint(); loadAll();
    }).catch(() => loadAll());
    paint();
    loadCommutes();
    (async () => {
      let st = LS.get("tb_loc_ok", 0) ? "granted" : "prompt";
      try { if (navigator.permissions) st = (await navigator.permissions.query({ name: "geolocation" })).state; } catch (e) { /* older browsers */ }
      if (st === "granted") { nearState = "granted"; paint(); findNear(false); } else { nearState = st === "denied" ? "denied" : "prompt"; paint(); }
    })();
    pollWatches().then(() => paint());
    every(15000, () => { loadAll(); if (nearState === "granted" && Date.now() - coordsAt > 120000) findNear(false); pollWatches().then(paint); });
  }

  // ---------- search ----------
  function searchView(params) {
    setTab("search"); setNav({ title: "Search" });
    const rc = recents(), sv = saved();
    view.innerHTML = `<h1 class="large">Search</h1>
      <form class="searchbar" id="sform" role="search" autocomplete="off"><div class="sfield"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10.5 3a7.5 7.5 0 0 1 5.96 12.06l4.24 4.24-1.4 1.4-4.24-4.24A7.5 7.5 0 1 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z"/></svg>
        <input id="q" type="search" enterkeyhint="go" placeholder="Stop number, station, or A to B" aria-label="Search stops, stations or trips" value="${esc(params.get("q") || "")}">
        <button type="button" class="clr" id="clr" aria-label="Clear" hidden>${I.x}</button></div><button type="button" class="cancel" id="scancel" hidden>Cancel</button></form>
      <div id="sres"></div>`;
    const input = $("#q"), res = $("#sres"), clr = $("#clr");
    if (params.get("focus")) setTimeout(() => input.focus(), 0);
    const idle = () => {
      res.innerHTML = `<div class="group"><div class="list">
          <a class="cell" href="#/near"><span class="s-ico tintbg">${I.loc}</span><div class="grow"><div class="t1">Stops near me</div></div>${I.chev}</a>
          <a class="cell" href="#/topup"><span class="s-ico purple">${I.card}</span><div class="grow"><div class="t1">Opal top up machines</div></div>${I.chev}</a>
          <a class="cell" href="#/parking"><span class="s-ico tintbg">${I.car}</span><div class="grow"><div class="t1">Park and Ride spaces</div></div>${I.chev}</a>
          <a class="cell" href="#/alerts"><span class="s-ico orange">${I.alert}</span><div class="grow"><div class="t1">Service alerts</div></div>${I.chev}</a></div></div>
        ${sv.length ? `<div class="group"><div class="group-h">Saved trips</div><div class="list">${sv.map((s) => `<a class="cell" href="#/trip?${qs({ from: s.from.id, to: s.to.id, fn: s.from.name, tn: s.to.name, name: s.name })}"><span class="s-ico">${I.starOn}</span><div class="grow"><div class="t1">${esc(cap(s.name))}</div><div class="t2">${esc(short(s.from.name))} to ${esc(short(s.to.name))}</div></div>${I.chev}</a>`).join("")}</div></div>` : ""}
        ${rc.length ? `<div class="group"><div class="group-h">Recent<button id="clrRecent">Clear</button></div><div class="list">${rc.map((x) => `<a class="cell" href="#/ask?${qs({ q: x })}"><span class="s-ico">${I.clock}</span><div class="grow"><div class="t1">${esc(x)}</div></div>${I.chev}</a>`).join("")}</div></div>` : ""}
        <div class="group"><div class="group-h">Try</div><div class="list">${[["213516", "A stop number from the sign"], ["Central", "A whole station, every platform"], ["Burwood to Central", "A trip, with live legs"], ["Parramatta to Town Hall by 9am", "Arrive by a time"]].map(([q, t]) => `<a class="cell" href="#/ask?${qs({ q })}"><span class="s-ico">${I.route}</span><div class="grow"><div class="t1">${esc(q)}</div><div class="t2">${t}</div></div>${I.chev}</a>`).join("")}</div></div>`;
      const cr = $("#clrRecent"); if (cr) cr.onclick = () => { LS.set("tb_recent", []); searchView(params); };
    };
    let timer = null;
    const suggest = () => {
      const v = input.value.trim();
      clr.hidden = !v;
      clearTimeout(timer);
      if (v.length < 2) { idle(); return; }
      timer = setTimeout(async () => {
        const opts = [];
        sv.filter((s) => s.name.startsWith(v.toLowerCase())).forEach((s) => opts.push({ q: s.name, label: cap(s.name), sub: `${short(s.from.name)} to ${short(s.to.name)}`, ico: I.starOn }));
        if (/\s(to|>)\s+\S/i.test(v)) opts.push({ q: v, label: v, sub: "Plan this trip with live times", ico: I.route });
        else if (/^\d{5,8}$/.test(v)) opts.push({ q: v, label: `Stop ${v}`, sub: "Live departures from this stop", ico: I.bus });
        else {
          try {
            const d = await fetch("/api/search?" + qs({ q: v })).then((r) => r.json());
            if (input.value.trim() !== v) return;
            (d.items || []).slice(0, 8).forEach((s) => opts.push({ href: `#/stop/${encodeURIComponent(s.id)}?${qs({ name: s.name })}`, label: s.name, sub: `Stop ${s.id}${s.modes && s.modes.length ? " \u00b7 " + s.modes.join(", ") : ""}`, ico: /train|metro/i.test((s.modes || []).join(" ")) ? I.train : I.bus, name: s.name }));
          } catch (e) { /* offline */ }
        }
        res.innerHTML = opts.length ? `<div class="group"><div class="list">${opts.map((o, i) => `<a class="cell" data-i="${i}" href="${o.href || "#/ask?" + qs({ q: o.q })}"><span class="s-ico">${o.ico}</span><div class="grow"><div class="t1">${esc(o.label)}</div><div class="t2">${esc(o.sub)}</div></div>${I.chev}</a>`).join("")}</div></div>` : `<div class="empty">No stops match "${esc(v)}". Press Go to ask anyway.</div>`;
        $$("[data-i]", res).forEach((a) => a.addEventListener("click", () => { const o = opts[Number(a.dataset.i)]; addRecent(o.name || o.q); }));
      }, 160);
    };
    input.addEventListener("input", suggest);
    const sc = $("#scancel");
    input.addEventListener("focus", () => { sc.hidden = false; });
    input.addEventListener("blur", () => { setTimeout(() => { if (!input.value) sc.hidden = true; }, 150); });
    sc.onclick = () => { input.value = ""; input.blur(); sc.hidden = true; suggest(); };
    clr.onclick = () => { input.value = ""; suggest(); input.focus(); };
    $("#sform").onsubmit = (e) => { e.preventDefault(); const v = input.value.trim(); if (v) { input.blur(); location.hash = "#/ask?" + qs({ q: v }); } };
    suggest();
    if (!params.get("q")) setTimeout(() => input.focus(), 250);
  }

  // ---------- stop board ----------
  const MODE_TABS = [["", "All"], ["train", "Trains"], ["metro", "Metro"], ["bus", "Buses"], ["lightrail", "Light rail"], ["ferry", "Ferries"]];
  function stopView(id, params, pre) {
    setTab("search");
    let mode = params.get("mode") || "", showAll = false, data = null, fac = null, facAt = 0;
    const nm = params.get("name") || "Stop " + id;
    // Station access, lifts, Opal machines and Park and Ride: once, then every 2 minutes with the board.
    const loadFac = (sid) => {
      if (!/^\d{5,8}$/.test(String(sid)) || Date.now() - facAt < 110000) return;
      facAt = Date.now();
      fetch("/api/station?" + qs({ id: sid })).then((r) => (r.ok ? r.json() : null)).then((st) => { if (st && st.access) { fac = st; if (data && location.hash.startsWith("#/stop/")) paint(); } }).catch(() => null);
    };
    const navFor = (title) => {
      const starred = stars().some((s) => s.id === id);
      setNav({ title, back: true, actions: `<button class="icon-btn act${starred ? " on" : ""}" id="starBtn" aria-pressed="${starred}" aria-label="${starred ? "Unstar" : "Star"} this stop">${starred ? I.starOn : I.star}</button>` });
      $("#starBtn").onclick = () => {
        let s = stars();
        if (s.some((x) => x.id === id)) { s = s.filter((x) => x.id !== id); toast("Removed from Home"); }
        else { s.unshift({ id, name: title }); toast("Starred. It's on Home now."); }
        LS.set("tb_stars", s.slice(0, 10)); navFor(title);
      };
    };
    navFor(short(nm));
    view.innerHTML = `<h1 class="large">${esc(short(nm))}<small>Stop ${esc(id)}</small></h1><div class="group">${skel(6)}</div>`;
    const paint = () => {
      const d = data;
      const title = d.byNumber && d.stop.exactName ? d.stop.exactName : d.stop.name;
      navFor(short(title));
      const tabs = MODE_TABS.filter(([k]) => !k || d.modes.includes(k) || (k === "bus" && d.modes.includes("coach")));
      const items = d.items.filter((i) => !mode || i.mode === mode || (mode === "bus" && i.mode === "coach"));
      const shown = showAll ? items : items.slice(0, 15);
      const liveN = items.filter((i) => i.realtime).length;
      rowData.clear();
      view.innerHTML = `<h1 class="large">${esc(title)}<small>Stop ${esc(d.stop.id)} \u00b7 ${liveN} of ${items.length} live</small></h1>
        ${tabs.length > 2 ? `<div class="seg" role="tablist">${tabs.map(([k, n]) => `<button class="${k === mode ? "on" : ""}" data-mode="${k}" role="tab" aria-selected="${k === mode}">${n}</button>`).join("")}</div>` : ""}
        ${d.alternatives && d.alternatives.length ? `<div class="group"><div class="chips">${d.alternatives.map((a) => `<a class="chip" href="#/stop/${encodeURIComponent(a.id)}?${qs({ name: a.name })}">${esc(a.name)}</a>`).join("")}</div></div>` : ""}
        ${alertsHtml(d.alerts)}
        ${(() => { const pk = peakNow(); return pk && items.some((i) => i.mode !== "ferry") ? `<div class="farebar"><span class="fb-peak">Peak</span><span>Off peak from ${pk}: 30 percent off train, metro, bus and light rail fares</span></div>` : ""; })()}
        <div class="group"><div class="list">${shown.map((it) => depRow(it)).join("") || `<div class="empty">No upcoming services found right now.</div>`}
        ${items.length > shown.length ? `<button class="more" id="moreBtn">Show ${items.length - shown.length} more</button>` : ""}</div>
        <p class="group-f">Swipe left on a service to watch it. ${items.some((i) => i.pred) ? "* Usual delay, a prediction from recorded times, not live." : ""}</p></div>${stationHtml(fac)}${foot()}`;
      wirePark();
      $$(".seg button").forEach((b) => (b.onclick = () => { mode = b.dataset.mode; history.replaceState(null, "", `#/stop/${encodeURIComponent(id)}?${qs({ name: params.get("name"), mode })}`); paint(); }));
      const mb = $("#moreBtn"); if (mb) mb.onclick = () => { showAll = true; paint(); };
    };
    const load = () => api("/api/departures?" + qs({ stop: id, device: DEVICE, profile: PROFILE })).then((d) => { if (!data && d.stop) addRecentStop(String(d.stop.id || id), d.byNumber && d.stop.exactName ? d.stop.exactName : d.stop.name); data = { ...d, byNumber: /^\d{5,8}$/.test(id) && pre && pre.byNumber, alternatives: (pre && pre.alternatives) || [] }; paint(); loadFac(d.stop && d.stop.id || id); }).catch((e) => { if (!data) view.innerHTML = `<h1 class="large">${esc(short(nm))}</h1><div class="empty">${esc(e.message)}</div>`; });
    if (pre && pre.items) { data = pre; if (pre.stop) addRecentStop(String(pre.stop.id || id), pre.stop.name); paint(); loadFac(pre.stop && pre.stop.id || id); } else load();
    every(15000, load);
  }

  // ---------- trips ----------
  function tripView(params, pre) {
    setTab("search");
    const from = params.get("from"), to = params.get("to");
    let fn = params.get("fn") || from, tn = params.get("tn") || to;
    const name = params.get("name") || "";
    const via = params.get("via") ? { id: params.get("via"), name: params.get("vn") || params.get("via") } : null;
    let legsP = null;
    try { legsP = params.get("legs") ? JSON.parse(params.get("legs")) : null; } catch (e) { legsP = null; }
    if (!Array.isArray(legsP) || legsP.length < 2) legsP = null;
    // A via link (from Ask or an older share) opens as a two leg trip.
    if (!legsP && via) legsP = [{ mode: "", from: { id: from, name: fn }, to: via }, { mode: "", from: via, to: { id: to, name: tn }, conn: params.get("conn") == null ? 5 : Number(params.get("conn")) }];
    const T = () => legsP ? { from: { id: from, name: fn }, to: { id: to, name: tn }, legs: legsP }
      : { from: { id: from, name: fn }, to: { id: to, name: tn }, via, conn: params.get("conn") == null ? 5 : Number(params.get("conn")) };
    const chain = isChain(T());
    let open = null, data = pre || null;
    if (!chain) addRecentTrip({ id: from, name: fn }, { id: to, name: tn });
    const isSavedT = () => saved().some((s) => tripKey(s) === tripKey(T()));
    const navNow = () => {
      const isSaved = isSavedT();
      setNav({ title: `${short(fn)} to ${short(tn)}`, back: true, actions: `<button class="icon-btn act" id="revBtn" aria-label="Reverse trip">${I.swap}</button><button class="icon-btn act${isSaved ? " on" : ""}" id="saveBtn" aria-label="Save this trip">${isSaved ? I.starOn : I.star}</button>` });
      $("#revBtn").onclick = () => { location.hash = tripHref(reverseTrip({ ...T(), name: null })); };
      $("#saveBtn").onclick = saveTrip;
    };
    navNow();
    // "Save trip" from Ask: open the Confirm trip sheet once, then drop the flag so Back does not reopen it.
    if (params.get("save") === "1") {
      history.replaceState(null, "", location.hash.replace(/([?&])save=1(&|$)/, "$1").replace(/[?&]$/, ""));
      setTimeout(() => { if (isSavedT()) toast("This trip is already saved"); else saveTrip(); }, 60);
    }
    const chainSub = () => { const L = tLegs(T()); return L.length === 2 && L[1].mode !== "walk" ? `Via ${stName(short(L[0].to.name))}, ${L[1].conn == null ? 5 : L[1].conn} min to change` : `${L.length} legs via ${viaText(T())}`; };
    const sub = [name ? cap(name) : "", chain ? chainSub() : ""].filter(Boolean).join(". ");
    const head = () => `<h1 class="large">${esc(short(fn))} <span style="color:var(--label3t)">to</span> ${esc(short(tn))}${sub ? `<small>${esc(sub)}</small>` : ""}</h1>`;
    let extra = [], showDep = true;
    const hhmm = (t) => { const p = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(t)); return (p.find((x) => x.type === "hour").value % 24).toString().padStart(2, "0") + p.find((x) => x.type === "minute").value; };
    const jkey = (j) => { const f = (j.legs || []).find((l) => l.kind === "transit"); return f ? legKey(f) : String(j.leave); };
    const more = (dir) => {
      const cur = merged();
      if (!cur.length) return;
      const t = dir < 0 ? Math.max(now() - 25 * 60000, cur[0].x.leave - 40 * 60000) : cur[cur.length - 1].x.leave + 60000;
      planTrip(T(), { time: hhmm(t), count: 5 }).then((d) => { extra = extra.concat(d.journeys || []); paint(); }).catch((e) => toast(e.message));
    };
    const merged = () => {
      const seen = new Set(), out = [];
      [...(data.journeys || []), ...extra].forEach((j) => { const k = jkey(j); if (seen.has(k)) return; seen.add(k); out.push({ j, x: journeyTimes(j) }); });
      return out.filter((o) => o.x.leave > now() - 30 * 60000 || data.when).sort((a, b) => a.x.leave - b.x.leave);
    };
    const paint = () => {
      const d = data;
      if (d.from && d.from.name && !/^\d+$/.test(d.from.name)) fn = d.from.name;
      if (d.to && d.to.name && !/^\d+$/.test(d.to.name)) tn = d.to.name;
      navNow();
      const df = directFilter(merged(), T());
      const js = df.list;
      saveHold();
      const alerts = [];
      js.forEach((o) => (o.j.legs || []).forEach((l) => (l.alerts || []).forEach((a) => { if (!alerts.some((b) => b.title === a.title)) alerts.push(a); })));
      const rows = js.map((o, i) => {
        const key = jkey(o.j);
        const beaten = js.slice(i + 1).some((p) => p.x.arr < o.x.arr - 30000);
        const first = o.x.first, watched = first && isWatched(first);
        let r = svcRow(o.j, o.x, beaten, false, fn);
        const jo = journeyOutages(o.j);
        if (jo.length) r += `<div class="jacc">${I.access}<span>Lift out: ${esc(jo[0])}</span></div>`;
        if (!showDep) r = r.replace(/<div class="cdb [^"]*"><span class="cdb-n"[^>]*>[^<]*<\/span><span class="cdb-u"[^>]*>min<\/span><\/div>/, `<div class="cdb cd-x durb"><span class="cdb-n">${o.x.dur}</span><span class="cdb-u">min</span></div>`);
        const past = o.x.leave < now() - 30000;
        return `<div class="jrow${past ? " past" : ""}" data-key="${esc(key)}" data-i="${i}" role="button" tabindex="0" aria-expanded="${open === key}">${r}
          ${open === key ? `<div class="jdetail"><div class="legs">${legsDetail(o.j)}</div>${fareBox(o.j.fare)}<div class="card-actions"><button class="pillbtn solid" data-go>${I.loc}Start trip</button><button class="pillbtn${watched ? " on" : ""}" data-watch>${I.bell}${watched ? "Watching" : "Watch"}</button>${chain ? "" : `<button class="pillbtn" data-commute>${I.clock}Commute</button>`}</div></div>` : ""}</div>`;
      }).join("");
      view.innerHTML = head() + `${alerts.length ? `<a class="abanner" href="#/alerts">${I.alert}<span><b>Service information</b><br>${alerts.length} alert${alerts.length > 1 ? "s" : ""}. ${esc(alerts[0].title)}</span></a>` : ""}
        ${(() => { const fj = js.find((o) => o.j.fare && o.x.leave > now() - 30000); const f = fj && fj.j.fare; return f ? `<div class="farebar">${f.offPeak ? `<span class="fb-peak">Peak</span><span>Off peak from ${esc(f.offPeak.from)}, save ${money(f.offPeak.save)}</span>` : `<span class="fb-t">Opal fare estimate</span><span>${money(f.total)} ${esc(f.typeName)}${f.peak ? ", peak" : ", off peak"}</span>`}</div>` : ""; })()}
        ${d.accessible ? `<div class="farebar accbar"><span class="fb-acc">${I.access}</span><span>Step free trips only. ${js.length ? "" : "None found for this trip. "}<a href="#/settings">Change in Settings</a></span></div>` : ""}
        ${d.parking && d.parking.carparks ? parkGroup(d.parking.carparks, `Park and Ride at ${stShort(d.parking.station.name)}`, true, d.parking.station.name) : ""}
        <div class="seg tt" role="tablist"><button class="${showDep ? "on" : ""}" role="tab" aria-selected="${showDep}" data-mode="dep">Departs in</button><button class="${showDep ? "" : "on"}" role="tab" aria-selected="${!showDep}" data-mode="dur">Travel time</button></div>
        <div class="group"><div class="list"><div class="cell static"><div class="grow"><div class="t1">All services</div><div class="t2">${df.all ? "Trips with a change are shown too" : df.chain ? ((d.fallback || []).some(Boolean) ? "Some legs have no direct service" : "Direct services on each leg") : df.none ? "None stop at both ends, so all are shown" : "Only services that stop at both ends"}</div></div><label class="switch"><input type="checkbox" data-all ${df.all ? "checked" : ""} aria-label="All services"><span></span></label></div></div></div>
        <div class="group"><div class="tcard"><button class="morebtn" data-more="-1">Earlier services</button>${rows || `<div class="svc-empty">No trips found right now</div>`}<button class="morebtn" data-more="1">Later services</button></div>
        <p class="group-f">${S.lastOk ? `Live data updated ${fmtSecs(S.lastOk)}. ` : ""}Tap a service for its stops, or to watch it. Greyed out: a later one gets you there sooner.</p></div>${foot()}`;
      $$("[data-mode]").forEach((b) => (b.onclick = () => { showDep = b.dataset.mode === "dep"; paint(); }));
      wirePark();
      const sw = $("[data-all]"); if (sw) sw.onchange = () => { const a = allSvc(); if (sw.checked) a[tripKey(T())] = 1; else delete a[tripKey(T())]; LS.set("tb_allsvc", a); open = null; if (chain) { extra = []; load(); } paint(); };
      $$("[data-more]").forEach((b) => (b.onclick = () => more(Number(b.dataset.more))));
      $$(".jrow").forEach((b) => (b.onclick = (e) => {
        if (e.target.closest("a")) return;
        const wb = e.target.closest("[data-watch]"); const cb = e.target.closest("[data-commute]");
        const j = js[Number(b.dataset.i)].j;
        if (e.target.closest("[data-go]")) { e.preventDefault(); startTrip(tripSpec(j, { id: from, name: fn }, { id: to, name: tn })); return; }
        if (wb) { e.preventDefault(); openWatchSheet(tripSpec(j, { id: from, name: fn }, { id: to, name: tn })); return; }
        if (cb) { e.preventDefault(); openCommuteSheet({ from: { id: from, name: fn }, to: { id: to, name: tn }, tod: todOf(tms(j.leave)) }); return; }
        if (e.target.closest(".jdetail")) return;
        const k = b.dataset.key; open = open === k ? null : k; paint();
      }));
    };
    function saveTrip() {
      if (isSavedT()) {
        deleteSaved(saved().find((s) => tripKey(s) === tripKey(T())) || T()); toast("Removed from saved trips"); navNow(); return;
      }
      const lm = (j) => { const l = j && (j.legs || []).find((x) => x.kind === "transit"); return l && modeOf(l.mode).k ? l.mode : ""; };
      if (legsP) return openConfirmTrip({ legs: tLegs(T()), name: name || null, after: () => navNow() });
      const j0 = (data && merged()[0] || {}).j;
      const t0 = T();
      const legs = via ? [{ mode: lm(j0), from: t0.from, to: via }, { mode: "", from: via, to: t0.to }] : [{ mode: lm(j0), from: t0.from, to: t0.to }];
      return openConfirmTrip({ legs, conn: t0.conn, name: name || null, after: () => navNow() });
      openModal({ title: "Save trip", right: "Save", body: `<div class="group-h">Name</div><div class="group"><div class="list"><div class="cell static"><input id="tripName" style="border:0;background:none;outline:none;width:100%;font-size:17px" value="${saved().length ? "work" : "home"}" maxlength="24" aria-label="Trip name"></div></div><p class="group-f">Then type the name in Search for the next live trips.</p></div>`,
        onOpen: (m) => setTimeout(() => $("#tripName", m).select(), 350),
        onRight: () => {
          const n = ($("#tripName").value || "").trim().toLowerCase();
          if (!n) return;
          const s = saved().filter((x) => x.name !== n);
          s.unshift({ name: n, from: { id: from, name: fn }, to: { id: to, name: tn } });
          LS.set("tb_saved", s.slice(0, 8));
          post("/api/saved", { profile: PROFILE, name: n, from: { id: from, name: fn }, to: { id: to, name: tn } }).catch(() => {});
          closeModal(); toast(`Saved as ${n}`); navNow();
        } });
    }
    if (data) paint(); else view.innerHTML = head() + `<div class="group">${skel(3)}</div>`;
    const load = () => (chain ? planTrip(T(), { count: 6, time: params.get("time") }) : api("/api/trip?" + qs({ from, to, fromName: fn, toName: tn, count: 6, time: params.get("time"), arriveBy: params.get("arr"), device: DEVICE, profile: PROFILE, refresh: data ? 1 : "", fare: fareT(), acc: accOn() ? 1 : null }))).then((d) => { data = { ...d, when: pre && pre.when }; paint(); }).catch((e) => { if (!data) view.innerHTML = head() + `<div class="empty">${esc(e.message)}</div>`; });
    if (!pre) load();
    every(20000, load);
  }
  function todOf(t) { const p = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(t)); const h = Number(p.find((x) => x.type === "hour").value) % 24; return h * 60 + Number(p.find((x) => x.type === "minute").value); }
  function journeyCard(j, i, open) {
    const tl = j.legs.filter((l) => l.kind === "transit");
    const first = tl[0];
    const key = (first && (first.tripId || first.planned)) || String(i);
    const t = tms(j.leave), b = bigText(t);
    const cls = first ? (first.cancelled ? "" : first.realtime ? (first.delayMin >= 2 ? "is-late" : "is-live") : "") : "";
    const watched = first && isWatched(first);
    const risk = j.anyCancelled ? `<span class="badge bad">Cancelled</span>` : j.risk === "miss" ? `<span class="badge bad">Connection at risk</span>` : j.risk === "tight" ? `<span class="badge late">Tight change</span>` : "";
    const word = first ? (first.cancelled ? '<span class="bad-t">Cancelled</span>' : first.realtime ? (first.delayMin >= 2 ? `<span class="late-t">${first.delayMin} min late</span>` : "On time") : `Scheduled${first.pred ? ` \u00b7 ${esc(first.pred.short)}*` : ""}`) : "";
    let h = `<div class="card jrny${j.beaten ? " beaten" : ""}" data-key="${esc(key)}" data-i="${i}" role="button" tabindex="0" aria-expanded="${open === key}" style="${j.beaten ? "opacity:.6" : ""}">
      <div class="big" style="margin-top:0"><span class="u">Leave in</span><span class="n big-n ${cls}" data-t="${t}">${esc(b.n)}</span><span class="u">${esc(b.u)}</span><span style="margin-left:auto">${risk}</span></div>
      <div class="meta">${fmtClock(j.leave)} to ${fmtClock(j.arrive)} \u00b7 ${j.durationMin} min \u00b7 ${j.changes ? j.changes + " change" + (j.changes > 1 ? "s" : "") : "direct"}</div>
      <div class="meta">${word}${first && first.fromPlatform ? " \u00b7 " + esc(first.fromPlatform) : ""}${first && first.vehicle && first.stopsAway != null && first.realtime ? ` \u00b7 ${first.stopsAway === 0 ? "arriving" : first.stopsAway + (first.stopsAway === 1 ? " stop away" : " stops away")}` : ""}</div>
      ${chainHtml(j)}
      ${journeyOutages(j).length ? `<div class="meta acc-warn">${I.access}${esc(journeyOutages(j)[0])}</div>` : ""}
      <div class="card-actions"><button class="pillbtn${watched ? " on" : ""}" data-watch>${I.bell}${watched ? "Watching" : "Watch"}</button><button class="pillbtn" data-commute>${I.clock}Commute</button></div>`;
    if (open === key) h += `<div class="legs" style="margin-top:14px">${legsDetail(j)}</div>`;
    return h + `</div>`;
  }
  function legsDetail(j) {
    return j.legs.map((l) => {
      if (l.kind === "walk") return l.durationMin < 1 ? "" : `<div class="leg walk"><div class="lt" style="font-weight:500">${I.walk.replace("<svg", '<svg style="width:16px;height:16px"')} Walk ${l.durationMin} min</div><div class="ls">to ${esc(l.to)}</div></div>`;
      const dep = tms(l.estimated || l.planned), arr = tms(l.arrEstimated || l.arrPlanned);
      const moved = l.estimated && Math.abs(tms(l.estimated) - tms(l.planned)) >= 60000;
      const tf = l.transfer;
      const tr = !tf ? "" : tf.missed ? `<div class="transfer miss">Delays: you miss the ${fmtClock(tms(tf.missed.planned))} ${esc(tf.missed.line)} at ${esc(tf.at)}. Next connection: ${Math.max(0, tf.minutes)} min to change</div>`
        : `<div class="transfer ${tf.risk}">${tf.risk === "miss" ? "Connection at risk: " : tf.risk === "tight" ? "Tight change: " : ""}${Math.max(0, tf.minutes)} min to change at ${esc(tf.at)}${tf.walkMin ? `, ${tf.walkMin} min walk` : ""}${tf.chain && tf.conn != null && tf.risk !== "tight" ? `, you allow ${tf.conn}` : ""}</div>`;
      return `${tr}<div class="leg" style="--c:${esc(l.color)}"><div class="lt">${lb(l.line, l.color, true)} ${esc(short(l.towards))}</div>
        <div class="ls"><b>${moved ? `<s>${fmtClock(l.planned)}</s> ` : ""}${fmtClock(dep)}</b> ${esc(l.from)}${l.fromPlatform ? ", " + esc(l.fromPlatform) : ""}</div>
        <div class="ls">${statusLine(l, { noPlatform: true })}</div>
        <div class="ls"><b>${fmtClock(arr)}</b> ${esc(l.to)}${l.toPlatform ? ", " + esc(l.toPlatform) : ""} \u00b7 ${l.durationMin} min${l.stops ? `, ${l.stops} stops` : ""}</div>
        ${legAccHtml(l)}
        <div class="ls"><a href="${svcLink(l, { to: l.toStopId })}" style="color:var(--tint)">Track on map</a></div></div>`;
    }).join("");
  }

  // ---------- service view: live map with a pull up sheet ----------
  function serviceView(params) {
    setTab("full"); setNav({ title: "" });
    nav.style.display = "none";
    S.cleanup.push(() => { nav.style.display = ""; });
    const q = Object.fromEntries(params.entries());
    const color = q.color || "#00B5EF";
    let map = null, layers = {}, vMarker = null, follow = true, firstFit = true, lastPos = null, data = null;
    view.innerHTML = `<div class="mapwrap"><div id="map" style="--c:${esc(color)}"></div></div>
      <button class="map-btn left" id="mBack" aria-label="Back">${I.back.replace("<svg", '<svg style="width:12px;height:18px"')}</button>
      <button class="map-btn right" id="mFollow" aria-label="Follow vehicle" hidden>${I.loc}</button>
      <section class="sheet" id="sheet" style="--c:${esc(color)}"><div class="grab" id="grab"></div><div class="sheet-body" id="sbody">
        <div class="svc-top"><div class="svc-title">${lb(q.line, color)}<h1>${esc(short(q.dest || ""))}</h1></div><div class="skel" style="margin-top:14px;border-radius:12px"></div></div></div></section>`;
    $("#mBack").onclick = () => { if (S.navDepth > 0) history.back(); else location.hash = "#/"; };
    const fb = $("#mFollow");
    fb.onclick = () => { follow = true; fb.hidden = true; if (lastPos && map) map.panTo(lastPos); };
    // Sheet drag with three resting points.
    const sheet = $("#sheet"), sbody = $("#sbody");
    const H = () => sheet.getBoundingClientRect().height;
    const snaps = () => [H() - 210, H() * 0.42, 0];
    let y = snaps()[1];
    const setY = (v) => { y = v; sheet.style.setProperty("--y", v + "px"); };
    setY(y);
    let drag = null;
    const startDrag = (e) => { if (e.target.closest("button, a")) return; drag = { y0: e.clientY, base: y, t: Date.now() }; sheet.classList.add("drag"); };
    const onMove = (e) => { if (!drag) return; setY(Math.max(0, Math.min(snaps()[0] + 40, drag.base + e.clientY - drag.y0))); };
    const onUp = (e) => {
      if (!drag) return;
      const v = (e.clientY - drag.y0) / Math.max(1, Date.now() - drag.t);
      sheet.classList.remove("drag");
      const sp = snaps();
      let target = sp.reduce((a, b) => (Math.abs(b - y) < Math.abs(a - y) ? b : a));
      if (v > 0.6) target = sp.filter((s) => s > drag.base).sort((a, b) => a - b)[0] ?? sp[0];
      if (v < -0.6) target = sp.filter((s) => s < drag.base).sort((a, b) => b - a)[0] ?? 0;
      drag = null; setY(target);
    };
    $("#grab").addEventListener("pointerdown", startDrag);
    sheet.addEventListener("pointerdown", (e) => { if (e.target.closest(".svc-top")) startDrag(e); });
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    S.cleanup.push(() => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); });

    const makeMap = () => {
      if (map || !window.L) return;
      const dark = matchMedia("(prefers-color-scheme: dark)").matches;
      map = L.map("map", { zoomControl: false, attributionControl: true }).setView([-33.8688, 151.2093], 13);
      baseTiles(map);
      map.on("dragstart", () => { follow = false; fb.hidden = !vMarker; });
      S.cleanup.push(() => { map.remove(); map = null; });
    };
    const vehIcon = (bearing) => L.divIcon({ className: "", iconSize: [36, 36], iconAnchor: [18, 18], html: `<div class="vm" style="--c:${esc(color)}"><span class="ring"></span>${bearing != null ? `<div style="position:absolute;inset:0;transform:rotate(${bearing}deg)"><span class="h"></span></div>` : ""}<span class="b">${icon(q.mode)}</span></div>` });
    const animate = (m, to) => {
      const from = m.getLatLng(); const t0 = performance.now(), dur = 1800;
      const step = (t) => { const k = Math.min(1, (t - t0) / dur); const e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; m.setLatLng([from.lat + (to[0] - from.lat) * e, from.lng + (to[1] - from.lng) * e]); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    };
    const paintMap = (d) => {
      makeMap(); if (!map) return;
      if (!layers.route && d.path && d.path.length > 1) {
        layers.route = L.polyline(d.path, { color, weight: 6, opacity: .9, lineJoin: "round" }).addTo(map);
        layers.stops = L.layerGroup().addTo(map);
      }
      if (layers.stops) {
        layers.stops.clearLayers();
        d.stops.forEach((s) => {
          const mine = s.mine || s.alight;
          L.marker([s.lat, s.lon], { icon: L.divIcon({ className: "", iconSize: mine ? [18, 18] : [12, 12], html: `<div class="sm-dot${mine ? " mine" : ""}" style="--c:${esc(color)};${s.passed ? "opacity:.45" : ""}"></div>` }), keyboard: false, title: s.name }).addTo(layers.stops);
        });
      }
      if (d.vehicle) {
        const pos = [d.vehicle.lat, d.vehicle.lon];
        if (!vMarker) vMarker = L.marker(pos, { icon: vehIcon(d.vehicle.bearing), zIndexOffset: 1000, keyboard: false }).addTo(map);
        else { vMarker.setIcon(vehIcon(d.vehicle.bearing)); animate(vMarker, pos); }
        lastPos = pos;
      }
      const pad = { paddingTopLeft: [30, 70], paddingBottomRight: [30, Math.min(window.innerHeight * 0.55, H() - y) + 20] };
      if (firstFit) {
        firstFit = false;
        const pts = [];
        if (d.vehicle) pts.push([d.vehicle.lat, d.vehicle.lon]);
        const mi = d.mineIndex >= 0 ? d.mineIndex : d.nextIndex;
        d.stops.slice(Math.max(0, mi - 1), mi + 2).forEach((s) => pts.push([s.lat, s.lon]));
        if (pts.length > 1) map.fitBounds(pts, { ...pad, maxZoom: 16 });
        else if (pts.length) map.setView(pts[0], 15);
        else if (layers.route) map.fitBounds(layers.route.getBounds(), pad);
      } else if (follow && lastPos) map.panTo(lastPos, { animate: true, duration: 1.5 });
    };
    const paint = (d) => {
      const late = d.delayMin;
      const status = d.cancelled ? `<span class="badge bad">Cancelled</span>` : d.live ? `<span class="badge live">${I.rt.replace('class="rt"', 'class="rt" style="width:11px;height:11px"')}Live</span>${late >= 2 ? `<span class="badge late">${late} min late</span>` : late <= -2 ? `<span class="badge late">${-late} min early</span>` : `<span class="badge live">On time</span>`}` : `<span class="badge sched">Scheduled, no live data yet</span>`;
      const occ = d.vehicle && d.vehicle.occupancy ? `<span class="badge sched">${esc(d.vehicle.occupancy.text)}</span>` : "";
      const m = d.mine;
      const mt = m ? tms(m.estimated || m.planned) : 0, bt = bigText(mt);
      const away = d.stopsAway == null ? "" : d.stopsAway === 0 ? ", arriving" : `, ${d.stopsAway} stop${d.stopsAway === 1 ? "" : "s"} away`;
      const cls = d.cancelled ? "" : d.live ? (late >= 2 ? "is-late" : "is-live") : "";
      const eta = m && !m.passed ? `<div class="svc-eta"><span class="n big-n ${cls}" data-t="${mt}">${esc(bt.n)}</span><span class="u" data-after=" at ${esc(short(m.name))}${esc(away)}">${esc(bt.u)} at ${esc(short(m.name))}${esc(away)}</span></div>` : "";
      const where = d.where ? `<div class="svc-where"><b>${esc(d.where.text)}</b>${d.vehicle && d.vehicle.ageS != null ? ` \u00b7 seen ${d.vehicle.ageS < 60 ? d.vehicle.ageS + " s" : Math.round(d.vehicle.ageS / 60) + " min"} ago${d.vehicle.speedKmh ? `, ${d.vehicle.speedKmh} km/h` : ""}` : ""}</div>` : `<div class="svc-where">No live position for this ${noun(d.mode)} yet.${d.live ? "" : " It usually appears once it starts its run."}</div>`;
      const pred = d.pred ? `<div class="pred-line">${I.chart}<div><b style="color:var(--label);font-weight:600">Prediction, not live:</b> ${esc(d.pred.text.toLowerCase().replace(/^usually/, "usually"))}, ${esc(d.pred.basis)}.</div></div>` : "";
      const al = (d.alerts || []).map((a) => `<div class="alert${/high/i.test(a.priority) ? " high" : ""}"><span class="ai">${I.alert}</span><div>${esc(a.title)}</div></div>`).join("");
      const watched = isWatched({ tripId: d.tripId || q.trip, line: q.line, planned: q.planned });
      const stopsHtml = d.stops.map((s, i) => {
        const t = s.estimated || s.planned;
        const moved = s.estimated && s.planned && Math.abs(tms(s.estimated) - tms(s.planned)) >= 60000;
        const vehHere = d.vehicle && i === d.nextIndex;
        return `<li class="${s.passed ? "passed" : ""}${s.mine ? " mine" : ""}" ${s.mine ? 'id="mineStop"' : ""}>${vehHere ? `<span class="veh">${icon(d.mode)}</span>` : ""}<span>${esc(short(s.name))}${s.mine ? '<span class="tag">Your stop</span>' : ""}${s.alight ? '<span class="tag">Get off</span>' : ""}${s.skipped ? ' <span class="late-t">skipped</span>' : ""}</span>
          <span class="st-time${s.estimated ? " live" : ""}">${moved ? `<s>${fmtClock(s.planned)}</s>` : ""}${t ? fmtClock(t) : ""}</span></li>`;
      }).join("");
      const keep = sbody.scrollTop;
      sbody.innerHTML = `<div class="svc-top"><div class="svc-title">${lb(d.line || q.line, color)}<h1>${esc(short(d.dest || q.dest || ""))}</h1></div>
        <div class="svc-status">${status}${occ}${q.platform ? `<span class="badge sched">${esc(q.platform)}</span>` : ""}</div>${eta}${where}${pred}
        <div style="margin:14px 0 4px"><button class="btn${watched ? " on" : ""}" id="watchBtn">${I.bell}${watched ? "Watching this trip" : "Watch this trip"}</button></div></div>
        ${al ? `<div class="group" style="margin:12px 16px"><div class="list" style="background:var(--bg3)">${al}</div></div>` : ""}
        ${d.stops.length ? `<div class="group-h" style="margin-top:14px">Stops \u00b7 ${d.live ? "live times" : "timetable times"}</div><ul class="stops">${stopsHtml}</ul>` : `<div class="empty">Stop list not available for this service right now.</div>`}`;
      sbody.scrollTop = keep;
      $("#watchBtn").onclick = () => {
        if (watched) { location.hash = "#/watching"; return; }
        const it = { mode: d.mode || q.mode, line: d.line || q.line, tripId: d.tripId || q.trip, stopId: q.stop, stopName: q.stopName, planned: (m && m.planned) || q.planned, estimated: m && m.estimated, dest: d.dest || q.dest, destId: q.destId, color, platform: q.platform };
        const alight = d.alightIndex >= 0 ? d.stops[d.alightIndex] : null;
        openWatchSheet(svcSpec(it, { stops: d.stops, toStopId: alight && alight.id, toName: alight && short(alight.name), arrPlanned: alight && alight.planned }));
      };
      paintMap(d);
    };
    const load = () => api("/api/service?" + qs(q)).then((d) => { data = d; paint(d); }).catch((e) => { if (!data) sbody.innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
    const start = () => { load(); every(10000, load); };
    if (window.L) start(); else window.addEventListener("load", start, { once: true });
  }

  // ---------- watching ----------
  // The "Turn on alerts" card for Watching. It respects "Not now" for 3 days and explains
  // why alerts are not possible when the browser can't show them.
  function promptCard() {
    const ps = pushState();
    if (ps === "on") return "";
    const hideUntil = Number(LS.get("tb_hide_prompt", 0)) || 0;
    if (ps === "off" && hideUntil > Date.now()) return "";
    const text = ps === "install" ? "On iPhone, add this app to your Home Screen first (Share, then Add to Home Screen). Until then, alerts show here while it's open."
      : ps === "denied" ? "Notifications are blocked for this site. Allow them in your phone's settings. Alerts still show here while the app is open."
      : ps === "unsupported" ? "This browser can't show notifications. Alerts show here while the app is open."
      : "Get told when to leave, about delays, platform changes and a connection at risk, even with the app closed.";
    return `<div class="group"><div class="card">${ps === "off" ? `<button class="x" data-hide-prompt aria-label="Not now">${I.x}</button>` : ""}<div class="prompt"><span class="sym" style="background:#ff3b30">${I.bell}</span><div><h2>${ps === "off" ? "Turn on alerts" : "Alerts on this phone"}</h2><p>${esc(text)}</p>${ps === "off" ? `<button class="pillbtn solid" id="pushOn" style="margin-top:10px">Turn on alerts</button>` : ""}</div></div></div></div>`;
  }
  function watchingView() {
    setTab("watching"); setNav({ title: "Watching" });
    const paint = (d) => {
      const items = S.watches;
      const active = items.filter((w) => w.active), done = items.filter((w) => !w.active);
      const ps = pushState();
      view.innerHTML = `<h1 class="large">Watching<small>${active.length ? `${active.length} trip${active.length > 1 ? "s" : ""} followed live, every minute` : "Nothing followed right now"}</small></h1>
        ${ps === "on" ? "" : promptCard()}
        ${active.length ? `<div class="group">${active.map(watchCard).join("")}</div>` : `<div class="group"><div class="card"><div class="prompt"><span class="sym" style="background:#ff9500">${I.bell}</span><div><h2>Watch a trip</h2><p>Swipe left on any service, or tap Watch on a trip or on the map. I'll follow it and tell you when to leave, if it runs late, changes platform, or your connection is at risk.</p></div></div></div></div>`}
        ${d && d.notes && d.notes.length ? `<div class="group"><div class="group-h">Recent alerts</div><div class="list">${d.notes.map((n) => `<a class="cell" href="${esc(n.url || "#/watching")}"><span class="s-ico orange">${I.bell}</span><div class="grow"><div class="t1" style="font-weight:600">${esc(n.title)}</div><div class="t2" style="white-space:normal">${esc(n.body)}</div></div><span class="clock">${fmtClock(n.at)}</span></a>`).join("")}</div></div>` : ""}
        ${done.length ? `<div class="group"><div class="group-h">Finished</div><div class="list">${done.map((w) => `<a class="cell" href="#/watch/${esc(w.id)}"><div class="grow"><div class="t1">${esc(w.title)}</div><div class="t2">${w.ended === "stopped" ? "Stopped" : "Trip ended"}</div></div>${I.chev}</a>`).join("")}</div></div>` : ""}${foot()}`;
      const po = $("#pushOn"); if (po) po.onclick = async () => { const r = await enablePush(true).catch(() => ({ ok: false })); toast(r.ok ? "Alerts are on. A test one is on its way." : pushWhyText(r.why)); paint(d); };
      const hp = $("[data-hide-prompt]"); if (hp) hp.onclick = (e) => { e.preventDefault(); LS.set("tb_hide_prompt", Date.now() + 3 * 86400000); paint(d); };
    };
    const load = async () => {
      const d = await pollWatches();
      let notes = [];
      try { notes = (await fetch("/api/watches?" + qs({ device: DEVICE, profile: PROFILE, since: 0 })).then((r) => r.json())).notes || []; } catch (e) { /* offline */ }
      paint({ notes });
    };
    paint(null); load(); every(20000, load);
  }
  function watchDetailView(id) {
    setTab("watching"); setNav({ title: "Watched trip", back: true });
    view.innerHTML = `<h1 class="large">Watched trip</h1><div class="group">${skel(3)}</div>`;
    const load = () => api("/api/watch?" + qs({ id })).then((d) => {
      const w = d.watch, s = watchStatus(w), L = (w.snap && w.snap.legs) || [];
      setNav({ title: w.title, back: true });
      const b = s.t ? bigText(s.t) : null;
      view.innerHTML = `<h1 class="large">${esc(w.title)}<small>${w.active ? "Followed live, every minute" : w.ended === "stopped" ? "You stopped watching" : "Trip ended"}</small></h1>
        <div class="group"><div class="card">${b ? `<div class="big" style="margin-top:0"><span class="u">${esc(s.head)}</span><span class="n big-n ${s.cls || ""}" data-t="${s.t}">${esc(b.n)}</span><span class="u">${esc(b.u)}</span></div>` : `<div class="big" style="margin-top:0"><span class="n" style="font-size:28px">${esc(s.head)}</span></div>`}
          <div class="meta">${esc(s.sub)}</div>
          <div class="legs" style="margin-top:14px">${(w.legs || []).map((l, i) => { const o = L[i] || {}; const dep = o.dep || tms(l.planned); const arr = o.arr || tms(l.arrPlanned);
            return `${l.walkBefore && i > 0 ? `<div class="transfer">${l.walkBefore} min walk to change</div>` : ""}<div class="leg" style="--c:${esc(l.color || "#8e8e93")}"><div class="lt">${lb(l.line, l.color, true)} ${esc(short(l.towards || l.to || ""))}</div>
            <div class="ls"><b>${o.depLive && Math.abs(dep - tms(l.planned)) >= 60000 ? `<s>${fmtClock(l.planned)}</s> ` : ""}${fmtClock(dep)}</b> ${esc(l.from || "")}${o.platform ? ", " + esc(o.platform) : ""}${o.platformFrom ? ` <span class="late-t">(was ${esc(o.platformFrom)})</span>` : ""}</div>
            <div class="ls">${o.cancelled ? '<span class="bad-t">Cancelled</span>' : o.depLive ? (o.delay >= 2 ? `<span class="late-t">${o.delay} min late</span>` : o.delay <= -2 ? `${-o.delay} min early` : "On time") : "Scheduled"}${o.simulated ? " (test delay)" : ""}</div>
            ${arr && l.to ? `<div class="ls"><b>${fmtClock(arr)}</b> ${esc(l.to)}</div>` : ""}</div>`; }).join("")}</div>
          <div class="card-actions">${(w.legs || [])[0] && w.active ? `<a class="pillbtn" href="${svcLink({ ...w.legs[0], dest: w.legs[0].towards, stopName: w.legs[0].from }, { to: w.legs[0].toStopId })}">Track on map</a>` : ""}</div></div></div>
        ${d.notes.length ? `<div class="group"><div class="group-h">Alerts sent</div><div class="list">${d.notes.map((n) => `<div class="cell static"><div class="grow"><div class="t1" style="font-weight:600">${esc(n.title)}</div><div class="t2" style="white-space:normal">${esc(n.body)}</div></div><span class="clock">${fmtClock(n.at)}</span></div>`).join("")}</div></div>` : ""}
        ${w.active ? `<div class="group"><div class="list"><button class="cell danger" id="stopW">Stop watching</button></div></div>` : ""}${foot()}`;
      const sw = $("#stopW"); if (sw) sw.onclick = async () => { await stopWatch(id); toast("Stopped watching"); load(); };
    }).catch((e) => { view.innerHTML = `<h1 class="large">Watched trip</h1><div class="empty">${esc(e.message)}</div>`; });
    load(); every(20000, load);
  }

  // ---------- settings ----------
  const DAYS = [["1", "M"], ["2", "T"], ["3", "W"], ["4", "T"], ["5", "F"], ["6", "S"], ["7", "S"]];
  function daysText(d) {
    if (d === "12345") return "Weekdays"; if (d === "1234567") return "Every day"; if (d === "67") return "Weekends";
    return d.split("").map((x) => ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][Number(x)]).join(", ");
  }
  function openCommuteSheet(c) {
    let days = c.days || "12345";
    const t = c.tod != null ? c.tod : 480;
    const hhmm = String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0");
    openModal({ title: c.id ? "Edit commute" : "New commute", right: "Save", body: `
      <div class="group"><div class="list"><div class="cell static"><div class="grow"><div class="t1" style="font-weight:600">${esc(short(c.from.name))} to ${esc(short(c.to.name))}</div><div class="t2">I'll tell you when to leave and warn you about delays</div></div></div></div></div>
      <div class="group"><div class="list">
        <div class="cell static"><div class="grow">Name</div><input id="cName" value="${esc(c.name || (t < 720 ? "Morning trip" : "Evening trip"))}" maxlength="30" style="border:0;background:none;outline:none;text-align:right;color:var(--label2);font-size:17px;width:55%"></div>
        <div class="cell static"><div class="grow">Usually leave at</div><input type="time" id="cTime" value="${hhmm}"></div>
        ${c.id ? `<div class="cell static"><div class="grow">On</div><label class="switch"><input type="checkbox" id="cOn" ${c.active ? "checked" : ""}><span></span></label></div>` : ""}
      </div></div>
      <div class="group-h">Days</div><div class="group"><div class="days" id="cDays">${DAYS.map(([v, n]) => `<button data-v="${v}" class="${days.includes(v) ? "on" : ""}" aria-label="${["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][Number(v)]}">${n}</button>`).join("")}</div>
      <p class="group-f">About 30 minutes before, you get a heads up only if something's wrong (delays, alerts, a tight change). Then a leave now alert for the best trip near your time, and I follow it until you arrive.</p></div>
      ${c.id ? `<div class="group"><div class="list"><button class="cell danger" id="cDel">Delete commute</button></div></div>` : ""}`,
      onOpen: (m) => {
        $$("#cDays button", m).forEach((b) => (b.onclick = () => { b.classList.toggle("on"); days = $$("#cDays button.on", m).map((x) => x.dataset.v).join(""); }));
        const del = $("#cDel", m); if (del) del.onclick = async () => { await api("/api/commutes?" + qs({ id: c.id, profile: PROFILE }), { method: "DELETE" }).catch(() => {}); closeModal(); toast("Commute deleted"); route(); };
      },
      onRight: async () => {
        const [hh, mm] = ($("#cTime").value || "08:00").split(":").map(Number);
        const body = { id: c.id, from: c.from, to: c.to, name: $("#cName").value.trim() || "My trip", tod: hh * 60 + mm, days: days || "12345" };
        if (c.id) body.active = $("#cOn").checked;
        try {
          await post("/api/commutes?" + qs({ profile: PROFILE }), body);
          const tt = `${hh % 12 || 12}:${String(mm).padStart(2, "0")}${hh < 12 ? "am" : "pm"}`;
          closeModal(); toast(c.id ? "Saved" : `Commute set: ${daysText(body.days).toLowerCase()} around ${tt}`);
          if (pushState() === "off") { try { await enablePush(true); } catch (e) { /* optional */ } }
          route();
        } catch (e) { toast(e.message); }
      } });
  }
  // Confirm sheet, then delete server data for this profile. scope "history": trip searches
  // and commute suggestions. scope "all": also saved trips, commutes, watches and alerts on the
  // server, then everything this app keeps on the phone except its private id.
  function confirmDelete(scope, done) {
    const all = scope === "all";
    const m = openModal({ title: all ? "Delete all my data" : "Delete trip history", body: `<div class="delsheet"><span class="sym big-sym" style="background:var(--red)">${I.x}</span>
      <h3>${all ? "Delete all your data?" : "Delete your trip history?"}</h3>
      <p>${all ? "This deletes your saved trips, starred stops, commutes, watched trips, alerts and trip history, on this phone and on the server. Alerts on this phone turn off. This cannot be undone." : "This deletes the trips you searched for that the server keeps, and the commute suggestions made from them. Saved trips, commutes and watches stay. This cannot be undone."}</p>
      <button class="pillbtn solid dangerbtn" id="delGo">${all ? "Delete all my data" : "Delete trip history"}</button></div>` });
    $("#delGo", m).onclick = async () => {
      const btn = $("#delGo", m); btn.disabled = true; btn.textContent = "Deleting";
      try {
        const r = await post("/api/history/delete", { profile: PROFILE, device: DEVICE, scope });
        if (all) {
          try { const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); const sub = reg && reg.pushManager && await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch (e) { /* no push */ }
          const keep = new Set(["tb_profile", "tb_device", "tb_install_seen", "tb_install_x"]);
          Object.keys(localStorage).filter((k) => k.startsWith("tb_") && !keep.has(k)).forEach((k) => localStorage.removeItem(k));
          S.watches = [];
        }
        const n = (r && r.deleted && r.deleted.searches) || 0;
        closeModal(); toast(all ? "All your data is deleted" : n ? `Deleted ${n} trip search${n === 1 ? "" : "es"}` : "Trip history deleted");
        if (done) done();
      } catch (e) { btn.disabled = false; btn.textContent = all ? "Delete all my data" : "Delete trip history"; toast(e.message || "Could not delete right now. Try again."); }
    };
  }
  function settingsView() {
    setTab("settings"); setNav({ title: "Settings" });
    const paint = (cm, usage) => {
      const ps = pushState();
      const pushRow = ps === "on" ? `<div class="cell static"><span class="sym" style="background:#ff3b30">${I.bell}</span><div class="grow">Alerts</div><span class="val">On</span></div><button class="cell tint" id="testPush"><span class="sym" style="background:var(--fill);color:var(--tint)">${I.sparkle}</span><div class="grow">Send a test alert</div></button>`
        : ps === "install" ? `<div class="cell static"><span class="sym" style="background:#ff3b30">${I.bell}</span><div class="grow"><div class="t1">Alerts</div><div class="t2" style="white-space:normal">Add to Home Screen first (below), then open it from there</div></div></div>`
        : ps === "denied" ? `<div class="cell static"><span class="sym" style="background:#ff3b30">${I.bell}</span><div class="grow"><div class="t1">Alerts blocked</div><div class="t2" style="white-space:normal">Allow notifications for this site in your phone settings</div></div></div>`
        : ps === "unsupported" ? `<div class="cell static"><span class="sym" style="background:#ff3b30">${I.bell}</span><div class="grow"><div class="t1">Alerts</div><div class="t2">Not available in this browser</div></div></div>`
        : `<button class="cell" id="pushOn2"><span class="sym" style="background:#ff3b30">${I.bell}</span><div class="grow">Alerts</div><span class="val" style="color:var(--tint)">Turn On</span></button>`;
      view.innerHTML = `<h1 class="large">Settings</h1>
        <div class="group"><div class="group-h">Notifications</div><div class="list" style="--inset:57px">${pushRow}</div>
        <p class="group-f">Alerts come from trips you watch and from your commutes. Each watched trip ends on its own when you arrive.</p></div>
        <div class="group"><div class="group-h">Commutes</div><div class="list">${cm.length ? cm.map((c, i) => `<button class="cell" data-c="${i}"><span class="sym" style="background:${c.active ? "#5856d6" : "var(--label3)"}">${I.clock}</span><div class="grow"><div class="t1">${esc(c.name)}</div><div class="t2">${esc(short(c.from.name))} to ${esc(short(c.to.name))} \u00b7 ${esc(c.todText)} \u00b7 ${c.active ? esc(daysText(c.days)) : "Off"}</div></div>${I.chev}</button>`).join("") : `<div class="cell static"><div class="grow t2" style="white-space:normal">No commute yet. Open any trip and tap Commute, or search the same trip on two days and I'll offer it.</div></div>`}</div></div>
        <div class="group" id="accSet"><div class="group-h">Accessibility</div><div class="list" style="--inset:57px">
          <div class="cell static"><span class="sym" style="background:#0a84ff">${I.access}</span><div class="grow"><div class="t1">Accessible trips</div><div class="t2 wrap">Step free trips only, from the Trip Planner</div></div><label class="switch"><input type="checkbox" id="accToggle" aria-label="Accessible trips"${accOn() ? " checked" : ""}><span></span></label></div>
          <div class="cell static"><span class="sym" style="background:#ff3b30">${I.bell}</span><div class="grow"><div class="t1">Lift outage alerts</div><div class="t2 wrap">For stations on your saved trips</div></div><label class="switch"><input type="checkbox" id="liftToggle" aria-label="Lift outage alerts"${LS.get("tb_liftalerts", false) ? " checked" : ""}><span></span></label></div>
          <a class="cell" href="#/topup"><span class="sym" style="background:#5856d6">${I.card}</span><div class="grow">Opal top up machines near me</div>${I.chev}</a>
        </div><p class="group-f">Station screens show step free access, lifts and live lift outages from Transport for NSW. Trip details mark each station, and a lift outage on your trip shows on the trip.</p></div>
        <div class="group" id="fareSet"><div class="group-h">Opal fare estimates</div><div class="list">${Object.entries(FARE_NAMES).map(([k, n]) => `<button class="cell" data-fare="${k}" role="radio" aria-checked="${fareT() === k}"><div class="grow">${esc(n)}</div>${fareT() === k ? `<span class="check"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>` : ""}</button>`).join("")}</div>
          <p class="group-f">Trips show an Opal fare estimate for this fare type, worked out from the Opal fare tables: peak or off peak, transfer discount, airport station fee and daily cap. It is not your card's charge.</p></div>
        <div class="group" id="clearHist"><div class="group-h">Clear history</div><div class="list">
          ${[["tb_recent", "Clear recent searches", recents().length], ["tb_rstops", "Clear recent stops", recentStops().length], ["tb_rtrips", "Clear recent trips", recentTrips().length]].map(([k, t, n]) => `<button class="cell" data-clr="${k}"${n ? "" : " disabled"}><div class="grow${n ? " tint-t" : " t2"}">${t}</div><span class="val">${n || "None"}</span></button>`).join("")}
          <button class="cell" id="delServer"><div class="grow danger-t">Delete my trip history on server</div></button>
          <button class="cell" id="delAll"><div class="grow danger-t">Delete all my data</div></button>
        </div><p class="group-f">Recent searches, stops and trips are kept only on this phone. The server keeps the trips you search for 90 days, under this app's private id, to suggest commutes. Delete them here at any time.</p></div>
        <div class="group"><div class="group-h">Install</div><div class="card"><div class="prompt"><span class="sym" style="background:var(--tint)">${I.plusSq}</span><div><h2>${standalone ? "Installed" : "Add to Home Screen"}</h2>
          ${standalone ? `<p>You're using the installed app.</p>` : isIOS ? `<ol class="steps"><li>Tap ${I.share} Share in Safari</li><li>Tap Add to Home Screen</li><li>Open Transport from your Home Screen, then turn on alerts here</li></ol>` : `<p>In Chrome, tap the menu, then Install app or Add to Home screen.</p>${S.installEvt ? `<div class="card-actions"><button class="pillbtn solid" id="installBtn">Install</button></div>` : ""}`}</div></div></div></div>
        <div class="group"><div class="group-h">Predictions</div><div class="list"><div class="cell static"><span class="sym" style="background:#34c759">${I.chart}</span><div class="grow"><div class="t1">Delay history</div><div class="t2">${usage && usage.observations ? `${usage.observations.n.toLocaleString()} live times recorded` : "Recording"}</div></div></div></div>
        <p class="group-f">I record live times at busy stations and your stops every few minutes. Once a service has 5 or more recorded trips around the same time of day, it shows a usual delay, marked as a prediction. It never replaces live data.</p></div>
        <div class="group"><div class="list"><a class="cell" href="#/alerts"><div class="grow">Service alerts</div>${I.chev}</a><a class="cell" href="#/near"><div class="grow">Stops near me</div>${I.chev}</a></div></div>${foot()}`;
      $$("[data-c]").forEach((b) => (b.onclick = () => openCommuteSheet(cm[Number(b.dataset.c)])));
      const po = $("#pushOn2"); if (po) po.onclick = async () => { const r = await enablePush(true).catch(() => ({ ok: false })); toast(r.ok ? "Alerts are on. A test one is on its way." : pushWhyText(r.why)); paint(cm, usage); };
      const tp = $("#testPush"); if (tp) tp.onclick = async () => { try { await syncPush(); const r = await post("/api/push/test", { device: DEVICE }); toast(r.pushed && r.pushed.some((x) => x === 201 || x === 200) ? "Sent. Check your notifications." : "Sent, but the phone's push service didn't accept it. Try turning alerts off and on."); } catch (e) { toast(e.message); } };
      const ib = $("#installBtn"); if (ib) ib.onclick = async () => { S.installEvt.prompt(); S.installEvt = null; };
      $("#accToggle").onchange = (e) => { LS.set("tb_acc", e.target.checked); toast(e.target.checked ? "Trips now show step free options only" : "Showing all trips"); };
      $("#liftToggle").onchange = async (e) => {
        const on = e.target.checked;
        if (on && pushState() !== "on") { const r = await enablePush(false).catch(() => ({ ok: false })); if (!r.ok) { e.target.checked = false; toast(pushWhyText(r.why) || "Turn on alerts first."); return; } }
        try {
          const r = await post("/api/lifts/alerts", on ? { device: DEVICE, profile: PROFILE, on: true, stations: liftStations() } : { device: DEVICE, on: false });
          LS.set("tb_liftalerts", on);
          toast(!on ? "Lift outage alerts off" : r.now && r.now.length ? `On. Right now: ${r.now[0].title}` : `On for ${r.stations} station${r.stations === 1 ? "" : "s"}. No lift outages there right now.`);
        } catch (err) { e.target.checked = !on; toast(err.message); }
      };
      $$("[data-fare]").forEach((b) => (b.onclick = () => { LS.set("tb_fare", b.dataset.fare); toast(`Fares shown for ${FARE_NAMES[b.dataset.fare]}`); paint(cm, usage); }));
      $$("[data-clr]").forEach((b) => (b.onclick = () => { LS.set(b.dataset.clr, []); toast("Cleared"); paint(cm, usage); }));
      $("#delServer").onclick = () => confirmDelete("history", () => paint(cm, usage));
      $("#delAll").onclick = () => confirmDelete("all", () => { cm = []; paint([], usage); });
    };
    paint(LS.get("tb_commutes", []), null);
    Promise.all([api("/api/commutes?" + qs({ profile: PROFILE })).catch(() => null), fetch("/api/usage").then((r) => r.json()).catch(() => null)]).then(([c, u]) => {
      const cm = (c && c.items) || []; LS.set("tb_commutes", cm); paint(cm, u);
    });
  }
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); S.installEvt = e; });


  // ---------- Opal top up and ticket machine finder ----------
  const TK = { cash: ["Top up and tickets", "Cash or card", "#5856d6"], card: ["Top up and tickets", "Card only", "#af52de"], topup: ["Top up only", "Card only", "#ff9500"] };
  function topupView(params) {
    setTab("search"); setNav({ title: "Opal machines", back: true });
    let items = null, coords = null, map = null, filter = params.get("cash") === "1" ? "cash" : "";
    view.innerHTML = `<h1 class="large">Opal machines<small>Finding your location</small></h1><div class="group">${skel(5)}</div>`;
    const paint = () => {
      const list = (items || []).filter((r) => !filter || r.kind === "cash");
      const near = coords ? list.slice(0, 25) : list.slice(0, 40);
      if (map) { map.remove(); map = null; }
      view.innerHTML = `<h1 class="large">Opal machines<small>${coords ? "Closest stations with a top up or ticket machine" : "Stations with a top up or ticket machine"}</small></h1>
        <div class="seg" role="tablist"><button class="${filter ? "" : "on"}" data-f="" role="tab" aria-selected="${!filter}">All machines</button><button class="${filter ? "on" : ""}" data-f="cash" role="tab" aria-selected="${!!filter}">Takes cash</button></div>
        <div class="group"><div id="tu_map" class="st-map tu-map" role="img" aria-label="Map of stations with Opal machines"></div></div>
        <div class="group"><div class="list" style="--inset:57px">${near.map((r) => { const k = TK[r.kind] || TK.card; return `<a class="cell" href="#/stop/${encodeURIComponent(r.id)}?${qs({ name: r.name })}"><span class="sym" style="background:${k[2]}">${I.card}</span><div class="grow"><div class="t1">${esc(stShort(r.name))}</div><div class="t2">${esc(k[1])}${r.kind === "topup" ? " \u00b7 top up only" : ""}</div></div>${r.distance != null ? `<span class="val num">${r.distance < 1000 ? Math.round(r.distance / 10) * 10 + " m" : (r.distance / 1000).toFixed(1) + " km"}</span>` : ""}${I.chev}</a>`; }).join("") || '<div class="empty">No machines found.</div>'}</div>
        <p class="group-f src">Machines at stations, wharves and light rail stops, from ${SRC.fac}. Opal retailers are not in the open data. You can also top up in the Opal Travel app.</p></div>${foot()}`;
      $$("[data-f]").forEach((b) => (b.onclick = () => { filter = b.dataset.f; paint(); }));
      if (window.L) {
        map = L.map("tu_map", { zoomControl: false, attributionControl: true });
        baseTiles(map);
        const pts = (coords ? list.slice(0, 60) : list);
        pts.forEach((r) => {
          const k = TK[r.kind] || TK.card;
          const mk = L.circleMarker([r.lat, r.lon], { radius: 7, weight: 2, color: "#fff", fillColor: k[2], fillOpacity: 1 }).addTo(map);
          mk.bindPopup(`<div class="mpop"><b>${esc(stShort(r.name))}</b><span>${esc(k[0])}, ${esc(k[1].toLowerCase())}</span><a class="pillbtn solid" href="#/stop/${encodeURIComponent(r.id)}?${qs({ name: r.name })}">Open</a></div>`, { closeButton: false });
        });
        if (coords) {
          L.circleMarker([coords.latitude, coords.longitude], { radius: 8, weight: 3, color: "#fff", fillColor: "#0a84ff", fillOpacity: 1 }).addTo(map);
          map.fitBounds([[coords.latitude, coords.longitude], ...near.slice(0, 5).map((r) => [r.lat, r.lon])], { padding: [28, 28], maxZoom: 15 });
        } else map.setView([-33.8688, 151.2093], 11);
        setTimeout(() => map && map.invalidateSize(), 300);
      }
    };
    const load = (c) => fetch("/api/topup?" + qs(c ? { lat: c.latitude.toFixed(5), lon: c.longitude.toFixed(5), limit: 40 } : {})).then((r) => r.json()).then((d) => { items = d.items || []; paint(); })
      .catch(() => { view.innerHTML = `<h1 class="large">Opal machines</h1><div class="empty">No connection right now.</div>`; });
    locate().then((c) => { coords = c; load(c); }).catch(() => load(null));
  }

  // ---------- Park and Ride live spaces ----------
  function parkingView() {
    setTab("search"); setNav({ title: "Park and Ride", back: true });
    view.innerHTML = `<h1 class="large">Park and Ride<small>Live spaces</small></h1><div class="group">${skel(6)}</div>`;
    let coords = null;
    const paint = (d) => {
      let list = d.carparks || [];
      if (coords) list = list.map((p) => ({ ...p, dist: Math.hypot((p.lat - coords.latitude) * 111, (p.lon - coords.longitude) * 92) })).sort((a, b) => a.dist - b.dist);
      else list = list.slice().sort((a, b) => a.name.localeCompare(b.name));
      view.innerHTML = `<h1 class="large">Park and Ride<small>${coords ? "Closest first" : "A to Z"} \u00b7 ${list.length} car parks</small></h1>
        <div class="group"><div class="list" style="--inset:57px">${list.map((p) => `<a class="pklink" href="#/stop/${encodeURIComponent(p.station)}?${qs({ name: p.name })}">${parkCell(p, false)}</a>`).join("")}</div>
        <p class="group-f src">Live spaces from the ${SRC.park}. Check the free parking rules for Opal travellers on transportnsw.info. Open a station to set a nearly full alert.</p></div>${foot()}`;
    };
    const load = () => api("/api/parking").then(paint).catch((e) => { view.innerHTML = `<h1 class="large">Park and Ride</h1><div class="empty">${esc(e.message)}</div>`; });
    locate().then((c) => { coords = c; }).catch(() => null).finally(load);
    every(120000, load);
  }

  // ---------- alerts, nearby, ask ----------
  function alertsView() {
    setTab("search"); setNav({ title: "Service alerts", back: true });
    view.innerHTML = `<h1 class="large">Service alerts</h1><div class="group">${skel(4)}</div>`;
    const load = () => api("/api/alerts").then((d) => {
      view.innerHTML = `<h1 class="large">Service alerts<small>${d.items.length} current</small></h1><div class="group"><div class="list">${d.items.map((a) => `<div class="alert${/high/i.test(a.priority) ? " high" : ""}"><span class="ai">${I.alert}</span><div>${a.lines.length ? `<b>${esc(a.lines.join(", "))}</b> ` : ""}${esc(a.title)}</div></div>`).join("") || '<div class="empty">No current alerts.</div>'}</div></div>${foot()}`;
    }).catch((e) => { view.innerHTML = `<h1 class="large">Service alerts</h1><div class="empty">${esc(e.message)}</div>`; });
    load(); every(60000, load);
  }
  function locate() {
    return new Promise((res, rej) => {
      if (!navigator.geolocation) return rej(new Error("Location isn't available on this device."));
      navigator.geolocation.getCurrentPosition((p) => res(p.coords), () => rej(new Error("Location was not shared. Search for a stop instead.")), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    });
  }
  async function nearView() {
    setTab("search"); setNav({ title: "Near me", back: true });
    view.innerHTML = `<h1 class="large">Near me<small>Finding your location</small></h1><div class="group">${skel(4)}</div>`;
    try {
      const c = await locate();
      const d = await api("/api/nearby?" + qs({ lat: c.latitude.toFixed(5), lon: c.longitude.toFixed(5) }));
      view.innerHTML = `<h1 class="large">Near me</h1><div class="group"><div class="list"><a class="cell" href="#/topup"><span class="s-ico purple">${I.card}</span><div class="grow"><div class="t1">Opal top up machines near me</div></div>${I.chev}</a></div></div><div class="group"><div class="list">${d.stops.map((s) => `<a class="cell" href="#/stop/${encodeURIComponent(s.id)}?${qs({ name: s.name })}"><span class="s-ico">${I.loc}</span><div class="grow"><div class="t1">${esc(s.name)}</div><div class="t2">${s.distance != null ? s.distance + " m" : ""}${s.modes && s.modes.length ? " \u00b7 " + esc(s.modes.join(", ")) : ""}</div></div>${I.chev}</a>`).join("") || '<div class="empty">No stops found nearby.</div>'}</div></div>${foot()}`;
    } catch (e) { view.innerHTML = `<h1 class="large">Near me</h1><div class="empty">${esc(e.message)}</div>`; }
  }
  async function askView(q, coords) {
    setTab("search"); setNav({ title: q, back: true });
    view.innerHTML = `<h1 class="large">${esc(q)}</h1><div class="group">${skel(5)}</div>`;
    addRecent(q);
    try {
      const local = saved().find((s) => s.name === q.trim().toLowerCase());
      if (local) { location.replace("#/trip?" + qs({ from: local.from.id, to: local.to.id, fn: local.from.name, tn: local.to.name, name: local.name })); return; }
      const d = await api("/api/ask?" + qs({ q, profile: PROFILE, device: DEVICE, fare: fareT(), acc: accOn() ? 1 : null, lat: coords && coords.latitude.toFixed(5), lon: coords && coords.longitude.toFixed(5) }));
      if (d.kind === "departures") { S.pre = d; location.replace(`#/stop/${encodeURIComponent(d.stop.id)}?${qs({ name: d.stop.name, mode: d.mode || "" })}`); }
      else if (d.kind === "trip" && (d.chain || d.via) && (d.links || []).some((l) => l.kind === "trip" && l.legs)) location.replace(d.links.find((l) => l.kind === "trip" && l.legs).href);
      else if (d.kind === "trip") { S.pre = d; location.replace("#/trip?" + qs({ from: d.from.id, to: d.to.id, fn: d.from.name, tn: d.to.name, name: d.saved || "", time: d.when && d.when.time, arr: d.when && d.when.arriveBy ? "1" : "" })); }
      else if (d.kind === "needLocation") { const c = await locate(); askView(q, c); }
      else if (d.kind === "alerts") location.replace("#/alerts");
      else if (d.kind === "nearby") location.replace("#/near");
      else if (d.kind === "help") location.replace("#/search");
      else view.innerHTML = `<h1 class="large">${esc(q)}</h1><div class="group"><div class="card"><p style="margin:0">${esc(d.text || "Try a stop number, a station, or a trip like Burwood to Central.")}</p></div></div>`;
    } catch (e) { view.innerHTML = `<h1 class="large">${esc(q)}</h1><div class="empty">${esc(e.message)}</div>`; }
  }

  // ---------- live trip ----------
  // Start trip: follow a trip leg by leg on a map with your own position, the live vehicle,
  // stops left, live arrival times, get off alerts and an optional share link. Your location
  // stays on this phone; it is only sent while you share the trip, and only if you choose to.
  const goGet = () => LS.get("tb_go", null);
  const goSet = (g) => LS.set("tb_go", g);
  function goLegs(spec) { return (spec.legs || []).filter((l) => l.stopId && l.planned).slice(0, 6); }
  function startTrip(spec) {
    const legs = goLegs(spec);
    if (!legs.length) { toast("This trip can't be tracked."); return; }
    const old = goGet();
    if (old) goStop(old, true);
    goSet({ id: randId("g"), title: spec.title, origin: spec.origin || null, to: spec.to || null, legs, fare: spec.fare || null, started: Date.now(), alerted: {}, share: null, watchId: null });
    if (pushState() === "on") goWatch();
    location.hash = "#/go";
  }
  async function goWatch() {
    const g = goGet(); if (!g || g.watchId) return;
    try {
      const r = await post("/api/watch", { device: DEVICE, profile: PROFILE, kind: "trip", title: g.title, legs: g.legs, origin: g.origin, to: g.to, lead: 0, track: true, silentStart: true });
      const g2 = goGet(); if (g2 && g2.id === g.id && r.watch) { g2.watchId = r.watch.id; goSet(g2); pollWatches(); }
    } catch (e) { /* alerts still show while the app is open */ }
  }
  function goStop(g, quiet) {
    if (g.share) api("/api/share?" + qs({ id: g.share.id }), { method: "DELETE", headers: { "x-share-key": g.share.key } }).catch(() => {});
    if (g.watchId) stopWatch(g.watchId).catch(() => {});
    if (S.goGeo != null && navigator.geolocation) { navigator.geolocation.clearWatch(S.goGeo); S.goGeo = null; }
    LS.set("tb_go", null);
    if (!quiet) toast(g.share ? "Trip ended. Your share link has stopped working." : "Trip ended");
  }
  function goBanner(g) {
    const L0 = g.legs[0];
    return `<a class="gobar" href="#/go"><span class="gobar-dot"></span><span class="gobar-t"><b>Trip in progress</b><small>${esc(g.title)}</small></span>${lb(L0.line, L0.color)}${I.chev}</a>`;
  }
  function goNotify(title, body) {
    try { if (navigator.vibrate) navigator.vibrate([180, 80, 180]); } catch (e) { /* no vibration */ }
    const show = () => { toast(title); };
    try {
      if (window.Notification && Notification.permission === "granted" && swReg) swReg.showNotification(title, { body, tag: "go", renotify: true, icon: "/icon-192.png", badge: "/badge-96.png", data: { url: "/#/go" } }).catch(show);
      else show();
    } catch (e) { show(); }
  }
  function goView() {
    const g = goGet();
    if (!g) { location.replace("#/"); return; }
    setTab("full"); setNav({ title: "" });
    nav.style.display = "none";
    S.cleanup.push(() => { nav.style.display = ""; });
    const legs = g.legs, last = legs.length - 1;
    const svc = legs.map(() => null);
    let alive = true;
    S.cleanup.push(() => { alive = false; });
    let map = null, layers = { legs: [], stops: null }, vMarker = null, meMarker = null, meCircle = null, follow = true, fitted = false, me = null, st = null;
    view.innerHTML = `<div class="mapwrap"><div id="map"></div></div>
      <button class="map-btn left" id="gBack" aria-label="Back">${I.back.replace("<svg", '<svg style="width:12px;height:18px"')}</button>
      <button class="map-btn right" id="gFollow" aria-label="Show my trip">${I.loc}</button>
      <section class="sheet go-sheet" id="sheet"><div class="grab" id="grab"></div><div class="sheet-body" id="sbody"><div class="go-pad"><div class="skel" style="border-radius:14px;height:120px"></div></div></div></section>`;
    $("#gBack").onclick = () => { location.hash = "#/"; };
    $("#gFollow").onclick = () => { follow = true; fitted = false; paintMap(); };
    const sheet = $("#sheet"), sbody = $("#sbody");
    const H = () => sheet.getBoundingClientRect().height;
    const snaps = () => [H() - 236, H() * 0.4, 0];
    let y = snaps()[1];
    const setY = (v) => { y = v; sheet.style.setProperty("--y", v + "px"); };
    setY(y);
    let drag = null;
    const startDrag = (e) => { if (e.target.closest("button, a, input, label")) return; drag = { y0: e.clientY, base: y, t: Date.now() }; sheet.classList.add("drag"); };
    const onMove = (e) => { if (drag) setY(Math.max(0, Math.min(snaps()[0] + 40, drag.base + e.clientY - drag.y0))); };
    const onUp = (e) => {
      if (!drag) return;
      const v = (e.clientY - drag.y0) / Math.max(1, Date.now() - drag.t);
      sheet.classList.remove("drag");
      const sp = snaps();
      let target = sp.reduce((a, b) => (Math.abs(b - y) < Math.abs(a - y) ? b : a));
      if (v > 0.6) target = sp.filter((s) => s > drag.base).sort((a, b) => a - b)[0] ?? sp[0];
      if (v < -0.6) target = sp.filter((s) => s < drag.base).sort((a, b) => b - a)[0] ?? 0;
      drag = null; setY(target);
    };
    $("#grab").addEventListener("pointerdown", startDrag);
    sheet.addEventListener("pointerdown", (e) => { if (e.target.closest(".go-head")) startDrag(e); });
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    S.cleanup.push(() => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); });

    // Where you are: only on this phone, never sent unless you share and include it.
    const startGeo = () => {
      if (!navigator.geolocation || S.goGeo != null) return;
      S.goGeo = navigator.geolocation.watchPosition((p) => {
        me = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, at: Date.now() };
        LS.set("tb_go_loc", "on");
        paintMap(); if (st) paint();
      }, (err) => { if (err.code === 1) { LS.set("tb_go_loc", "denied"); if (st) paint(); } }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    };
    if (LS.get("tb_go_loc", null) === "on") startGeo();
    S.cleanup.push(() => { if (S.goGeo != null && navigator.geolocation) { navigator.geolocation.clearWatch(S.goGeo); S.goGeo = null; } });

    const makeMap = () => {
      if (map || !window.L) return;
      map = L.map("map", { zoomControl: false, attributionControl: true }).setView([-33.8688, 151.2093], 13);
      baseTiles(map);
      map.on("dragstart", () => { follow = false; });
      S.cleanup.push(() => { if (map) map.remove(); map = null; });
    };
    const legColor = (l) => l.color || "#00B5EF";
    function paintMap() {
      if (!alive) return;
      makeMap(); if (!map) return;
      legs.forEach((l, i) => {
        const d = svc[i];
        if (layers.legs[i] || !d || !d.path || d.path.length < 2) return;
        let path = d.path;
        const a = d.mineIndex >= 0 ? d.stops[d.mineIndex] : null, b = d.alightIndex >= 0 ? d.stops[d.alightIndex] : null;
        if (a && b) {
          const near = (p) => path.reduce((bi, q, k) => ((q[0] - p.lat) ** 2 + (q[1] - p.lon) ** 2 < (path[bi][0] - p.lat) ** 2 + (path[bi][1] - p.lon) ** 2 ? k : bi), 0);
          const ia = near(a), ib = near(b);
          if (ib > ia) path = path.slice(ia, ib + 1);
        }
        layers.legs[i] = L.polyline(path, { color: legColor(l), weight: 6, opacity: i < (st ? st.cur : 0) ? 0.35 : 0.92, lineJoin: "round" }).addTo(map);
      });
      if (!layers.stops) layers.stops = L.layerGroup().addTo(map);
      layers.stops.clearLayers();
      legs.forEach((l, i) => {
        const d = svc[i]; if (!d) return;
        const from = d.mineIndex >= 0 ? d.mineIndex : 0, to = d.alightIndex >= 0 ? d.alightIndex : d.stops.length - 1;
        d.stops.slice(from, to + 1).forEach((s, k) => {
          const end = k === 0 || from + k === to;
          L.marker([s.lat, s.lon], { icon: L.divIcon({ className: "", iconSize: end ? [18, 18] : [11, 11], html: `<div class="sm-dot${end ? " mine" : ""}" style="--c:${esc(legColor(l))};${s.passed && st && i <= st.cur ? "opacity:.4" : ""}"></div>` }), keyboard: false, title: s.name }).addTo(layers.stops);
        });
      });
      const cur = st ? st.cur : 0, d = svc[cur];
      if (d && d.vehicle) {
        const pos = [d.vehicle.lat, d.vehicle.lon];
        const html = `<div class="vm" style="--c:${esc(legColor(legs[cur]))}"><span class="ring"></span>${d.vehicle.bearing != null ? `<div style="position:absolute;inset:0;transform:rotate(${d.vehicle.bearing}deg)"><span class="h"></span></div>` : ""}<span class="b go-vl">${esc(legs[cur].line)}</span></div>`;
        const ic = L.divIcon({ className: "", iconSize: [36, 36], iconAnchor: [18, 18], html });
        if (!vMarker) vMarker = L.marker(pos, { icon: ic, zIndexOffset: 1000, keyboard: false }).addTo(map);
        else { vMarker.setIcon(ic); vMarker.setLatLng(pos); }
      } else if (vMarker) { vMarker.remove(); vMarker = null; }
      if (me) {
        const ll = [me.lat, me.lon];
        if (!meMarker) {
          meCircle = L.circle(ll, { radius: Math.min(me.acc || 30, 300), color: "#0a84ff", weight: 0, fillOpacity: 0.12 }).addTo(map);
          meMarker = L.marker(ll, { icon: L.divIcon({ className: "", iconSize: [22, 22], iconAnchor: [11, 11], html: '<div class="me-dot"></div>' }), zIndexOffset: 1200, keyboard: false, title: "You" }).addTo(map);
        } else { meMarker.setLatLng(ll); meCircle.setLatLng(ll); meCircle.setRadius(Math.min(me.acc || 30, 300)); }
      }
      const pad = { paddingTopLeft: [30, 70], paddingBottomRight: [30, Math.min(window.innerHeight * 0.55, H() - y) + 20] };
      if (follow) {
        const pts = [];
        if (d && d.vehicle) pts.push([d.vehicle.lat, d.vehicle.lon]);
        if (me) pts.push([me.lat, me.lon]);
        if (d && st) { const t = st.phase === "wait" ? d.stops[d.mineIndex] : d.stops[st.nextIdx]; if (t) pts.push([t.lat, t.lon]); const z = d.stops[d.alightIndex]; if (z && st.stopsLeft != null && st.stopsLeft <= 3) pts.push([z.lat, z.lon]); }
        if (!fitted && pts.length < 2) layers.legs.forEach((p) => p && p.getLatLngs().forEach((q) => pts.push([q.lat, q.lng])));
        if (pts.length > 1) { map.fitBounds(pts, { ...pad, maxZoom: 16, animate: fitted }); fitted = true; }
        else if (pts.length) { map.setView(pts[0], 15, { animate: fitted }); fitted = true; }
      }
    }
    const tOf = (s) => (s ? tms(s.estimated || s.planned) : null);
    function compute() {
      const t = now();
      const L2 = legs.map((l, i) => {
        const d = svc[i];
        const mineS = d && d.mineIndex >= 0 ? d.stops[d.mineIndex] : null, offS = d && d.alightIndex >= 0 ? d.stops[d.alightIndex] : null;
        const delay = mineS && mineS.estimated ? tms(mineS.estimated) - tms(mineS.planned) : (l.estimated ? tms(l.estimated) - tms(l.planned) : 0);
        const dep = mineS ? tOf(mineS) : tms(l.estimated || l.planned);
        const arr = offS ? tOf(offS) : (l.arrPlanned ? tms(l.arrPlanned) + delay : dep + 10 * 60000);
        // The vehicle is already past your stop: this leg is over whatever the clock says.
        const past = d && d.alightIndex >= 0 && d.nextIndex > d.alightIndex;
        return { dep, arr: past ? Math.min(arr, t - 60000) : arr, delay, live: !!(d && d.live), d, mineS, offS };
      });
      // A late leg pushes later legs only when you would miss their planned connection.
      let cur = L2.findIndex((x) => t < x.arr + 45000);
      if (cur < 0) return { done: true, L2, eta: L2[last].arr };
      const x = L2[cur], d = x.d;
      let phase = "wait";
      if (d && d.mineIndex >= 0 && d.nextIndex > d.mineIndex) phase = "ride";
      else if (!d || d.mineIndex < 0) phase = t >= x.dep ? "ride" : "wait";
      // Stops it runs through without stopping have no time; they are not counted or named.
      const timed = (s) => s && (s.planned || s.estimated) && !s.skipped;
      let nextIdx = d ? d.nextIndex : -1;
      if (d && nextIdx >= 0) { while (nextIdx < d.stops.length - 1 && nextIdx !== d.alightIndex && !timed(d.stops[nextIdx])) nextIdx++; }
      const stopsLeft = d && d.alightIndex >= 0 && phase === "ride" ? d.stops.slice(Math.max(nextIdx, d.mineIndex + 1), d.alightIndex + 1).filter(timed).length : null;
      const conns = [];
      for (let i = cur; i < last; i++) {
        const a = L2[i], b = L2[i + 1];
        const spare = Math.round((b.dep - a.arr) / 60000 - (legs[i + 1].walkBefore || 0));
        conns.push({ i, at: legs[i].to, spare, risk: spare < 0 ? "miss" : spare < 2 ? "tight" : "ok", next: legs[i + 1], nextDep: b.dep });
      }
      return { done: false, cur, phase, nextIdx, stopsLeft, L2, conns, eta: L2[last].arr, live: x.live };
    }
    function stopsHtml(d, i) {
      if (!d || d.alightIndex < 0) return "";
      const from = Math.max(d.mineIndex, Math.min(st.nextIdx, d.alightIndex)), list = d.stops.slice(from, d.alightIndex + 1).filter((s) => (s.planned || s.estimated) && !s.skipped);
      if (!list.length) return "";
      const show = list.length > 7 ? [...list.slice(0, 5), null, list[list.length - 1]] : list;
      return `<div class="go-stops" style="--c:${esc(legColor(legs[i]))}">${show.map((s) => s ? `<div class="go-stop${s.alight ? " off" : ""}${s.mine ? " on" : ""}"><i></i><span class="n">${esc(short(s.name))}</span><span class="t">${fmtClock(tOf(s))}</span></div>` : `<div class="go-stop more"><i></i><span class="n">${list.length - 6} more stops</span></div>`).join("")}</div>`;
    }
    function paint() {
      if (!st || !alive) return;
      if (st.done) {
        sbody.innerHTML = `<div class="go-pad"><div class="go-head"><div class="go-k">You've arrived</div><div class="go-big">${esc(short(legs[last].to))}</div><div class="go-sub">${fmtClock(st.eta)} \u00b7 trip ended</div></div>
          <button class="btn" id="gDone">Done</button></div>`;
        $("#gDone").onclick = () => { goStop(goGet() || g); location.hash = "#/"; };
        return;
      }
      const l = legs[st.cur], x = st.L2[st.cur], d = x.d;
      const m = Math.max(0, mins(st.eta));
      const late = Math.round(x.delay / 60000);
      const badge = x.live ? (late >= 2 ? `<span class="badge late">${late} min late</span>` : `<span class="badge live">${I.rt.replace('class="rt"', 'class="rt" style="width:11px;height:11px"')}Live</span>`) : `<span class="badge sched">Scheduled</span>`;
      let now1 = "", now2 = "";
      if (st.phase === "wait") {
        const dm = mins(x.dep);
        now1 = `${st.cur > 0 ? "Change to" : "Board"} the ${esc(l.line)} to ${esc(short(l.towards || l.to))}`;
        now2 = `${dm <= 0 ? "Due now" : `Leaves in ${dm} min, ${fmtClock(x.dep)}`}${l.fromPlatform ? " \u00b7 " + esc(platShort(l.fromPlatform)) : ""}${d && d.stopsAway != null && d.vehicle ? ` \u00b7 ${d.stopsAway === 0 ? "arriving" : d.stopsAway + " stop" + (d.stopsAway > 1 ? "s" : "") + " away"}` : ""}`;
      } else {
        const ns = d && st.nextIdx >= 0 ? d.stops[st.nextIdx] : null;
        const yours = d && st.nextIdx === d.alightIndex;
        now1 = yours ? `Get off at the next stop` : ns ? `Next stop: ${esc(short(ns.name))}` : `On the ${esc(l.line)} to ${esc(short(l.towards || l.to))}`;
        now2 = `${st.stopsLeft != null ? `${st.stopsLeft} stop${st.stopsLeft === 1 ? "" : "s"} to ${esc(short(l.to))}` : `To ${esc(short(l.to))}`} \u00b7 ${st.cur < last ? "change" : "arrive"} ${fmtClock(x.arr)}`;
      }
      const warn = (st.conns || []).filter((c) => c.risk !== "ok").map((c) => c.risk === "miss"
        ? `<div class="go-warn bad">${I.alert}<div><b>You'll likely miss the ${fmtClock(tms(c.next.planned))} ${esc(c.next.line)} at ${esc(short(c.at))}</b><span>Live times leave ${Math.abs(c.spare)} min too little. <a href="#/trip?${qs({ from: legs[c.i].toStopId, to: (g.to && g.to.id) || legs[last].toStopId, fn: legs[c.i].to, tn: (g.to && g.to.name) || legs[last].to })}">Find the next connection</a></span></div></div>`
        : `<div class="go-warn">${I.alert}<div><b>Tight change at ${esc(short(c.at))}</b><span>${Math.max(0, c.spare)} min to catch the ${esc(c.next.line)}${c.next.fromPlatform ? " from " + esc(platShort(c.next.fromPlatform)) : ""}.</span></div></div>`).join("");
      const legRows = legs.map((ll, i) => {
        const y2 = st.L2[i], state = i < st.cur ? "done" : i === st.cur ? "now" : "next";
        const c = (st.conns || []).find((k) => k.i === i - 1);
        return `${i > 0 ? `<div class="go-chg">${ll.walkBefore ? `${I.walk}${ll.walkBefore} min walk, ` : ""}change at ${esc(short(legs[i - 1].to))}${c ? ` \u00b7 <span class="${c.risk === "ok" ? "" : c.risk === "tight" ? "late-t" : "bad-t"}">${Math.max(0, c.spare)} min spare</span>` : ""}</div>` : ""}
          <div class="go-leg ${state}" style="--c:${esc(legColor(ll))}">${lb(ll.line, ll.color)}<div class="grow"><div class="t1">${esc(short(ll.from))} to ${esc(short(ll.to))}</div><div class="t2">${fmtClock(y2.dep)} to ${fmtClock(y2.arr)}${state === "done" ? " \u00b7 done" : ""}</div></div>${state === "now" ? '<span class="go-now-dot"></span>' : ""}</div>`;
      }).join("");
      const locState = LS.get("tb_go_loc", null), ps = pushState();
      const setup = [];
      if (locState !== "on") setup.push(`<div class="cell static"><span class="s-ico tintbg">${I.loc}</span><div class="grow"><div class="t1">Show where I am</div><div class="t2">${locState === "denied" ? "Location is off for this site. Turn it on in your phone's settings." : "Your location stays on this phone."}</div></div>${locState === "denied" ? "" : `<button class="pillbtn solid" id="gLoc">Allow</button>`}</div>`);
      if (ps !== "on") setup.push(`<div class="cell static"><span class="s-ico orange">${I.bell}</span><div class="grow"><div class="t1">Get off alerts</div><div class="t2">${ps === "install" ? "On iPhone, add this app to your Home Screen first. Alerts still show here while it's open." : ps === "denied" ? "Notifications are blocked. Alerts show here while the app is open." : ps === "unsupported" ? "Alerts show here while the app is open." : "One stop before your stop, at each change, and if a connection is at risk."}</div></div>${ps === "off" ? `<button class="pillbtn solid" id="gPush">Turn on</button>` : ""}</div>`);
      sbody.innerHTML = `<div class="go-pad">
        <div class="go-head"><div class="go-k">Arrive at ${esc(short((g.to && g.to.name) || legs[last].to))}</div><div class="go-row"><div class="go-big">${fmtClock(st.eta)}</div><div class="go-in">${m === 0 ? "<b>Now</b>" : m < 60 ? `<b>${m}</b><span>min</span>` : `<b>${Math.floor(m / 60)}</b><span>h</span><b>${m % 60}</b><span>min</span>`}</div></div><div class="go-badges">${badge}${g.share ? '<span class="badge live">Sharing</span>' : ""}</div></div>
        <div class="go-card" style="--c:${esc(legColor(l))}"><div class="go-card-l">${lb(l.line, l.color)}</div><div class="grow"><div class="go-now1">${now1}</div><div class="go-now2">${now2}</div></div></div>
        ${warn}
        ${st.phase === "ride" ? stopsHtml(d, st.cur) : ""}
        ${setup.length ? `<div class="group"><div class="list">${setup.join("")}</div></div>` : ""}
        <div class="go-actions"><button class="btn go-share" id="gShare">${I.share}${g.share ? "Sharing" : "Share trip"}</button><button class="btn go-end" id="gEnd">End trip</button></div>
        <div class="group-h">Your trip</div><div class="group"><div class="go-legs">${legRows}</div>${g.fare && g.fare.total != null ? `<div class="go-fare"><span>Opal fare estimate <small>${esc(g.fare.typeName)}${g.fare.peak ? ", peak" : ", off peak"}${g.fare.transfer ? `, ${money(g.fare.transfer)} transfer discount` : ""}${g.fare.airportFee ? `, includes ${money(g.fare.airportFee)} airport fee` : ""}</small></span><b>${money(g.fare.total)}</b></div>` : ""}</div>
        <p class="group-f">Live positions and times from Transport for NSW. Your location is used on this phone only${g.share && g.share.pos ? ", and sent to your share link while sharing" : ""}. Share links stop working when the trip ends.</p></div>`;
      const gl = $("#gLoc"); if (gl) gl.onclick = () => { LS.set("tb_go_loc", "asked"); startGeo(); };
      const gp = $("#gPush"); if (gp) gp.onclick = async () => { const r = await enablePush(false).catch(() => ({ ok: false })); if (r.ok) { toast("Get off alerts on"); goWatch(); } else toast(pushWhyText(r.why)); paint(); };
      $("#gEnd").onclick = () => { goStop(goGet() || g); location.hash = "#/"; };
      $("#gShare").onclick = () => openShare();
    }
    function openShare() {
      const cur = goGet(); if (!cur) return;
      if (cur.share) return shareLink(cur.share.url, true);
      const canLoc = LS.get("tb_go_loc", null) === "on";
      openModal({ title: "Share live trip", body: `<div class="group"><div class="list"><div class="cell static"><div class="grow"><div class="t1">Anyone with the link can see</div><div class="t2" style="white-space:normal">Your trip, the live position of your ${esc(noun(legs[0].mode))}, the next stop and your arrival time. No account needed.</div></div></div>
        <label class="cell static"><div class="grow"><div class="t1">Include my location</div><div class="t2" style="white-space:normal">${canLoc ? "Sent only while sharing." : "Turn on Show where I am first."}</div></div><span class="switch"><input type="checkbox" id="shLoc" ${canLoc ? "checked" : "disabled"} aria-label="Include my location"><span></span></span></label></div>
        <p class="group-f">The link stops working when the trip ends or when you end it, and everything it showed is deleted.</p></div>
        <div class="group"><button class="btn" id="shGo">${I.share}Create link</button></div>`, onOpen: (mm) => {
        $("#shGo", mm).onclick = async (e) => {
          const btn = e.currentTarget; btn.disabled = true; btn.textContent = "Creating...";
          const pos = $("#shLoc", mm).checked && me ? me : null;
          try {
            const r = await post("/api/share", { device: DEVICE, title: g.title, from: g.origin, to: g.to, legs, pos, prog: progOf() });
            const c2 = goGet(); if (!c2) return;
            c2.share = { id: r.id, key: r.key, url: r.url, pos: !!$("#shLoc", mm).checked }; goSet(c2); g.share = c2.share;
            closeModal(); paint(); shareLink(r.url, false);
          } catch (err) { btn.disabled = false; btn.textContent = "Create link"; toast(err.message); }
        };
      } });
    }
    async function shareLink(url, again) {
      const text = `Follow my trip live: ${g.title}`;
      if (navigator.share) { try { await navigator.share({ title: "Live trip", text, url }); return; } catch (e) { if (e && e.name === "AbortError") return; } }
      try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch (e) { /* show it instead */ }
      openModal({ title: "Live trip link", body: `<div class="group"><div class="list"><div class="cell static"><input class="go-link" readonly value="${esc(url)}" aria-label="Live trip link"></div></div><p class="group-f">Send this to anyone. It works until the trip ends.</p></div>
        <div class="group"><button class="btn go-end" id="shStop">Stop sharing</button></div>`, onOpen: (mm) => {
        const inp = $(".go-link", mm); setTimeout(() => inp.select(), 300);
        $("#shStop", mm).onclick = () => { const c2 = goGet(); if (c2 && c2.share) { api("/api/share?" + qs({ id: c2.share.id }), { method: "DELETE", headers: { "x-share-key": c2.share.key } }).catch(() => {}); c2.share = null; goSet(c2); g.share = null; } closeModal(); toast("Sharing stopped"); paint(); };
      } });
    }
    function progOf() {
      if (!st || st.done) return { phase: "done" };
      const d = st.L2[st.cur].d, ns = d && st.nextIdx >= 0 ? d.stops[st.nextIdx] : null;
      return { leg: st.cur, phase: st.phase, next: ns ? short(ns.name) : null, stopsLeft: st.stopsLeft, eta: st.eta };
    }
    function alerts() {
      const cur = goGet(); if (!cur || !st) return;
      const a = cur.alerted || (cur.alerted = {});
      let changed = false;
      if (!st.done && st.phase === "ride") {
        const d = st.L2[st.cur].d, l = legs[st.cur];
        if (d && d.alightIndex > 0 && st.nextIdx === d.alightIndex && !a["off" + st.cur]) {
          a["off" + st.cur] = 1; changed = true;
          if (st.cur === last) goNotify(`Next stop: ${short(l.to)}`, `Get ready to get off. You arrive at ${fmtClock(st.eta)}.`);
          else { const n = legs[st.cur + 1]; goNotify(`Next stop: ${short(l.to)}, change here`, `Then the ${fmtClock(st.L2[st.cur + 1].dep)} ${n.line}${n.fromPlatform ? " from " + platShort(n.fromPlatform) : ""}.`); }
        }
      }
      (st.conns || []).forEach((c) => {
        if (c.risk === "miss" && !a["miss" + c.i]) { a["miss" + c.i] = 1; changed = true; goNotify("Connection at risk", `With live times you'll likely miss the ${fmtClock(tms(c.next.planned))} ${c.next.line} at ${short(c.at)}.`); }
        else if (c.risk === "tight" && !a["tight" + c.i]) { a["tight" + c.i] = 1; changed = true; goNotify(`Tight change at ${short(c.at)}`, `${Math.max(0, c.spare)} min to catch the ${c.next.line}.`); }
      });
      if (changed) goSet(cur);
    }
    let lastFull = 0, busy = false;
    async function load() {
      if (busy) return; busy = true;
      try {
        const full = Date.now() - lastFull > 60000;
        const cur = st && !st.done ? st.cur : 0;
        const want = legs.map((l, i) => full || i === cur || i === cur + 1);
        await Promise.all(legs.map(async (l, i) => {
          if (!want[i]) return;
          try { svc[i] = await api("/api/service?" + qs({ trip: l.tripId, mode: l.mode, line: l.line, stop: l.stopId, destId: l.destId, planned: l.planned, to: l.toStopId, dest: l.towards, stopName: l.from, color: l.color })); } catch (e) { /* keep the last answer */ }
        }));
        if (full) lastFull = Date.now();
        if (!alive) return;
        st = compute();
        paint(); paintMap(); alerts();
        const c2 = goGet();
        if (c2 && c2.share) {
          post("/api/share/update", { id: c2.share.id, key: c2.share.key, pos: c2.share.pos && me ? me : null, prog: progOf() }).catch((e) => { if (/not found/i.test(e.message)) { c2.share = null; goSet(c2); } });
        }
        if (st.done && now() > st.eta + 10 * 60000) { goStop(goGet() || g, true); }
      } finally { busy = false; }
    }
    load();
    every(15000, load);
  }

  // ---------- router ----------
  S.navDepth = 0;
  let lastHash = location.hash;
  function route() {
    clearView();
    S.homeTok = null;
    rowData.clear();
    const h = location.hash.slice(1) || "/";
    const [path, query] = h.split("?");
    const params = new URLSearchParams(query || "");
    const pre = S.pre; S.pre = null;
    window.scrollTo(0, 0);
    if (window.TBHit) { const sec = (path.split("/")[1] || "home").replace(/[^a-z]/g, ""); window.TBHit("app/" + sec); }
    if (path === "/" || path === "") homeView();
    else if (path === "/search") searchView(params);
    else if (path === "/watching") watchingView();
    else if (path.startsWith("/watch/")) watchDetailView(decodeURIComponent(path.slice(7)));
    else if (path === "/settings") settingsView();
    else if (path.startsWith("/stop/")) stopView(decodeURIComponent(path.slice(6)), params, pre && pre.kind === "departures" ? pre : null);
    else if (path === "/trip") tripView(params, pre && pre.kind === "trip" ? pre : null);
    else if (path === "/svc") serviceView(params);
    else if (path === "/go") goView();
    else if (path === "/chat" && window.AskTab) window.AskTab.render({ view: $("#view"), setNav, setTab, params, S });
    else if (path === "/ask") askView(params.get("q") || "");
    else if (path === "/alerts") alertsView();
    else if (path === "/near") nearView();
    else if (path === "/topup") topupView(params);
    else if (path === "/parking") parkingView();
    else homeView();
  }
  window.addEventListener("hashchange", () => {
    const top = ["", "#/", "#/search", "#/watching", "#/chat", "#/settings"];
    S.navDepth = top.includes(location.hash.split("?")[0]) ? 0 : S.navDepth + 1;
    lastHash = location.hash;
    route();
  });
  paintWatchCount();
  route();
  pollWatches();
};
if (document.documentElement.classList.contains("app")) window.TBApp();
