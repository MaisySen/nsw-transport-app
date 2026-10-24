#if canImport(ActivityKit) && os(iOS)
import ActivityKit
import Foundation

/// The Live Activity for a watched trip: lock screen card and Dynamic Island.
public struct TripActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// When the vehicle leaves your stop (live when available).
        public var departs: Date
        /// When you arrive at the end of the trip, if known.
        public var arrives: Date?
        /// "3 min late", "On time", "Scheduled", "Cancelled".
        public var status: String
        public var isLive: Bool
        public var platform: String?
        /// A short line like "2 stops away" or "Approaching Ashfield".
        public var detail: String?
        public var stopsAway: Int?

        public init(departs: Date, arrives: Date?, status: String, isLive: Bool, platform: String?, detail: String?, stopsAway: Int?) {
            self.departs = departs; self.arrives = arrives; self.status = status; self.isLive = isLive
            self.platform = platform; self.detail = detail; self.stopsAway = stopsAway
        }
    }

    public var line: String
    public var lineColorHex: String
    public var mode: String
    public var from: String
    public var towards: String
    public var to: String?

    public init(line: String, lineColorHex: String, mode: String, from: String, towards: String, to: String?) {
        self.line = line; self.lineColorHex = lineColorHex; self.mode = mode
        self.from = from; self.towards = towards; self.to = to
    }
}
#endif
