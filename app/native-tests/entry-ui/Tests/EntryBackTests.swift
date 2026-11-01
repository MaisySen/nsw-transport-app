// Back from outside the app (1 Nov 2026, Bidur on build 214: "Widget missing back button or app screen?").
// Opens every outside link in the real app, closed (cold, as after a TestFlight update or when iOS has closed it) and
// open (warm). For each: a picture of the landed screen, then its Back is tapped and the app's tab bar must be there.
// Pictures and results.jsonl go to ENTRY_OUT (TEST_RUNNER_ENTRY_OUT from xcodebuild).
import XCTest

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
    }

    private func shot(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        try? png.write(to: out.appendingPathComponent(name + ".png"))
        let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }

    private func record(_ d: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: d), var line = String(data: data, encoding: .utf8) else { return }
        line += "\n"
        let f = out.appendingPathComponent("results.jsonl")
        if let h = try? FileHandle(forWritingTo: f) { h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); try? h.close() }
        else { try? line.write(to: f, atomically: true, encoding: .utf8) }
    }

    /// System prompts: "Open in Transport?", notifications, location. Tapped through so the screen under them shows.
    private func clearPrompts() {
        for label in ["Open", "Allow", "Allow While Using App", "Allow Once", "OK"] {
            let b = springboard.buttons[label]
            if b.waitForExistence(timeout: 1) { b.tap() }
        }
    }

    private func open(_ link: String) {
        app.open(URL(string: link)!)
        clearPrompts()
    }

    /// The app's own first-run questions (home and work), skipped once so they do not cover the screens.
    private func skipFirstRun() {
        for label in ["Skip", "Not now", "Done"] {
            let b = app.buttons[label]
            if b.waitForExistence(timeout: 2) { b.tap(); sleep(1) }
        }
    }

    /// The screen's way back: the header's back button (UIKit names it "BackButton"; with the minimal style its label
    /// is "Back"), or the screen's own Back (the live trip, shared trips, profiles). Nothing else on the left counts.
    private func backButton() -> XCUIElement? {
        let bar = app.navigationBars.firstMatch
        if bar.exists {
            for id in ["BackButton", "Back"] {
                let b = bar.buttons[id]
                if b.exists && b.isHittable { return b }
            }
        }
        let own = app.buttons["Back"]
        if own.exists && own.isHittable { return own }
        return nil
    }

    private func check(_ name: String, _ link: String, _ what: String, cold: Bool) {
        let tag = (cold ? "cold-" : "warm-") + name
        sleep(cold ? 14 : 6)
        clearPrompts()
        shot(tag)
        let tabsUnder = app.tabBars.firstMatch.exists
        let back = backButton()
        var tabsAfter = false
        if let b = back {
            b.tap()
            sleep(3)
            clearPrompts()
            tabsAfter = app.tabBars.firstMatch.waitForExistence(timeout: 6)
            shot(tag + "-after-back")
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
        shot("00-first-open-after-skip")
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 10), "the app's normal start shows the tab bar")
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
