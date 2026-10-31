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

    // MARK: Build 212: the Your trip widget follows the whole trip (TripMoments, G4, G5, G28)

    static func card(phase: String, departs: TimeInterval?, legArrives: TimeInterval, updated: TimeInterval = 0,
                     delay: Int? = 4, warning: String? = nil) -> SharedLiveCard {
        let ms = { (t: TimeInterval) in (now.timeIntervalSince1970 + t) * 1000 }
        return SharedLiveCard(title: "Your trip", line: "T9", lineColorHex: "#D11F2F", mode: "train", phase: phase,
                              getOffAt: "Hornsby Station", destination: "Hornsby Station", nextStop: "Gordon Station",
                              platform: "Platform 2", departs: departs.map(ms), legArrives: ms(legArrives),
                              arrival: ms(legArrives), until: ms(legArrives + 120), updated: ms(updated),
                              warning: warning, delayMin: delay, departsLive: true, legArrivesLive: true)
    }

    func testTripMomentsRunFromWaitingToArrivedInOrder() {
        let m = TripMoments.list(phase: "wait", departs: Self.now.addingTimeInterval(240),
                                 legArrives: Self.now.addingTimeInterval(1200), arrival: Self.now.addingTimeInterval(1200), now: Self.now)
        XCTAssertEqual(m.map(\.kind), [.wait, .due, .ride, .next, .getOff, .arrived])
        XCTAssertEqual(m[1].at, Self.now.addingTimeInterval(180), "Due a minute before the live departure")
        XCTAssertEqual(m[4].at, Self.now.addingTimeInterval(1170), "Get off now 30 s before the live arrival")
        for (a, b) in zip(m, m.dropFirst()) { XCTAssertLessThan(a.at, b.at) }
    }

    func testTripMomentsPastTheDepartureShowDueNeverZero() {
        let m = TripMoments.list(phase: "wait", departs: Self.now.addingTimeInterval(-20),
                                 legArrives: Self.now.addingTimeInterval(900), arrival: Self.now.addingTimeInterval(900), now: Self.now)
        XCTAssertEqual(m.first?.kind, .due)
        XCTAssertNil(m.first?.target, "Due is a word, not a countdown")
    }

    func testLiveTimelineHasNoCheckingNoTripStartedAndKeepsARowToTheEnd() {
        let c = Self.card(phase: "wait", departs: 240, legArrives: 1200)
        let es = NextTripProvider.liveEntries(c, now: Self.now)
        XCTAssertGreaterThan(es.count, 5)
        for e in es {
            XCTAssertEqual(e.trips.count, 1, "a ride row the whole trip")
            XCTAssertNil(e.message)
            XCTAssertFalse((e.trips[0].status).contains("Checking"))
            XCTAssertFalse((e.notice?.text ?? "").contains("Trip started"))
        }
        XCTAssertEqual(es.first?.trips.first?.status, "4 min late", "the delay is on the row (G28)")
        XCTAssertTrue(es.contains { $0.trips[0].status.hasPrefix("Due now") })
        XCTAssertTrue(es.contains { $0.trips[0].status == "Get off now" })
        XCTAssertTrue(es.last?.trips[0].status.hasPrefix("Arrived") ?? false)
        for (a, b) in zip(es, es.dropFirst()) { XCTAssertLessThan(a.date, b.date) }
    }

    func testLiveTimelineSaysAboutThenNoLiveData() {
        let c = Self.card(phase: "ride", departs: nil, legArrives: 1500, updated: -400)
        let e = NextTripProvider.liveEntry(c, now: Self.now)
        XCTAssertEqual(e.ago?.hasPrefix("No live data since"), true)
        XCTAssertFalse(e.trips[0].isLive)
    }
}
