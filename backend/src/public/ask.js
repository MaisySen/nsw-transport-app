// Ask tab: a chat with Transport Bot. Questions go to /api/ask, answers come back as a short
// reply plus live cards (departures, trips, alerts) that open the board, trip or live map.
(function () {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const qs = (o) => Object.entries(o).filter(([, v]) => v != null && v !== "").map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const KEY = "tb_chat";
  const STARTERS = ["Next train Burwood to Central", "When's the 461 from Burwood", "Is the T1 late", "Departures Strathfield", "How do I get to Bondi Beach", "Last train home"];
  const ICON = {
    send: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.5c.4 0 .7.1 1 .4l6.1 6.1a1.3 1.3 0 0 1-1.9 1.9l-3.9-3.9V19a1.3 1.3 0 0 1-2.6 0V8l-3.9 3.9A1.3 1.3 0 0 1 4.9 10L11 3.9c.3-.3.6-.4 1-.4Z"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.8a3.4 3.4 0 0 1 3.4 3.4v5.6a3.4 3.4 0 0 1-6.8 0V6.2A3.4 3.4 0 0 1 12 2.8Zm-6 8.4c.5 0 .9.4.9.9a5.1 5.1 0 0 0 10.2 0 .9.9 0 0 1 1.8 0 6.9 6.9 0 0 1-6 6.8v2.3a.9.9 0 0 1-1.8 0v-2.3a6.9 6.9 0 0 1-6-6.8c0-.5.4-.9.9-.9Z"/></svg>',
    chev: '<svg viewBox="0 0 8 14" width="8" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m1.5 1.5 5 5.5-5 5.5"/></svg>',
    warn: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M10.3 3.7a2 2 0 0 1 3.4 0l8 13.8a2 2 0 0 1-1.7 3H4a2 2 0 0 1-1.7-3l8-13.8ZM12 8.5a1 1 0 0 0-1 1v4.2a1 1 0 0 0 2 0V9.5a1 1 0 0 0-1-1Zm0 7.4a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z"/></svg>',
    loc: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M20.6 3.4c.4.4.5 1 .3 1.5l-7 15.8c-.5 1.1-2.1 1-2.4-.2l-1.5-5.6-5.6-1.5c-1.2-.3-1.3-1.9-.2-2.4l15.8-7c.5-.2 1.1-.1 1.5.3Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M9.5 3h5a1 1 0 0 1 1 1v1H19a1 1 0 1 1 0 2h-.6l-.8 11.6A2.5 2.5 0 0 1 15.1 21H8.9a2.5 2.5 0 0 1-2.5-2.4L5.6 7H5a1 1 0 0 1 0-2h3.5V4a1 1 0 0 1 1-1Zm-1.9 4 .8 11.4c0 .3.3.6.5.6h6.2c.3 0 .5-.3.5-.6L16.4 7H7.6Z"/></svg>',
  };

  let msgs = LS.get(KEY, []);
  let busy = false, coords = null, coordsAt = 0, ctxRef = null, lastQ = "";
  const save = () => LS.set(KEY, msgs.slice(-40));

  function clock(t) {
    const d = new Date(t);
    return d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Australia/Sydney" }).replace(/\s?(am|pm)/i, (m, p) => " " + p.toLowerCase());
  }
  function countdown(t) {
    const m = Math.round((new Date(t).getTime() - Date.now()) / 60000);
    if (m < -1) return { big: clock(t), unit: "", past: true };
    if (m <= 0) return { big: "Now", unit: "" };
    if (m >= 60) return { big: clock(t), unit: "" };
    return { big: String(m), unit: "min" };
  }
  function statusChip(it) {
    if (it.cancelled) return '<span class="ak-st bad">Cancelled</span>';
    if (!it.realtime) return '<span class="ak-st sched">Scheduled</span>';
    const d = Math.round(it.delayMin || 0);
    if (d >= 2) return `<span class="ak-st late">${d} min late</span>`;
    if (d <= -2) return `<span class="ak-st ok">${-d} min early</span>`;
    return '<span class="ak-st ok">On time</span>';
  }
  const badge = (line, color, sm) => line ? `<span class="lb${sm ? " sm" : ""}" style="background:${esc(color || "#8e8e93")}">${esc(line)}</span>` : "";
  const plat = (p) => p ? esc(p.replace(/^Platform /, "Plat ")) : "";

  function depRow(it) {
    const t = it.estimated || it.planned;
    const c = countdown(t);
    return `<a class="ak-row${it.cancelled || c.past ? " dim" : ""}" href="${esc(it.link ? it.link.href : "#")}" data-akt="${esc(t)}" data-aklive="${it.realtime ? 1 : 0}">
      ${badge(it.line, it.color)}
      <div class="ak-mid"><div class="ak-t1">${esc(it.dest || "")}</div><div class="ak-t2">${[plat(it.platform), clock(t)].filter(Boolean).join(" \u00b7 ")} ${statusChip(it)}</div></div>
      <div class="ak-cd${it.realtime && !it.cancelled ? " live" : ""}${c.unit || c.big === "Now" ? "" : " clock"}"><b>${esc(c.big)}</b>${c.unit ? `<small>${c.unit}</small>` : ""}</div></a>`;
  }
  function journeyRow(j, link, hi) {
    const tl = (j.legs || []).filter((l) => l.kind === "transit");
    const first = tl[0] || {};
    const c = countdown(j.leave);
    const lines = tl.map((l) => badge(l.line, l.color, true)).join('<span class="ak-arrow">\u203a</span>');
    const ch = j.changes ? `${j.changes} change${j.changes > 1 ? "s" : ""}` : "Direct";
    return `<a class="ak-row${hi ? " hi" : ""}${c.past ? " dim" : ""}" href="${esc(link ? link.href : first.link ? first.link.href : "#")}" data-akt="${esc(j.leave)}" data-aklive="${first.realtime ? 1 : 0}">
      <div class="ak-mid"><div class="ak-t1 num">${clock(j.leave)} to ${clock(j.arrive)}</div>
      <div class="ak-t2 ak-lines">${lines || "Walk"} <span>${j.durationMin} min \u00b7 ${ch}${first.fromPlatform ? " \u00b7 " + plat(first.fromPlatform) : ""}</span></div>
      ${first.line ? `<div class="ak-t2">${statusChip(first)}</div>` : ""}
      ${j.warn ? `<div class="ak-t2"><span class="ak-st late">${esc(j.warn)}</span></div>` : ""}
      ${j.fare && j.fare.total != null ? `<div class="ak-t2 ak-fare">Opal fare estimate $${Number(j.fare.total).toFixed(2)} ${esc(j.fare.typeName)}${j.fare.peak ? ", peak" : ", off peak"}${j.fare.offPeak ? ` <span class="ak-st">Off peak from ${esc(j.fare.offPeak.from)}, save $${Number(j.fare.offPeak.save).toFixed(2)}</span>` : ""}</div>` : ""}</div>
      <div class="ak-cd${first.realtime ? " live" : ""}${c.unit || c.big === "Now" ? "" : " clock"}"><b>${esc(c.big)}</b>${c.unit ? `<small>${c.unit}</small>` : ""}</div></a>`;
  }
  function cardHtml(c) {
    if (c.type === "departures") {
      return `<div class="ak-card">${c.link ? `<a class="ak-head" href="${esc(c.link.href)}"><span>${esc(c.title)}</span>${ICON.chev}</a>` : `<div class="ak-head"><span>${esc(c.title)}</span></div>`}
        ${c.items.map(depRow).join("") || '<div class="ak-empty">No departures right now.</div>'}</div>`;
    }
    if (c.type === "trip") {
      const title = c.titleOnly && c.title ? c.title : (c.title ? c.title + ": " : "") + `${c.from.name} to ${c.to.name}`;
      return `<div class="ak-card">${c.link ? `<a class="ak-head" href="${esc(c.link.href)}"><span>${esc(title)}</span>${ICON.chev}</a>` : `<div class="ak-head"><span>${esc(title)}</span></div>`}
        ${c.journeys.map((j, i) => journeyRow(j, null, c.highlight != null && i === c.highlight && c.journeys.length > 1)).join("") || '<div class="ak-empty">No trips found.</div>'}</div>`;
    }
    if (c.type === "alerts") {
      return `<div class="ak-card">${c.items.map((a) => `<a class="ak-row ak-alert" ${a.url && /^https:\/\//i.test(a.url) ? `href="${esc(a.url)}" target="_blank" rel="noopener"` : ""}><span class="ak-warn">${ICON.warn}</span><div class="ak-mid"><div class="ak-t3">${esc(a.title)}</div>${a.lines && a.lines.length ? `<div class="ak-t2">${esc(a.lines.join(", "))}</div>` : ""}</div></a>`).join("")}</div>`;
    }
    if (c.type === "parking") {
      return `<div class="ak-card"><div class="ak-head"><span>${esc(c.title || "Park and Ride")}</span></div>${(c.items || []).map((p) => {
        const pct = p.spots && p.free != null ? Math.max(0, Math.min(100, Math.round((p.occupied / p.spots) * 100))) : 0;
        const st = p.status === "full" ? '<span class="ak-st late">Full</span>' : p.status === "nearly" ? '<span class="ak-st late">Nearly full</span>' : p.status === "ok" ? '<span class="ak-st ok">Spaces free</span>' : '<span class="ak-st">No live count</span>';
        return `<a class="ak-row" href="#/stop/${encodeURIComponent(p.station)}?name=${encodeURIComponent(p.name)}"><div class="ak-mid"><div class="ak-t1">${esc(p.name)} ${st}</div><div class="ak-t2 num">${p.free == null ? esc(p.spots) + " spaces" : `<b>${esc(p.free)}</b> of ${esc(p.spots)} free`}</div><div class="ak-pk${p.status === "nearly" ? " nearly" : p.status === "full" ? " full" : ""}"><i style="width:${pct}%"></i></div></div>${ICON.chev}</a>`;
      }).join("")}<div class="ak-src">Live from the Transport for NSW Car Park API</div></div>`;
    }
    if (c.type === "station" && c.station) {
      const s = c.station, a = s.access || {};
      const lvl = a.level === "independent" ? "ok" : a.level === "assisted" ? "late" : "";
      return `<div class="ak-card"><a class="ak-head" href="#/stop/${encodeURIComponent(s.id)}?name=${encodeURIComponent(s.name)}"><span>${esc(s.name)}</span>${ICON.chev}</a>
        <div class="ak-row"><div class="ak-mid"><div class="ak-t1"><span class="ak-st ${lvl}">${esc(a.label || "Access not listed")}</span></div><div class="ak-t2">${esc([a.lift && "Lifts", a.escalator && "Escalators"].filter(Boolean).join(", ") || "No lifts listed")}</div></div></div>
        ${(s.outages || []).map((o) => `<a class="ak-row ak-alert" ${o.url && /^https:\/\//i.test(o.url) ? `href="${esc(o.url)}" target="_blank" rel="noopener"` : ""}><span class="ak-warn">${ICON.warn}</span><div class="ak-mid"><div class="ak-t3">${esc(o.title)}</div></div></a>`).join("")}
        <div class="ak-row"><div class="ak-mid"><div class="ak-t2">${esc((s.ticket && s.ticket.label) || "")}</div></div></div>
        <div class="ak-src">${esc(s.source || "Transport for NSW open data")}</div></div>`;
    }
    if (c.type === "stops") {
      return `<div class="ak-card">${c.items.map((s) => `<a class="ak-row" href="${esc(s.link.href)}"><div class="ak-mid"><div class="ak-t1">${esc(s.name)}</div><div class="ak-t2">${s.distance != null ? s.distance + " m" : ""}</div></div>${ICON.chev}</a>`).join("")}</div>`;
    }
    return "";
  }
  function msgHtml(m, i) {
    if (m.role === "me") return `<div class="ak-msg me"><div class="ak-b">${esc(m.text)}</div></div>`;
    if (m.role === "typing") return `<div class="ak-msg bot"><div class="ak-b ak-typing" aria-label="Transport Bot is typing"><i></i><i></i><i></i></div></div>`;
    const d = m.data || {};
    const links = (d.links || []).filter((l) => l.href);
    const chips = [];
    if (d.ask === "location") chips.push(`<button class="ak-chip loc" data-act="loc">${ICON.loc}<span>Use my location</span></button>`);
    for (const s of d.suggestions || []) chips.push(`<button class="ak-chip" data-q="${esc(s)}">${esc(s)}</button>`);
    return `<div class="ak-msg bot"><div class="ak-b">${esc(m.text)}</div>
      ${(d.cards || []).map(cardHtml).join("")}
      ${links.length ? `<div class="ak-links">${links.map((l) => `<a class="ak-link" href="${esc(l.href)}">${esc(l.label)}</a>`).join("")}</div>` : ""}
      ${chips.length && i === msgs.length - 1 ? `<div class="ak-chips">${chips.join("")}</div>` : ""}</div>`;
  }
  function stamp(t) {
    const d = new Date(t);
    const today = new Date().toDateString() === d.toDateString();
    return (today ? "Today " : d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" }) + " ") + clock(t);
  }
  function paint(scroll = true) {
    const list = $("#akList");
    if (!list) return;
    let html = "", lastT = 0;
    const all = busy ? msgs.concat([{ role: "typing", t: Date.now() }]) : msgs;
    all.forEach((m, i) => {
      if (m.t && m.t - lastT > 20 * 60000) html += `<div class="ak-stamp">${esc(stamp(m.t))}</div>`;
      if (m.t) lastT = m.t;
      html += msgHtml(m, i);
    });
    if (!msgs.length && !busy) {
      html = `<div class="ak-hello"><div class="ak-av"><img src="/icon-192.png" alt=""></div><b>Ask Transport Bot</b><p>Live times for any train, bus, ferry or light rail in NSW. Type or say a question.</p></div>
        <div class="ak-starters">${STARTERS.map((s) => `<button class="ak-chip big" data-q="${esc(s)}">${esc(s)}</button>`).join("")}</div>`;
    }
    list.innerHTML = html;
    if (scroll) requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: msgs.length > 1 ? "smooth" : "auto" }));
  }
  function tick() {
    $$("#akList [data-akt]").forEach((el) => {
      const c = countdown(el.dataset.akt);
      const box = $(".ak-cd", el);
      if (box) { box.innerHTML = `<b>${esc(c.big)}</b>${c.unit ? `<small>${c.unit}</small>` : ""}`; box.classList.toggle("clock", !c.unit && c.big !== "Now"); }
      if (c.past) el.classList.add("dim");
    });
  }

  function places() { return LS.get("tb_places", {}); }
  async function maybeCoords(force) {
    if (coords && Date.now() - coordsAt < 120000) return coords;
    if (!("geolocation" in navigator)) return null;
    if (!force) {
      try { const p = await navigator.permissions.query({ name: "geolocation" }); if (p.state !== "granted") return null; } catch (e) { return null; }
    }
    return new Promise((res) => navigator.geolocation.getCurrentPosition((p) => { coords = p.coords; coordsAt = Date.now(); res(coords); }, () => res(null), { timeout: force ? 15000 : 4000, maximumAge: 60000, enableHighAccuracy: false }));
  }
  async function ask(q, opts = {}) {
    q = String(q || "").trim();
    if (!q || busy) return;
    lastQ = q;
    if (!opts.silent) msgs.push({ role: "me", text: q, t: Date.now() });
    busy = true; save(); paint();
    const pl = places();
    const c = await maybeCoords(opts.forceLoc);
    const p = {
      q, profile: (window.TBApp && window.TBApp.profile) || LS.get("tb_profile", ""), device: LS.get("tb_device", ""), fare: LS.get("tb_fare", "adult"),
      home: pl.home && pl.home.id ? pl.home.id + "|" + (pl.home.name || "") : null,
      work: pl.work && pl.work.id ? pl.work.id + "|" + (pl.work.name || "") : null,
      lat: c ? c.latitude.toFixed(5) : null, lon: c ? c.longitude.toFixed(5) : null,
    };
    let d;
    try {
      const prof = p.profile; delete p.profile;
      const r = await fetch("/api/ask?" + qs(p), prof ? { headers: { "x-profile": prof } } : undefined);
      d = await r.json();
    } catch (e) { d = { reply: "No connection right now. Check your signal and try again.", suggestions: [q] }; }
    busy = false;
    msgs.push({ role: "bot", text: d.reply || d.text || "Sorry, I didn't get that.", data: { cards: d.cards || [], links: d.links || [], suggestions: d.suggestions || [], ask: d.ask || null }, t: Date.now() });
    save(); paint();
  }

  function render({ view, setNav, setTab, S }) {
    ctxRef = { S };
    setTab("ask");
    setNav({ title: "Ask", actions: `<button class="icon-btn act" id="akClear" aria-label="Clear chat">${ICON.trash}</button>` });
    document.body.classList.add("ak-on");
    view.innerHTML = `<h1 class="large">Ask</h1><div class="ak-list" id="akList" aria-live="polite"></div>`;
    let bar = $("#akBar");
    if (!bar) {
      bar = document.createElement("form");
      bar.id = "akBar"; bar.className = "ak-bar"; bar.setAttribute("autocomplete", "off"); bar.setAttribute("role", "search"); bar.setAttribute("aria-label", "Ask");
      const canTalk = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
      bar.innerHTML = `<div class="ak-field"><input id="akIn" type="text" enterkeyhint="send" placeholder="Ask about a train, bus or trip" aria-label="Your question">
        ${canTalk ? `<button type="button" class="ak-mic" id="akMic" aria-label="Speak your question">${ICON.mic}</button>` : ""}</div>
        <button class="ak-send" id="akSend" type="submit" aria-label="Send" disabled>${ICON.send}</button>`;
      document.body.appendChild(bar);
    }
    const input = $("#akIn"), send = $("#akSend");
    input.oninput = () => { send.disabled = !input.value.trim(); };
    bar.onsubmit = (e) => { e.preventDefault(); const v = input.value; input.value = ""; send.disabled = true; ask(v); };
    const mic = $("#akMic");
    if (mic) mic.onclick = () => {
      const R = window.SpeechRecognition || window.webkitSpeechRecognition;
      const rec = new R(); rec.lang = "en-AU"; rec.interimResults = true; rec.maxAlternatives = 1;
      mic.classList.add("on");
      rec.onresult = (ev) => { const r = ev.results[ev.results.length - 1]; input.value = r[0].transcript; send.disabled = !input.value.trim(); if (r.isFinal) { const v = input.value; input.value = ""; send.disabled = true; ask(v); } };
      rec.onend = () => mic.classList.remove("on");
      rec.onerror = () => mic.classList.remove("on");
      try { rec.start(); } catch (e) { mic.classList.remove("on"); }
    };
    $("#akClear").onclick = () => { msgs = []; save(); paint(); };
    view.onclick = (e) => {
      const b = e.target.closest("[data-q]");
      if (b) { ask(b.dataset.q); return; }
      const l = e.target.closest('[data-act="loc"]');
      if (l) { msgs[msgs.length - 1].data.ask = null; ask(lastQ || (msgs.filter((m) => m.role === "me").pop() || {}).text, { forceLoc: true, silent: true }); }
    };
    paint(false);
    requestAnimationFrame(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const timer = setInterval(() => { if (!document.hidden) tick(); }, 15000);
    const pre = new URLSearchParams(location.hash.split("?")[1] || "").get("q");
    if (pre && !busy) { history.replaceState(null, "", "#/chat"); ask(pre); }
    S.cleanup.push(() => { clearInterval(timer); document.body.classList.remove("ak-on"); const b = $("#akBar"); if (b) b.remove(); view.onclick = null; });
  }
  window.AskTab = { render, ask };
})();
