// Privacy friendly page counter: one anonymous count per page view, no cookies, no IDs.
// Browsers that send Do Not Track or Global Privacy Control are not counted.
(function () {
  var off = navigator.doNotTrack === "1" || navigator.globalPrivacyControl === true || /^(localhost|127\.)/.test(location.hostname);
  var last = null, first = true;
  window.TBHit = function (p) {
    if (off || p === last) return;
    last = p;
    try {
      var body = JSON.stringify({ p: p, r: first ? document.referrer : "" });
      first = false;
      if (navigator.sendBeacon) navigator.sendBeacon("/api/hit", new Blob([body], { type: "application/json" }));
      else fetch("/api/hit", { method: "POST", body: body, headers: { "content-type": "application/json" }, keepalive: true });
    } catch (e) { /* counting is optional */ }
  };
  var page = document.documentElement.getAttribute("data-page");
  if (page != null) window.TBHit(page);
})();
