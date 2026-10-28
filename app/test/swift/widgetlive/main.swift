import Foundation

// Checks targets/widget/WidgetLive.swift on its own (Foundation only, so it runs on Linux too).
// app/test/widgetlive.test.mjs compiles this with that file, runs it and compares every line with the app's
// liveState (src/lib/liveLabelCore.ts). One JSON object per line.

let at = Date(timeIntervalSince1970: 1_793_268_000) // 29 Oct 2026, 8:20am Sydney
func emit(_ o: [String: Any]) {
    let d = try! JSONSerialization.data(withJSONObject: o, options: [.sortedKeys])
    print(String(data: d, encoding: .utf8)!)
}

// The rule on a grid of data ages and times to the service.
for age in [0.0, 60, 119, 120, 121, 180, 299, 300, 301, 600, 1200] {
    for lead in [30.0, 300, 599, 600, 601, 900, 1800] {
        let fresh = WidgetLive.isFresh(dataAt: at.addingTimeInterval(-age), leave: at.addingTimeInterval(lead), at: at)
        emit(["kind": "fresh", "age": age, "lead": lead, "fresh": fresh])
    }
}

// Data time on the phone's clock.
let fetched = at
func dataAt(_ feed: Double?, _ server: Double?) -> Double {
    WidgetLive.dataAt(fetched: fetched, feedMs: feed, serverNowMs: server).timeIntervalSince(fetched)
}
let nowMs = at.timeIntervalSince1970 * 1000
emit(["kind": "dataAt", "case": "none", "v": dataAt(nil, nil)])
emit(["kind": "dataAt", "case": "feed90", "v": dataAt(nowMs - 90_000, nil)])
// Server clock 10 min ahead of the phone: the feed copy is 40 s old by the server's own clock.
emit(["kind": "dataAt", "case": "skew", "v": dataAt(nowMs + 600_000 - 40_000, nowMs + 600_000)])
emit(["kind": "dataAt", "case": "future", "v": dataAt(nowMs + 60_000, nowMs)])
emit(["kind": "dataAt", "case": "ancient", "v": dataAt(1000, nowMs)])
emit(["kind": "dataAt", "case": "zero", "v": dataAt(0, nowMs)])
emit(["kind": "oldest", "v": WidgetLive.oldest([nil, 5, 3, nil, 9]) ?? -1])

// Words.
for s in [0.0, 30, 59, 60, 61, 119, 420, 3599, 3600, 7200] {
    emit(["kind": "ago", "s": s, "v": WidgetLive.ago(at.addingTimeInterval(-s), at: at)])
}

// A 3 minute late service: its timetable time is 3 minutes before the live one, walk included.
let leave = at.addingTimeInterval(900)
let tt = WidgetLive.timetable(leave: leave, live: at.addingTimeInterval(1020), planned: at.addingTimeInterval(840))
emit(["kind": "timetable", "v": tt.map { $0.timeIntervalSince(at) } ?? -1])
emit(["kind": "timetable", "v": WidgetLive.timetable(leave: leave, live: nil, planned: at).map { $0.timeIntervalSince(at) } ?? -1])

// One row at one moment.
func settle(_ age: Double, _ live: Bool, _ ttOff: Double?, _ hasData: Bool = true) -> [String: Any] {
    let r = WidgetLive.settle(leave: leave, timetable: ttOff.map { at.addingTimeInterval($0) }, isLive: live,
                              dataAt: hasData ? at.addingTimeInterval(-age) : nil, at: at)
    return ["leave": r.leave.timeIntervalSince(at), "live": r.isLive, "demoted": r.demoted]
}
emit(["kind": "settle", "case": "fresh", "r": settle(60, true, 720)])
emit(["kind": "settle", "case": "old", "r": settle(360, true, 720)])
emit(["kind": "settle", "case": "oldNoTimetable", "r": settle(360, true, nil)])
emit(["kind": "settle", "case": "neverLive", "r": settle(3600, false, 720)])
emit(["kind": "settle", "case": "noData", "r": settle(3600, true, 720, false)])
