import XCTest

/// Watch refresh logic (30 Oct, build 210; Bidur: the watch changed only after an app was opened).
final class WatchRefreshLogicTests: XCTestCase {
    static func sydney(_ y: Int, _ mo: Int, _ d: Int, _ h: Int, _ mi: Int) -> Date {
        var c = DateComponents(); c.year = y; c.month = mo; c.day = d; c.hour = h; c.minute = mi
        var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "Australia/Sydney")!
        return cal.date(from: c)!
    }

    func testBandsAndBudget() {
        XCTAssertEqual(WatchRefresh.band(at: Self.sydney(2026, 10, 30, 7, 15)), .busy)
        XCTAssertEqual(WatchRefresh.band(at: Self.sydney(2026, 10, 31, 7, 15)), .day, "Saturday has no peak")
        XCTAssertEqual(WatchRefresh.band(at: Self.sydney(2026, 10, 30, 2, 0)), .night)
        XCTAssertEqual(WatchRefresh.band(at: Self.sydney(2026, 10, 30, 22, 0)), .evening)
        var t = Self.sydney(2026, 10, 30, 0, 0), n = 0
        let end = t.addingTimeInterval(86_400)
        while t < end { t = WatchRefresh.next(t); n += 1 }
        XCTAssertLessThanOrEqual(n, 50, "inside watchOS's complication budget")
        let now = Self.sydney(2026, 10, 30, 12, 0)
        XCTAssertEqual(WatchRefresh.next(now, live: true).timeIntervalSince(now), 300)
        XCTAssertEqual(WatchRefresh.next(now, failed: true).timeIntervalSince(now), 900)
    }

    func testCommuteLoadsOnlyWhenKeptTimesAreOld() {
        let now = Self.sydney(2026, 10, 30, 8, 0)
        func svc(_ m: Double) -> WService {
            WService(line: "T1", colorHex: nil, mode: "train", dest: nil, platform: nil, time: now.addingTimeInterval(m * 60), live: true, cancelled: false, arrive: nil)
        }
        var s = WatchSnapshot()
        XCTAssertTrue(WatchRefresh.commuteStale(s, key: "a>b", now: now), "nothing kept")
        s.commuteKey = "a>b"; s.commute = [svc(3), svc(8), svc(13)]; s.commuteAt = now.addingTimeInterval(-60)
        XCTAssertFalse(WatchRefresh.commuteStale(s, key: "a>b", now: now), "loaded a minute ago")
        XCTAssertTrue(WatchRefresh.commuteStale(s, key: "b>a", now: now), "the commute turned round")
        s.commuteAt = now.addingTimeInterval(-300)
        XCTAssertTrue(WatchRefresh.commuteStale(s, key: "a>b", now: now), "5 minutes old")
    }
}
