import Foundation

/// The server address, in one place. The app, the widgets and the Live Activity all read it from
/// here. Remote config can move it ("api_base") without a build, but only to an https address on
/// a domain in `allowedDomains` or the host in use now; the last good value is kept in the App
/// Group so the widgets follow it too.
public enum APIBase {
    /// The address the app ships with.
    public static let builtIn = URL(string: "https://api.transportsydney.app")!

    /// Hosts remote config may move the app to (the host itself and any host under it), besides
    /// the host in use now. Adding a server is a one line change here.
    public static let allowedDomains: [String] = ["api.transportsydney.app"]

    /// The public site with the help, privacy and terms pages. Separate from the API address.
    public static let site = URL(string: "https://transportsydney.app")!
    /// Where people write to the publisher.
    public static let contactEmail = "contact@fintex.au"
    static let key = "apiBase.v1"

    /// The address to use now: the last accepted remote value, else the built in one.
    public static func current(_ d: UserDefaults = AppIdentity.groupDefaults) -> URL {
        if let s = d.string(forKey: key), let u = accept(s, currentHost: builtIn.host ?? "") { return u }
        return builtIn
    }

    /// The address `s` names, if it is allowed: https, no user name or password, no port, no
    /// query, and a host on one of `domains` or equal to `currentHost`. Anything else is nil.
    public static func accept(_ s: String?, currentHost: String, domains: [String] = allowedDomains) -> URL? {
        guard let s = s?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty,
              let c = URLComponents(string: s), c.scheme?.lowercased() == "https",
              let host = c.host?.lowercased(), !host.isEmpty,
              c.user == nil, c.password == nil, c.query == nil, c.fragment == nil,
              c.port == nil || c.port == 443 else { return nil }
        let ok = host == currentHost.lowercased() || domains.contains { d in
            let d = d.lowercased()
            return !d.isEmpty && (host == d || host.hasSuffix("." + d))
        }
        guard ok, host.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "." || $0 == "-" }) else { return nil }
        var path = c.path
        while path.hasSuffix("/") { path.removeLast() }
        return URL(string: "https://\(host)\(path)")
    }

    /// Applies the remote value. A good value is saved; a bad one is ignored and the last good
    /// value stays; no value goes back to the built in address. Returns the address in use.
    @discardableResult
    public static func apply(remote: String?, _ d: UserDefaults = AppIdentity.groupDefaults) -> URL {
        let host = current(d).host ?? builtIn.host ?? ""
        if remote == nil || remote?.trimmingCharacters(in: .whitespaces).isEmpty == true {
            d.removeObject(forKey: key)
        } else if let u = accept(remote, currentHost: host) {
            d.set(u.absoluteString, forKey: key)
        }
        return current(d)
    }

    /// A page on the public site, like "privacy" or "support".
    public static func page(_ path: String) -> URL {
        site.appendingPathComponent(path)
    }
}
