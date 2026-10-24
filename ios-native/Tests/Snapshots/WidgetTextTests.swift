import XCTest
import Foundation
import TransportKit

/// The widget words: minutes not a seconds timer, short platform and status words, one compact
/// alert line cut at a whole word, and a timeline that never shows a service that has left.
/// The same file runs on Linux in Tools/KitCheck.
final class WidgetTextTests: XCTestCase {
    let now = Date(timeIntervalSince1970: 1_793_000_000)

    func testWaitIsMinutesNeverASecondsTimer() {
        XCTAssertEqual(WidgetText.wait(now.addingTimeInterval(20), from: now), "Now")
        XCTAssertEqual(WidgetText.wait(now.addingTimeInterval(59), from: now), "Now")
        XCTAssertEqual(WidgetText.wait(now.addingTimeInterval(60), from: now), "1 min")
        XCTAssertEqual(WidgetText.wait(now.addingTimeInterval(13 * 60 + 40), from: now), "13 min")
        XCTAssertEqual(WidgetText.wait(now.addingTimeInterval(59 * 60 + 59), from: now), "59 min")
        for s in stride(from: 0.0, to: 7200, by: 37) {
            let w = WidgetText.wait(now.addingTimeInterval(s), from: now)
            XCTAssertNil(w.range(of: #"^\d{1,2}:\d{2}$"#, options: .regularExpression), "\(w) reads like a timer")
        }
    }

    func testPastAnHourShowsTheClockTime() {
        let w = WidgetText.wait(now.addingTimeInterval(3600), from: now)
        XCTAssertEqual(w, Clock.time(now.addingTimeInterval(3600)))
        XCTAssertTrue(w.hasSuffix("am") || w.hasSuffix("pm"))
    }

    func testPlatformAndStatusWords() {
        XCTAssertEqual(WidgetText.plat("Platform 1"), "Plat 1")
        XCTAssertEqual(WidgetText.plat("3"), "Plat 3")
        XCTAssertEqual(WidgetText.plat("Stand A"), "Stand A")
        XCTAssertNil(WidgetText.plat(""))
        XCTAssertEqual(WidgetText.status(isLive: false, status: "Scheduled"), "No live data")
        XCTAssertEqual(WidgetText.status(isLive: true, status: "On time"), "On time")
        XCTAssertEqual(WidgetText.status(isLive: false, status: "Cancelled"), "Cancelled")
        XCTAssertEqual(WidgetText.changes(0), nil)
        XCTAssertEqual(WidgetText.changes(1), "1 change")
        XCTAssertEqual(WidgetText.changes(2), "2 changes")
    }

    func testAlertIsOneShortLineCutAtAWord() {
        let t = "T1 Western Line: Trains run to a changed timetable between Penrith and Emu Plains"
        let short = WidgetText.compactAlert(t, maxChars: 40)
        XCTAssertTrue(short.hasPrefix("Trains run to a changed timetable"), short)
        XCTAssertLessThanOrEqual(short.count, 40)
        XCTAssertTrue(short.hasSuffix("\u{2026}"))
        let words = Set(t.split(separator: " ").map(String.init))
        for w in short.dropLast().split(separator: " ") { XCTAssertTrue(words.contains(String(w)), "\(w) was cut") }
        XCTAssertEqual(WidgetText.compactAlert("Lift out at Central", maxChars: 40), "Lift out at Central")
        XCTAssertFalse(WidgetText.compactAlert(t, maxChars: 24).contains("timeta\u{2026}"))
    }

    func testTitleIsTheSavedNameElseFromTo() {
        XCTAssertEqual(WidgetText.title(name: "Work", from: "Burwood", to: "Central"), "Work")
        XCTAssertEqual(WidgetText.title(name: "", from: "Strathfield", to: "Kings Cross"), "Strathfield to Kings Cross")
        XCTAssertEqual(WidgetText.title(name: "Kings Cross", from: "Strathfield", to: "Kings Cross"), "Strathfield to Kings Cross")
    }

    func testInlineLockScreenLine() {
        XCTAssertEqual(WidgetText.inline(line: "T1", leave: now.addingTimeInterval(4 * 60 + 10), platform: "Platform 2", now: now), "T1 4 min, Plat 2")
        XCTAssertEqual(WidgetText.inline(line: "M", leave: now.addingTimeInterval(30), platform: nil, now: now), "M Now")
    }

    func testTimelineHasAnEntryAtEachDepartureAndDropsDepartedServices() {
        let deps = [now.addingTimeInterval(90), now.addingTimeInterval(400), now.addingTimeInterval(4000)]
        let dates = WidgetText.entryDates(updated: now, departures: deps)
        XCTAssertTrue(dates.contains(deps[0]))
        XCTAssertTrue(dates.contains(deps[1]))
        XCTAssertEqual(dates, dates.sorted())
        for d in dates {
            let shown = WidgetText.upcoming(deps, at: d) { $0 }
            XCTAssertTrue(shown.allSatisfy { $0 > d }, "a service that left is on screen at \(d)")
        }
        XCTAssertEqual(WidgetText.upcoming(deps, at: deps[0]) { $0 }.count, 2, "gone the moment it leaves")
    }

    func testReloadsAtTheNextDepartureOrEveryFiveMinutes() {
        XCTAssertEqual(WidgetText.reloadDate(updated: now, departures: [now.addingTimeInterval(130)]), now.addingTimeInterval(130))
        XCTAssertEqual(WidgetText.reloadDate(updated: now, departures: [now.addingTimeInterval(900)]), now.addingTimeInterval(300))
        XCTAssertEqual(WidgetText.reloadDate(updated: now, departures: [now.addingTimeInterval(10)]), now.addingTimeInterval(60))
        XCTAssertEqual(WidgetText.reloadDate(updated: now, departures: []), now.addingTimeInterval(300))
    }

    func testRowLinksOpenThatTrip() {
        let u = WidgetText.tripURL(from: "213410", to: "200060", leave: now)
        XCTAssertEqual(u?.absoluteString, "nswtransport://trip/213410/200060?at=1793000000")
        XCTAssertEqual(WidgetText.alertsURL(from: "213410", to: "200060")?.absoluteString, "nswtransport://alerts/213410/200060")
    }
}
