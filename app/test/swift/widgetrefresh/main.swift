// Compiled with targets/widget/WidgetRefresh.swift by app/test/widgetrefresh.test.mjs; prints one JSON line per case.
import Foundation

func out(_ d: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: d, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
}
let iso = ISO8601DateFormatter()
func at(_ s: String) -> Date { iso.date(from: s)! }
// Sydney is UTC+11 on these days (daylight time). Fri 30 Oct 2026 and Sat 31 Oct 2026.
let cases: [(String, String)] = [
    ("fri0200", "2026-10-29T15:00:00Z"), ("fri0715", "2026-10-29T20:15:00Z"), ("fri1100", "2026-10-30T00:00:00Z"),
    ("fri1700", "2026-10-30T06:00:00Z"), ("fri2200", "2026-10-30T11:00:00Z"), ("sat0815", "2026-10-30T21:15:00Z"),
    ("fri0020", "2026-10-29T13:20:00Z"), ("fri0500", "2026-10-29T18:00:00Z"), ("fri0929", "2026-10-29T22:29:00Z"),
    ("fri0930", "2026-10-29T22:30:00Z"),
]
for (name, s) in cases {
    let t = at(s)
    out(["kind": "band", "case": name, "v": WidgetRefresh.band(at: t).rawValue])
    let many = (1...6).map { t.addingTimeInterval(Double($0) * 600) }
    out(["kind": "next", "case": name, "v": Int(WidgetRefresh.next(updated: t, departures: many).timeIntervalSince(t))])
    out(["kind": "failed", "case": name, "v": Int(WidgetRefresh.next(updated: t, departures: many, failed: true).timeIntervalSince(t))])
    out(["kind": "empty", "case": name, "v": Int(WidgetRefresh.next(updated: t, departures: []).timeIntervalSince(t))])
    out(["kind": "short", "case": name, "v": Int(WidgetRefresh.next(updated: t, departures: [t.addingTimeInterval(120), t.addingTimeInterval(420)]).timeIntervalSince(t))])
    out(["kind": "one", "case": name, "v": Int(WidgetRefresh.next(updated: t, departures: [t.addingTimeInterval(1500)]).timeIntervalSince(t))])
    out(["kind": "live", "case": name, "v": Int(WidgetRefresh.next(updated: t, departures: [t.addingTimeInterval(130)], live: true).timeIntervalSince(t))])
    out(["kind": "liveNow", "case": name, "v": Int(WidgetRefresh.next(updated: t, departures: [t.addingTimeInterval(10)], live: true).timeIntervalSince(t))])
}
let t0 = at("2026-10-29T13:00:00Z") // Fri midnight Sydney
out(["kind": "perDay", "case": "weekday", "v": WidgetRefresh.asksPerDay(from: t0)])
out(["kind": "perDay", "case": "saturday", "v": WidgetRefresh.asksPerDay(from: t0.addingTimeInterval(86_400))])
let e = WidgetRefresh.entryDates(updated: t0, departures: [t0.addingTimeInterval(90), t0.addingTimeInterval(4000)])
out(["kind": "entries", "count": e.count, "first": Int(e.first!.timeIntervalSince(t0)), "last": Int(e.last!.timeIntervalSince(t0)),
     "hasDeparture": e.contains(t0.addingTimeInterval(90)), "pastHorizon": e.contains(t0.addingTimeInterval(4000))])
