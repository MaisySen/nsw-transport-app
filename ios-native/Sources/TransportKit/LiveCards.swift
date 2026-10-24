import Foundation

/// Something that runs Lock Screen cards (Live Activities): the app's ActivityKit wrapper, or a
/// fake in tests. `cardIDs` lists every running card of every kind (trip and followed service).
@MainActor
public protocol LiveCardHost: AnyObject {
    var cardIDs: [String] { get }
    func endCard(_ id: String) async
    func requestCard() throws -> String
}

/// Exactly one Lock Screen card at a time.
@MainActor
public enum LiveCardRule {
    /// Ends every running card, including ones left from earlier trips or a followed service,
    /// then asks for one. Starting twice leaves one card.
    @discardableResult
    public static func startOne(on host: LiveCardHost) async -> String? {
        for id in host.cardIDs { await host.endCard(id) }
        return try? host.requestCard()
    }

    /// Ends every card after the first, in case two were ever started.
    public static func trimToOne(on host: LiveCardHost) async {
        for id in host.cardIDs.dropFirst() { await host.endCard(id) }
    }
}

/// Words for the trip card, worked out here so the widget and the tests agree.
public enum LiveCardText {
    /// "Strathfield Station, Platform 2" becomes "Strathfield".
    public static func place(_ s: String?) -> String {
        Naming.compact(Naming.short(s ?? ""))
    }

    /// Whole minutes until a time: "Now", "1 min", "26 min", "1 hr 5 min". Never seconds.
    public static func minutes(until date: Date, now: Date = Date()) -> String {
        let m = Int((date.timeIntervalSince(now) / 60).rounded(.up))
        if m <= 0 { return "Now" }
        if m < 60 { return "\(m) min" }
        return m % 60 == 0 ? "\(m / 60) hr" : "\(m / 60) hr \(m % 60) min"
    }
}
