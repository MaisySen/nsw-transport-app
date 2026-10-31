import SwiftUI

/// Line check for the native audit (31 Oct, build 211). On the owner's iPhone, build 210's Lock Screen card showed
/// "Get off / in 6 / minutes" and the Island "in 5 / minutes": the audit only counted pixels drawn outside a box, so a
/// countdown on two lines, or a stop name cut with "...", passed. A probed Text reports, while the audit renders it,
/// the box it was given, its size on one line, and the lines it needs at its smallest allowed scale; the audit then
/// fails when a countdown or stop name uses more lines than it may, or is cut.
/// In the app `LineProbe.on` is always false and the modifier hands the view back unchanged.
enum LineProbe {
    struct Reading {
        var id: String
        var text: String
        var allowed: Int
        var minScale: CGFloat
        /// The box the Text got.
        var box: CGSize = .zero
        /// The Text on one line, unscaled.
        var oneLine: CGSize = .zero
        /// Its height with no line limit in the widest box its scale allows (box width / smallest scale).
        var needed: CGFloat = 0
    }

    /// Set by the native audit only.
    nonisolated(unsafe) static var on = false
    nonisolated(unsafe) static var readings: [String: Reading] = [:]

    static func note(_ key: String, _ seed: Reading, _ change: (inout Reading) -> Void) -> Bool {
        var r = readings[key] ?? seed
        change(&r)
        readings[key] = r
        return true
    }

    /// Lines the Text shows, and lines it would need at its smallest scale (more than allowed means it is cut).
    static func lines(_ r: Reading) -> (used: Int, needed: Int)? {
        guard r.oneLine.height > 0, r.box.height > 0 else { return nil }
        let used = Int((r.box.height / r.oneLine.height).rounded())
        let needed = Int((r.needed / r.oneLine.height).rounded())
        return (max(used, 1), max(needed, 1))
    }
}

extension View {
    /// `lines`: how many lines this Text may use. `font` and `minScale` must be the Text's own.
    func lineProbe(_ id: String, text: String, lines: Int, font: Font, minScale: CGFloat = 1) -> some View {
        modifier(LineProbeModifier(id: id, text: text, lines: lines, font: font, minScale: minScale))
    }
}

struct LineProbeModifier: ViewModifier {
    var id: String
    var text: String
    var lines: Int
    var font: Font
    var minScale: CGFloat

    func body(content: Content) -> some View {
        if LineProbe.on && !text.isEmpty {
            content.overlay(alignment: .topLeading) {
                GeometryReader { g in
                    let key = "\(id)|\(text)"
                    let seed = LineProbe.Reading(id: id, text: text, allowed: lines, minScale: minScale)
                    let _ = LineProbe.note(key, seed) { $0.box = g.size }
                    VStack(alignment: .leading, spacing: 0) {
                        Text(text).font(font).lineLimit(1).minimumScaleFactor(1).fixedSize()
                            .background(GeometryReader { o in
                                let _ = LineProbe.note(key, seed) { $0.oneLine = o.size }
                                Color.clear
                            })
                        Text(text).font(font).lineLimit(nil).minimumScaleFactor(1)
                            .frame(width: g.size.width / max(minScale, 0.1) + 1, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                            .background(GeometryReader { n in
                                let _ = LineProbe.note(key, seed) { $0.needed = n.size.height }
                                Color.clear
                            })
                    }
                    .opacity(0)
                    .accessibilityHidden(true)
                }
            }
        } else {
            content
        }
    }
}
