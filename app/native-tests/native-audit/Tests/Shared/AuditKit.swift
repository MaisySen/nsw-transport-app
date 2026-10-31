import SwiftUI
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
import Foundation

/// Native audit (30 Oct, before build 210): renders a shipped view inside the exact box the system gives it and
/// checks, pixel by pixel, that nothing is drawn outside that box (on a device that part is cut off). Each shot is
/// saved as a PNG with one JSON line in manifest.jsonl, which the contact sheets are made from. Snapshot only:
/// no signing, no build of the app, no upload.
enum Audit {
    struct Record: Codable {
        var surface: String      // "nexttrip-medium", "island-expanded", "watch-rect"
        var scenario: String     // "long", "nolive", ...
        var device: String       // "se", "std", "promax", "41mm" ...
        var type: String         // "default" or "xxxl"
        var scheme: String       // "light" or "dark"
        var box: [Double]        // width, height in points
        var overflow: [Double]   // points drawn past the box: top, left, bottom, right
        var fits: Bool
        var file: String
        /// Line check (31 Oct, build 211): countdowns and stop names that use more lines than they may, or are cut
        /// ("lock-countdown 'in 6 minutes' 2 of 1 lines"). Empty when all are whole.
        var lines: [String]? = nil
    }

    /// Set by the iPhone audit: switches the line probes on around a check and returns what they found (the shared
    /// file has no widget code, so the Watch audit leaves it unset).
    static var lineCheck: (start: () -> Void, finish: () -> [String]?)?

    static let types: [(String, DynamicTypeSize)] = [("default", .large), ("xxxl", .xxxLarge)]
    static var records: [Record] = []
    static let scale: CGFloat = 2
    static let pad: CGFloat = 40

    static var dir: String {
        let d = ProcessInfo.processInfo.environment["SNAPSHOT_DIR"] ?? (NSTemporaryDirectory() + "native-audit")
        try? FileManager.default.createDirectory(atPath: d, withIntermediateDirectories: true)
        return d
    }

    /// The pixels the view draws outside `box`, in points per side. The view is laid out in a box of exactly that
    /// size on a transparent canvas with room around it, so anything that does not fit shows up outside.
    @MainActor
    static func overflow<V: View>(_ v: V, box: CGSize) -> [Double] {
        let canvas = ZStack { v.frame(width: box.width, height: box.height) }
            .frame(width: box.width + 2 * pad, height: box.height + 2 * pad)
        let r = ImageRenderer(content: canvas)
        r.scale = scale
        guard let cg = r.cgImage else { return [-1, -1, -1, -1] }
        let w = cg.width, h = cg.height
        let px = UnsafeMutablePointer<UInt8>.allocate(capacity: w * h * 4)
        px.initialize(repeating: 0, count: w * h * 4)
        defer { px.deallocate() }
        guard let ctx = CGContext(data: px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return [-1, -1, -1, -1] }
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        // Box in pixels, with 1 pt of tolerance for anti-aliasing.
        let x0 = Int((pad - 1) * scale), y0 = Int((pad - 1) * scale)
        let x1 = Int((pad + box.width + 1) * scale), y1 = Int((pad + box.height + 1) * scale)
        var top = 0, left = 0, bottom = 0, right = 0
        for y in 0..<h {
            for x in 0..<w {
                if x >= x0 && x < x1 && y >= y0 && y < y1 { continue }
                if px[(y * w + x) * 4 + 3] < 48 { continue }
                // CGContext rows start at the bottom.
                let yy = h - 1 - y
                if yy < y0 { top = max(top, y0 - yy) }
                if yy >= y1 { bottom = max(bottom, yy - y1 + 1) }
                if x < x0 { left = max(left, x0 - x) }
                if x >= x1 { right = max(right, x - x1 + 1) }
            }
        }
        return [top, left, bottom, right].map { (Double($0) / Double(scale) * 10).rounded() / 10 }
    }

    static func savePNG(_ cg: CGImage, _ name: String) {
        let url = URL(fileURLWithPath: dir).appendingPathComponent(name + ".png")
        guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { return }
        CGImageDestinationAddImage(dest, cg, nil)
        CGImageDestinationFinalize(dest)
    }

    /// Checks one view and saves how it looks on the device (cut to the container, as the system does).
    @MainActor
    @discardableResult
    static func shot<V: View, P: View>(_ v: V, surface: String, scenario: String, device: String, type: (String, DynamicTypeSize),
                                       scheme: ColorScheme, box: CGSize, picture: P) -> Record {
        let typed = v.environment(\.dynamicTypeSize, type.1).environment(\.colorScheme, scheme)
            .environment(\.timeZone, TimeZone(identifier: "Australia/Sydney")!)
            .environment(\.locale, Locale(identifier: "en_AU"))
        lineCheck?.start()
        let o = overflow(typed, box: box)
        let lines = lineCheck?.finish() ?? nil
        let fits = o.allSatisfy { $0 >= 0 && $0 <= 0.5 }
        let s = scheme == .dark ? "dark" : "light"
        let name = "\(surface)__\(scenario)__\(device)__\(type.0)__\(s)"
        let r = ImageRenderer(content: picture.environment(\.dynamicTypeSize, type.1).environment(\.colorScheme, scheme)
            .environment(\.timeZone, TimeZone(identifier: "Australia/Sydney")!).environment(\.locale, Locale(identifier: "en_AU")))
        r.scale = scale
        if let cg = r.cgImage { savePNG(cg, name) }
        let rec = Record(surface: surface, scenario: scenario, device: device, type: type.0, scheme: s,
                         box: [Double(box.width), Double(box.height)], overflow: o, fits: fits, file: name + ".png", lines: lines)
        records.append(rec)
        return rec
    }

    static func writeManifest(_ file: String) {
        let enc = JSONEncoder()
        let lines = records.compactMap { try? enc.encode($0) }.compactMap { String(data: $0, encoding: .utf8) }
        try? (lines.joined(separator: "\n") + "\n").write(to: URL(fileURLWithPath: dir).appendingPathComponent(file), atomically: true, encoding: .utf8)
        let bad = records.filter { !$0.fits }
        print("native audit: \(records.count) shots, \(bad.count) do not fit")
        for b in bad { print("DOES NOT FIT \(b.file) overflow t/l/b/r \(b.overflow)") }
        let cut = records.filter { !($0.lines ?? []).isEmpty }
        print("native audit line check: \(records.filter { $0.lines != nil }.count) shots with probed countdowns or stop names, \(cut.count) with a countdown or stop name on too many lines or cut")
        for c in cut { print("WRAPS OR CUT \(c.file): " + (c.lines ?? []).joined(separator: "; ")) }
    }
}

/// A Home Screen or Lock Screen widget as it looks on the phone: the container, the content margins, and
/// the content cut to the container like the system does.
struct WidgetFrame<V: View>: View {
    var content: V
    var size: CGSize
    var margin: CGFloat
    var corner: CGFloat
    var fill: Color
    var wallpaper: Color
    var body: some View {
        ZStack {
            content.frame(width: size.width - 2 * margin, height: size.height - 2 * margin)
        }
        .frame(width: size.width, height: size.height)
        .background(fill)
        .clipShape(RoundedRectangle(cornerRadius: corner, style: .continuous))
        .padding(16)
        .background(wallpaper)
    }
}
