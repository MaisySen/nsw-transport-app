// Shared live trip viewer. Opens a link made with "Share live trip" in the Transport app:
// the vehicle on the map, the sharer's position if they chose to include it, the next stop and
// the arrival time. No account. The link stops working when the trip ends.
(function () {
  "use strict";
  var TZ = "Australia/Sydney";
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var qs = function (o) { return Object.keys(o).filter(function (k) { return o[k] != null && o[k] !== ""; }).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(o[k]); }).join("&"); };
  var short = function (n) { return String(n || "").split(",")[0].trim(); };
  var tms = function (s) { return s ? new Date(s).getTime() : null; };
  var skew = 0;
  var now = function () { return Date.now() + skew; };
  var clock = function (t) { return new Date(t).toLocaleTimeString("en-AU", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).replace(/\s/g, "").toLowerCase(); };
  var mins = function (t) { return Math.max(0, Math.round((t - now()) / 60000)); };
  var nouns = { train: "train", metro: "metro", bus: "bus", ferry: "ferry", lightrail: "light rail", coach: "coach" };
  var id = new URLSearchParams(location.search).get("t") || "";
  var sheet = $("#sheet"), sbody = $("#sbody");
  sheet.style.setProperty("--y", Math.round(sheet.getBoundingClientRect().height * 0.45) + "px");
  var map = null, route = null, vMarker = null, pMarker = null, stopsLayer = null, follow = true, share = null, svc = null, svcLeg = -1, timer = null;


  // Vector tiles from OpenFreeMap with MapLibre GL inside Leaflet, loaded when the map opens;
  // OpenStreetMap raster tiles when the phone has no WebGL.
  function baseTiles(m) {
    var dark = matchMedia("(prefers-color-scheme: dark)").matches;
    function raster() { L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, className: dark ? "dk-tiles" : "", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(m); }
    var gl = false;
    try { var c = document.createElement("canvas"); gl = !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (e) { gl = false; }
    if (!gl) { raster(); return; }
    var add = function (src, next) { var s = document.createElement("script"); s.src = src; s.onload = next; s.onerror = raster; document.head.appendChild(s); };
    var css = document.createElement("link"); css.rel = "stylesheet"; css.href = "/vendor/maplibre-gl.css?v=1"; document.head.appendChild(css);
    add("/vendor/maplibre-gl.js?v=1", function () {
      add("/vendor/leaflet-maplibre-gl.js?v=1", function () {
        if (!L.maplibreGL) { raster(); return; }
        L.maplibreGL({ style: "https://tiles.openfreemap.org/styles/" + (dark ? "dark" : "liberty"), attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(m);
      });
    });
  }
  function makeMap() {
    if (map || !window.L) return;
    map = L.map("map", { zoomControl: false }).setView([-33.8688, 151.2093], 12);
    baseTiles(map);
    map.on("dragstart", function () { follow = false; });
  }
  $("#lFollow").onclick = function () { follow = true; paintMap(); };

  function ended(msg) {
    clearInterval(timer);
    makeMap();
    if (route) route.remove(); if (vMarker) vMarker.remove(); if (pMarker) pMarker.remove(); if (stopsLayer) stopsLayer.clearLayers();
    sbody.innerHTML = '<div class="go-pad"><div class="go-head"><div class="go-k">Live trip</div><div class="go-big" style="font-size:30px">' + esc(msg || "This trip has ended.") + '</div><div class="go-sub">Shared trips stop when the trip ends, and their positions are deleted.</div></div><a class="btn" href="/">Open Transport</a></div>';
  }
  function legOf(s) { var p = s.prog || {}; var i = p.leg != null ? p.leg : 0; return Math.max(0, Math.min(s.legs.length - 1, i)); }
  function paintMap() {
    makeMap(); if (!map || !share) return;
    var l = share.legs[legOf(share)], c = l.color || "#00B5EF";
    var pts = [];
    if (svc && svc.path && svc.path.length > 1) {
      if (!route) route = L.polyline(svc.path, { color: c, weight: 6, opacity: 0.9, lineJoin: "round" }).addTo(map);
      else { route.setLatLngs(svc.path); route.setStyle({ color: c }); }
      if (!stopsLayer) stopsLayer = L.layerGroup().addTo(map);
      stopsLayer.clearLayers();
      var a = svc.mineIndex >= 0 ? svc.mineIndex : 0, b = svc.alightIndex >= 0 ? svc.alightIndex : svc.stops.length - 1;
      svc.stops.slice(a, b + 1).forEach(function (s, k) {
        var end = k === 0 || a + k === b;
        L.marker([s.lat, s.lon], { icon: L.divIcon({ className: "", iconSize: end ? [18, 18] : [11, 11], html: '<div class="sm-dot' + (end ? " mine" : "") + '" style="--c:' + esc(c) + ";" + (s.passed ? "opacity:.4" : "") + '"></div>' }), keyboard: false, title: s.name }).addTo(stopsLayer);
      });
    }
    if (svc && svc.vehicle) {
      var vp = [svc.vehicle.lat, svc.vehicle.lon];
      var ic = L.divIcon({ className: "", iconSize: [36, 36], iconAnchor: [18, 18], html: '<div class="vm" style="--c:' + esc(c) + '"><span class="ring"></span><span class="b go-vl">' + esc(l.line) + "</span></div>" });
      if (!vMarker) vMarker = L.marker(vp, { icon: ic, zIndexOffset: 1000 }).addTo(map); else { vMarker.setLatLng(vp); vMarker.setIcon(ic); }
      pts.push(vp);
    } else if (vMarker) { vMarker.remove(); vMarker = null; }
    if (share.pos) {
      var pp = [share.pos.lat, share.pos.lon];
      if (!pMarker) pMarker = L.marker(pp, { icon: L.divIcon({ className: "", iconSize: [22, 22], iconAnchor: [11, 11], html: '<div class="me-dot"></div>' }), zIndexOffset: 1200, title: "Their location" }).addTo(map);
      else pMarker.setLatLng(pp);
      pts.push(pp);
    } else if (pMarker) { pMarker.remove(); pMarker = null; }
    if (svc && svc.stops) { var z = svc.stops[svc.alightIndex] || svc.stops[svc.stops.length - 1]; var n = svc.stops[svc.nextIndex]; if (n) pts.push([n.lat, n.lon]); if (z && pts.length < 2) pts.push([z.lat, z.lon]); }
    if (follow) {
      var pad = { paddingTopLeft: [30, 70], paddingBottomRight: [30, Math.min(window.innerHeight * 0.5, sheet.getBoundingClientRect().height * 0.55) + 20], maxZoom: 16 };
      if (pts.length > 1) map.fitBounds(pts, pad); else if (pts.length) map.setView(pts[0], 15); else if (route) map.fitBounds(route.getBounds(), pad);
    }
  }
  function paint() {
    var s = share, li = legOf(s), l = s.legs[li], last = s.legs[s.legs.length - 1], p = s.prog || {};
    var alight = svc && svc.alightIndex >= 0 ? svc.stops[svc.alightIndex] : null;
    var eta = p.eta || (li === s.legs.length - 1 && alight ? tms(alight.estimated || alight.planned) : tms(last.arrPlanned || last.planned));
    var line1 = p.phase === "wait" ? "Waiting for the " + esc(l.line) + " to " + esc(short(l.towards || l.to)) : p.phase === "done" ? "Arrived" : "On the " + esc(l.line) + " to " + esc(short(l.towards || l.to));
    var line2 = p.next ? "Next stop: " + esc(p.next) + (p.stopsLeft != null ? " \u00b7 " + p.stopsLeft + " stop" + (p.stopsLeft === 1 ? "" : "s") + " to " + esc(short(l.to)) : "") : "To " + esc(short(l.to));
    var live = svc && svc.live, late = svc && svc.delayMin;
    var badge = live ? (late >= 2 ? '<span class="badge late">' + late + " min late</span>" : '<span class="badge live">Live</span>') : '<span class="badge sched">Scheduled</span>';
    var age = Math.round((now() - s.updated) / 60000);
    var legRows = s.legs.map(function (x, i) {
      return (i > 0 ? '<div class="go-chg">change at ' + esc(short(s.legs[i - 1].to)) + "</div>" : "") + '<div class="go-leg ' + (i < li ? "done" : i === li ? "now" : "next") + '" style="--c:' + esc(x.color || "#00B5EF") + '"><span class="lb" style="background:' + esc(x.color || "#00B5EF") + ";color:" + ink(x.color || "#00B5EF") + '">' + esc(x.line) + '</span><div class="grow"><div class="t1">' + esc(short(x.from)) + " to " + esc(short(x.to)) + '</div><div class="t2">' + clock(tms(x.estimated || x.planned)) + " to " + clock(tms(x.arrPlanned || x.planned)) + " planned</div></div>" + (i === li ? '<span class="go-now-dot"></span>' : "") + "</div>";
    }).join("");
    var m = mins(eta);
    var inTxt = m === 0 ? "<b>Now</b>" : m < 60 ? "<b>" + m + "</b><span>min</span>" : "<b>" + Math.floor(m / 60) + "</b><span>h</span><b>" + (m % 60) + "</b><span>min</span>";
    sbody.innerHTML = '<div class="go-pad"><div class="go-head"><div class="go-k">' + esc(s.title) + '</div><div class="go-row"><div><div class="go-sub" style="margin:0">Gets in at ' + esc(short((s.to && s.to.name) || last.to)) + '</div><div class="go-big">' + clock(eta) + '</div></div><div class="go-in">' + inTxt + '</div></div><div class="go-badges">' + badge + (s.pos ? '<span class="badge sched">Location shared</span>' : "") + "</div></div>" +
      '<div class="go-card" style="--c:' + esc(l.color || "#00B5EF") + '"><div class="grow"><div class="go-now1">' + line1 + '</div><div class="go-now2">' + line2 + "</div></div></div>" +
      (svc && svc.where ? '<p class="go-sub" style="padding:0 4px">The ' + esc(nouns[l.mode] || "service") + " is " + esc(svc.where.text.charAt(0).toLowerCase() + svc.where.text.slice(1)) + ".</p>" : "") +
      '<div class="group-h">The trip</div><div class="group"><div class="go-legs">' + legRows + "</div></div>" +
      '<p class="group-f">Updated ' + (age < 1 ? "just now" : age + " min ago") + ". Live times and vehicle positions from Transport for NSW. This link stops working when the trip ends.</p></div>";
  }
  function load() {
    fetch("/api/share?" + qs({ id: id })).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); }).then(function (x) {
      if (!x.ok || !x.d || x.d.ended) { ended(x.d && x.d.error); return null; }
      share = x.d; if (share.now) skew = share.now - Date.now();
      var li = legOf(share), l = share.legs[li];
      if (li !== svcLeg) { svc = null; if (route) { route.remove(); route = null; } }
      svcLeg = li;
      return fetch("/api/service?" + qs({ trip: l.tripId, mode: l.mode, line: l.line, stop: l.stopId, destId: l.destId, planned: l.planned, to: l.toStopId, dest: l.towards, stopName: l.from, color: l.color }))
        .then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d) svc = d; }).catch(function () {});
    }).then(function () { if (share) { paint(); paintMap(); } }).catch(function () { /* try again on the next tick */ });
  }
  if (!/^[A-Za-z0-9_-]{12,40}$/.test(id)) { ended("This live trip link is not valid."); return; }
  load();
  timer = setInterval(function () { if (!document.hidden) load(); }, 15000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
})();
  // Black text on light line colours so badges stay readable (4.5:1).
  const ink = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
    if (!m) return "#fff";
    const c = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 1.05 / (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] + 0.05) >= 4.5 ? "#fff" : "#000";
  };
