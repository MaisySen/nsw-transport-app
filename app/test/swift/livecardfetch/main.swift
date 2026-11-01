// Compiled with targets/widget/LiveCardFetch.swift by app/test/lockedlive1nov.test.mjs; prints one JSON line per check.
import Foundation

func out(_ k: String, _ v: Any) {
    let data = try! JSONSerialization.data(withJSONObject: ["k": k, "v": v], options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
}
let now = Date(timeIntervalSince1970: 1_793_520_000)
let ms = now.timeIntervalSince1970 * 1000
out("neededNil", LiveCardFetch.needed(updatedMs: nil, now: now))
out("needed30", LiveCardFetch.needed(updatedMs: ms - 30_000, now: now))
out("needed90", LiveCardFetch.needed(updatedMs: ms - 90_000, now: now))
let base = URL(string: "https://api.transportsydney.app")!
out("url", LiveCardFetch.url(base: base, profile: "u6b1m1i641h161z1j6p046532", line: "T1", off: "Strathfield")?.absoluteString ?? "nil")
out("urlNone", LiveCardFetch.url(base: base, profile: "none", line: "T1", off: "Strathfield")?.absoluteString ?? "nil")
out("urlShared", LiveCardFetch.url(base: base, profile: "bidur", line: "T1", off: "x")?.absoluteString ?? "nil")
let good = ##"{"card":{"line":"T1","lineColorHex":"#F99D1C","mode":"train","phase":"ride","getOffAt":"Strathfield","arrival":1793521080000,"legArrives":1793521080000,"until":1793522880000,"updated":1793519990000,"warning":"2 min late"},"ended":false}"##
let a = LiveCardFetch.parse(Data(good.utf8))!
out("parseUpdated", a.updatedMs ?? -1)
out("parseEnded", a.ended)
let back = try! JSONSerialization.jsonObject(with: a.card!) as! [String: Any]
out("parseCardPhase", back["phase"] as! String)
out("replacesNewer", LiveCardFetch.replaces(a, keptUpdatedMs: ms - 300_000))
out("replacesOlder", LiveCardFetch.replaces(a, keptUpdatedMs: ms))
let ended = LiveCardFetch.parse(Data(#"{"card":{"line":"T1","phase":"arrived","getOffAt":"Strathfield","arrival":1793521080000,"until":1793522880000},"ended":true}"#.utf8))!
out("replacesEnded", LiveCardFetch.replaces(ended, keptUpdatedMs: ms))
let none = LiveCardFetch.parse(Data(#"{"card":null}"#.utf8))!
out("noneCard", none.card == nil)
out("replacesNone", LiveCardFetch.replaces(none, keptUpdatedMs: nil))
out("badCard", LiveCardFetch.parse(Data(#"{"card":{"line":"T1"}}"#.utf8)) == nil)
let arrive = now.addingTimeInterval(600)
out("nextOk", Int(LiveCardFetch.next(now: now, arrival: arrive, ok: true).timeIntervalSince(now)))
out("nextFail", Int(LiveCardFetch.next(now: now, arrival: arrive, ok: false).timeIntervalSince(now)))
out("nextNearArrival", Int(LiveCardFetch.next(now: now, arrival: now.addingTimeInterval(100), ok: true).timeIntervalSince(now)))
out("nextPastArrival", Int(LiveCardFetch.next(now: now, arrival: now.addingTimeInterval(-100), ok: true).timeIntervalSince(now)))
