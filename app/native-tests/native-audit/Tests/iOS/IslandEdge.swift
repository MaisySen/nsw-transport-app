import SwiftUI
import CoreGraphics

/// Island edge check (31 Oct, build 211 round 2). The first 211 candidate (97b2d03) drew the expanded Island's countdown
/// ("5 min", "Now", "1 hr, 4 min") flush with the right edge of its region, while the line badge on the left keeps 4 pt
/// of its own, and the audit picture showed the countdown running into the rounded corner. The pixel check only asks
/// whether anything is drawn outside a region's box, so it passed. Two checks on every expanded Island shot:
/// 1. Nothing is drawn closer than `clearance` to the Island's rounded outline, with the outline where the owner's
///    build 210 iPhone has it (31 Oct screenshot of the expanded Island, 6.1 inch, 2.405 px per pt: content 17 pt in
///    from the right edge, 20 pt from the left with the badge's own 4 pt, 16 pt below the top; his 210 countdown was
///    about 9 pt from the corner's curve).
/// 2. The trailing region keeps at least the inset the leading region keeps (the badge's 4 pt), measured on the ink.
@MainActor
enum IslandEdge {
    /// The expanded Island around its content, as on the owner's iPhone.
    static let inset = EdgeInsets(top: 16, leading: 18, bottom: 8, trailing: 18)
    static let corner: CGFloat = 44
    /// Closest any ink may come to the rounded outline.
    static let clearance: CGFloat = 8
    static let scale: CGFloat = 2
    /// Expanded shots checked (the test fails if none were, so the check cannot silently stop running).
    static var checked = 0

    static func typed<V: View>(_ v: V, _ t: DynamicTypeSize) -> some View {
        v.environment(\.dynamicTypeSize, t).environment(\.colorScheme, .dark)
            .environment(\.timeZone, TimeZone(identifier: "Australia/Sydney")!)
            .environment(\.locale, Locale(identifier: "en_AU"))
    }

    /// The opaque pixels of the view laid out in exactly `box`, at 2x: (width, height, alpha >= 48 per pixel).
    static func ink<V: View>(_ v: V, box: CGSize) -> (w: Int, h: Int, on: [Bool])? {
        let r = ImageRenderer(content: v.frame(width: box.width, height: box.height))
        r.scale = scale
        guard let cg = r.cgImage else { return nil }
        let w = cg.width, h = cg.height
        var px = [UInt8](repeating: 0, count: w * h * 4)
        let ok: Bool = px.withUnsafeMutableBytes { buf in
            guard let ctx = CGContext(data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        guard ok else { return nil }
        var on = [Bool](repeating: false, count: w * h)
        // CGContext rows start at the bottom: flip so row 0 is the top.
        for y in 0..<h { for x in 0..<w where px[(y * w + x) * 4 + 3] >= 48 { on[(h - 1 - y) * w + x] = true } }
        return (w, h, on)
    }

    /// Distance from a point inside the Island (points, from its top left) to its rounded outline, and which edge.
    static func distance(_ x: CGFloat, _ y: CGFloat, size: CGSize) -> (CGFloat, String) {
        let r = corner, W = size.width, H = size.height
        let cx: CGFloat? = x < r ? r : (x > W - r ? W - r : nil)
        let cy: CGFloat? = y < r ? r : (y > H - r ? H - r : nil)
        if let cx, let cy {
            let name = (cy == r ? "top " : "bottom ") + (cx == r ? "left" : "right") + " corner"
            return (r - ((x - cx) * (x - cx) + (y - cy) * (y - cy)).squareRoot(), name)
        }
        let edges: [(CGFloat, String)] = [(x, "left edge"), (W - x, "right edge"), (y, "top edge"), (H - y, "bottom edge")]
        return edges.min { $0.0 < $1.0 }!
    }

    struct Reading { var nearest: CGFloat; var at: String; var left: CGFloat; var right: CGFloat }

    /// `layout` is the whole expanded view in `box`; `leading` and `trailing` are its side regions, `side` wide.
    static func check<A: View, L: View, T: View>(layout: A, leading: L, trailing: T, box: CGSize, side: CGFloat,
                                                  type t: DynamicTypeSize) -> (Reading, [String])? {
        guard let m = ink(typed(layout, t), box: box) else { return nil }
        let size = CGSize(width: box.width + inset.leading + inset.trailing, height: box.height + inset.top + inset.bottom)
        var nearest = CGFloat.greatestFiniteMagnitude, at = ""
        for y in 0..<m.h {
            for x in 0..<m.w where m.on[y * m.w + x] {
                let px = (CGFloat(x) + 0.5) / scale + inset.leading, py = (CGFloat(y) + 0.5) / scale + inset.top
                let (d, name) = distance(px, py, size: size)
                if d < nearest { nearest = d; at = name }
            }
        }
        // The side regions on their own, placed as in the Island: leading at its left, trailing at its right.
        let sideBox = CGSize(width: side, height: 52)
        func columns(_ v: some View, _ align: Alignment) -> [Int] {
            guard let s = ink(typed(v.frame(width: side, height: 52, alignment: align), t), box: sideBox) else { return [] }
            return (0..<s.w).filter { x in (0..<s.h).contains { s.on[$0 * s.w + x] } }
        }
        let lc = columns(leading, .leading), tc = columns(trailing, .trailing)
        let left = lc.first.map { CGFloat($0) / scale } ?? 0
        let right = tc.last.map { side - CGFloat($0 + 1) / scale } ?? side
        var out: [String] = []
        if nearest < clearance {
            out.append(String(format: "island-edge drawn %.1f pt from the %@, needs %.0f", nearest, at, clearance))
        }
        if !lc.isEmpty && !tc.isEmpty && right + 0.5 < left {
            out.append(String(format: "island-edge trailing %.1f pt from its right edge, leading %.1f pt from its left: same inset both sides", right, left))
        }
        return (Reading(nearest: nearest, at: at, left: left, right: right), out)
    }
}
