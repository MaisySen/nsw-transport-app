import SwiftUI

/// The line check (31 Oct, build 211): with the probes on, each countdown and stop name in the Live Activities reports
/// its box while the shot is checked (app/targets/widget/LineProbe.swift). A countdown must stay on one line; a stop
/// name may use the lines its layout gives it; neither may be cut ("Get off at Five..."). Build 210 on the owner's
/// iPhone showed "Get off / in 6 / minutes", which the pixel check alone passed.
/// Round 2 (31 Oct, build 211): the Start trip titles are one line on the Lock Screen and in the Island, whatever
/// the view allows. The first 211 candidate (97b2d03) drew "Get off at / Croydon" under the camera in every Island
/// shot and "Get off at / Macarthur" on the Lock Screen beside "1 hr, 4 min", and passed because those views let the
/// title use two lines; on the owner's build 210 iPhone the Island title was one line. The same holds for the followed
/// service's titles.
@MainActor
enum LineCheck {
    static var probed = 0
    /// Titles: one line at most, a wrap fails like a countdown on two lines does. The followed service's "to Hornsby"
    /// titles are held to the same rule so both Live Activities read alike. A title whose last form (the stop alone at
    /// its smallest size) still does not fit is cut at its end: allowed, as the last resort, and listed as shortened
    /// (TITLE SHORTENED in the log) rather than failed.
    static let titles: Set<String> = ["island-stop", "lock-stop", "follow-island-to", "follow-lock-to"]
    static func allowed(_ r: LineProbe.Reading) -> Int { titles.contains(r.id) ? min(r.allowed, 1) : r.allowed }
    /// Titles cut at their end in the last check, for the shot's log line.
    static var shortened: [String] = []
    static var shortenedTotal = 0
    static func takeShortened() -> [String] { defer { shortened = [] }; return shortened }

    static func install() {
        Audit.lineCheck = (start: {
            LineProbe.readings = [:]
            LineProbe.on = true
        }, finish: {
            LineProbe.on = false
            let rs = LineProbe.readings.values.sorted { ($0.id, $0.text) < ($1.id, $1.text) }
            LineProbe.readings = [:]
            guard !rs.isEmpty else { return nil }
            probed += rs.count
            var out: [String] = []
            for r in rs {
                guard let l = LineProbe.lines(r) else { continue }
                let may = allowed(r)
                if l.used > may {
                    out.append("\(r.id) '\(r.text)' on \(l.used) lines, may use \(may)")
                } else if l.needed > may && titles.contains(r.id) {
                    shortened.append("\(r.id) '\(r.text)' cut at its end (needs \(l.needed) lines at its smallest size)")
                    shortenedTotal += 1
                } else if l.needed > may {
                    out.append("\(r.id) '\(r.text)' cut: needs \(l.needed) lines at its smallest size, has \(may)")
                }
                print("LINE \(r.id) '\(r.text)' allowed \(may) used \(l.used) needed \(l.needed) box \(Int(r.box.width))x\(Int(r.box.height)) one \(Int(r.oneLine.width))x\(Int(r.oneLine.height))")
            }
            return out
        })
    }
}
