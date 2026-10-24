import XCTest
import Foundation
import TransportKit

/// The server address can move by remote config only to https on an allowed domain (or the host
/// in use), and the last good value stays. The same file runs on Linux in Tools/KitCheck.
final class APIBaseTests: XCTestCase {
    var d: UserDefaults!

    override func setUp() {
        super.setUp()
        d = UserDefaults(suiteName: "apibase-tests-\(UUID().uuidString)")
    }

    let host = APIBase.builtIn.host ?? ""
    /// A list like the shipped one, to test the rules.
    let domains = ["sydneylive.com.au"]

    func testAllowlist() {
        XCTAssertEqual(APIBase.accept("https://api.sydneylive.com.au", currentHost: host, domains: domains)?.absoluteString, "https://api.sydneylive.com.au")
        XCTAssertEqual(APIBase.accept("https://sydneylive.com.au/", currentHost: host, domains: domains)?.absoluteString, "https://sydneylive.com.au")
        XCTAssertEqual(APIBase.accept(" https://API.SydneyLive.com.au/v2/ ", currentHost: host, domains: domains)?.absoluteString, "https://api.sydneylive.com.au/v2")
        XCTAssertNotNil(APIBase.accept("https://\(host)", currentHost: host, domains: domains), "the host in use stays allowed")
        XCTAssertNil(APIBase.accept("http://api.sydneylive.com.au", currentHost: host, domains: domains), "https only")
        XCTAssertNil(APIBase.accept("https://sydneylive.com.au.evil.com", currentHost: host, domains: domains))
        XCTAssertNil(APIBase.accept("https://evilsydneylive.com.au", currentHost: host, domains: domains))
        XCTAssertNil(APIBase.accept("https://api.fintex.au", currentHost: host, domains: domains), "not on the list")
        XCTAssertNil(APIBase.accept("https://user:pw@api.sydneylive.com.au", currentHost: host, domains: domains))
        XCTAssertNil(APIBase.accept("https://api.sydneylive.com.au:8443", currentHost: host, domains: domains))
        XCTAssertNil(APIBase.accept("https://api.sydneylive.com.au/?x=1", currentHost: host, domains: domains))
        XCTAssertNil(APIBase.accept("ftp://api.sydneylive.com.au", currentHost: host, domains: domains))
        XCTAssertNil(APIBase.accept("api.sydneylive.com.au", currentHost: host, domains: domains))
        XCTAssertNil(APIBase.accept("", currentHost: host, domains: domains))
        XCTAssertNil(APIBase.accept(nil, currentHost: host, domains: domains))
    }

    func testTheShippedListAllowsTheNewServerAndTheCurrentHost() {
        XCTAssertNotNil(APIBase.accept("https://\(host)", currentHost: host))
        XCTAssertEqual(APIBase.accept("https://api.transportsydney.app", currentHost: host)?.absoluteString, "https://api.transportsydney.app")
        XCTAssertNil(APIBase.accept("https://transportsydney.app.evil.com", currentHost: host))
        XCTAssertNil(APIBase.accept("https://evil-transportsydney.app", currentHost: host))
        XCTAssertNil(APIBase.accept("https://api.sydneylive.com.au", currentHost: host))
        XCTAssertEqual(APIBase.page("privacy").absoluteString, "https://transportsydney.app/privacy")
        XCTAssertEqual(APIBase.page("support").absoluteString, "https://transportsydney.app/support")
        XCTAssertTrue(APIBase.allowedDomains.allSatisfy { !$0.isEmpty && !$0.hasPrefix(".") })
    }

    func testKeepsTheLastGoodValue() {
        XCTAssertEqual(APIBase.current(d), APIBase.builtIn)
        let moved = "https://\(host)/v2"
        XCTAssertEqual(APIBase.apply(remote: moved, d).absoluteString, moved)
        XCTAssertEqual(APIBase.apply(remote: "http://bad.example.com", d).absoluteString, moved, "a bad value is ignored")
        XCTAssertEqual(APIBase.apply(remote: "https://api.not-allowed.example", d).absoluteString, moved)
        XCTAssertEqual(APIBase.current(d).absoluteString, moved)
        XCTAssertEqual(APIBase.apply(remote: nil, d), APIBase.builtIn, "no value goes back to the built in address")
    }

    func testRemoteConfigReadsApiBase() throws {
        let c = try JSONDecoder().decode(RemoteConfig.self, from: Data(#"{"version":3,"api_base":"https://api.sydneylive.com.au"}"#.utf8))
        XCTAssertEqual(c.apiBase, "https://api.sydneylive.com.au")
        let back = try JSONDecoder().decode(RemoteConfig.self, from: JSONEncoder().encode(c))
        XCTAssertEqual(back.apiBase, "https://api.sydneylive.com.au", "the cached copy keeps it")
        XCTAssertNil(try JSONDecoder().decode(RemoteConfig.self, from: Data(#"{"version":3}"#.utf8)).apiBase)
        let viaCopy = try JSONDecoder().decode(RemoteConfig.self, from: Data(#"{"copy":{"api_base":"https://api.sydneylive.com.au"}}"#.utf8))
        XCTAssertEqual(viaCopy.apiBase, "https://api.sydneylive.com.au", "the copy section works with the server as it is today")
    }
}
