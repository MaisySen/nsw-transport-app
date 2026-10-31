import SwiftUI

/// The line check (31 Oct, build 211): with the probes on, each countdown and stop name in the Live Activities reports
/// its box while the shot is checked (app/targets/widget/LineProbe.swift). A countdown must stay on one line; a stop
/// name may use the lines its layout gives it; neither may be cut ("Get off at Five..."). Build 210 on the owner's
/// iPhone showed "Get off / in 6 / minutes", which the pixel check alone passed.
@MainActor
enum LineCheck {
    static var probed = 0

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
                if l.used > r.allowed {
                    out.append("\(r.id) '\(r.text)' on \(l.used) lines, may use \(r.allowed)")
                } else if l.needed > r.allowed {
                    out.append("\(r.id) '\(r.text)' cut: needs \(l.needed) lines at its smallest size, has \(r.allowed)")
                }
                print("LINE \(r.id) '\(r.text)' allowed \(r.allowed) used \(l.used) needed \(l.needed) box \(Int(r.box.width))x\(Int(r.box.height)) one \(Int(r.oneLine.width))x\(Int(r.oneLine.height))")
            }
            return out
        })
    }
}
