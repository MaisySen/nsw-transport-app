// Compiled with targets/widget/MinimalIsland.swift and Format.swift by app/test/island2nov.test.mjs; one JSON line per case.
import Foundation

func out(_ d: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: d, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
}
let iso = ISO8601DateFormatter()
// 2 Nov 2026 4:52am Sydney (UTC+11)
let t = iso.date(from: "2026-11-01T17:52:00Z")!
func show(_ name: String, _ w: MinimalIsland.Words?) {
    guard let w else { out(["case": name, "nil": true]); return }
    out(["case": name, "line": w.line ?? NSNull(), "time": w.time, "getOff": w.getOff])
}
show("due", MinimalIsland.words(line: "T4", target: t, word: "Due", arrived: false))
show("counting", MinimalIsland.words(line: "T4", target: t, word: nil, arrived: false))
show("getoff", MinimalIsland.words(line: "T4", target: t.addingTimeInterval(180), word: "Now", arrived: false))
show("arrived", MinimalIsland.words(line: "T4", target: t, word: nil, arrived: true))
show("noline", MinimalIsland.words(line: "  ", target: t, word: "Due", arrived: false))
show("longline", MinimalIsland.words(line: "M1X99", target: t, word: nil, arrived: false))
out(["case": "spoken", "v": MinimalIsland.spoken(line: "T4", target: t, phase: "wait")])
out(["case": "spokenride", "v": MinimalIsland.spoken(line: "T4", target: t, phase: "ride")])
