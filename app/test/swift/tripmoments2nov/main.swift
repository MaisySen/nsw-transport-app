// Compiled with targets/widget/TripMoments.swift by app/test/island2nov.test.mjs; one JSON line per case.
import Foundation

func out(_ d: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: d, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
}
let iso = ISO8601DateFormatter()
func at(_ s: String) -> Date { iso.date(from: s)! }
func ms(_ d: Date) -> Double { d.timeIntervalSince1970 * 1000 }
// 2 Nov 2026, Sydney UTC+11: card saved 4:48:00, first leg arrives 4:49, next leg leaves 4:52
let u = at("2026-11-01T17:48:00Z"), off = at("2026-11-01T17:49:00Z"), dep = at("2026-11-01T17:52:00Z")
out(["case": "ladder", "v": TripMoments.ladder(updated: u, after: off).map { $0.timeIntervalSince(u) }])
out(["case": "ladderLate", "v": TripMoments.ladder(updated: u, after: u.addingTimeInterval(400)).map { $0.timeIntervalSince(u) }])
out(["case": "ladderNone", "v": TripMoments.ladder(updated: nil, after: off).count])
out(["case": "nextAt", "v": TripMoments.nextLegAt(off: off, now: u).timeIntervalSince(off)])
out(["case": "nextAtLate", "v": TripMoments.nextLegAt(off: off, now: at("2026-11-01T17:55:14Z")).timeIntervalSince(off)])
// the next leg's own moments from the change: waiting, Due a minute before, then on board
let start = TripMoments.nextLegAt(off: off, now: u)
let m = TripMoments.list(phase: "wait", departs: dep, legArrives: at("2026-11-01T17:56:00Z"), arrival: at("2026-11-01T17:56:00Z"), now: start, updated: nil)
out(["case": "nextMoments", "v": m.map { $0.kind.rawValue }, "first": m[0].at.timeIntervalSince(off)])
// the shared card's next leg decodes from the app's JSON (widgetShare.ts nextLegFor)
let json = """
{"line":"T4","lineColorHex":"#005AA3","mode":"train","from":"Hub","to":"End","platform":"Platform 5","departs":\(ms(dep)),"arrives":null,"departsLive":true,"arrivesLive":false}
"""
let n = try! JSONDecoder().decode(SharedNextLeg.self, from: json.data(using: .utf8)!)
out(["case": "decode", "line": n.line, "platform": n.platform ?? "", "departs": n.departs ?? 0, "arrives": n.arrives == nil])
