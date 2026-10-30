import XCTest
import SwiftUI
import UIKit
import WidgetKit

/// Every iPhone widget the app ships, in every family it supports, on the smallest iPhone (SE), a standard
/// 6.1 inch and the largest Pro Max, at the default and the largest common text size, light and dark, with
/// realistic long data. Sizes are Apple's published widget sizes in points (Human Interface Guidelines).
@MainActor
final class WidgetAuditTests: XCTestCase {
    struct Phone {
        let name: String; let small: CGFloat; let medium: CGSize; let large: CGSize
        let rect: CGSize; let circ: CGFloat; let inline: CGSize
    }
    static let phones = [
        Phone(name: "se", small: 148, medium: CGSize(width: 321, height: 148), large: CGSize(width: 321, height: 324),
              rect: CGSize(width: 153, height: 69), circ: 68, inline: CGSize(width: 220, height: 26)),
        Phone(name: "std", small: 158, medium: CGSize(width: 338, height: 158), large: CGSize(width: 338, height: 354),
              rect: CGSize(width: 160, height: 72), circ: 72, inline: CGSize(width: 234, height: 26)),
        Phone(name: "promax", small: 170, medium: CGSize(width: 364, height: 170), large: CGSize(width: 364, height: 382),
              rect: CGSize(width: 172, height: 76), circ: 76, inline: CGSize(width: 248, height: 26)),
    ]
    static let margin: CGFloat = 16

    /// 3:34:30 pm Sydney, 30 Oct 2026.
    static let now: Date = {
        var c = DateComponents(); c.year = 2026; c.month = 10; c.day = 30; c.hour = 15; c.minute = 34; c.second = 30
        var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "Australia/Sydney")!
        return cal.date(from: c)!
    }()
    static func at(_ min: Double) -> Date { now.addingTimeInterval(min * 60) }

    // MARK: Next trip data

    static func trip(_ line: String, _ hex: String, _ mode: String, leave: Double, live: Bool, status: String,
                     platform: String?, changes: Int = 0, walk: Double = 0) -> TripLine {
        TripLine(line: line, colorHex: hex, mode: mode, leave: at(leave), arrive: at(leave + 38), isLive: live, status: status,
                 platform: platform, changes: changes, stopID: "202210", board: walk > 0 ? at(leave + walk) : nil)
    }

    static func nextTrip(_ title: String, _ from: String, _ to: String, _ trips: [TripLine], message: String? = nil,
                         notice: WidgetNotice? = nil, commute: Bool = true, live: Bool = false, ago: String? = nil) -> NextTripEntry {
        NextTripEntry(date: now, title: title, from: from, to: to, trips: trips, message: message, fromID: "202210", toID: "215020",
                      notice: notice, updated: at(-1), relevance: nil, commute: commute, live: live, dataAt: nil, ago: ago)
    }

    static let nextScenarios: [(String, NextTripEntry)] = [
        ("normal", nextTrip("To work", "Bondi Junction", "Parramatta", [
            trip("T4", "#005AA3", "train", leave: 9.5, live: true, status: "On time", platform: "Platform 1", changes: 1),
            trip("T4", "#005AA3", "train", leave: 19.5, live: true, status: "2 min late", platform: "Platform 1", changes: 1),
            trip("T4", "#005AA3", "train", leave: 29.5, live: false, status: "Scheduled", platform: "Platform 2", changes: 1),
            trip("T4", "#005AA3", "train", leave: 39.5, live: false, status: "Scheduled", platform: "Platform 1", changes: 1),
            trip("T4", "#005AA3", "train", leave: 49.5, live: false, status: "Scheduled", platform: "Platform 1", changes: 1)])),
        ("long", nextTrip("To Macquarie University", "Sydney Olympic Park", "Macquarie University", [
            trip("M1", "#168388", "metro", leave: 4.5, live: true, status: "12 min late", platform: "Platform 23", changes: 3, walk: 8),
            trip("610X", "#00B5EF", "bus", leave: 16.5, live: true, status: "On time", platform: "Stand D", changes: 2, walk: 11),
            trip("T9", "#D11F2F", "train", leave: 27.5, live: false, status: "Scheduled", platform: "Platform 16", changes: 2, walk: 6),
            trip("F1", "#00774B", "ferry", leave: 41.5, live: true, status: "4 min late", platform: "Wharf 3", changes: 2),
            trip("L2", "#E4022D", "lightrail", leave: 75.5, live: false, status: "Scheduled", platform: nil, changes: 2)])),
        ("nolive", nextTrip("To home", "Parramatta", "Bondi Junction", [
            trip("T1", "#F99D1C", "train", leave: 9.5, live: false, status: "Scheduled", platform: "Platform 2"),
            trip("T1", "#F99D1C", "train", leave: 24.5, live: false, status: "Scheduled", platform: "Platform 2"),
            trip("T1", "#F99D1C", "train", leave: 39.5, live: false, status: "Scheduled", platform: "Platform 2")], ago: "Updated 7 min ago")),
        ("cancelled", nextTrip("To work", "Chatswood", "Martin Place", [
            trip("T1", "#F99D1C", "train", leave: 6.5, live: true, status: "Cancelled", platform: "Platform 4"),
            trip("M1", "#168388", "metro", leave: 8.5, live: true, status: "On time", platform: "Platform 1"),
            trip("T1", "#F99D1C", "train", leave: 21.5, live: true, status: "7 min late", platform: "Platform 4")],
            notice: WidgetNotice(text: "Trains are not running between Chatswood and Hornsby due to urgent track repairs. Buses replace trains.", level: .severe))),
        ("later", nextTrip("Gym", "Epping", "Hornsby", [
            trip("T9", "#D11F2F", "train", leave: 72.5, live: false, status: "Scheduled", platform: "Platform 3")],
            notice: WidgetNotice(text: "Trackwork this weekend: buses replace trains between Epping and Hornsby", level: .warning), commute: false)),
        ("live", nextTrip("Your trip", "Lakemba", "Circular Quay", [
            trip("T3", "#F15A22", "train", leave: 2.5, live: true, status: "On time", platform: "Platform 2", changes: 1)],
            notice: WidgetNotice(text: "Trip started", level: .info), live: true)),
        ("empty", nextTrip("To home", "Parramatta", "Bondi Junction", [], message: "Checking for the next one")),
    ]

    // MARK: Stop board data

    static func row(_ line: String, _ hex: String, _ mode: String, _ dest: String, _ min: Double, live: Bool, _ status: String, _ plat: String?) -> BoardRow {
        BoardRow(line: line, colorHex: hex, mode: mode, dest: dest, time: at(min), isLive: live, status: status, platform: plat)
    }

    static let boardScenarios: [(String, StopBoardEntry)] = [
        ("normal", StopBoardEntry(date: now, stopID: "200020", stopName: "Circular Quay", filter: nil, rows: [
            row("T2", "#0098CD", "train", "Leppington", 1.5, live: true, "On time", "Platform 1"),
            row("F1", "#00774B", "ferry", "Manly", 3.5, live: true, "On time", "Wharf 3"),
            row("L2", "#E4022D", "lightrail", "Randwick", 4.5, live: true, "1 min late", nil),
            row("T3", "#F15A22", "train", "Liverpool", 6.5, live: false, "Scheduled", "Platform 2"),
            row("333", "#00B5EF", "bus", "Bondi Beach", 7.5, live: true, "On time", "Stand A"),
            row("F2", "#144734", "ferry", "Taronga Zoo", 9.5, live: false, "Scheduled", "Wharf 2"),
            row("T8", "#00954C", "train", "Macarthur", 11.5, live: true, "3 min late", "Platform 1"),
            row("L3", "#BE1622", "lightrail", "Juniors Kingsford", 12.5, live: true, "On time", nil),
            row("T2", "#0098CD", "train", "Parramatta", 15.5, live: false, "Scheduled", "Platform 1"),
            row("F4", "#5AB031", "ferry", "Pyrmont Bay", 18.5, live: false, "Scheduled", "Wharf 4")], message: nil, updated: at(-1))),
        ("long", StopBoardEntry(date: now, stopID: "213110", stopName: "Sydney Olympic Park Wharf", filter: "F3, T7, 525", rows: [
            row("T7", "#6F818E", "train", "Lidcombe via Olympic Park Loop", 0.5, live: true, "Cancelled", "Platform 1"),
            row("F3", "#648C3C", "ferry", "Circular Quay via Cockatoo Island and Balmain", 5.5, live: true, "12 min late", "Wharf 1"),
            row("525", "#00B5EF", "bus", "Rhodes via Homebush Bay Drive and Concord Hospital", 8.5, live: false, "Scheduled", "Stand F"),
            row("M52", "#00B5EF", "bus", "Parramatta via Victoria Road", 14.5, live: true, "On time", "Stand B"),
            row("T7", "#6F818E", "train", "Lidcombe", 20.5, live: false, "Scheduled", "Platform 1"),
            row("F3", "#648C3C", "ferry", "Parramatta", 64.5, live: false, "Scheduled", "Wharf 1"),
            row("525", "#00B5EF", "bus", "Parramatta", 66.5, live: false, "Scheduled", "Stand F"),
            row("M52", "#00B5EF", "bus", "Circular Quay", 70.5, live: false, "Scheduled", "Stand B")],
            message: nil, notice: WidgetNotice(text: "Ferries are not running between Sydney Olympic Park and Parramatta due to low tide", level: .severe),
            updated: at(-1), ago: "Updated 7 min ago")),
        ("empty", StopBoardEntry(date: now, stopID: "215020", stopName: "Parramatta", filter: "T1", rows: [], message: "No departures soon.", updated: at(-1))),
        ("choose", StopBoardEntry(date: now, stopID: "", stopName: "Stop board", filter: nil, rows: [],
                                  message: "Touch and hold, then Edit Widget to choose a stop.", updated: at(-1))),
    ]

    func families(_ p: Phone, kind: String) -> [(String, WidgetFamily, CGSize)] {
        var f: [(String, WidgetFamily, CGSize)] = [
            ("small", .systemSmall, CGSize(width: p.small, height: p.small)), ("medium", .systemMedium, p.medium),
            ("large", .systemLarge, p.large), ("rect", .accessoryRectangular, p.rect)]
        if kind == "nexttrip" {
            f.append(("circular", .accessoryCircular, CGSize(width: p.circ, height: p.circ)))
            f.append(("inline", .accessoryInline, p.inline))
        }
        return f
    }

    static func isAccessory(_ f: WidgetFamily) -> Bool { f == .accessoryRectangular || f == .accessoryCircular || f == .accessoryInline }

    func render<V: View>(_ v: V, surface: String, scenario: String, phone: Phone, fam: WidgetFamily, size: CGSize) {
        let acc = Self.isAccessory(fam)
        let m: CGFloat = acc ? 0 : Self.margin
        let inner = CGSize(width: size.width - 2 * m, height: size.height - 2 * m)
        for t in Audit.types {
            for scheme in [ColorScheme.light, .dark] {
                let fill: Color = acc ? Color.white.opacity(0.18) : (scheme == .dark ? Color(white: 0.17) : Color(white: 0.96))
                let wall: Color = acc ? Color(red: 0.12, green: 0.2, blue: 0.35) : (scheme == .dark ? .black : Color(red: 0.55, green: 0.65, blue: 0.8))
                // The Lock Screen draws accessory widgets in white on the wallpaper.
                let content = acc ? AnyView(v.environment(\.colorScheme, .dark).foregroundStyle(.white)) : AnyView(v)
                Audit.shot(content, surface: surface, scenario: scenario, device: phone.name, type: t, scheme: scheme, box: inner,
                           picture: WidgetFrame(content: content, size: size, margin: m,
                                                corner: fam == .accessoryCircular ? size.width / 2 : (acc ? 10 : 22),
                                                fill: fam == .accessoryInline ? .clear : fill, wallpaper: wall))
            }
        }
    }

    func testEveryWidgetEveryFamily() throws {
        for p in Self.phones {
            for (fname, fam, size) in families(p, kind: "nexttrip") {
                for (sname, e) in Self.nextScenarios {
                    render(NextTripView(entry: e, familyOverride: fam, standByOverride: false),
                           surface: "nexttrip-\(fname)", scenario: sname, phone: p, fam: fam, size: size)
                }
            }
            // StandBy on a charger shows the small widget without its background.
            for (sname, e) in Self.nextScenarios {
                render(NextTripView(entry: e, familyOverride: .systemSmall, standByOverride: true),
                       surface: "nexttrip-standby", scenario: sname, phone: p, fam: .systemSmall, size: CGSize(width: p.small, height: p.small))
            }
            for (fname, fam, size) in families(p, kind: "stopboard") {
                for (sname, e) in Self.boardScenarios {
                    render(StopBoardView(entry: e, familyOverride: fam),
                           surface: "stopboard-\(fname)", scenario: sname, phone: p, fam: fam, size: size)
                }
            }
        }
        LiveActivityAudit.run()
        Audit.writeManifest("manifest-ios.jsonl")
        let bad = Audit.records.filter { !$0.fits }
        XCTAssertTrue(bad.isEmpty, "Does not fit:\n" + bad.map { "\($0.file) \($0.overflow)" }.joined(separator: "\n"))
    }
}
