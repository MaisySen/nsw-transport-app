import Foundation

public enum Countdown {
    /// Whole minutes from now until the date, rounded down, never below zero.
    public static func minutes(until date: Date, now: Date = Date()) -> Int {
        max(0, Int(floor(date.timeIntervalSince(now) / 60)))
    }

    /// The big number on a row: "Now", "4" or "1h 12m".
    public static func big(until date: Date, now: Date = Date()) -> String {
        let s = date.timeIntervalSince(now)
        if s < 60 { return "Now" }
        let m = Int(s / 60)
        if m < 60 { return "\(m)" }
        return m % 60 == 0 ? "\(m / 60)h" : "\(m / 60)h \(m % 60)m"
    }

    /// The unit under the big number.
    public static func unit(until date: Date, now: Date = Date()) -> String {
        let s = date.timeIntervalSince(now)
        if s < 60 { return "" }
        return s < 3600 ? "min" : ""
    }

    /// A sentence fragment: "now", "in 4 min", "in 1 hr 12 min".
    public static func phrase(until date: Date, now: Date = Date()) -> String {
        let s = date.timeIntervalSince(now)
        if s < 60 { return "now" }
        let m = Int(s / 60)
        if m < 60 { return "in \(m) min" }
        return m % 60 == 0 ? "in \(m / 60) hr" : "in \(m / 60) hr \(m % 60) min"
    }
}

public enum Clock {
    public static let sydney = TimeZone(identifier: "Australia/Sydney") ?? .current

    public static func time(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_AU")
        f.timeZone = sydney
        f.dateFormat = "h:mm a"
        return f.string(from: d).lowercased().replacingOccurrences(of: " ", with: "")
    }

    public static func seconds(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_AU")
        f.timeZone = sydney
        f.dateFormat = "h:mm:ss a"
        return f.string(from: d).lowercased()
    }

    /// Minutes after midnight in Sydney, used for commute times.
    public static func minuteOfDay(_ d: Date) -> Int {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = sydney
        let c = cal.dateComponents([.hour, .minute], from: d)
        return (c.hour ?? 0) * 60 + (c.minute ?? 0)
    }

    public static func todText(_ tod: Int) -> String {
        let h = tod / 60, m = tod % 60
        let h12 = h % 12 == 0 ? 12 : h % 12
        return "\(h12):" + String(format: "%02d", m) + (h < 12 ? "am" : "pm")
    }
}

public enum Delay {
    /// "On time", "3 min late", "2 min early", "Cancelled", or "Scheduled" when there is no live data.
    public static func text(delayMin: Int?, live: Bool, cancelled: Bool) -> String {
        if cancelled { return "Cancelled" }
        guard live, let d = delayMin else { return "Scheduled" }
        if d == 0 { return "On time" }
        return d > 0 ? "\(d) min late" : "\(-d) min early"
    }
}

public enum Mode: String, CaseIterable, Sendable {
    case train, metro, bus, lightrail, ferry, coach, school, walk

    public init(raw: String?) {
        let r = (raw ?? "").lowercased().replacingOccurrences(of: " ", with: "")
        switch r {
        case "train", "trains", "sydneytrains", "nswtrains": self = .train
        case "metro": self = .metro
        case "lightrail", "tram": self = .lightrail
        case "ferry", "ferries": self = .ferry
        case "coach": self = .coach
        case "school", "schoolbus": self = .school
        case "walk", "footpath": self = .walk
        default: self = .bus
        }
    }

    public var symbol: String {
        switch self {
        case .train: return "train.side.front.car"
        case .metro: return "tram.fill.tunnel"
        case .bus, .school, .coach: return "bus.fill"
        case .lightrail: return "lightrail.fill"
        case .ferry: return "ferry.fill"
        case .walk: return "figure.walk"
        }
    }

    public var title: String {
        switch self {
        case .train: return "Trains"
        case .metro: return "Metro"
        case .bus: return "Buses"
        case .lightrail: return "Light Rail"
        case .ferry: return "Ferries"
        case .coach: return "Coaches"
        case .school: return "School buses"
        case .walk: return "Walk"
        }
    }

    /// Fallback line colours in the spirit of the network map, used when the server sends none.
    public var fallbackHex: String {
        switch self {
        case .train: return "#F6891F"
        case .metro: return "#168388"
        case .bus, .school, .coach: return "#00B5EF"
        case .lightrail: return "#E4022D"
        case .ferry: return "#5AB031"
        case .walk: return "#8E8E93"
        }
    }
}

public struct RGB: Sendable, Hashable {
    public var r: Double, g: Double, b: Double

    public init?(hex: String?) {
        guard var s = hex?.trimmingCharacters(in: .whitespaces), !s.isEmpty else { return nil }
        if s.hasPrefix("#") { s.removeFirst() }
        if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        r = Double((v >> 16) & 0xFF) / 255
        g = Double((v >> 8) & 0xFF) / 255
        b = Double(v & 0xFF) / 255
    }

    /// True when white text reads better than black on this colour.
    public var prefersWhiteText: Bool {
        (0.299 * r + 0.587 * g + 0.114 * b) < 0.72
    }
}
