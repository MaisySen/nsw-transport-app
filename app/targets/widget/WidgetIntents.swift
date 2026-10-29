import AppIntents
import WidgetKit

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
    /// The one row the Trip picker shows when there are no saved trips yet.
    var isPlaceholder: Bool { id == "none" }

    var displayRepresentation: DisplayRepresentation {
        if isSmart {
            return DisplayRepresentation(title: "Home and Work (auto)", subtitle: "Home to Work in the morning, back in the evening")
        }
        if isPlaceholder { return DisplayRepresentation(title: "Save a trip in the app first") }
        return DisplayRepresentation(title: "\(Naming.compact(name))", subtitle: "\(Naming.compact(fromName)) to \(Naming.compact(toName))")
    }

    static let smart = TripChoice(id: "smart", name: "Smart", fromID: "", fromName: "", toID: "", toName: "")
    static let noSaved = TripChoice(id: "none", name: "Save a trip in the app first", fromID: "", fromName: "", toID: "", toName: "")

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
        if id == "none" { self = .noSaved; return }
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

    /// Your commutes and saved trips. Home and Work is its own choice under Show, so it is not listed here.
    func suggestedEntities() async throws -> [TripChoice] {
        var out: [TripChoice] = []
        var answered = false
        let api = TransportAPI.shared
        if let c = try? await api.commutes(device: nil) {
            answered = true
            for x in c.items where x.active != false {
                out.append(TripChoice(name: x.name ?? "Commute \(x.todText ?? "")", from: x.from, to: x.to))
            }
        }
        if let s = try? await api.saved() {
            answered = true
            for x in s { out.append(TripChoice(name: x.name.prefix(1).uppercased() + x.name.dropFirst(), from: x.from, to: x.to)) }
        }
        // Trips saved on this phone (Your trips), shared by the app through the app group.
        if let shared = SharedHomeWork.load() {
            answered = true
            for x in shared.trips ?? [] {
                let name = x.name.isEmpty ? "Trip" : x.name
                out.append(TripChoice(name: name.prefix(1).uppercased() + name.dropFirst(), from: x.from, to: x.to))
            }
        }
        var seen = Set<String>()
        out = out.filter { seen.insert($0.id).inserted }
        if out.isEmpty && answered { return [.noSaved] }
        return out
    }

    func defaultResult() async -> TripChoice? { nil }
}

/// A stop or station, found by typing its name.
struct StopChoice: AppEntity, Hashable {
    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Stop" }
    static var defaultQuery: StopChoiceQuery { StopChoiceQuery() }

    /// "stopID|name".
    var id: String
    var stopID: String
    var name: String

    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(Naming.compact(name))") }

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

    /// Your starred stops, shared by the app through the app group. Nothing is suggested for you.
    static var starred: [StopChoice] {
        guard let d = AppIdentity.groupDefaults.data(forKey: "starredStops"),
              let list = try? JSONDecoder().decode([StopRef].self, from: d) else { return [] }
        return list.map { StopChoice($0) }
    }
}

struct StopChoiceQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [StopChoice] {
        identifiers.compactMap { StopChoice(id: $0) }
    }

    func entities(matching string: String) async throws -> [StopChoice] {
        let q = string.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else { return try await suggestedEntities() }
        return (try await TransportAPI.shared.search(q)).prefix(12).map { StopChoice($0) }
    }

    func suggestedEntities() async throws -> [StopChoice] {
        var out: [StopChoice] = StopChoice.starred
        if let hw = SharedHomeWork.load() {
            if let h = hw.home { out.append(StopChoice(h)) }
            if let w = hw.work { out.append(StopChoice(w)) }
        }
        if let s = try? await TransportAPI.shared.saved() {
            for x in s { out.append(StopChoice(x.from)); out.append(StopChoice(x.to)) }
        }
        var seen = Set<String>()
        return out.filter { seen.insert($0.stopID).inserted }
    }
}

/// What the Next trip widget follows.
enum TripMode: String, AppEnum {
    case auto, saved, stops

    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Show" }
    static var caseDisplayRepresentations: [TripMode: DisplayRepresentation] {
        [.auto: "Home and Work (auto)", .saved: "Saved trip", .stops: "Pick stops"]
    }
}

struct NextTripIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource { "Next trip" }
    static var description: IntentDescription { IntentDescription("Live countdown to your next trip.") }

    /// Home and Work (auto) unless you pick another. Widgets set up before build 204 start on Home and Work too.
    @Parameter(title: "Show", default: .auto)
    var mode: TripMode

    @Parameter(title: "Trip")
    var trip: TripChoice?

    @Parameter(title: "From")
    var from: StopChoice?

    @Parameter(title: "To")
    var to: StopChoice?

    /// Only the rows for the chosen Show: Saved trip adds Trip, Pick stops adds From and To.
    static var parameterSummary: some ParameterSummary {
        When(\.$mode, .equalTo, .saved) {
            Summary("Show \(\.$mode)") {
                \.$trip
            }
        } otherwise: {
            When(\.$mode, .equalTo, .stops) {
                Summary("Show \(\.$mode)") {
                    \.$from
                    \.$to
                }
            } otherwise: {
                Summary("Show \(\.$mode)")
            }
        }
    }

    /// The chosen Show.
    var effectiveMode: TripMode { mode }

    init() {}

    init(mode: TripMode? = nil, trip: TripChoice?, from: StopChoice? = nil, to: StopChoice? = nil) {
        self.mode = mode ?? .auto; self.trip = trip; self.from = from; self.to = to
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
    /// A trip by name and stops, from the server or saved on this phone.
    struct Plain {
        var name: String
        var from: StopRef
        var to: StopRef
    }

    /// The trip that matters now: Home to Work before 12pm and Work to Home after (the app's Home and Work),
    /// else the commute whose time is next (from 30 minutes ago), else a saved Home or Work trip by time of day,
    /// else the first saved trip.
    static func pick(now: Date = Date()) async -> (title: String, from: StopRef, to: StopRef, relevance: Float)? {
        let shared = SharedHomeWork.load()
        if let c = shared?.commute(now: now) {
            return (c.title, c.from, c.to, 1)
        }
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
        var saved: [Plain] = []
        if let s = try? await api.saved() {
            for x in s { saved.append(Plain(name: x.name, from: x.from, to: x.to)) }
        }
        for x in shared?.trips ?? [] { saved.append(Plain(name: x.name.isEmpty ? "Trip" : x.name, from: x.from, to: x.to)) }
        guard !saved.isEmpty else { return nil }
        let morning = minute < 12 * 60
        func named(_ word: String) -> Plain? { saved.first { $0.name.lowercased().contains(word) } }
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

    /// Why there is nothing to show, in words that say what to do.
    static func emptyMessage() -> String {
        guard let shared = SharedHomeWork.load() else { return "Open the app once to share Home and Work." }
        if shared.home == nil || shared.work == nil { return "Set Home and Work in the app." }
        return "Home and Work are the same stop. Change one in the app."
    }

    /// Minutes from `from` forward to `to` on a 24 hour clock, starting 30 minutes back.
    static func ahead(from: Int, to: Int) -> Int {
        ((to - (from - 30)) % 1440 + 1440) % 1440
    }
}

// MARK: Shared by the app through the app group

/// Home, Work, the commute swap for this half day and the trips saved on this phone (key "homeWork"),
/// written by the app on start and whenever they change.
struct SharedHomeWork: Decodable {
    struct Trip: Decodable {
        var name: String
        var from: StopRef
        var to: StopRef
    }

    var home: StopRef?
    var work: StopRef?
    /// The half day the commute card was swapped for, "2026-10-25 pm".
    var flip: String?
    var trips: [Trip]?

    /// Nil until the app has shared it (an app opened only on an older build, or never opened).
    static func load(_ d: UserDefaults = AppIdentity.groupDefaults) -> SharedHomeWork? {
        guard let data = d.data(forKey: "homeWork") else { return nil }
        return try? JSONDecoder().decode(SharedHomeWork.self, from: data)
    }

    /// Home to Work before 12pm and Work to Home after, the other way round when the commute card was
    /// swapped for this half day. The same rule as the commute card on Home.
    func commute(now: Date = Date()) -> (title: String, from: StopRef, to: StopRef)? {
        guard let h = home, let w = work, !h.id.isEmpty, !w.id.isEmpty, h.id != w.id else { return nil }
        let morning = Clock.minuteOfDay(now) < 12 * 60
        var flipped = flip == SharedHomeWork.halfDayKey(now)
        // The widget's swap button turns it round again for this half day.
        if TSShared.widgetFlipped(now: now) { flipped.toggle() }
        if morning != flipped { return ("To work", h, w) }
        return ("To home", w, h)
    }

    /// "2026-10-25 am" in Sydney, the key the app writes when you swap the commute card.
    static func halfDayKey(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = Clock.sydney
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d) + (Clock.minuteOfDay(d) < 12 * 60 ? " am" : " pm")
    }
}

/// The card of a trip in progress (key "liveCard"), written by the app while the trip runs.
/// Times are milliseconds since 1970, as the app keeps them.
struct SharedLiveCard: Decodable {
    var title: String?
    var line: String
    var lineColorHex: String
    var mode: String
    var phase: String
    var getOffAt: String
    var destination: String?
    var nextStop: String?
    var platform: String?
    var departs: Double?
    var legArrives: Double?
    var arrival: Double
    var until: Double
    /// When the card's live times were loaded, ms (app code from 25 Oct; optional, older apps leave it out).
    var updated: Double?

    /// The card while the trip runs, nil once it has arrived or the app has not updated it for a while.
    static func load(now: Date = Date(), _ d: UserDefaults = AppIdentity.groupDefaults) -> SharedLiveCard? {
        guard let data = d.data(forKey: "liveCard"),
              let c = try? JSONDecoder().decode(SharedLiveCard.self, from: data) else { return nil }
        if c.phase == "arrived" { return nil }
        if Date(timeIntervalSince1970: c.until / 1000) <= now { return nil }
        return c
    }

    /// What the countdown is to: leaving while you wait, getting off while on board.
    var target: Date {
        let ms: Double = (phase == "wait" ? departs : legArrives) ?? arrival
        return Date(timeIntervalSince1970: ms / 1000)
    }
}
