import XCTest

/// Taps through every flow of the app on a simulator with live data and saves a screenshot
/// of each step. The tests run in name order and build on each other: the search test stars
/// Central and watches a service, the trip test saves a trip, so Home is not empty later.
/// They use the "uitest" profile on the backend, so nothing touches the real saved trips.
final class FlowTests: XCTestCase {
    private var app: XCUIApplication!
    private static var counter = 0

    override func setUp() {
        continueAfterFailure = true
        app = XCUIApplication()
        app.launchArguments = ["-apiProfile", "uitest"]
        addUIInterruptionMonitor(withDescription: "System alert") { alert in
            for label in ["Allow", "Allow While Using App", "OK"] where alert.buttons[label].exists {
                alert.buttons[label].tap()
                return true
            }
            return false
        }
    }

    // MARK: Flows

    func test01SearchStarAndBoard() {
        app.launchArguments += ["-uiTestReset", "YES"]
        app.launch()
        shot("home-first-launch")

        tab("Search")
        let near = app.buttons["Show stops near me"].firstMatch
        if near.waitForExistence(timeout: 5) && near.isHittable {
            near.tap()
            allowSystemAlert()
            pause(4)
            shot("search-nearby")
        }
        let field = app.searchFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), "search field")
        field.tap()
        field.typeText("Central")
        let result = element("stopResult")
        XCTAssertTrue(result.waitForExistence(timeout: 20), "search results for Central")
        XCTAssertTrue(app.staticTexts["Central Station"].firstMatch.exists, "Central Station in results")
        shot("search-central")

        result.swipeRight()
        let star = app.buttons["Star"].firstMatch
        XCTAssertTrue(star.waitForExistence(timeout: 5), "star swipe action")
        shot("search-swipe-star")
        star.tap()
        pause(1.5)
        shot("search-starred-banner")

        result.tap()
        let row = element("departure")
        XCTAssertTrue(row.waitForExistence(timeout: 25), "live departures at Central")
        pause(1)
        shot("stop-central-board")

        row.swipeLeft()
        let watch = app.buttons["Watch"].firstMatch
        XCTAssertTrue(watch.waitForExistence(timeout: 5), "watch swipe action")
        shot("stop-swipe-watch")
        watch.tap()
        allowSystemAlert()
        pause(2)
        shot("stop-watched-banner")
    }

    func test02LiveMapAndSheet() {
        app.launchArguments += ["-screen", "stop/200060"]
        app.launch()
        let row = element("departure")
        XCTAssertTrue(row.waitForExistence(timeout: 25), "departures at Central")
        row.tap()
        let sheet = element("serviceSheet")
        XCTAssertTrue(sheet.waitForExistence(timeout: 20), "service sheet over the map")
        pause(5)
        shot("live-map")

        let top = sheet.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.0)).withOffset(CGVector(dx: 0, dy: 12))
        let target = app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.06))
        top.press(forDuration: 0.1, thenDragTo: target)
        pause(1.5)
        shot("live-map-sheet-up")
        XCTAssertTrue(app.staticTexts["Stops"].firstMatch.exists || app.otherElements["Stops"].firstMatch.exists, "stops list in the sheet")
    }

    func test03PlanWatchAndSaveTrip() {
        app.launch()
        tab("Trips")
        let plan = app.navigationBars.buttons["Plan a trip"].firstMatch
        XCTAssertTrue(plan.waitForExistence(timeout: 10), "plan button on Home")
        plan.tap()
        shot("plan-empty")

        pick("fromField", "Burwood", expect: "Burwood Station")
        pick("toField", "Central", expect: "Central Station")
        let journey = element("journey")
        XCTAssertTrue(journey.waitForExistence(timeout: 30), "journeys from Burwood to Central")
        pause(1)
        shot("plan-burwood-central")

        journey.tap()
        let watchTrip = app.buttons["Watch trip"].firstMatch
        XCTAssertTrue(watchTrip.waitForExistence(timeout: 10), "journey detail")
        shot("trip-detail")
        watchTrip.tap()
        allowSystemAlert()
        pause(2)
        shot("trip-watched")

        let lock = app.buttons["Lock Screen"].firstMatch
        if lock.exists { lock.tap(); pause(1.5) }

        app.swipeUp()
        let save = app.buttons["Save as a named trip"].firstMatch
        XCTAssertTrue(save.waitForExistence(timeout: 5), "save trip button")
        shot("trip-detail-bottom")
        save.tap()
        let alert = app.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 5), "name alert")
        let name = alert.textFields.firstMatch
        name.tap()
        name.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 12) + "uitest")
        shot("trip-name-alert")
        alert.buttons["Save"].tap()
        pause(2)
    }

    func test04HomeWithSavedItems() {
        app.launch()
        tab("Trips")
        XCTAssertTrue(app.staticTexts["Uitest"].firstMatch.waitForExistence(timeout: 20), "saved trip on Home")
        pause(3)
        shot("home-filled")
        app.swipeUp()
        pause(1)
        shot("home-filled-scrolled")
        app.swipeDown()

        // Add home and Add work: the To work and To home trips then lead Home.
        if element("addHome").waitForExistence(timeout: 5) {
            pick("addHome", "Strathfield", expect: "Strathfield Station")
            pick("addWork", "Town Hall", expect: "Town Hall Station")
            pause(5)
            shot("home-places")
        }
        let toWork = app.staticTexts["To work"].firstMatch
        if toWork.waitForExistence(timeout: 10) {
            toWork.tap()
            let earlier = element("earlierServices")
            XCTAssertTrue(earlier.waitForExistence(timeout: 30), "Earlier services on the trip screen")
            pause(2)
            shot("trip-screen")
            let travel = app.buttons["Travel time"].firstMatch
            if travel.exists { travel.tap(); pause(1); shot("trip-travel-time") }
        }
    }

    func test05Watching() {
        app.launch()
        tab("Watching")
        pause(4)
        shot("watching")
        app.swipeUp()
        pause(1)
        shot("watching-scrolled")
    }

    func test06SettingsToggles() {
        app.launch()
        tab("Settings")
        let haptics = app.switches["Haptics"].firstMatch
        XCTAssertTrue(haptics.waitForExistence(timeout: 10), "haptics switch")
        shot("settings")
        let before = haptics.value as? String
        haptics.coordinate(withNormalizedOffset: CGVector(dx: 0.94, dy: 0.5)).tap()
        pause(0.8)
        XCTAssertNotEqual(before, haptics.value as? String, "haptics switch changed")
        shot("settings-haptics-off")
        haptics.coordinate(withNormalizedOffset: CGVector(dx: 0.94, dy: 0.5)).tap()

        let refresh = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Refresh every")).firstMatch
        if refresh.waitForExistence(timeout: 3) {
            refresh.tap()
            pause(0.8)
            shot("settings-refresh-menu")
            let thirty = app.buttons["30 seconds"].firstMatch
            if thirty.waitForExistence(timeout: 3) { thirty.tap() }
            pause(0.8)
            shot("settings-refresh-30")
        } else {
            XCTFail("refresh picker")
        }
        app.swipeUp()
        pause(0.8)
        shot("settings-bottom")
    }

    func test07DynamicIslandAndLockScreen() {
        app.launchArguments += ["-screen", "stop/200060"]
        app.launch()
        let first = element("departure")
        XCTAssertTrue(first.waitForExistence(timeout: 25), "departures")
        // A service a few minutes out, so the countdown is not already at zero.
        let rows = app.descendants(matching: .any).matching(identifier: "departure")
        let row = rows.count > 3 ? rows.element(boundBy: 3) : first
        row.press(forDuration: 1.2)
        let follow = app.buttons["Follow on Lock Screen"].firstMatch
        if follow.waitForExistence(timeout: 5) {
            shot("stop-context-menu")
            follow.tap()
        }
        pause(2)
        XCUIDevice.shared.press(.home)
        pause(3)
        shot("dynamic-island-home-screen")

        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let start = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.005))
        start.press(forDuration: 0.1, thenDragTo: springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.75)))
        pause(2.5)
        shot("lock-screen-live-activity")
        let allow = springboard.buttons["Allow"].firstMatch
        if allow.waitForExistence(timeout: 2) {
            allow.tap()
            pause(2)
            shot("lock-screen-live-activity-allowed")
        }
        springboard.swipeUp()
        pause(1)
    }

    /// Clean up: deletes the saved test trip from Home with its swipe action, and stops the
    /// first watch from the Watching tab with its swipe action.
    func test08SwipeToDeleteAndStop() {
        app.launch()
        tab("Trips")
        let saved = app.staticTexts["Uitest"].firstMatch
        if !saved.waitForExistence(timeout: 15) { app.swipeUp(); pause(1) }
        if saved.waitForExistence(timeout: 5) {
            let row = app.cells.containing(.staticText, identifier: "Uitest").firstMatch
            (row.exists ? row : saved).swipeLeft()
            let delete = app.buttons["Delete"].firstMatch
            XCTAssertTrue(delete.waitForExistence(timeout: 5), "delete swipe action on the saved trip")
            shot("home-swipe-delete")
            delete.tap()
            pause(2)
            XCTAssertFalse(app.staticTexts["Uitest"].firstMatch.exists, "saved trip removed")
        } else {
            XCTFail("saved trip on Home")
        }
        tab("Watching")
        // Only an active watch has the Stop action; one that already finished has none.
        let watch = element("activeWatch")
        if watch.waitForExistence(timeout: 8) {
            let cell = app.cells.containing(.any, identifier: "activeWatch").firstMatch
            (cell.exists ? cell : watch).swipeLeft()
            let stop = app.buttons["Stop"].firstMatch
            if !stop.waitForExistence(timeout: 3) {
                (cell.exists ? cell : watch).swipeLeft()
            }
            XCTAssertTrue(stop.waitForExistence(timeout: 5), "stop swipe action on a watch")
            shot("watching-swipe-stop")
            if stop.exists { stop.tap() }
            pause(2)
        }
    }

    /// The Ask tab: a starter question gets a live answer with cards.
    func test09Ask() {
        app.launch()
        tab("Ask")
        let clear = app.navigationBars.buttons["Clear"].firstMatch
        if clear.waitForExistence(timeout: 3) && clear.isEnabled { clear.tap(); pause(1) }
        let starter = element("askStarter")
        XCTAssertTrue(starter.waitForExistence(timeout: 10), "starter questions on Ask")
        shot("ask-start")
        starter.tap()
        let reply = element("askReply")
        XCTAssertTrue(reply.waitForExistence(timeout: 40), "a reply from Ask")
        pause(2)
        shot("ask-answer")
    }

    /// New trip by mode: Train A to Z with the side index, By distance and By map, then
    /// Confirm trip with an extended light rail leg, a second trip by stop search, the
    /// direct services toggle on the trip screen, and moving a trip up on Trips.
    func test10NewTripByModeConfirmAndReorder() {
        app.launch()
        tab("Trips")
        openNewTrip()
        XCTAssertTrue(element("mode-train").waitForExistence(timeout: 8), "mode picker")
        pause(1)
        shot("new-trip-modes")

        element("mode-train").tap()
        let indexB = element("index-B")
        XCTAssertTrue(indexB.waitForExistence(timeout: 30), "A to Z side index")
        indexB.tap()
        pause(1)
        XCTAssertTrue(app.buttons["Banksia"].firstMatch.waitForExistence(timeout: 5), "B stations after jumping to B")
        shot("new-trip-train-a-to-z")

        let byDistance = app.buttons["By distance"].firstMatch
        if byDistance.exists {
            byDistance.tap()
            allowSystemAlert()
            pause(3)
            shot("new-trip-by-distance")
        }
        let byMap = app.buttons["By map"].firstMatch
        if byMap.exists {
            byMap.tap()
            pause(4)
            shot("new-trip-by-map")
        }
        app.buttons["A to Z"].firstMatch.tap()
        pause(1)
        filterStations("Burwood")
        let burwood = app.buttons["Burwood"].firstMatch
        XCTAssertTrue(burwood.waitForExistence(timeout: 5), "Burwood in the filtered list")
        burwood.tap()
        pause(1)
        XCTAssertTrue(app.navigationBars["To"].waitForExistence(timeout: 5), "To step after From")
        let indexC = element("index-C")
        if indexC.waitForExistence(timeout: 5) {
            indexC.tap()
            pause(1)
            shot("new-trip-train-to")
        }
        filterStations("Central")
        let central = app.buttons["Central"].firstMatch
        XCTAssertTrue(central.waitForExistence(timeout: 5), "Central in the filtered list")
        central.tap()

        XCTAssertTrue(element("tripName").waitForExistence(timeout: 8), "Confirm trip")
        pause(1)
        shot("confirm-trip")

        // Extend trip: a light rail leg from Central.
        element("extendTrip").tap()
        XCTAssertTrue(element("mode-lightrail").waitForExistence(timeout: 8), "mode picker for the connection")
        element("mode-lightrail").tap()
        XCTAssertTrue(app.searchFields.firstMatch.waitForExistence(timeout: 20), "light rail station filter")
        filterStations("Circular")
        let quay = app.buttons["Circular Quay"].firstMatch
        XCTAssertTrue(quay.waitForExistence(timeout: 20), "Circular Quay light rail")
        quay.tap()
        XCTAssertTrue(element("leg2").waitForExistence(timeout: 8), "second leg on Confirm trip")
        let stepper = app.steppers.firstMatch
        if stepper.exists && stepper.buttons["Increment"].exists { stepper.buttons["Increment"].tap() }
        pause(1)
        shot("confirm-trip-extended")
        element("saveTrip").tap()

        let via = element("tripVia")
        XCTAssertTrue(reveal(via), "extended trip on Trips")
        pause(6)
        shot("trips-new-trip")

        // A second trip by stop search, so there is something to reorder.
        openNewTrip()
        XCTAssertTrue(element("mode-search").waitForExistence(timeout: 8))
        element("mode-search").tap()
        searchAndPick("Strathfield", expect: "Strathfield Station")
        searchAndPick("Lidcombe", expect: "Lidcombe Station")
        XCTAssertTrue(element("saveTrip").waitForExistence(timeout: 8), "Confirm trip for the search trip")
        element("saveTrip").tap()
        pause(3)

        // The newest trip sits above the extended one; Move up swaps them.
        let second = app.staticTexts["Strathfield to Lidcombe"].firstMatch
        XCTAssertTrue(reveal(second), "search trip on Trips")
        XCTAssertTrue(reveal(via))
        if second.exists && via.exists {
            XCTAssertLessThan(second.frame.minY, via.frame.minY, "newest trip first")
            via.press(forDuration: 1.3)
            let up = app.buttons["Move up"].firstMatch
            XCTAssertTrue(up.waitForExistence(timeout: 5), "Move up in the trip menu")
            up.tap()
            pause(2)
            _ = reveal(via)
            XCTAssertLessThan(via.frame.minY, second.frame.minY, "extended trip moved up")
            shot("trips-reordered")
        }

        // The trip screen: direct services by default, All services saved per trip.
        via.tap()
        let toggle = element("allServices")
        XCTAssertTrue(toggle.waitForExistence(timeout: 40), "All services toggle on the trip screen")
        XCTAssertTrue(element("viaRow").exists, "via row on the trip screen")
        pause(2)
        shot("trip-extended")
        let sw = app.switches["allServices"].firstMatch
        let inner = sw.switches.firstMatch
        if inner.exists { inner.tap() } else { (sw.exists ? sw : toggle).tap() }
        pause(2)
        shot("trip-all-services")
        let value = app.switches["allServices"].firstMatch.value as? String
        XCTAssertEqual(value, "1", "All services on")
    }

    /// Bus: route number, direction, then a stop to get on and a later stop to get off.
    func test11NewBusTrip() {
        app.launch()
        tab("Trips")
        openNewTrip()
        XCTAssertTrue(element("mode-bus").waitForExistence(timeout: 8))
        element("mode-bus").tap()
        let field = app.searchFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 20), "route field")
        field.tap()
        field.typeText("461X")
        let route = element("busRoute")
        XCTAssertTrue(route.waitForExistence(timeout: 30), "461X in the route list")
        pause(1)
        shot("new-trip-bus-routes")
        route.tap()
        let stop = element("busStop")
        XCTAssertTrue(stop.waitForExistence(timeout: 30), "stops of the route")
        let dir = element("busDirection")
        if dir.exists { dir.tap(); pause(1) }
        pause(1)
        shot("new-trip-bus-stops")
        let stops = app.buttons.matching(identifier: "busStop")
        XCTAssertGreaterThan(stops.count, 3, "stops listed")
        stops.element(boundBy: 0).tap()
        pause(1)
        let after = app.buttons.matching(identifier: "busStop")
        XCTAssertTrue(after.element(boundBy: 2).waitForExistence(timeout: 5), "stops after the boarding stop")
        after.element(boundBy: 2).tap()
        XCTAssertTrue(element("tripName").waitForExistence(timeout: 8), "Confirm trip for the bus")
        pause(1)
        shot("confirm-bus-trip")
        element("saveTrip").tap()
        pause(2)
    }

    // MARK: Helpers

    private func openNewTrip() {
        let plus = app.navigationBars.buttons["Add a trip"].firstMatch
        if plus.waitForExistence(timeout: 10) {
            plus.tap()
        } else {
            element("addTrip").tap()
        }
        pause(1)
    }

    private func filterStations(_ text: String) {
        let field = app.searchFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 8), "station filter")
        field.tap()
        field.typeText(text)
        pause(1)
    }

    private func searchAndPick(_ query: String, expect: String) {
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 8), "stop search field")
        search.tap()
        search.typeText(query)
        let result = element("pickResult")
        XCTAssertTrue(result.waitForExistence(timeout: 20), "results for \(query)")
        pause(1)
        let exact = app.buttons.matching(identifier: "pickResult").containing(.staticText, identifier: expect).firstMatch
        (exact.exists ? exact : result).tap()
        pause(1)
    }

    /// Scrolls Trips until the element is on screen.
    @discardableResult
    private func reveal(_ e: XCUIElement) -> Bool {
        if e.waitForExistence(timeout: 8) && e.isHittable { return true }
        let list = app.collectionViews.firstMatch
        for _ in 0..<6 {
            if e.exists && e.isHittable { return true }
            list.swipeUp(velocity: .slow)
            pause(0.5)
        }
        for _ in 0..<8 {
            if e.exists && e.isHittable { return true }
            list.swipeDown(velocity: .slow)
            pause(0.5)
        }
        return e.exists && e.isHittable
    }


    private func element(_ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func tab(_ name: String) {
        let inBar = app.tabBars.buttons[name].firstMatch
        if inBar.waitForExistence(timeout: 8) { inBar.tap() } else { app.buttons[name].firstMatch.tap() }
        pause(1)
        allowSystemAlert()
    }

    /// Answers a system permission alert (notifications, location) if one is showing.
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

    private func shot(_ name: String) {
        Self.counter += 1
        let prefix = ProcessInfo.processInfo.environment["SHOT_PREFIX"] ?? "light"
        let file = String(format: "%@-%02d-%@", prefix, Self.counter, name)
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
