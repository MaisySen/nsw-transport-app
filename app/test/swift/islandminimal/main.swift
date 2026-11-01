// Compiled with targets/widget/IslandMinimal.swift and Format.swift by app/test/island2nov.test.mjs; one JSON line per case.
import Foundation

func out(_ d: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: d, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
}
let iso = ISO8601DateFormatter()
// 2 Nov 2026 4:52am Sydney (UTC+11)
let t = iso.date(from: "2026-11-01T17:52:00Z")!
func show(_ name: String, _ w: IslandMinimal.Words?) {
    guard let w else { out(["case": name, "nil": true]); return }
    out(["case": name, "line": w.line ?? NSNull(), "time": w.time, "getOff": w.getOff])
}
show("due", IslandMinimal.words(line: "T4", target: t, word: "Due", arrived: false))
show("counting", IslandMinimal.words(line: "T4", target: t, word: nil, arrived: false))
show("getoff", IslandMinimal.words(line: "T4", target: t.addingTimeInterval(180), word: "Now", arrived: false))
show("arrived", IslandMinimal.words(line: "T4", target: t, word: nil, arrived: true))
show("noline", IslandMinimal.words(line: "  ", target: t, word: "Due", arrived: false))
show("longline", IslandMinimal.words(line: "M1X99", target: t, word: nil, arrived: false))
out(["case": "spoken", "v": IslandMinimal.spoken(line: "T4", target: t, phase: "wait")])
out(["case": "spokenride", "v": IslandMinimal.spoken(line: "T4", target: t, phase: "ride")])
