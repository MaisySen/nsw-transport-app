import XCTest

/// One first time user, start to finish, with a screenshot of every screen in order: first launch,
/// Plan, a stop search for Central, its departures and lift status, star it, plan Strathfield to
/// Central, a trip, Start trip, Share trip, End trip, save the trip, Home with the saved trip and
/// starred stop, Watching, More, Ask, Settings and About. It cleans up what it saved at the end.
/// Run it alone with: -only-testing:TransportUITests/FullJourneyTests
final class FullJourneyTests: XCTestCase {
    private var app: XCUIApplication!
    private var counter = 0

    override func setUp() {
        continueAfterFailure = true
        app = XCUIApplication()
        app.launchArguments = ["-apiProfile", "uitest", "-uiTestReset", "YES"]
        addUIInterruptionMonitor(withDescription: "System alert") { alert in
            for label in ["Allow", "Allow While Using App", "OK"] where alert.buttons[label].exists {
                alert.buttons[label].tap()
                return true
            }
            return false
        }
    }

    func testFullJourney() {
        app.launch()
        // The welcome shows while nothing is saved; a trip left on the test profile hides it.
        _ = element("welcome").waitForExistence(timeout: 15)
        pause(2)
        shot("first-launch")

        // Plan: the one search.
        if element("welcomePlan").exists { element("welcomePlan").tap() } else { tab("Plan") }
        XCTAssertTrue(element("planTrip").waitForExistence(timeout: 10), "Plan tab")
        shot("plan-tab")
        let field = app.searchFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), "search field on Plan")
        field.tap()
        field.typeText("Central")
        let result = element("stopResult")
        XCTAssertTrue(result.waitForExistence(timeout: 20), "results for Central")
        pause(1)
        shot("search-central")

        result.tap()
        XCTAssertTrue(element("departure").waitForExistence(timeout: 25), "departures at Central")
        pause(2)
        shot("stop-departures")
        let star = app.navigationBars.buttons["Star stop"].firstMatch
        XCTAssertTrue(star.waitForExistence(timeout: 5), "star button on the stop")
        star.tap()
        pause(1.5)
        shot("stop-starred")
        let list = app.collectionViews.firstMatch
        let access = app.staticTexts["Access and facilities"].firstMatch
        for _ in 0..<8 where !access.exists {
            list.swipeUp()
            pause(0.6)
        }
        pause(1)
        shot("stop-alerts-and-lifts")

        // Back to Plan and plan a trip.
        app.navigationBars.buttons.firstMatch.tap()
        pause(1)
        let cancel = app.buttons["Cancel"].firstMatch
        if cancel.exists && cancel.isHittable { cancel.tap(); pause(1) }
        let plan = element("planTrip")
        XCTAssertTrue(plan.waitForExistence(timeout: 10), "Plan a trip row")
        plan.tap()
        pause(1)
        shot("planner-empty")
        pick("fromField", "Strathfield", expect: "Strathfield Station")
        pick("toField", "Central", expect: "Central Station")
        let journey = element("journey")
        for _ in 0..<2 where !journey.waitForExistence(timeout: 30) {
            app.collectionViews.firstMatch.swipeDown(velocity: .slow)
        }
        XCTAssertTrue(journey.waitForExistence(timeout: 30), "trips from Strathfield to Central")
        pause(2)
        shot("planner-results")

        journey.tap()
        let start = element("startTrip")
        XCTAssertTrue(start.waitForExistence(timeout: 10), "trip details")
        pause(1)
        shot("trip-details")
        app.swipeUp()
        pause(1)
        shot("trip-details-bottom")
        for _ in 0..<4 where !(start.exists && start.isHittable) {
            app.swipeDown()
            pause(0.8)
        }

        // Start trip, Share trip, End trip.
        start.tap()
        allowSystemAlert()
        let end = element("endTrip")
        XCTAssertTrue(end.waitForExistence(timeout: 20), "live trip")
        pause(4)
        shot("live-trip")
        let share = element("shareTrip")
        if share.waitForExistence(timeout: 5) {
            share.tap()
            pause(3)
            shot("share-trip")
            let close = app.buttons["Close"].firstMatch
            if close.waitForExistence(timeout: 3) { close.tap() } else { app.swipeDown() }
            pause(1)
        } else {
            XCTFail("Share trip button")
        }
        if !end.isHittable {
            app.collectionViews.firstMatch.swipeUp()
            pause(1)
        }
        end.tap()
        let confirm = element("confirmEndTrip")
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), "End trip dialog")
        shot("end-trip-confirm")
        confirm.tap()
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: element("endTrip"))
        wait(for: [gone], timeout: 15)
        pause(1)
        shot("trip-ended")

        // Save the trip.
        let save = element("saveNamedTrip")
        for _ in 0..<4 where !(save.exists && save.isHittable) {
            app.swipeUp()
            pause(0.8)
        }
        XCTAssertTrue(save.waitForExistence(timeout: 5), "Save trip")
        save.tap()
        let alert = app.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 5), "Save trip name")
        let name = alert.textFields.firstMatch
        name.tap()
        name.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 12) + "journeytest")
        shot("save-trip-name")
        alert.buttons["Save"].tap()
        pause(2)

        // Home now shows the saved trip and the starred stop with live times.
        tab("Home")
        XCTAssertTrue(app.staticTexts["Journeytest"].firstMatch.waitForExistence(timeout: 20), "saved trip on Home")
        pause(4)
        shot("home-saved")
        app.swipeUp()
        pause(1)
        shot("home-saved-scrolled")
        app.swipeDown()

        tab("Watching")
        pause(2)
        shot("watching")

        tab("More")
        XCTAssertTrue(element("moreAsk").waitForExistence(timeout: 8), "More")
        shot("more")
        element("moreAsk").tap()
        let starter = element("askStarter")
        if starter.waitForExistence(timeout: 10) {
            shot("ask-start")
            starter.tap()
            _ = element("askReply").waitForExistence(timeout: 40)
            pause(2)
            shot("ask-answer")
        }
        app.navigationBars.buttons.firstMatch.tap()
        pause(1)
        element("moreSettings").tap()
        XCTAssertTrue(app.switches["Haptics"].firstMatch.waitForExistence(timeout: 8), "Settings")
        shot("settings")
        app.swipeUp()
        pause(1)
        shot("settings-bottom")
        app.navigationBars.buttons.firstMatch.tap()
        pause(1)
        element("moreAbout").tap()
        XCTAssertTrue(app.staticTexts["Fintex Australia Pty Ltd"].firstMatch.waitForExistence(timeout: 8), "About shows the publisher")
        shot("about")

        // Clean up: delete the saved trip and unstar Central.
        tab("Home")
        let saved = app.staticTexts["Journeytest"].firstMatch
        if saved.waitForExistence(timeout: 10) {
            let row = app.cells.containing(.staticText, identifier: "Journeytest").firstMatch
            (row.exists ? row : saved).swipeLeft()
            let delete = app.buttons["Delete"].firstMatch
            if delete.waitForExistence(timeout: 5) { delete.tap() }
            pause(2)
        }
        let starred = element("homeStop")
        if starred.waitForExistence(timeout: 5) {
            starred.swipeLeft()
            let unstar = app.buttons["Unstar"].firstMatch
            if unstar.waitForExistence(timeout: 3) { unstar.tap() }
            pause(1)
        }
    }

    // MARK: Helpers

    private func element(_ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func tab(_ name: String) {
        let inBar = app.tabBars.buttons[name].firstMatch
        if inBar.waitForExistence(timeout: 8) { inBar.tap() }
        pause(1)
        allowSystemAlert()
    }

    private func allowSystemAlert() {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let alert = springboard.alerts.firstMatch
        guard alert.waitForExistence(timeout: 1.5) else { return }
        for label in ["Allow", "Allow While Using App", "OK"] where alert.buttons[label].exists {
            alert.buttons[label].tap()
            pause(1)
            return
        }
    }

    private func pick(_ fieldID: String, _ query: String, expect: String) {
        let field = element(fieldID)
        XCTAssertTrue(field.waitForExistence(timeout: 10), fieldID)
        field.tap()
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 8), "picker search field")
        search.tap()
        search.typeText(query)
        let result = element("pickResult")
        XCTAssertTrue(result.waitForExistence(timeout: 20), "picker results for \(query)")
        let exact = app.buttons.matching(identifier: "pickResult").containing(.staticText, identifier: expect).firstMatch
        (exact.exists ? exact : result).tap()
        pause(1)
    }

    private func pause(_ s: TimeInterval) {
        Thread.sleep(forTimeInterval: s)
    }

    /// Saved as <theme>-jNN-<name>.png, so the journey sorts apart from the other flow shots.
    private func shot(_ name: String) {
        counter += 1
        let prefix = ProcessInfo.processInfo.environment["SHOT_PREFIX"] ?? "light"
        let file = String(format: "%@-j%02d-%@", prefix, counter, name)
        let image = XCUIScreen.main.screenshot()
        let a = XCTAttachment(screenshot: image)
        a.name = file
        a.lifetime = .keepAlways
        add(a)
        if let dir = ProcessInfo.processInfo.environment["SHOTS_DIR"] {
            try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            try? image.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent(file + ".png"))
        }
    }
}
