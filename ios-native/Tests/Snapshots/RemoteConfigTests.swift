import XCTest
import Foundation
import TransportKit

/// The server config can hide or pause features, change copy, timings and the tab order, and a
/// bad or missing value falls back to the built in default.
final class RemoteConfigTests: XCTestCase {
    func decode(_ s: String) throws -> RemoteConfig {
        try JSONDecoder().decode(RemoteConfig.self, from: Data(s.utf8))
    }

    func testEmptyIsDefaults() throws {
        XCTAssertEqual(try decode("{}"), RemoteConfig.defaults)
        XCTAssertTrue(RemoteConfig.defaults.isOn("liveTrip"))
        XCTAssertEqual(RemoteConfig.defaults.tabOrder, ["home", "plan", "watching", "more"])
    }

    func testFlagsKillCopyAndTabs() throws {
        let c = try decode(#"{"flags":{"ask":false},"kill":{"liveTrip":"Paused for a moment"},"copy":{"welcomeTitle":"Hello","startTripFooter":" "},"tabs":["plan","nope","home"]}"#)
        XCTAssertFalse(c.isOn("ask"))
        XCTAssertTrue(c.isOn("parkRide"))
        XCTAssertFalse(c.isOn("liveTrip"))
        XCTAssertEqual(c.killMessage("liveTrip"), "Paused for a moment")
        XCTAssertEqual(c.text("welcomeTitle", "x"), "Hello")
        XCTAssertEqual(c.text("startTripFooter", "Built in"), "Built in")
        XCTAssertEqual(c.tabOrder, ["plan", "home", "watching", "more"])
    }

    func testTimingsStayInBounds() throws {
        let c = try decode(#"{"timing":{"liveRefreshSec":1,"alertRepeatWindowMin":9999}}"#)
        XCTAssertEqual(c.number("liveRefreshSec", 15, min: 5, max: 120), 5)
        XCTAssertEqual(c.number("alertRepeatWindowMin", 15, min: 1, max: 120), 120)
        XCTAssertEqual(c.number("sameRunToleranceSec", 120, min: 30, max: 600), 120)
    }

    func testBadPartsAreIgnored() throws {
        let c = try decode(#"{"flags":[1,2],"tabs":"home","timing":{"liveRefreshSec":"fast"}}"#)
        XCTAssertEqual(c.flags, RemoteConfig.defaults.flags)
        XCTAssertEqual(c.tabOrder, RemoteConfig.defaults.tabOrder)
    }
}
