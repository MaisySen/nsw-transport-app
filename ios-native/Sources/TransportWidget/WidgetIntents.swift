import AppIntents
import WidgetKit
import TransportKit

// MARK: What a widget shows, picked in its settings (touch and hold, Edit Widget)

/// A trip the widget can follow: Smart (Home or Work by time of day), a commute or a saved trip.
struct TripChoice: AppEntity, Hashable {
    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Trip" }
    static var defaultQuery: TripChoiceQuery { TripChoiceQuery() }

    /// "smart", or "fromID|toID|name" so the choice survives without a network call.
    var id: String
    var name: String
    var fromID: String
    var fromName: String
    var toID: String
    var toName: String

    var isSmart: Bool { id == "smart" }

    var displayRepresentation: DisplayRepresentation {
        if isSmart {
            return DisplayRepresentation(title: "Smart", subtitle: "Home to Work in the morning, back in the evening")
        }
        return DisplayRepresentation(title: "\(name)", subtitle: "\(Naming.compact(fromName)) to \(Naming.compact(toName))")
    }

    static let smart = TripChoice(id: "smart", name: "Smart", fromID: "", fromName: "", toID: "", toName: "")

    init(id: String, name: String, fromID: String, fromName: String, toID: String, toName: String) {
        self.id = id; self.name = name; self.fromID = fromID; self.fromName = fromName; self.toID = toID; self.toName = toName
    }

    init(name: String, from: StopRef, to: StopRef) {
        self.init(id: "\(from.id)|\(to.id)|\(name)|\(from.name)|\(to.name)", name: name,
                  fromID: from.id, fromName: Naming.short(from.name), toID: to.id, toName: Naming.short(to.name))
    }

    /// Rebuilds a choice from its id.
    init?(id: String) {
        if id == "smart" { self = .smart; return }
        let p = id.components(separatedBy: "|")
        guard p.count >= 5 else { return nil }
        self.init(id: id, name: p[2], fromID: p[0], fromName: p[3], toID: p[1], toName: p[4])
    }

    var from: StopRef { StopRef(id: fromID, name: fromName) }
    var to: StopRef { StopRef(id: toID, name: toName) }
}

struct TripChoiceQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [TripChoice] {
        identifiers.compactMap { TripChoice(id: $0) }
    }

    func suggestedEntities() async throws -> [TripChoice] {
        var out: [TripChoice] = [.smart]
        let api = TransportAPI.shared
        if let c = try? await api.commutes(device: nil) {
            for x in c.items where x.active != false {
                out.append(TripChoice(name: x.name ?? "Commute \(x.todText ?? "")", from: x.from, to: x.to))
            }
        }
        if let s = try? await api.saved() {
            for x in s { out.append(TripChoice(name: x.name.prefix(1).uppercased() + x.name.dropFirst(), from: x.from, to: x.to)) }
        }
        var seen = Set<String>()
        return out.filter { seen.insert($0.id).inserted }
    }

    func defaultResult() async -> TripChoice? { .smart }
}

/// A stop or station, found by typing its name.
struct StopChoice: AppEntity, Hashable {
    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Stop" }
    static var defaultQuery: StopChoiceQuery { StopChoiceQuery() }

    /// "stopID|name".
    var id: String
    var stopID: String
    var name: String

    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }

    init(_ s: StopRef) {
        stopID = s.id
        name = Naming.short(s.name)
        id = "\(s.id)|\(name)"
    }

    init?(id: String) {
        let p = id.components(separatedBy: "|")
        guard p.count >= 2 else { return nil }
        self.id = id; stopID = p[0]; name = p[1]
    }

    var ref: StopRef { StopRef(id: stopID, name: name) }

    static let popular: [StopChoice] = [
        StopChoice(StopRef(id: "200060", name: "Central Station")),
        StopChoice(StopRef(id: "200070", name: "Town Hall Station")),
        StopChoice(StopRef(id: "213510", name: "Strathfield Station")),
        StopChoice(StopRef(id: "213410", name: "Burwood Station")),
        StopChoice(StopRef(id: "215020", name: "Parramatta Station")),
    ]
}

struct StopChoiceQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [StopChoice] {
        identifiers.compactMap { StopChoice(id: $0) }
    }

    func entities(matching string: String) async throws -> [StopChoice] {
        let q = string.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else { return StopChoice.popular }
        return (try await TransportAPI.shared.search(q)).prefix(12).map { StopChoice($0) }
    }

    func suggestedEntities() async throws -> [StopChoice] {
        var out: [StopChoice] = []
        if let s = try? await TransportAPI.shared.saved() {
            for x in s { out.append(StopChoice(x.from)); out.append(StopChoice(x.to)) }
        }
        out += StopChoice.popular
        var seen = Set<String>()
        return out.filter { seen.insert($0.stopID).inserted }
    }
}

struct NextTripIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource { "Next trip" }
    static var description: IntentDescription { IntentDescription("Pick a saved trip, or two stops. Smart switches between Home and Work by time of day.") }

    @Parameter(title: "Trip")
    var trip: TripChoice?

    @Parameter(title: "Or from stop")
    var from: StopChoice?

    @Parameter(title: "To stop")
    var to: StopChoice?

    init() {}

    init(trip: TripChoice?, from: StopChoice? = nil, to: StopChoice? = nil) {
        self.trip = trip; self.from = from; self.to = to
    }
}

struct StopBoardIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource { "Stop board" }
    static var description: IntentDescription { IntentDescription("Live departures from one stop, like the screen on the platform.") }

    @Parameter(title: "Stop")
    var stop: StopChoice?

    @Parameter(title: "Only these lines", description: "For example T1, 461. Leave empty for all.")
    var lines: String?

    init() {}

    init(stop: StopChoice?, lines: String? = nil) {
        self.stop = stop; self.lines = lines
    }
}

/// The refresh button on the widgets. WidgetKit reloads the widget after it runs.
struct RefreshDeparturesIntent: AppIntent {
    static var title: LocalizedStringResource { "Refresh departures" }
    static var isDiscoverable: Bool { false }

    init() {}

    func perform() async throws -> some IntentResult {
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}

// MARK: Smart Home and Work

enum SmartTrip {
    /// The trip that matters now: the commute whose time is next (from 30 minutes ago),
    /// else a saved Home or Work trip by time of day, else the first saved trip.
    static func pick(now: Date = Date()) async -> (title: String, from: StopRef, to: StopRef, relevance: Float)? {
        let api = TransportAPI.shared
        let minute = Clock.minuteOfDay(now)
        if let c = try? await api.commutes(device: nil) {
            let active = c.items.filter { $0.active != false }
            let best = active.min { ahead(from: minute, to: $0.tod) < ahead(from: minute, to: $1.tod) }
            if let b = best {
                let gap = ahead(from: minute, to: b.tod)
                let soon: Float = (gap < 90 || gap > 24 * 60 - 30) ? 1 : 0.3
                return (b.name ?? (minute < 12 * 60 ? "Morning" : "Evening"), b.from, b.to, soon)
            }
        }
        guard let saved = try? await api.saved(), !saved.isEmpty else { return nil }
        let morning = minute < 12 * 60
        func named(_ word: String) -> SavedTrip? { saved.first { $0.name.lowercased().contains(word) } }
        let work = named("work"), home = named("home")
        if morning, let w = work { return ("Work", w.from, w.to, 0.8) }
        if !morning, let h = home { return ("Home", h.from, h.to, 0.8) }
        // One saved trip and its reverse: morning one way, evening the other.
        let first = saved[0]
        if !morning, saved.contains(where: { $0.from.id == first.to.id && $0.to.id == first.from.id }) {
            return ("Return", first.to, first.from, 0.6)
        }
        let t = home ?? work ?? first
        return (t.name.prefix(1).uppercased() + t.name.dropFirst(), t.from, t.to, 0.5)
    }

    /// Minutes from `from` forward to `to` on a 24 hour clock, starting 30 minutes back.
    static func ahead(from: Int, to: Int) -> Int {
        ((to - (from - 30)) % 1440 + 1440) % 1440
    }
}
