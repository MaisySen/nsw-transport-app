import XCTest

/// App Store screenshots. Runs only when STORE_SHOTS is set (the store screenshot step in CI),
/// on each required iPhone size, with live data. Saves full resolution PNGs to SHOTS_DIR.
final class StoreShots: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        try XCTSkipIf(ProcessInfo.processInfo.environment["STORE_SHOTS"] == nil, "store screenshots run on their own")
        continueAfterFailure = true
        app = XCUIApplication()
        app.launchArguments = ["-apiProfile", "storeshots"]
        addUIInterruptionMonitor(withDescription: "System alert") { alert in
            for label in ["Allow", "Allow While Using App", "OK"] where alert.buttons[label].exists {
                alert.buttons[label].tap()
                return true
            }
            return false
        }
    }

    func testStoreScreens() {
        app.launchArguments += ["-uiTestReset", "YES"]
        app.launch()
        tab("Trips")
        if element("addHome").waitForExistence(timeout: 8) {
            pick("addHome", "Strathfield", expect: "Strathfield Station")
            pick("addWork", "Town Hall", expect: "Town Hall Station")
        }
        pause(10)
        shot("01-trips")

        let toWork = app.staticTexts["To work"].firstMatch
        let toHome = app.staticTexts["To home"].firstMatch
        let trip = toWork.waitForExistence(timeout: 10) ? toWork : toHome
        if trip.exists {
            trip.tap()
            _ = element("earlierServices").waitForExistence(timeout: 30)
            pause(3)
            shot("02-trip")
        }

        app.terminate()
        app.launchArguments = ["-apiProfile", "storeshots", "-screen", "stop/200060"]
        app.launch()
        let row = element("departure")
        if row.waitForExistence(timeout: 30) {
            pause(3)
            shot("03-board")
            row.tap()
            if element("serviceSheet").waitForExistence(timeout: 20) {
                pause(7)
                shot("04-live-map")
            }
        }

        app.terminate()
        app.launchArguments = ["-apiProfile", "storeshots"]
        app.launch()
        tab("Ask")
        let clear = app.navigationBars.buttons["Clear"].firstMatch
        if clear.waitForExistence(timeout: 3) && clear.isEnabled { clear.tap(); pause(1) }
        let starter = element("askStarter")
        if starter.waitForExistence(timeout: 10) {
            starter.tap()
            if element("askReply").waitForExistence(timeout: 45) {
                pause(3)
                shot("05-ask")
            }
        }

        tab("Home")
        let near = app.buttons["Show stops near me"].firstMatch
        for _ in 0..<4 where !(near.exists && near.isHittable) {
            app.swipeUp()
            pause(0.6)
        }
        if near.waitForExistence(timeout: 5) && near.isHittable {
            near.tap()
            allowSystemAlert()
        }
        pause(6)
        shot("06-nearby")
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
        guard field.waitForExistence(timeout: 10) else { return }
        field.tap()
        let search = app.searchFields.firstMatch
        guard search.waitForExistence(timeout: 8) else { return }
        search.tap()
        search.typeText(query)
        let result = element("pickResult")
        guard result.waitForExistence(timeout: 20) else { return }
        let exact = app.buttons.matching(identifier: "pickResult").containing(.staticText, identifier: expect).firstMatch
        (exact.exists ? exact : result).tap()
        pause(1)
    }

    private func pause(_ s: TimeInterval) { Thread.sleep(forTimeInterval: s) }

    private func shot(_ name: String) {
        let prefix = ProcessInfo.processInfo.environment["SHOT_PREFIX"] ?? "store"
        let image = XCUIScreen.main.screenshot()
        let a = XCTAttachment(screenshot: image)
        a.name = "\(prefix)-\(name)"
        a.lifetime = .keepAlways
        add(a)
        if let dir = ProcessInfo.processInfo.environment["SHOTS_DIR"] {
            try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            try? image.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(prefix)-\(name).png"))
        }
    }
}

/// Starts the app against a server address that does not answer, as if the phone had no network,
/// and opens every tab. The app must not crash and the tab bar must stay usable.
final class OfflineLaunchTests: XCTestCase {
    func testStartsWithoutNetwork() {
        let app = XCUIApplication()
        app.launchArguments = ["-apiProfile", "uitest-offline", "-apiBase", "http://127.0.0.1:9", "-uiTestReset", "YES"]
        app.launch()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 15), "tab bar after an offline start")
        for name in ["Home", "Plan", "Watching", "More", "Home"] {
            let b = app.tabBars.buttons[name].firstMatch
            if b.waitForExistence(timeout: 5) { b.tap() }
            Thread.sleep(forTimeInterval: 2.5)
            XCTAssertEqual(app.state, .runningForeground, "still running on \(name) without a network")
        }
        let image = XCUIScreen.main.screenshot()
        if let dir = ProcessInfo.processInfo.environment["SHOTS_DIR"] {
            let prefix = ProcessInfo.processInfo.environment["SHOT_PREFIX"] ?? "light"
            try? image.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(prefix)-90-offline-start.png"))
        }
    }
}
