import XCTest
import SwiftUI
import UIKit
import WidgetKit

/// Build 210: the medium trip widget on build 209 was cut off top and bottom (owner, 30 Oct). This renders the
/// trip widget in every family it supports, at the widget sizes of the smallest iPhone (SE), a mini, a 6.1 inch
/// and the largest Pro Max, at the default text size and at a larger one, and checks the content fits inside
/// the widget's margins. PNGs go to SNAPSHOT_DIR. The views are the ones the widget ships.
@MainActor
final class WidgetFitSnapshotTests: XCTestCase {
    struct Device { let name: String; let small: CGFloat; let medium: CGSize; let large: CGSize; let rect: CGSize }
    // Apple's published widget sizes in points (Human Interface Guidelines, Widgets).
    static let devices = [
        Device(name: "se", small: 148, medium: CGSize(width: 321, height: 148), large: CGSize(width: 321, height: 324), rect: CGSize(width: 153, height: 69)),
        Device(name: "mini", small: 155, medium: CGSize(width: 329, height: 155), large: CGSize(width: 329, height: 345), rect: CGSize(width: 157, height: 70)),
        Device(name: "61", small: 158, medium: CGSize(width: 338, height: 158), large: CGSize(width: 338, height: 354), rect: CGSize(width: 160, height: 72)),
        Device(name: "promax", small: 170, medium: CGSize(width: 364, height: 170), large: CGSize(width: 364, height: 382), rect: CGSize(width: 172, height: 76)),
    ]
    static let margin: CGFloat = 16

    /// Fixed clock so the minutes are stable: 3:34:30 pm Sydney, first service 3:44, second 3:54.
    static let now: Date = {
        var c = DateComponents(); c.year = 2026; c.month = 10; c.day = 30; c.hour = 15; c.minute = 34; c.second = 30
        var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "Australia/Sydney")!
        return cal.date(from: c)!
    }()

    static func trips(_ n: Int) -> [TripLine] {
        (0..<n).map { i in
            TripLine(line: "T4", colorHex: "#005AA3", mode: "train",
                     leave: now.addingTimeInterval(570 + Double(i) * 600), arrive: now.addingTimeInterval(1800 + Double(i) * 600),
                     isLive: i == 0, status: i == 0 ? "On time" : "Scheduled", platform: "Platform 1", changes: 1, stopID: "200070")
        }
    }

    static func entry(trips n: Int, notice: WidgetNotice? = nil, title: String = "To home") -> NextTripEntry {
        NextTripEntry(date: now, title: title, from: "Bondi Junction", to: "Parramatta", trips: trips(n), message: nil,
                      fromID: "202210", toID: "215010", notice: notice, updated: now, relevance: nil, commute: true,
                      live: false, dataAt: nil, ago: nil)
    }

    static let scenarios: [(String, NextTripEntry)] = [
        ("trip", entry(trips: 5)),
        ("notice", entry(trips: 5, notice: WidgetNotice(text: "T4 Eastern Suburbs Line: Trains run to a changed timetable this weekend", level: .warning))),
        ("one", entry(trips: 1)),
        ("empty", NextTripEntry(date: now, title: "To home", from: "Bondi Junction", to: "Parramatta", trips: [], message: "No trips soon",
                                fromID: "202210", toID: "215010", notice: nil, updated: now, relevance: nil, commute: true, live: false, dataAt: nil, ago: nil)),
    ]

    static let typeSizes: [(String, DynamicTypeSize)] = [("default", .large), ("xxxl", .xxxLarge)]

    var report: [String] = []

    func families(_ d: Device) -> [(String, WidgetFamily, CGSize)] {
        [("small", .systemSmall, CGSize(width: d.small, height: d.small)), ("medium", .systemMedium, d.medium),
         ("large", .systemLarge, d.large), ("rect", .accessoryRectangular, d.rect)]
    }

    func testTripWidgetFitsEveryFamilySizeAndTextSize() throws {
        var overflows: [String] = []
        for d in Self.devices {
            for (fname, fam, size) in families(d) {
                let m: CGFloat = fam == .accessoryRectangular ? 0 : Self.margin
                let inner = CGSize(width: size.width - 2 * m, height: size.height - 2 * m)
                for (sname, e) in Self.scenarios {
                    if sname != "trip" && d.name != "61" && d.name != "se" { continue }
                    for (tname, ts) in Self.typeSizes {
                        let v = NextTripView(entry: e, familyOverride: fam, standByOverride: false)
                            .environment(\.dynamicTypeSize, ts)
                            .environment(\.timeZone, TimeZone(identifier: "Australia/Sydney")!)
                        let fitted = measure(v, in: inner)
                        let ok = fitted.height <= inner.height + 0.5 && fitted.width <= inner.width + 0.5
                        let line = "\(d.name) \(fname) \(sname) \(tname): box \(Int(inner.width))x\(Int(inner.height)), content \(Int(fitted.width.rounded()))x\(Int(fitted.height.rounded())) \(ok ? "fits" : "OVERFLOWS")"
                        report.append(line)
                        if !ok { overflows.append(line) }
                        let name = "trip-\(fname)-\(d.name)-\(sname)-\(tname)"
                        save(canvas(v, size: size, inner: inner, accessory: fam == .accessoryRectangular, scheme: .light), name)
                        if d.name == "61" && tname == "default" && sname == "trip" {
                            save(canvas(v, size: size, inner: inner, accessory: fam == .accessoryRectangular, scheme: .dark), name + "-dark")
                        }
                    }
                }
            }
        }
        writeReport()
        XCTAssertTrue(overflows.isEmpty, "Overflows:\n" + overflows.joined(separator: "\n"))
    }

    /// The minutes match the app: a 3:44 departure at 3:34:30 shows 9 min in both (whole minutes rounded down,
    /// lib/format.ts countdown); at 3:34:00 both show 10 min.
    func testMinutesRuleMatchesTheApp() {
        let leave = Self.now.addingTimeInterval(570)
        XCTAssertEqual(WidgetText.wait(leave, from: Self.now), "9 min")
        XCTAssertEqual(WidgetText.wait(leave, from: Self.now.addingTimeInterval(-30)), "10 min")
        XCTAssertEqual(WidgetText.wait(leave, from: leave.addingTimeInterval(-59)), "Now")
    }

    /// The size the view takes when offered the widget's inner box. Larger than the box means cut off.
    func measure<V: View>(_ v: V, in inner: CGSize) -> CGSize {
        let host = UIHostingController(rootView: v)
        host.sizingOptions = []
        return host.sizeThatFits(in: inner)
    }

    func canvas<V: View>(_ v: V, size: CGSize, inner: CGSize, accessory: Bool, scheme: ColorScheme) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: accessory ? 12 : 22, style: .continuous)
                .fill(accessory ? Color.gray.opacity(0.25) : (scheme == .dark ? Color(white: 0.17) : Color(white: 0.95)))
            v.frame(width: inner.width, height: inner.height)
        }
        .frame(width: size.width, height: size.height)
        .padding(24)
        .background(scheme == .dark ? Color.black : Color(red: 0.55, green: 0.65, blue: 0.8))
        .environment(\.colorScheme, scheme)
    }

    func save<V: View>(_ v: V, _ name: String) {
        let r = ImageRenderer(content: v)
        r.scale = 3
        guard let img = r.uiImage, let data = img.pngData() else { XCTFail("no image for \(name)"); return }
        let dir = ProcessInfo.processInfo.environment["SNAPSHOT_DIR"] ?? NSTemporaryDirectory()
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        try? data.write(to: URL(fileURLWithPath: dir).appendingPathComponent(name + ".png"))
    }

    func writeReport() {
        let dir = ProcessInfo.processInfo.environment["SNAPSHOT_DIR"] ?? NSTemporaryDirectory()
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        try? (report.joined(separator: "\n") + "\n").write(to: URL(fileURLWithPath: dir).appendingPathComponent("fit-report.txt"), atomically: true, encoding: .utf8)
        print(report.joined(separator: "\n"))
    }
}
