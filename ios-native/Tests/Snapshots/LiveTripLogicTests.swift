import XCTest
import Foundation
import TransportKit

/// The live trip must end at the destination, never roll on to the next train, and say each
/// alert once. These run with the snapshot tests on the simulator, and the same checks run on
/// Linux in Tools/KitCheck.
final class LiveTripLogicTests: XCTestCase {

    // Redfern to Kings Cross on the T4: the 9:41pm from Redfern, in at 9:50pm.
    static let t0: Double = 1_793_000_000   // any fixed moment; times below are offsets in seconds
    static func leg() throws -> WatchLeg {
        let json = """
        {"mode":"train","line":"T4","tripId":"T4-941","stopId":"2015133","toStopId":"2011121","from":"Redfern Station","to":"Kings Cross Station",
         "planned":\(t0),"arrPlanned":\(t0 + 540)}
        """
        return try TransportAPI.makeDecoder().decode(WatchLeg.self, from: Data(json.utf8))
    }
    /// A /api/service answer: boarding stop planned at `board`, alighting stop estimated at `arrive`,
    /// the vehicle's next stop at index `next` (0 Redfern, 1 Central, 2 Town Hall, 3 Martin Place, 4 Kings Cross, 5 Edgecliff).
    static func service(board: Double, arrive: Double, next: Int) throws -> ServiceResponse {
        let names = ["Redfern Station", "Central Station", "Town Hall Station", "Martin Place Station", "Kings Cross Station", "Edgecliff Station"]
        var stops: [String] = []
        for (i, n) in names.enumerated() {
            let p = board + Double(i) * 135
            let e = i == 4 ? arrive : p
            stops.append("{\"id\":\"s\(i)\",\"name\":\"\(n)\",\"planned\":\(p),\"estimated\":\(e)}")
        }
        let json = "{\"tripId\":\"x\",\"live\":true,\"mineIndex\":0,\"alightIndex\":4,\"nextIndex\":\(next),\"stops\":[\(stops.joined(separator: ","))]}"
        return try TransportAPI.makeDecoder().decode(ServiceResponse.self, from: Data(json.utf8))
    }

    func testEndsAtArrival() throws {
        let l = try Self.leg()
        let s = try Self.service(board: Self.t0, arrive: Self.t0 + 540, next: 5)
        let st = LiveTripLogic.compute(legs: [l], services: [s], now: Date(timeIntervalSince1970: Self.t0 + 560))
        XCTAssertEqual(st?.done, true, "past Kings Cross, the trip is done")
    }

    func testRidingBeforeArrival() throws {
        let l = try Self.leg()
        let s = try Self.service(board: Self.t0, arrive: Self.t0 + 540, next: 3)
        let st = LiveTripLogic.compute(legs: [l], services: [s], now: Date(timeIntervalSince1970: Self.t0 + 300))
        XCTAssertEqual(st?.done, false)
        XCTAssertEqual(st?.phase, "ride")
    }

    func testNoRolloverToTheNextTrain() throws {
        let l = try Self.leg()
        // After the 9:41 run ends the server answers with the 9:44, in at 9:53.
        let next = try Self.service(board: Self.t0 + 180, arrive: Self.t0 + 720, next: 0)
        XCTAssertFalse(LiveTripLogic.matches(next, leg: l), "a later run is not this leg")
        let st = LiveTripLogic.compute(legs: [l], services: [next], now: Date(timeIntervalSince1970: Self.t0 + 600))
        XCTAssertEqual(st?.done, true, "the trip ends instead of following the next train")
        XCTAssertEqual(st?.eta, Date(timeIntervalSince1970: Self.t0 + 540))
    }

    func testSameRunMatches() throws {
        let l = try Self.leg()
        let s = try Self.service(board: Self.t0, arrive: Self.t0 + 600, next: 2)
        XCTAssertTrue(LiveTripLogic.matches(s, leg: l))
    }

    func testAlertsOncePerMoment() {
        var d = NoticeDeduper()
        let now = Date(timeIntervalSince1970: Self.t0)
        XCTAssertTrue(d.shouldPost(title: "Arriving at Kings Cross Station in 2 min", now: now))
        XCTAssertFalse(d.shouldPost(title: "Arriving at Kings Cross Station in 2 min", now: now), "exact repeat")
        XCTAssertFalse(d.shouldPost(title: "Next stop: Kings Cross Station", now: now.addingTimeInterval(20)), "same moment, other words")
        XCTAssertFalse(d.shouldPost(title: "Next stop: Kings Cross (get off)", now: now.addingTimeInterval(30)), "the app's own words")
        XCTAssertTrue(d.shouldPost(title: "Change at Redfern Station in 2 min", now: now), "another stop is another moment")
        XCTAssertFalse(d.shouldPost(title: "Next stop: Redfern, change here", now: now))
        XCTAssertTrue(d.shouldPost(title: "Arriving at Kings Cross Station in 2 min", now: now.addingTimeInterval(16 * 60)), "a new trip later")
    }

    // MARK: One Lock Screen card

    @MainActor
    final class FakeHost: LiveCardHost {
        var cards: [String] = []
        var asked = 0
        var cardIDs: [String] { cards }
        func endCard(_ id: String) async { cards.removeAll { $0 == id } }
        func requestCard() throws -> String {
            asked += 1
            let id = "card\(asked)"
            cards.append(id)
            return id
        }
    }

    @MainActor
    func testStartingTwiceLeavesOneCard() async {
        let host = FakeHost()
        await LiveCardRule.startOne(on: host)
        await LiveCardRule.startOne(on: host)
        XCTAssertEqual(host.cards, ["card2"])
    }

    @MainActor
    func testStartEndsCardsLeftFromEarlierTrips() async {
        let host = FakeHost()
        host.cards = ["old trip", "followed service", "another"]
        await LiveCardRule.startOne(on: host)
        XCTAssertEqual(host.cards.count, 1)
    }

    @MainActor
    func testTrimLeavesOne() async {
        let host = FakeHost()
        host.cards = ["a", "b"]
        await LiveCardRule.trimToOne(on: host)
        XCTAssertEqual(host.cards, ["a"])
    }

    func testMinutesNotSeconds() {
        let now = Date(timeIntervalSince1970: Self.t0)
        XCTAssertEqual(LiveCardText.minutes(until: now.addingTimeInterval(26 * 60 + 21), now: now), "27 min")
        XCTAssertEqual(LiveCardText.minutes(until: now.addingTimeInterval(51), now: now), "1 min")
        XCTAssertEqual(LiveCardText.minutes(until: now.addingTimeInterval(-5), now: now), "Now")
        XCTAssertEqual(LiveCardText.place("Strathfield Station, Platform 2"), "Strathfield")
        XCTAssertEqual(LiveCardText.place("Kings Cross Station"), "Kings Cross")
    }

    // MARK: Map and arrival card

    /// Burwood to Strathfield on a T1 whose path runs from the city out to Penrith.
    static func t1Service() throws -> ServiceResponse {
        let stops = [("Central Station", -33.8832, 151.2070), ("Redfern Station", -33.8915, 151.1985),
                     ("Burwood Station", -33.8771, 151.1036), ("Strathfield Station", -33.8717, 151.0941),
                     ("Lidcombe Station", -33.8645, 151.0473), ("Parramatta Station", -33.8170, 151.0047),
                     ("Penrith Station", -33.7505, 150.6943)]
        let items = stops.enumerated().map { i, s in "{\"id\":\"s\(i)\",\"name\":\"\(s.0)\",\"lat\":\(s.1),\"lon\":\(s.2),\"planned\":\(t0 + Double(i) * 180)}" }
        // A dense path along the whole line, as the server sends it.
        var path: [String] = []
        for k in 0..<(stops.count - 1) {
            for f in stride(from: 0.0, to: 1.0, by: 0.1) {
                let a = stops[k], b = stops[k + 1]
                path.append("[\(a.1 + (b.1 - a.1) * f),\(a.2 + (b.2 - a.2) * f)]")
            }
        }
        path.append("[\(stops.last!.1),\(stops.last!.2)]")
        let json = "{\"tripId\":\"t1\",\"live\":true,\"mineIndex\":2,\"alightIndex\":3,\"nextIndex\":3,\"stops\":[\(items.joined(separator: ","))],\"path\":[\(path.joined(separator: ","))]}"
        return try TransportAPI.makeDecoder().decode(ServiceResponse.self, from: Data(json.utf8))
    }

    func testMapFramesOnlyTheRiddenStop() throws {
        let s = try Self.t1Service()
        let pts = LegMap.ridden(s)
        XCTAssertGreaterThan(pts.count, 1)
        let f = try XCTUnwrap(LegMap.frame(pts))
        let km = LegMap.km(latSpan: f.latSpan, lonSpan: f.lonSpan, at: f.center.lat)
        XCTAssertLessThan(km.ns, 5, "north to south span")
        XCTAssertLessThan(km.ew, 5, "east to west span")
        for (lat, lon) in [(-33.8771, 151.1036), (-33.8717, 151.0941)] {
            XCTAssertLessThanOrEqual(abs(lat - f.center.lat), f.latSpan / 2, "Burwood and Strathfield in frame")
            XCTAssertLessThanOrEqual(abs(lon - f.center.lon), f.lonSpan / 2, "Burwood and Strathfield in frame")
        }
        XCTAssertFalse(pts.contains { $0.lon < 151.0 }, "nothing drawn out towards Penrith")
    }

    func testCardSaysArrivedAtTheEnd() throws {
        let leg = try Self.leg()
        let done = LiveTripLogic.compute(legs: [leg], services: [nil], now: Date(timeIntervalSince1970: Self.t0 + 540 + 120))
        XCTAssertEqual(LiveCardText.phase(done), "arrived")
        let state = LiveTripAttributes.ContentState(line: "T4", lineColorHex: "#005AA3", mode: "train", nextStop: "Kings Cross", stopsLeft: 0,
                                                    getOffAt: "Kings Cross", arrival: Date(timeIntervalSince1970: Self.t0 + 540), phase: LiveCardText.phase(done),
                                                    warning: nil, progress: 1, destination: "Kings Cross")
        XCTAssertEqual(state.headline(), "You've arrived at Kings Cross")
        XCTAssertFalse(state.detail().contains("Next stop"))
        // Even before the app updates it, a card past its arrival time (stale) says arrived.
        var riding = state
        riding.phase = "ride"
        XCTAssertEqual(riding.headline(stale: true), "You've arrived at Kings Cross")
        XCTAssertEqual(riding.headline(stale: false), "Get off at Kings Cross")
    }
}
