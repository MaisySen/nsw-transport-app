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
        let target = app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25))
        top.press(forDuration: 0.1, thenDragTo: target)
        pause(1.5)
        shot("live-map-sheet-up")
        XCTAssertTrue(app.staticTexts["Stops"].firstMatch.exists || app.otherElements["Stops"].firstMatch.exists, "stops list in the sheet")
    }

    func test03PlanWatchAndSaveTrip() {
        app.launch()
        tab("Plan")
        let plan = element("planTrip")
        XCTAssertTrue(plan.waitForExistence(timeout: 10), "Plan a trip on the Plan tab")
        plan.tap()
        shot("plan-empty")

        pick("fromField", "Burwood", expect: "Burwood Station")
        pick("toField", "Central", expect: "Central Station")
        let journey = element("journey")
        XCTAssertTrue(journey.waitForExistence(timeout: 30), "journeys from Burwood to Central")
        pause(1)
        shot("plan-burwood-central")

        journey.tap()
        // One Start trip button: watching starts with it, so there is no separate Watch trip.
        let start = element("startTrip")
        XCTAssertTrue(start.waitForExistence(timeout: 10), "journey detail")
        XCTAssertFalse(app.buttons["Watch trip"].exists, "no separate Watch trip button")
        XCTAssertFalse(app.buttons["Lock Screen"].exists, "no Lock Screen button")
        shot("trip-detail")

        app.swipeUp()
        let save = element("saveNamedTrip")
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
        // Back to A to Z; the map's own station buttons share the names.
        let az = app.buttons["A to Z"].firstMatch
        az.tap()
        pause(1)
        if !element("index-A").waitForExistence(timeout: 3) { az.tap(); pause(1) }
        XCTAssertTrue(element("index-A").waitForExistence(timeout: 5), "A to Z list again")
        filterStations("Burwood")
        tapStation("Burwood", thenExpect: element("changeFrom"))
        XCTAssertTrue(element("changeFrom").exists, "To step after From")
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
            if !second.exists { _ = reveal(second) }
            if via.exists && second.exists {
                XCTAssertLessThan(via.frame.minY, second.frame.minY, "extended trip moved up")
            }
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
        let clear = field.buttons["Clear text"].firstMatch
        if clear.exists { clear.tap() }
        field.typeText(text)
        pause(1)
    }

    /// Taps a station row, once more if the list was still settling.
    private func tapStation(_ name: String, thenExpect next: XCUIElement) {
        let row = app.buttons[name].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 8), "\(name) in the list")
        row.tap()
        let choose = element("mapChoose")
        if !next.waitForExistence(timeout: 2) && choose.exists { choose.tap() }
        if !next.waitForExistence(timeout: 4) && row.exists && row.isHittable {
            row.tap()
            _ = next.waitForExistence(timeout: 4)
        }
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

    /// Build 9: a trip shows the Opal fare estimate, Start trip opens the live trip with its
    /// sheet, the share button and End trip, and Home shows Trip in progress while it runs.
    func test12FaresAndLiveTrip() {
        app.launch()
        tab("Plan")
        let plan = element("planTrip")
        XCTAssertTrue(plan.waitForExistence(timeout: 10), "Plan a trip on the Plan tab")
        plan.tap()
        pick("fromField", "Strathfield", expect: "Strathfield Station")
        pick("toField", "Central", expect: "Central Station")
        let journey = element("journey")
        // The trip planner sometimes times out ("No trips found. The request timed out."): pull to refresh and wait again.
        for _ in 0..<2 where !journey.waitForExistence(timeout: 30) {
            app.collectionViews.firstMatch.swipeDown(velocity: .slow)
        }
        XCTAssertTrue(journey.waitForExistence(timeout: 30), "journeys from Strathfield to Central")
        XCTAssertTrue(element("fareBar").waitForExistence(timeout: 10), "fare bar on the trip screen")
        pause(1)
        shot("trip-fares")
        journey.tap()
        let start = element("startTrip")
        XCTAssertTrue(start.waitForExistence(timeout: 10), "Start trip on the journey")
        let fareTotal = element("fareTotal")
        for _ in 0..<4 where !(fareTotal.exists && fareTotal.isHittable) {
            app.swipeUp()
            pause(1)
        }
        XCTAssertTrue(fareTotal.waitForExistence(timeout: 8), "Opal fare estimate card")
        shot("trip-fare-card")
        for _ in 0..<4 where !(start.exists && start.isHittable) {
            app.swipeDown()
            pause(1)
        }
        start.tap()
        allowSystemAlert()
        let end = element("endTrip")
        XCTAssertTrue(end.waitForExistence(timeout: 20), "live trip sheet with End trip")
        XCTAssertTrue(element("liveArrival").waitForExistence(timeout: 20), "arrival time on the live trip")
        pause(4)
        shot("live-trip")
        let share = element("shareTrip")
        XCTAssertTrue(share.exists, "Share trip button")
        share.tap()
        pause(3)
        shot("live-trip-share")
        let close = app.buttons["Close"].firstMatch
        if close.waitForExistence(timeout: 3) { close.tap() } else { app.swipeDown() }
        pause(1)
        if !end.isHittable {
            let sheet = app.collectionViews.firstMatch
            sheet.swipeUp()
            pause(1)
        }
        end.tap()
        // The bar button is also labelled End trip, so the dialog's button is found by its own identifier.
        let confirm = element("confirmEndTrip")
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), "End this trip dialog")
        confirm.tap()
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: element("endTrip"))
        wait(for: [gone], timeout: 15)
        XCTAssertFalse(element("endTrip").exists, "live trip closed after End trip")
        shot("live-trip-ended")
    }

    /// Build 9: station screens show access, lifts and Park and Ride; the Opal machine finder lists machines.
    func test13StationAccessParkingAndOpalMachines() {
        app.launchArguments += ["-screen", "stop/2155384"]
        app.launch()
        XCTAssertTrue(element("departure").waitForExistence(timeout: 25), "departures at Tallawong")
        let parkHeader = app.staticTexts["Park and Ride"].firstMatch
        let list = app.collectionViews.firstMatch
        for _ in 0..<8 where !parkHeader.exists {
            list.swipeUp()
            pause(0.8)
        }
        XCTAssertTrue(parkHeader.waitForExistence(timeout: 10), "Park and Ride on the Tallawong screen")
        shot("station-parkride")
        let access = app.staticTexts["Access and facilities"].firstMatch
        for _ in 0..<6 where !access.exists {
            list.swipeUp()
            pause(0.8)
        }
        XCTAssertTrue(access.waitForExistence(timeout: 10), "Access and facilities on the Tallawong screen")
        shot("station-access")

        tab("More")
        let machines = element("opalMachines")
        XCTAssertTrue(machines.waitForExistence(timeout: 10), "Opal machines row in More")
        machines.tap()
        allowSystemAlert()
        XCTAssertTrue(element("opalMachine").waitForExistence(timeout: 30), "at least one Opal machine")
        pause(2)
        shot("opal-machines")
        app.navigationBars.buttons.firstMatch.tap()
        pause(1)
        let parks = element("parkRideList")
        if parks.waitForExistence(timeout: 5) {
            parks.tap()
            XCTAssertTrue(element("carPark").waitForExistence(timeout: 40), "Park and Ride list")
            pause(1)
            shot("parkride-list")
        }
    }

    /// Build 9: Settings has the fare type, Accessibility and Clear history; Recent trips on Home
    /// clears with Undo; a profile link asks first.
    func test14SettingsHistoryAndProfileLink() {
        app.launch()
        tab("Settings")
        let list = app.collectionViews.firstMatch
        let concession = app.buttons["Concession"].firstMatch
        for _ in 0..<6 where !concession.exists {
            list.swipeUp()
            pause(0.6)
        }
        XCTAssertTrue(concession.waitForExistence(timeout: 8), "Concession fare type")
        concession.tap()
        pause(0.8)
        shot("settings-fares")
        let acc = app.switches["accessibleTrips"].firstMatch
        for _ in 0..<4 where !acc.exists {
            list.swipeUp()
            pause(0.6)
        }
        XCTAssertTrue(acc.exists || element("accessibleTrips").exists, "Accessible trips switch")
        shot("settings-accessibility")
        let history = element("deleteServerHistory")
        for _ in 0..<4 where !history.exists {
            list.swipeUp()
            pause(0.6)
        }
        XCTAssertTrue(history.waitForExistence(timeout: 8), "Delete my trip history on server")
        history.tap()
        let deleteButton = app.buttons["Delete trip history"].firstMatch
        XCTAssertTrue(deleteButton.waitForExistence(timeout: 5), "confirm sheet for trip history")
        shot("settings-delete-history-confirm")
        deleteButton.tap()
        pause(2)
        shot("settings-history-deleted")
        let adult = app.buttons["Adult"].firstMatch
        for _ in 0..<6 where !adult.exists {
            list.swipeDown()
            pause(0.6)
        }
        if adult.exists { adult.tap() }

        tab("Plan")
        let clear = element("clearRecentTrips")
        if reveal(clear) {
            shot("home-recent")
            clear.tap()
            XCTAssertTrue(element("undoClear").waitForExistence(timeout: 3), "Undo after Clear")
            shot("home-recent-cleared-undo")
            element("undoClear").tap()
            pause(1)
            XCTAssertTrue(element("recentTrip").waitForExistence(timeout: 5), "recent trips back after Undo")
        }

        app.terminate()
        app.launchArguments += ["-screen", "profile/uitestprofile"]
        app.launch()
        let switchButton = app.buttons["Switch profile"].firstMatch
        XCTAssertTrue(switchButton.waitForExistence(timeout: 10), "profile link asks first")
        shot("profile-link-prompt")
        // iOS 26 shows this dialog without a Cancel button; a tap outside it cancels.
        let cancel = app.buttons["Cancel"].firstMatch
        if cancel.exists && cancel.isHittable {
            cancel.tap()
        } else {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
        }
        let dismissed = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: switchButton)
        wait(for: [dismissed], timeout: 8)
        XCTAssertFalse(switchButton.exists, "profile link prompt cancelled")
    }

    // MARK: Trip screen buttons and journey replay

    /// Every button on the trip screen acts on the first tap: the map opens, Start trip opens the
    /// live trip, End trip closes it, Save trip asks for a name, and the tab bar still switches.
    func test15TripScreenButtonsAct() {
        app.launch()
        openTrip(from: "Burwood", fromName: "Burwood Station", to: "Strathfield", toName: "Strathfield Station")
        let start = element("startTrip")
        XCTAssertTrue(start.waitForExistence(timeout: 10), "Start trip")
        shot("trip-screen")

        let map = element("legMap")
        XCTAssertTrue(map.waitForExistence(timeout: 5), "leg with its map link")
        map.tap()
        XCTAssertTrue(element("serviceSheet").waitForExistence(timeout: 20), "the map opens on the first tap")
        pause(2)
        shot("trip-screen-map")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(start.waitForExistence(timeout: 8), "back on the trip screen")

        start.tap()
        allowSystemAlert()
        let end = element("endTrip")
        XCTAssertTrue(end.waitForExistence(timeout: 15), "Start trip opens the live trip on the first tap")
        pause(2)
        shot("trip-screen-started")
        if !end.isHittable { app.collectionViews.firstMatch.swipeUp(); pause(1) }
        end.tap()
        let confirm = element("confirmEndTrip")
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), "End this trip dialog")
        confirm.tap()
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: element("endTrip"))
        wait(for: [gone], timeout: 15)

        XCTAssertTrue(start.waitForExistence(timeout: 8), "back on the trip screen after End trip")
        start.tap()
        XCTAssertTrue(element("endTrip").waitForExistence(timeout: 15), "Start trip works a second time")
        element("endTrip").tap()
        if element("confirmEndTrip").waitForExistence(timeout: 5) { element("confirmEndTrip").tap() }
        pause(2)

        let save = element("saveNamedTrip")
        if reveal(save) {
            save.tap()
            let alert = app.alerts.firstMatch
            XCTAssertTrue(alert.waitForExistence(timeout: 5), "Save trip asks for a name on the first tap")
            alert.buttons["Cancel"].tap()
        }

        tab("Watching")
        XCTAssertTrue(app.navigationBars["Watching"].waitForExistence(timeout: 8), "the Watching tab opens")
        tab("More")
        XCTAssertTrue(element("moreSettings").waitForExistence(timeout: 8), "the More tab opens")
        tab("Home")
        XCTAssertTrue(app.navigationBars["Home"].waitForExistence(timeout: 8), "the Home tab opens")
        tab("Plan")
        XCTAssertTrue(element("planTrip").waitForExistence(timeout: 8), "the Plan tab opens")
        shot("tabs-after-trip")
    }

    /// Bidur's short trip: Burwood to Strathfield planned with live data, then Start trip replayed
    /// on a fake clock (2 min late) to arrival and 15 minutes past it.
    func test16ReplayBurwoodToStrathfield() {
        app.launchArguments += ["-liveReplay", "YES", "-liveReplayShift", "2", "-liveReplayTick", "900"]
        app.launch()
        openTrip(from: "Burwood", fromName: "Burwood Station", to: "Strathfield", toName: "Strathfield Station")
        let start = element("startTrip")
        XCTAssertTrue(start.waitForExistence(timeout: 10), "Start trip")
        shot("replay-short-trip-screen")
        start.tap()
        allowSystemAlert()
        let log = runReplay(name: "short", stages: [("waiting", "state: leg 1 waiting"), ("on-board", "on board"), ("get-off", "alert: "), ("arrived", "You've arrived")])
        checkReplay(log, legs: 1)
    }

    /// A trip with a change: Strathfield to Redfern on a T1 3 min late, change to a T4 1 min
    /// early, off at Kings Cross, replayed to arrival and 15 minutes past it.
    func test17ReplayWithChange() {
        app.launchArguments += ["-liveReplay", "YES", "-liveReplayDemo", "YES", "-liveReplayTick", "700"]
        app.launch()
        let log = runReplay(name: "change", stages: [("start", "start:"), ("leg1", "state: leg 1 on board"), ("change", "Next stop: Redfern"), ("leg2", "state: leg 2 on board"), ("get-off", "Next stop: Kings Cross"), ("arrived", "You've arrived")])
        checkReplay(log, legs: 2)
        XCTAssertTrue(log.contains("change here"), "an alert for the change at Redfern")
    }

    private func openTrip(from: String, fromName: String, to: String, toName: String) {
        tab("Plan")
        let plan = element("planTrip")
        XCTAssertTrue(plan.waitForExistence(timeout: 10), "Plan a trip on the Plan tab")
        plan.tap()
        pick("fromField", from, expect: fromName)
        pick("toField", to, expect: toName)
        let journey = element("journey")
        for _ in 0..<2 where !journey.waitForExistence(timeout: 30) {
            app.collectionViews.firstMatch.swipeDown(velocity: .slow)
        }
        XCTAssertTrue(journey.waitForExistence(timeout: 30), "live journeys from \(fromName) to \(toName)")
        shot("replay-plan-\(from.lowercased())")
        journey.tap()
    }

    /// Waits for the replay to finish, taking a screenshot the first time each stage shows in the
    /// log, then saves the whole timeline next to the screenshots.
    private func runReplay(name: String, stages: [(String, String)]) -> String {
        let logView = element("replayLog")
        XCTAssertTrue(logView.waitForExistence(timeout: 20), "replay running")
        var pending = stages
        var text = ""
        let deadline = Date().addingTimeInterval(240)
        while Date() < deadline {
            text = (logView.value as? String) ?? ""
            while let s = pending.first, text.contains(s.1) {
                shot("replay-\(name)-\(s.0)")
                pending.removeFirst()
            }
            if logView.label == "Replay finished" { break }
            pause(0.4)
        }
        text = (logView.value as? String) ?? text
        shot("replay-\(name)-15-min-after")
        XCTAssertEqual(logView.label, "Replay finished", "replay ran to 15 minutes after arrival")
        XCTAssertTrue(pending.isEmpty, "stages not seen: \(pending.map { $0.0 })\n\(text)")
        let a = XCTAttachment(string: text)
        a.name = "replay-\(name)-timeline"
        a.lifetime = .keepAlways
        add(a)
        if let dir = ProcessInfo.processInfo.environment["SHOTS_DIR"] {
            let prefix = ProcessInfo.processInfo.environment["SHOT_PREFIX"] ?? "light"
            try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            try? (text + "\n").write(toFile: dir + "/\(prefix)-replay-\(name)-timeline.txt", atomically: true, encoding: .utf8)
        }
        return text
    }

    /// Each alert once, one arrived alert, the trip ends once at arrival and nothing after it.
    private func checkReplay(_ log: String, legs: Int) {
        let lines = log.components(separatedBy: "\n")
        let alerts = lines.compactMap { l -> String? in
            guard let r = l.range(of: " alert: ") else { return nil }
            let title = l[r.upperBound...].components(separatedBy: " | ")[0]
            return title.replacingOccurrences(of: #" in \d+ min$"#, with: "", options: .regularExpression)
        }
        XCTAssertEqual(Set(alerts).count, alerts.count, "each alert once:\n\(log)")
        XCTAssertEqual(alerts.filter { $0.hasPrefix("You've arrived") }.count, 1, "one You've arrived:\n\(log)")
        XCTAssertEqual(lines.filter { $0.contains("trip ended") }.count, 1, "the trip ends once:\n\(log)")
        if let end = lines.firstIndex(where: { $0.contains("trip ended") }) {
            XCTAssertFalse(lines[(end + 1)...].contains { $0.contains(" alert: ") || $0.contains("state: leg") }, "nothing after the trip ended:\n\(log)")
            XCTAssertTrue(lines[..<end].contains { $0.contains("state: arrived") }, "ended at arrival:\n\(log)")
        }
        XCTAssertTrue(log.contains("15 min after arrival: no trip running"), "no trip 15 min after arrival:\n\(log)")
        XCTAssertFalse(log.contains("-next"), "never moved on to the next service")
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

    /// Opens a part of the app by the name the tests used before the four tab layout:
    /// Trips is Home, Search is Plan, and Ask and Settings are rows in More.
    private func tab(_ name: String) {
        let map: [String: (String, String?)] = [
            "Trips": ("Home", nil), "Search": ("Plan", nil),
            "Ask": ("More", "moreAsk"), "Settings": ("More", "moreSettings"), "About": ("More", "moreAbout"),
        ]
        let (barName, row) = map[name] ?? (name, nil)
        let inBar = app.tabBars.buttons[barName].firstMatch
        if inBar.waitForExistence(timeout: 8) { inBar.tap() } else { app.buttons[barName].firstMatch.tap() }
        pause(1)
        allowSystemAlert()
        if barName == "Plan" { planRoot(inBar) }
        if let row {
            let cell = element(row)
            if !cell.waitForExistence(timeout: 3) {
                // Tapping the selected tab again goes back to its first screen.
                inBar.tap()
                pause(1)
            }
            if cell.waitForExistence(timeout: 8) { cell.tap() }
            pause(1)
        }
    }

    /// The Plan tab keeps the screen you left it on, and a stop search keeps its words. Back to
    /// its first screen: tap the tab again, go back, and clear the search.
    private func planRoot(_ inBar: XCUIElement) {
        let plan = element("planTrip")
        if plan.waitForExistence(timeout: 3) { return }
        if inBar.exists { inBar.tap(); pause(1) }
        for _ in 0..<4 where !plan.exists {
            let back = app.navigationBars.buttons.firstMatch
            if back.exists && back.isHittable && back.identifier != "Star stop" { back.tap(); pause(0.8) } else { break }
        }
        if !plan.exists {
            let field = app.searchFields.firstMatch
            if field.exists {
                field.tap()
                let clear = field.buttons.firstMatch
                if clear.exists { clear.tap() }
                let cancel = app.buttons["Cancel"].firstMatch
                if cancel.exists && cancel.isHittable { cancel.tap() }
                pause(1)
            }
        }
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
