import XCTest
import WidgetKit

/// Widget refresh logic (30 Oct, build 210; Bidur: widgets only changed after the app was opened). Runs with the
/// native audit on the simulator: no network, no rendering, only the timeline and reload rules the widgets use.
final class WidgetRefreshLogicTests: XCTestCase {
    /// 3:34:30 pm Sydney, Friday 30 Oct 2026 (a weekday peak).
    static let now: Date = {
        var c = DateComponents(); c.year = 2026; c.month = 10; c.day = 30; c.hour = 15; c.minute = 34; c.second = 30
        var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "Australia/Sydney")!
        return cal.date(from: c)!
    }()

    func testTimelineReachesAnHourWithAnEntryAMinute() {
        let e = WidgetText.entryDates(updated: Self.now, departures: [Self.now.addingTimeInterval(95)])
        XCTAssertEqual(e.first, Self.now)
        XCTAssertGreaterThanOrEqual(e.last!.timeIntervalSince(Self.now), 59 * 60)
        XCTAssertTrue(e.contains(Self.now.addingTimeInterval(95)), "an entry the moment a service leaves")
        XCTAssertEqual(e.count, 61)
    }

    func testReloadIsSpentByTheTimeOfDay() {
        let many = (1...6).map { Self.now.addingTimeInterval(Double($0) * 600) }
        XCTAssertEqual(WidgetText.reloadDate(updated: Self.now, departures: many).timeIntervalSince(Self.now), 15 * 60)
        XCTAssertEqual(WidgetText.reloadDate(updated: Self.now, departures: many, failed: true).timeIntervalSince(Self.now), 15 * 60)
        let night = Self.now.addingTimeInterval(-(15 * 3600 + 34 * 60 + 30) + 2 * 3600) // 2am the same day
        XCTAssertEqual(WidgetRefresh.band(at: night), .night)
        XCTAssertGreaterThanOrEqual(WidgetRefresh.next(updated: night, departures: []).timeIntervalSince(night), 50 * 60)
        XCTAssertLessThanOrEqual(WidgetRefresh.asksPerDay(from: night), 70, "inside WidgetKit's daily budget")
    }

    func testNextTripEntriesNeverShowAServiceThatLeft() {
        let lines = [TripLine(line: "T1", colorHex: "#F99D1C", mode: "train", leave: Self.now.addingTimeInterval(300),
                              arrive: Self.now.addingTimeInterval(2000), isLive: true, status: "On time", platform: "1")]
        var e = NextTripEntry(date: Self.now, title: "Home", from: "A", to: "B", trips: lines, message: nil, updated: Self.now)
        e.dataAt = Self.now
        let entries = NextTripProvider.entries(from: e)
        XCTAssertGreaterThanOrEqual(entries.count, 60)
        for x in entries where x.date >= Self.now.addingTimeInterval(300) { XCTAssertTrue(x.trips.isEmpty) }
        // Past the app's live rule the time is no longer called live.
        XCTAssertTrue(entries.filter { $0.date > Self.now.addingTimeInterval(130) && $0.date < Self.now.addingTimeInterval(300) }
            .allSatisfy { $0.trips.allSatisfy { !$0.isLive } })
    }

    func testOfflineBoardShowsTimetableTimesNeverLive() {
        let rows = [BoardRow(line: "T4", colorHex: "#005AA3", mode: "train", dest: "Cronulla", time: Self.now.addingTimeInterval(400),
                             isLive: true, status: "2 min late", platform: "Platform 2", timetable: Self.now.addingTimeInterval(280),
                             liveAt: Self.now.addingTimeInterval(-900)),
                    BoardRow(line: "T4", colorHex: "#005AA3", mode: "train", dest: "Cronulla", time: Self.now.addingTimeInterval(-60),
                             isLive: false, status: "Scheduled", platform: nil)]
        let off = BoardCache.offline(rows, at: Self.now)
        XCTAssertEqual(off.count, 1, "a service that left is dropped")
        XCTAssertFalse(off[0].isLive)
        XCTAssertEqual(off[0].time, Self.now.addingTimeInterval(280), "timetable time, not the old live one")
        XCTAssertNil(off[0].liveAt)
    }
}
