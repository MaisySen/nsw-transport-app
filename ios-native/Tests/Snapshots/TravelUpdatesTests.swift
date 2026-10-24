import XCTest
import Foundation
import TransportKit

/// Travel updates replayed with a fake clock: each step is said once (Leave now, Board, Next stop,
/// Change, Arrived), nothing after arrival, and steps scheduled while the app sleeps are not said
/// again when it wakes. The same file runs on Linux in Tools/KitCheck.
final class TravelUpdatesTests: XCTestCase {
    static let t0: Double = 1_793_000_000

    static func leg(_ line: String, from: String, to: String, towards: String, dep: Double, arr: Double, plat: String, walk: Int? = nil) throws -> WatchLeg {
        var json = """
        {"mode":"train","line":"\(line)","tripId":"\(line)-\(Int(dep))","stopId":"1","toStopId":"2","from":"\(from) Station","to":"\(to) Station",
         "towards":"\(towards)","planned":\(dep),"arrPlanned":\(arr),"fromPlatform":"Platform \(plat)"
        """
        if let walk { json += ",\"walkBefore\":\(walk)" }
        json += "}"
        return try TransportAPI.makeDecoder().decode(WatchLeg.self, from: Data(json.utf8))
    }

    /// A live /api/service answer at `now`: stops `names` planned `gap` seconds apart from `start`,
    /// running `delay` seconds late, you board at `mine` and get off at `alight`.
    static func service(names: [String], start: Double, gap: Double, delay: Double, mine: Int, alight: Int, now: Double) throws -> ServiceResponse {
        var stops: [String] = []
        var next = names.count
        for (i, n) in names.enumerated() {
            let p = start + Double(i) * gap
            if next == names.count && p + delay > now { next = i }
            stops.append("{\"id\":\"s\(i)\",\"name\":\"\(n) Station\",\"planned\":\(p),\"estimated\":\(p + delay)}")
        }
        let json = "{\"tripId\":\"x\",\"live\":true,\"mineIndex\":\(mine),\"alightIndex\":\(alight),\"nextIndex\":\(next),\"stops\":[\(stops.joined(separator: ","))]}"
        return try TransportAPI.makeDecoder().decode(ServiceResponse.self, from: Data(json.utf8))
    }

    struct Replay {
        var said: [String] = []
        var titles: [String] = []
        var scheduledIDs: [String: Int] = [:]
        var afterArrival = 0
    }

    /// Runs the trip from 15 minutes before to 15 minutes after, refreshing every `every` seconds.
    /// `awake` says when the app is in front and refreshing.
    static func replay(record: LiveTripRecord, services: (Double) throws -> [ServiceResponse?], end: Double,
                       every: Double = 15, awake: (Double) -> Bool = { _ in true }) throws -> Replay {
        var ledger = TravelUpdateLedger()
        var r = Replay()
        var arrived = false
        var t = t0 - 900
        while t <= end + 900 {
            defer { t += every }
            guard awake(t) else { continue }
            let now = Date(timeIntervalSince1970: t)
            let svc = try services(t)
            let st = LiveTripLogic.compute(legs: record.legs, services: svc, now: now)
            let steps = TravelUpdates.steps(record: record, state: st, services: svc, now: now)
            let a = ledger.update(steps, now: now)
            if arrived { r.afterArrival += a.post.count + a.schedule.count; continue }
            for s in a.shown + a.post { r.said.append(s.key); r.titles.append(s.title) }
            for s in a.schedule { r.scheduledIDs[s.key, default: 0] += 1 }
            if st?.done == true { arrived = true }
        }
        return r
    }

    // Burwood to Strathfield, one stop on the T1: leaves at t0 from Platform 2, in 4 minutes later.
    func burwood(delay: Double = 0) throws -> (LiveTripRecord, (Double) throws -> [ServiceResponse?]) {
        let l = try Self.leg("T1", from: "Burwood", to: "Strathfield", towards: "Penrith", dep: Self.t0, arr: Self.t0 + 240, plat: "2")
        let rec = LiveTripRecord(title: "Burwood to Strathfield", from: StopRef(id: "213410", name: "Burwood Station"),
                                 to: StopRef(id: "213510", name: "Strathfield Station"), legs: [l], fare: nil,
                                 started: Date(timeIntervalSince1970: Self.t0 - 900))
        let names = ["Croydon", "Burwood", "Strathfield", "Lidcombe"]
        return (rec, { now in [try Self.service(names: names, start: Self.t0 - 240, gap: 240, delay: delay, mine: 1, alight: 2, now: now)] })
    }

    func testBurwoodToStrathfieldEachStepOnce() throws {
        let (rec, svc) = try burwood()
        let r = try Self.replay(record: rec, services: svc, end: Self.t0 + 240)
        XCTAssertEqual(r.said, ["leave", "board0", "next0", "arrived"])
        XCTAssertEqual(r.titles, ["Leave now", "Board the T1 to Penrith", "Next stop: Strathfield, get off", "You've arrived at Strathfield"])
        XCTAssertEqual(r.afterArrival, 0, "nothing after arrival")
    }

    func testBurwoodToStrathfieldLateAndEarly() throws {
        for delay in [180.0, -60.0] {
            let (rec, svc) = try burwood(delay: delay)
            let r = try Self.replay(record: rec, services: svc, end: Self.t0 + 240 + delay)
            XCTAssertEqual(r.said, ["leave", "board0", "next0", "arrived"], "delay \(delay)")
            XCTAssertEqual(r.afterArrival, 0)
        }
    }

    func testAppAsleepTheSystemSaysEachStepAndNothingRepeatsOnWake() throws {
        let (rec, svc) = try burwood()
        // Awake once at the start (schedules every step) and again 10 minutes after arrival.
        let r = try Self.replay(record: rec, services: svc, end: Self.t0 + 240,
                                awake: { t in t == Self.t0 - 900 || t == Self.t0 + 840 })
        XCTAssertEqual(Set(r.scheduledIDs.keys), ["leave", "board0", "next0", "arrived"])
        XCTAssertTrue(r.scheduledIDs.values.allSatisfy { $0 == 1 })
        XCTAssertEqual(r.said, ["arrived"], "the system showed every step while asleep; on wake only the record of Arrived, never a second alert")
    }

    func testMovedTimesKeepOneIdentifierPerStep() throws {
        let started = Date(timeIntervalSince1970: Self.t0)
        let ids = ["leave", "board0", "next0", "arrived"].map { TravelUpdateLedger.identifier(started: started, key: $0) }
        XCTAssertEqual(Set(ids).count, 4)
        XCTAssertEqual(ids[1], "trip-\(Int(Self.t0))-board0")
    }

    // Burwood to North Strathfield with a change at Strathfield: T1 then the T9.
    func testTripWithAChange() throws {
        let a = try Self.leg("T1", from: "Burwood", to: "Strathfield", towards: "Penrith", dep: Self.t0, arr: Self.t0 + 240, plat: "2")
        let b = try Self.leg("T9", from: "Strathfield", to: "North Strathfield", towards: "Hornsby", dep: Self.t0 + 600, arr: Self.t0 + 780, plat: "4")
        let rec = LiveTripRecord(title: "Burwood to North Strathfield", from: StopRef(id: "213410", name: "Burwood Station"),
                                 to: StopRef(id: "213710", name: "North Strathfield Station"), legs: [a, b], fare: nil,
                                 started: Date(timeIntervalSince1970: Self.t0 - 900))
        let svc: (Double) throws -> [ServiceResponse?] = { now in
            [try Self.service(names: ["Croydon", "Burwood", "Strathfield", "Lidcombe"], start: Self.t0 - 240, gap: 240, delay: 0, mine: 1, alight: 2, now: now),
             try Self.service(names: ["Homebush", "Strathfield", "North Strathfield", "Concord West"], start: Self.t0 + 420, gap: 180, delay: 0, mine: 1, alight: 2, now: now)]
        }
        let r = try Self.replay(record: rec, services: svc, end: Self.t0 + 780)
        XCTAssertEqual(r.said, ["leave", "board0", "next0", "change1", "next1", "arrived"])
        XCTAssertEqual(r.titles[2], "Next stop: Strathfield, change here")
        XCTAssertEqual(r.titles[3], "Change at Strathfield")
        XCTAssertEqual(r.titles[4], "Next stop: North Strathfield, get off")
        XCTAssertEqual(r.afterArrival, 0)
    }

    func testWalkFirstLeaveNowCountsTheWalk() throws {
        let l = try Self.leg("T1", from: "Burwood", to: "Strathfield", towards: "Penrith", dep: Self.t0, arr: Self.t0 + 240, plat: "2", walk: 8)
        let rec = LiveTripRecord(title: "x", from: StopRef(id: "a", name: "Home"), to: StopRef(id: "b", name: "Strathfield Station"),
                                 legs: [l], fare: nil, started: Date(timeIntervalSince1970: Self.t0 - 1800))
        let steps = TravelUpdates.steps(record: rec, state: nil, now: Date(timeIntervalSince1970: Self.t0 - 1800))
        let leave = try XCTUnwrap(steps.first { $0.key == "leave" })
        XCTAssertEqual(leave.at, Date(timeIntervalSince1970: Self.t0 - 600), "8 min walk plus 2 min")
        XCTAssertTrue(leave.body.hasPrefix("8 min walk to Burwood."))
        XCTAssertTrue(leave.body.contains("Plat 2"))
    }

    func testStartedLateSaysOnlyTheNewestStep() throws {
        var ledger = TravelUpdateLedger()
        let (rec, svc) = try burwood()
        // Started 1 minute after the train left: Leave now and Board are gone, Next stop is due.
        let now = Date(timeIntervalSince1970: Self.t0 + 60)
        let s = try svc(Self.t0 + 60)
        let st = LiveTripLogic.compute(legs: rec.legs, services: s, now: now)
        let a = ledger.update(TravelUpdates.steps(record: rec, state: st, services: s, now: now), now: now)
        XCTAssertEqual(a.post.map(\.key), ["next0"])
        XCTAssertEqual(Set(a.skipped), ["leave", "board0"])
    }

    func testEndTripTakesBackEverythingScheduled() throws {
        var ledger = TravelUpdateLedger()
        let (rec, svc) = try burwood()
        let now = Date(timeIntervalSince1970: Self.t0 - 900)
        let s = try svc(Self.t0 - 900)
        _ = ledger.update(TravelUpdates.steps(record: rec, state: LiveTripLogic.compute(legs: rec.legs, services: s, now: now), services: s, now: now), now: now)
        XCTAssertEqual(ledger.end(), ["arrived", "board0", "leave", "next0"])
        let later = Date(timeIntervalSince1970: Self.t0)
        XCTAssertEqual(ledger.update(TravelUpdates.steps(record: rec, state: nil, now: later), now: later), TravelUpdateLedger.Actions())
    }
}
