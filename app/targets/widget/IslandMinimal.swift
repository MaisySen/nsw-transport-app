import Foundation

/// The Dynamic Island's minimal presentation (2 Nov 2026, the owner's first real trip on build 214: music was playing, so
/// iOS drew our Live Activity in its smallest form and it showed only "Due"; the owner said yes at 9:19 AM to "T4 4:52"
/// instead of a bare word). The minimal view has about 36 pt: the line and the clock time of what the card counts to
/// (the departure while waiting, your stop's arrival on board), side by side when they fit, the line over the time when
/// not, else the time alone. A clock time needs no update to stay right, so this costs no pushes. Pure, so
/// app/test/island2nov.test.mjs compiles it on Linux.
enum IslandMinimal {
    struct Words: Equatable {
        /// "T4"; nil when the card has no line.
        var line: String?
        /// "4:52", or "16:52" on a phone set to 24 hour time.
        var time: String
        /// Get off now: drawn in orange, as the compact Island's stop name.
        var getOff: Bool
    }

    /// Nil once arrived: the tick stays.
    static func words(line: String, target: Date, word: String?, arrived: Bool) -> Words? {
        if arrived { return nil }
        let l = line.trimmingCharacters(in: .whitespacesAndNewlines)
        return Words(line: l.isEmpty ? nil : l, time: clock(target), getOff: word == "Now")
    }

    /// The clock time with no "am" or "pm" ("4:52"): the minimal view has no room for it, and the trip is within the hour.
    static func clock(_ d: Date) -> String {
        let t = Clock.time(d)
        if t.hasSuffix("am") || t.hasSuffix("pm") { return String(t.dropLast(2)) }
        return t
    }

    /// VoiceOver: "T4, leaves 4:52am", "T4, get off 4:55am".
    static func spoken(line: String, target: Date, phase: String) -> String {
        let l = line.trimmingCharacters(in: .whitespacesAndNewlines)
        let verb = phase == "wait" ? "leaves" : "get off"
        return (l.isEmpty ? "" : l + ", ") + verb + " " + Clock.time(target)
    }
}
