// Back from outside the app (1 Nov 2026, Bidur on build 214: "Widget missing back button or app screen?").
// Opens every outside link in the real app, closed (cold, as after a TestFlight update or when iOS has closed it) and
// open (warm). For each: a picture of the landed screen, then its Back is tapped and the app's tab bar must be there.
// Pictures and results.jsonl go to ENTRY_OUT (TEST_RUNNER_ENTRY_OUT from xcodebuild).
import ObjectiveC
import XCTest

/// The app never goes idle the way XCTest waits for (live times, spinners and countdowns keep animating with no data),
/// so every query waited for it (the first run of this test was still on its first cases after 50 min). The test waits
/// with its own sleeps instead: XCTest's idle wait is made a no-op for this test process only.
enum NoIdleWait {
    static var done = false
    static func apply() {
        guard !done, let cls = NSClassFromString("XCUIApplicationProcess") else { return }
        done = true
        let one: @convention(block) (AnyObject, Bool) -> Void = { _, _ in }
        let two: @convention(block) (AnyObject, Bool, Bool) -> Void = { _, _, _ in }
        if let m = class_getInstanceMethod(cls, NSSelectorFromString("waitForQuiescenceIncludingAnimationsIdle:")) {
            method_setImplementation(m, imp_implementationWithBlock(one))
        }
        if let m = class_getInstanceMethod(cls, NSSelectorFromString("waitForQuiescenceIncludingAnimationsIdle:isPreEvent:")) {
            method_setImplementation(m, imp_implementationWithBlock(two))
        }
    }
}

final class EntryBackTests: XCTestCase {
    let app = XCUIApplication(bundleIdentifier: "com.maisysen.nswtransport")
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    lazy var out: URL = {
        let p = ProcessInfo.processInfo.environment["ENTRY_OUT"] ?? NSTemporaryDirectory()
        let u = URL(fileURLWithPath: p, isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }()

    /// name, link, what opens it on a phone, the screen's Back (nav = the header's back button; "Back" = its own)
    static let cases: [(String, String, String)] = [
        ("next-trip-row", "nswtransport://trip?from=200060&fromName=Central&to=2150401&toName=Parramatta&at=1793530800", "Next trip widget row, Lock Screen, StandBy"),
        ("next-trip-start", "nswtransport://trip?from=200060&fromName=Central&to=2150401&toName=Parramatta&start=1", "Next trip Start, Control Center, Siri"),
        ("stop-board", "nswtransport://stop/200060", "Stop board widget and its rows"),
        ("live-trip", "nswtransport://go", "Live Activity, Dynamic Island, Your trip widget (after the fix)"),
        ("plan", "nswtransport://plan?from=200060&to=2150401", "transportsydney.app/plan links"),
        ("shared", "nswtransport://shared/abcdefghijklmnop", "transportsydney.app/trip share links"),
    ]

    override func setUp() {
        continueAfterFailure = true
        NoIdleWait.apply()
    }

    private func shot(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        try? png.write(to: out.appendingPathComponent(name + ".png"))
        let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }

    private func record(_ d: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: d), var line = String(data: data, encoding: .utf8) else { return }
        let a = XCTAttachment(string: line); a.name = "result-\(d["name"] ?? "")"; a.lifetime = .keepAlways; add(a)
        line += "\n"
        let f = out.appendingPathComponent("results.jsonl")
        if let h = try? FileHandle(forWritingTo: f) { h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); try? h.close() }
        else { try? line.write(to: f, atomically: true, encoding: .utf8) }
    }

    /// System prompts: "Open in Transport?", notifications, location. Tapped through so the screen under them shows.
    private func clearPrompts() {
        for label in ["Open", "Allow", "Allow While Using App", "Allow Once", "OK"] {
            let b = springboard.buttons[label]
            if b.exists { b.tap(); sleep(1) }
        }
    }

    private func open(_ link: String) {
        app.open(URL(string: link)!)
        sleep(2)
        clearPrompts()
    }

    /// The app's own first-run questions (home and work), skipped once so they do not cover the screens.
    private func skipFirstRun() {
        for label in ["Continue", "Skip", "Not now", "Done"] {
            let b = app.buttons[label]
            if b.exists && b.isHittable { b.tap(); sleep(2) }
        }
    }

    /// The screen's way back: the header's back button (UIKit names it "BackButton"; with the minimal style its label
    /// is "Back"), or the screen's own Back (the live trip, shared trips, profiles). Nothing else on the left counts.
    private func backButton() -> XCUIElement? {
        let back = NSPredicate(format: "identifier CONTAINS[c] 'back' OR label == 'Back'")
        let inBar = app.navigationBars.buttons.matching(back).firstMatch
        if inBar.exists { return inBar }
        let own = app.buttons.matching(back).firstMatch
        if own.exists { return own }
        return nil
    }

    /// The app's tabs: the tab bar (Home, Plan, Ask, More).
    private func tabsShown() -> Bool {
        if app.tabBars.firstMatch.exists { return true }
        return app.buttons["Home"].exists && app.buttons["Plan"].exists
    }

    private func tap(_ e: XCUIElement) {
        if e.isHittable { e.tap() } else { e.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap() }
    }

    private func tree(_ name: String) {
        let a = XCTAttachment(string: app.debugDescription); a.name = name + "-tree"; a.lifetime = .keepAlways; add(a)
    }

    private func check(_ name: String, _ link: String, _ what: String, cold: Bool) {
        let tag = (cold ? "cold-" : "warm-") + name
        sleep(cold ? 14 : 6)
        clearPrompts()
        shot(tag)
        tree(tag)
        let tabsUnder = tabsShown()
        let back = backButton()
        var tabsAfter = false
        if let b = back {
            tap(b)
            sleep(3)
            clearPrompts()
            sleep(2)
            tabsAfter = tabsShown()
            shot(tag + "-after-back")
            if !tabsAfter { tree(tag + "-after-back") }
        }
        record(["name": tag, "url": link, "what": what, "back": back != nil, "tabsAfterBack": tabsAfter, "tabBarOnScreen": tabsUnder])
        XCTAssertNotNil(back, "\(tag): \(link) opened a screen with no Back")
        XCTAssertTrue(tabsAfter, "\(tag): Back from \(link) did not reach the app's tabs")
    }

    func test1FirstOpen() {
        app.terminate()
        app.launch()
        clearPrompts()
        sleep(20)
        clearPrompts()
        shot("00-first-open")
        skipFirstRun()
        skipFirstRun()
        sleep(3)
        shot("00-first-open-after-skip")
        tree("00-first-open-after-skip")
        XCTAssertTrue(tabsShown(), "the app's normal start shows the tab bar")
    }

    func test2Cold() {
        for (name, link, what) in Self.cases {
            app.terminate()
            sleep(2)
            open(link)
            check(name, link, what, cold: true)
        }
    }

    func test3Warm() {
        for (name, link, what) in Self.cases {
            app.terminate()
            sleep(2)
            app.launch()
            sleep(10)
            clearPrompts()
            skipFirstRun()
            open(link)
            check(name, link, what, cold: false)
        }
    }
}
