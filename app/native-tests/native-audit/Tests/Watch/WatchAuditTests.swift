import XCTest
import SwiftUI
import WidgetKit

/// Apple Watch: the watch app's screens (rows exactly as shipped, in the list layout the app uses) and every
/// complication family, on the smallest (40 mm SE), a standard (45 mm) and the largest (49 mm Ultra) watch, at
/// the default and the largest common text size. The watch is always dark. Screen and complication sizes are
/// Apple's published sizes in points.
@MainActor
final class WatchAuditTests: XCTestCase {
    struct Watch { let name: String; let screen: CGSize; let rect: CGSize; let circ: CGFloat; let inline: CGFloat; let corner: CGFloat }
    static let watches = [
        Watch(name: "40mm", screen: CGSize(width: 162, height: 197), rect: CGSize(width: 162, height: 69), circ: 42, inline: 150, corner: 32),
        Watch(name: "45mm", screen: CGSize(width: 198, height: 242), rect: CGSize(width: 184, height: 77), circ: 47, inline: 170, corner: 36),
        Watch(name: "49mm", screen: CGSize(width: 205, height: 251), rect: CGSize(width: 191, height: 81), circ: 50, inline: 180, corner: 38),
    ]

    /// 3:34:30 pm Sydney, 30 Oct 2026 (the rows take `now`; the complication countdowns read the real clock).
    static let now: Date = {
        var c = DateComponents(); c.year = 2026; c.month = 10; c.day = 30; c.hour = 15; c.minute = 34; c.second = 30
        var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "Australia/Sydney")!
        return cal.date(from: c)!
    }()
    static func at(_ m: Double) -> Date { now.addingTimeInterval(m * 60) }
    static func ms(_ m: Double) -> Double { at(m).timeIntervalSince1970 * 1000 }

    static func svc(_ line: String, _ hex: String, _ dest: String?, _ m: Double, plat: String?, live: Bool = true, cancelled: Bool = false) -> WService {
        WService(line: line, colorHex: hex, mode: "train", dest: dest, platform: plat, time: at(m), live: live, cancelled: cancelled, arrive: nil)
    }

    static func card(_ phase: String, line: String = "T9", off: String = "Macquarie University Station", next: String? = "Epping Station",
                     warning: String? = nil, plat: String? = "Platform 16", updated: Double? = -0.5) -> WLiveCard {
        WLiveCard(title: "To uni", line: line, lineColorHex: "#D11F2F", mode: "train", phase: phase, getOffAt: off, destination: off,
                  nextStop: next, stopsLeft: 4, platform: plat, towards: "Hornsby", warning: warning,
                  departs: ms(5.5), legArrives: ms(18.5), arrival: ms(42), until: ms(60), updated: updated.map { ms($0) })
    }

    /// One screen of the app: the title, then each section with its header and rows on the list's cell background.
    struct Screen: View {
        var title: String
        var sections: [(String?, [AnyView])]
        var body: some View {
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.headline).foregroundStyle(Color.accentColor).padding(.horizontal, 4)
                ForEach(Array(sections.enumerated()), id: \.offset) { _, s in
                    if let h = s.0 { Text(h).font(.footnote).foregroundStyle(.secondary).lineLimit(2).padding(.horizontal, 6) }
                    ForEach(Array(s.1.enumerated()), id: \.offset) { _, row in
                        row.padding(.horizontal, 10).padding(.vertical, 8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(white: 0.13), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                }
            }
        }
    }

    static func screens() -> [(String, Screen)] {
        let services = [svc("T1", "#F99D1C", "Emu Plains via Parramatta and Penrith", 4.5, plat: "Platform 2"),
                        svc("T9", "#D11F2F", "Hornsby", 12.5, plat: "Platform 16", cancelled: true),
                        svc("M1", "#168388", "Tallawong", 75.5, plat: "Platform 1", live: false)]
        return [
            ("home", Screen(title: "Transport", sections: [
                ("Trip", [AnyView(LiveTripRow(card: card("wait"), now: now))]),
                ("To work: Sydney Olympic Park to Macquarie University", services.map { AnyView(ServiceRow(service: $0, now: now)) }),
                ("Starred", [AnyView(StopRow(stop: WStop(id: "213110", name: "Sydney Olympic Park Wharf, Sydney Olympic Park"), next: services[0], now: now)),
                             AnyView(StopRow(stop: WStop(id: "215020", name: "Parramatta Station"), next: nil, now: now))]),
            ])),
            ("trip-ride", Screen(title: "Transport", sections: [
                ("Trip", [AnyView(LiveTripRow(card: card("ride", off: "Sydney Olympic Park Station", next: "Lidcombe Station",
                                                         warning: "You'll likely miss the 5:12pm T1 to Hornsby at Epping", updated: -12), now: now))]),
            ])),
            ("stop", Screen(title: "Sydney Olympic Park", sections: [
                (nil, services.map { AnyView(ServiceRow(service: $0, now: now)) } + [AnyView(Text("Updated 3:33pm").font(.footnote).foregroundStyle(.secondary))]),
            ])),
            ("nophone", Screen(title: "Transport", sections: [
                (nil, [AnyView(VStack(spacing: 8) {
                    Image(systemName: "iphone").font(.title2).foregroundStyle(.secondary)
                    Text("Open Transport on your iPhone to share Home, Work and your starred stops.").multilineTextAlignment(.center).font(.footnote)
                })]),
                ("Commute", [AnyView(Text("Set Home and Work in Transport on your iPhone.").font(.footnote).foregroundStyle(.secondary))]),
            ])),
        ]
    }

    static func entries() -> [(String, NextEntry)] {
        let n = Date()
        return [
            ("commute", NextEntry(date: n, kind: .commute, line: "T1", colorHex: "#F99D1C", target: n.addingTimeInterval(9.5 * 60), platform: "Platform 2",
                                  title: "To work", detail: "Sydney Olympic Park to Macquarie University")),
            ("live", NextEntry(date: n, kind: .live, line: "610X", colorHex: "#00B5EF", target: n.addingTimeInterval(14 * 60), platform: "Stand D",
                               title: "Off at Macquarie Centre", detail: "You'll likely miss the 5:12pm T1 at Epping")),
            ("later", NextEntry(date: n, kind: .commute, line: "M1", colorHex: "#168388", target: n.addingTimeInterval(75 * 60), platform: "Platform 1",
                                title: "To home", detail: "Updated 3:12pm")),
            ("empty", NextEntry(date: n, kind: .empty, title: "Set Home and Work", detail: "on your iPhone")),
        ]
    }

    func testWatchAppAndComplications() throws {
        for w in Self.watches {
            // The app's list: width is fixed by the screen, it scrolls down, so only the width can be cut off.
            for (name, screen) in Self.screens() {
                for t in Audit.types {
                    let width = w.screen.width - 8
                    let v = screen.frame(width: width).fixedSize(horizontal: false, vertical: true)
                    let typed = v.environment(\.dynamicTypeSize, t.1).environment(\.colorScheme, .dark)
                    let sizer = ImageRenderer(content: typed); sizer.scale = 1
                    let h = CGFloat(sizer.cgImage?.height ?? 400)
                    let box = CGSize(width: width, height: h)
                    let o = Audit.overflow(typed, box: box)
                    let side = [o[1], o[3]]
                    let fits = side.allSatisfy { $0 >= 0 && $0 <= 0.5 }
                    let file = "watch-app-\(name)__\(name)__\(w.name)__\(t.0)__dark"
                    let pic = v.padding(4).frame(width: w.screen.width).background(Color.black)
                        .environment(\.dynamicTypeSize, t.1).environment(\.colorScheme, .dark)
                    let r = ImageRenderer(content: pic); r.scale = Audit.scale
                    if let cg = r.cgImage { Audit.savePNG(cg, file) }
                    Audit.records.append(Audit.Record(surface: "watch-app-\(name)", scenario: name, device: w.name, type: t.0, scheme: "dark",
                                                      box: [Double(box.width), Double(box.height)], overflow: [0, side[0], 0, side[1]], fits: fits, file: file + ".png"))
                }
            }
            for (sname, e) in Self.entries() {
                let fams: [(String, WidgetFamily, CGSize, CGFloat)] = [
                    ("rect", .accessoryRectangular, w.rect, 10), ("circular", .accessoryCircular, CGSize(width: w.circ, height: w.circ), w.circ / 2),
                    ("inline", .accessoryInline, CGSize(width: w.inline, height: 20), 0), ("corner", .accessoryCorner, CGSize(width: w.corner, height: w.corner), w.corner / 2)]
                for (fname, fam, size, corner) in fams {
                    let v = NextView(entry: e, familyOverride: fam)
                    for t in Audit.types {
                        Audit.shot(v, surface: "watch-\(fname)", scenario: sname, device: w.name, type: t, scheme: .dark, box: size,
                                   picture: WidgetFrame(content: v, size: size, margin: 0, corner: corner,
                                                        fill: fam == .accessoryInline ? .clear : Color(white: 0.15), wallpaper: .black))
                    }
                }
            }
        }
        Audit.writeManifest("manifest-watch.jsonl")
        let bad = Audit.records.filter { !$0.fits }
        XCTAssertTrue(bad.isEmpty, "Does not fit:\n" + bad.map { "\($0.file) \($0.overflow)" }.joined(separator: "\n"))
    }
}
