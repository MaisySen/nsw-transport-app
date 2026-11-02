// Compiled with modules/transport-ios/ios/TripOutbox.swift by app/test/rtfix1nov.test.mjs; prints one JSON line per check.
import Foundation

func out(_ k: String, _ v: Any) {
    let data = try! JSONSerialization.data(withJSONObject: ["k": k, "v": v], options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
}
let d = UserDefaults(suiteName: "tripoutbox-test-\(ProcessInfo.processInfo.processIdentifier)")!
let now = Date(timeIntervalSince1970: 1_793_520_000)
let ms = now.timeIntervalSince1970 * 1000
out("o200", TripOutbox.outcome(status: 200).rawValue)
out("o503", TripOutbox.outcome(status: 503).rawValue)
out("o429", TripOutbox.outcome(status: 429).rawValue)
out("o400", TripOutbox.outcome(status: 400).rawValue)
out("oNil", TripOutbox.outcome(status: nil).rawValue)
out("wait1", TripOutbox.wait(afterTries: 1))
out("wait9", TripOutbox.wait(afterTries: 9))
let w = #"{"kind":"watch","method":"POST","path":"/api/watch","body":"{\"key\":\"g1-abc\"}","after":\#(ms + 20000),"until":\#(ms + 14400000),"offNotes":["getoff-g1-gnow0"]}"#
out("putWatch", TripOutbox.put(kind: "watch", json: w, base: "https://api.transportsydney.app", d))
out("putBad", TripOutbox.put(kind: "watch", json: #"{"kind":"watch","method":"GET","path":"/x","after":0,"until":0}"#, base: "https://api.transportsydney.app", d))
out("dueNow", TripOutbox.due(TripOutbox.load(d), now: now).count)
out("due21", TripOutbox.due(TripOutbox.load(d), now: now.addingTimeInterval(21)).map { $0.kind })
TripOutbox.setCard(json: #"{"device":"dev1","trip":{"id":"g1","legs":[]},"tripFlow":2}"#, base: "https://api.transportsydney.app", d)
let c = TripOutbox.cardToken("ab", activity: "act1", appOpen: false, now: now, d)!
let cb = try! JSONSerialization.jsonObject(with: Data(c.body!.utf8)) as! [String: Any]
out("cardToken", cb["token"] as! String)
out("cardActivity", cb["activity"] as! String)
out("cardDevice", cb["device"] as! String)
out("cardDueNow", TripOutbox.due(TripOutbox.load(d), now: now).map { $0.kind })
let open = TripOutbox.cardToken("ab", activity: "act1", appOpen: true, now: now, d)!
out("cardOpenWaits", (open.after - ms) / 1000)
out("kinds", TripOutbox.load(d).map { $0.kind }.sorted())
// a failed try waits by the backoff, a gone one leaves
let e = TripOutbox.load(d).first { $0.kind == "watch" }!
TripOutbox.record(e, outcome: .retry, now: now.addingTimeInterval(21), d)
let e2 = TripOutbox.load(d).first { $0.kind == "watch" }!
out("retryTries", e2.tries ?? -1)
out("retryAfter", (e2.after - ms) / 1000)
TripOutbox.record(e2, outcome: .ok, now: now.addingTimeInterval(30), d)
out("okGone", TripOutbox.load(d).contains { $0.kind == "watch" })
// a stop takes out a queued watch
_ = TripOutbox.put(kind: "watch", json: w, base: "https://api.transportsydney.app", d)
let s = #"{"kind":"stop","method":"DELETE","path":"/api/watch?device=dev1&key=g1-abc","after":\#(ms),"until":\#(ms + 21600000)}"#
out("putStop", TripOutbox.put(kind: "stop", json: s, base: "https://api.transportsydney.app", d))
out("afterStop", TripOutbox.load(d).map { $0.kind }.sorted())
out("dueOrder", TripOutbox.due(TripOutbox.load(d), now: now.addingTimeInterval(30)).map { $0.kind })
let rq = TripOutbox.request(TripOutbox.load(d).first { $0.kind == "stop" }!, timeout: 10)!
out("stopURL", rq.url!.absoluteString)
out("stopMethod", rq.httpMethod ?? "")
out("getOffYes", TripOutbox.serverSendsGetOff(Data(#"{"ok":true,"watch":{"id":"w1","getOff":true}}"#.utf8)))
out("getOffNo", TripOutbox.serverSendsGetOff(Data(#"{"ok":true,"watch":{"id":"w1"}}"#.utf8)))
// given up past until
var old = TripOutbox.load(d).first { $0.kind == "stop" }!
old.until = old.after + 1000
out("pastUntil", TripOutbox.after(old, outcome: .retry, now: now) == nil)
TripOutbox.setCard(json: nil, base: "", d)
out("cardCleared", TripOutbox.load(d).contains { $0.kind == "card" })
d.removePersistentDomain(forName: "tripoutbox-test-\(ProcessInfo.processInfo.processIdentifier)")
