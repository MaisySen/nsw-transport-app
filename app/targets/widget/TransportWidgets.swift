import WidgetKit
import SwiftUI
import AppIntents

#if !SNAPSHOT_TESTS
@main
struct TransportWidgets: WidgetBundle {
    var body: some Widget {
        NextTripWidget()
        StopBoardWidget()
        TripLiveActivity()
        LiveTripActivityWidget()
        if #available(iOS 18.0, *) {
            TrainHomeControl()
            StartCommuteControl()
        }
    }
}
#endif

// MARK: Next trip widget

/// The next services for a saved trip or two stops you pick, or Home and Work (auto): Home to Work in the
/// morning and back in the evening.
/// Live times come from the server. Home and Work, the trips saved on the phone and a trip in progress come
/// from the app through the app group.
struct NextTripWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "NextTrip", intent: NextTripIntent.self, provider: NextTripProvider()) { entry in
            NextTripView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Next trip")
        .description("Live countdown to your next trip.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge,
                            .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

struct TripLine: Hashable, Codable {
    var line: String
    var colorHex: String
    var mode: String
    var leave: Date
    var arrive: Date?
    var isLive: Bool
    var status: String
    var platform: String?
    var changes: Int = 0
    var stopID: String?
    /// When you board, if there is a walk first. The countdown is to `leave`, which includes the walk.
    var board: Date?
    /// `leave` by the timetable, for a live time that gets too old to call live (build 209). Nil on caches
    /// written by older builds and on rows that were never live.
    var timetable: Date?

    var walkMinutes: Int {
        guard let b = board else { return 0 }
        return max(0, Int((b.timeIntervalSince(leave) / 60).rounded()))
    }

    /// nswtransport://stop/STOP opens that stop's departures in the app.
    var followURL: URL? {
        guard let s = stopID, !s.isEmpty else { return nil }
        let id = s.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? s
        return URL(string: "nswtransport://stop/\(id)")
    }
}

/// A short warning shown on the widget itself: cancelled, platform change, trackwork.
struct WidgetNotice: Hashable {
    enum Level: Hashable { case info, warning, severe }
    var text: String
    var level: Level
}

struct NextTripEntry: TimelineEntry {
    var date: Date
    var title: String
    var from: String
    var to: String
    var trips: [TripLine]
    var message: String?
    var fromID: String = ""
    var toID: String = ""
    var notice: WidgetNotice?
    var updated: Date = .now
    var relevance: TimelineEntryRelevance?
    /// Home and Work (auto) showing the commute, so the swap button applies.
    var commute: Bool = false
    /// A trip in progress, from the app.
    var live: Bool = false
    /// When the live times were made, on the phone's clock (WidgetLive.dataAt). Nil: never aged (sample, offline).
    var dataAt: Date?
    /// "Updated 7 min ago" once a live time on this entry got too old to call live (build 209).
    var ago: String?

    static let sample = NextTripEntry(
        date: .now, title: "Home", from: "Burwood", to: "Central",
        trips: [TripLine(line: "T1", colorHex: "#F99D1C", mode: "train", leave: .now.addingTimeInterval(240),
                         arrive: .now.addingTimeInterval(1000), isLive: true, status: "On time", platform: "Platform 1"),
                TripLine(line: "T1", colorHex: "#F99D1C", mode: "train", leave: .now.addingTimeInterval(840),
                         arrive: .now.addingTimeInterval(1600), isLive: true, status: "2 min late", platform: "Platform 1"),
                TripLine(line: "T2", colorHex: "#0098CD", mode: "train", leave: .now.addingTimeInterval(1320),
                         arrive: .now.addingTimeInterval(2100), isLive: false, status: "Scheduled", platform: "Platform 2")],
        message: nil, fromID: "213410", toID: "200060")

    var url: URL? { WidgetText.tripURL(from: fromID, to: toID, leave: nil, fromName: from, toName: to) }
}

struct NextTripProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> NextTripEntry { .sample }

    func snapshot(for configuration: NextTripIntent, in context: Context) async -> NextTripEntry {
        if context.isPreview { return .sample }
        return await Self.load(configuration)
    }

    func timeline(for configuration: NextTripIntent, in context: Context) async -> Timeline<NextTripEntry> {
        let e = await Self.load(configuration)
        return Timeline(entries: Self.entries(from: e), policy: .after(WidgetText.reloadDate(updated: e.updated, departures: e.trips.map(\.leave), live: e.live)))
    }

    /// One entry a minute and one at each departure, so the minutes stay right and a service
    /// that has left is never shown. Also used by the tests.
    static func entries(from e: NextTripEntry) -> [NextTripEntry] {
        WidgetText.entryDates(updated: e.updated, departures: e.trips.map(\.leave)).map { d in
            var x = e
            x.date = d
            let (trips, demoted) = settle(e.trips, dataAt: e.dataAt, at: d)
            x.trips = WidgetText.upcoming(trips, at: d) { $0.leave }
            if demoted, let at = e.dataAt {
                x.ago = WidgetLive.ago(at, at: d)
                // An info line ("Trip started") and the live delay ("Running 6 min late") give way to the age;
                // alerts, cancellations and platform changes stay.
                if x.notice?.level == .info || x.notice?.text.hasPrefix("Running ") == true { x.notice = nil }
            }
            if x.trips.isEmpty, x.message == nil { x.message = "Checking for the next one" }
            return x
        }
    }

    /// The trips as they should read at `at`: a live time older than the app's rule (WidgetLive) shows its
    /// timetable time and is no longer live. Same order as the list, re-sorted only when a time moved.
    static func settle(_ trips: [TripLine], dataAt: Date?, at: Date) -> ([TripLine], Bool) {
        var any = false
        let out: [TripLine] = trips.map { t in
            let r = WidgetLive.settle(leave: t.leave, timetable: t.timetable, isLive: t.isLive, dataAt: dataAt, at: at)
            guard r.demoted else { return t }
            any = true
            var x = t
            if let b = t.board { x.board = b.addingTimeInterval(r.leave.timeIntervalSince(t.leave)) }
            x.leave = r.leave
            x.isLive = false
            return x
        }
        return (any ? out.sorted { $0.leave < $1.leave } : out, any)
    }

    static func load(_ c: NextTripIntent) async -> NextTripEntry {
        switch c.effectiveMode {
        case .stops:
            guard let f = c.from, let t = c.to else {
                return NextTripEntry(date: .now, title: "Next trip", from: "", to: "", trips: [],
                                     message: "Touch and hold, then Edit Widget to pick From and To.")
            }
            return await entry(title: "", from: f.ref, to: t.ref)
        case .saved:
            guard let t = c.trip, !t.isSmart, !t.isPlaceholder else {
                return NextTripEntry(date: .now, title: "Next trip", from: "", to: "", trips: [],
                                     message: c.trip?.isPlaceholder == true ? "Save a trip in the app first."
                                         : "Touch and hold, then Edit Widget to pick a saved trip.")
            }
            return await entry(title: Naming.compact(t.name), from: t.from, to: t.to)
        case .auto:
            break
        }
        if let live = SharedLiveCard.load() {
            return liveEntry(live)
        }
        guard let pick = await SmartTrip.pick() else {
            return NextTripEntry(date: .now, title: "Next trip", from: "", to: "", trips: [],
                                 message: SmartTrip.emptyMessage())
        }
        var e = await entry(title: pick.title, from: pick.from, to: pick.to)
        e.commute = SharedHomeWork.load()?.commute(now: Date()) != nil
        e.relevance = TimelineEntryRelevance(score: pick.relevance, duration: 30 * 60)
        return e
    }

    /// Live trips for one pair of stops. Also used by the snapshot tests.
    static func entry(title: String, from: StopRef, to: StopRef) async -> NextTripEntry {
        let api = TransportAPI.shared
        let fromName = Naming.compact(Naming.short(from.name)), toName = Naming.compact(Naming.short(to.name))
        guard let r = try? await api.trip(from: from.id, to: to.id, count: 6) else {
            // Offline: the last live times for this trip that have not left yet, marked as not live.
            if let c = TripCache.load(from: from.id, to: to.id) {
                let now = Date()
                let left: [TripLine] = c.trips.filter { $0.leave > now }.map { t in
                    var x = t
                    x.isLive = false
                    return x
                }
                if !left.isEmpty {
                    return NextTripEntry(date: now, title: title, from: fromName, to: toName, trips: left, message: nil,
                                         fromID: from.id, toID: to.id,
                                         notice: WidgetNotice(text: "Offline, times from \(Clock.time(c.updated))", level: .info),
                                         updated: now)
                }
            }
            return NextTripEntry(date: .now, title: title, from: fromName, to: toName,
                                 trips: [], message: "Offline. Live times will be back shortly.", fromID: from.id, toID: to.id)
        }
        let now = Date()
        let ok = r.journeys.filter { ($0.leave ?? .distantPast) > now && $0.firstTransit != nil }
        let trips: [TripLine] = ok.compactMap { j in
            guard let leave = j.leave, let f = j.firstTransit else { return nil }
            return TripLine(line: f.line ?? "", colorHex: f.color ?? Mode(raw: f.mode).fallbackHex, mode: f.mode ?? "bus",
                            leave: leave, arrive: j.arrive, isLive: j.live == true,
                            status: Delay.text(delayMin: f.delayMin, live: f.isLive, cancelled: j.anyCancelled == true),
                            platform: f.fromPlatform, changes: j.changes ?? 0, stopID: f.stopId, board: j.board,
                            timetable: WidgetLive.timetable(leave: leave, live: f.isLive ? f.estimated : nil, planned: f.planned))
        }
        // The feed's own time when the answer has it (newer server and app), else the newest fetch, else now.
        let dataAt = WidgetLive.dataAt(fetched: now, feedMs: r.live?.feedTs ?? r.live?.feedAt, serverNowMs: r.now)
        TripCache.save(Array(trips.prefix(6)), from: from.id, to: to.id, at: now)
        let rName = r.from.map { Naming.compact(Naming.short($0.name)) }
        let toResolved = r.to.map { Naming.compact(Naming.short($0.name)) }
        var e = NextTripEntry(date: now, title: title,
                             from: (rName?.allSatisfy(\.isNumber) == false ? rName : nil) ?? fromName,
                             to: (toResolved?.allSatisfy(\.isNumber) == false ? toResolved : nil) ?? toName,
                             trips: Array(trips.prefix(6)), message: trips.isEmpty ? "No trips soon." : nil,
                             fromID: from.id, toID: to.id, notice: notice(for: Array(ok.prefix(3))), updated: now)
        e.dataAt = dataAt
        return e
    }

    /// A trip in progress, from the app: the next thing to do and the minutes to it.
    static func liveEntry(_ c: SharedLiveCard, now: Date = Date()) -> NextTripEntry {
        let to = Naming.compact(Naming.short(c.destination ?? c.getOffAt))
        let off = Naming.compact(Naming.short(c.getOffAt))
        let waiting = c.phase == "wait"
        let status: String
        if waiting { status = "Leaves" } else if off == to { status = "Get off at \(off)" } else { status = "Change at \(off)" }
        let line = TripLine(line: c.line, colorHex: c.lineColorHex, mode: c.mode.isEmpty ? "train" : c.mode,
                            leave: c.target, arrive: Date(timeIntervalSince1970: c.arrival / 1000), isLive: true,
                            status: status, platform: waiting ? c.platform : nil)
        let from = waiting ? Naming.compact(Naming.short(c.nextStop ?? "")) : "On board"
        var e = NextTripEntry(date: now, title: "Your trip", from: from, to: to, trips: [line], message: nil,
                              notice: WidgetNotice(text: waiting ? "Trip started" : status, level: .info), updated: now)
        e.live = true
        // The app writes when the card's live times were loaded (build 207 on); a card older than the rule stops
        // counting as live in the timeline, like a fetched trip. No timetable time travels with the card.
        if let u = c.updated, u > 0 { e.dataAt = Date(timeIntervalSince1970: u / 1000) }
        return e
    }

    /// The one thing worth knowing before you leave, most serious first, and only about the
    /// services the widget shows.
    static func notice(for js: [Journey]) -> WidgetNotice? {
        guard let first = js.first else { return nil }
        if first.anyCancelled == true { return WidgetNotice(text: "Cancelled. Take the next one.", level: .severe) }
        if let l = first.transitLegs.first(where: { $0.platformChangedFrom != nil }), let p = l.fromPlatform {
            let now = WidgetText.plat(p) ?? p, was = WidgetText.plat(l.platformChangedFrom) ?? ""
            return WidgetNotice(text: "Now \(now), was \(was)", level: .warning)
        }
        var seen = Set<String>()
        let alerts = js.flatMap { $0.transitLegs.flatMap { $0.alerts ?? [] } }.filter { seen.insert($0.id).inserted }
        if let a = alerts.first(where: { $0.isSerious }), let t = a.title { return WidgetNotice(text: t, level: .severe) }
        let words = ["buses replace", "trackwork", "not running", "changed timetable", "delays"]
        if let a = alerts.first(where: { a in words.contains { (a.title ?? "").lowercased().contains($0) } }), let t = a.title {
            return WidgetNotice(text: t, level: .warning)
        }
        if let l = first.transitLegs.first, let d = l.delayMin, d >= 5 { return WidgetNotice(text: "Running \(d) min late", level: .warning) }
        return nil
    }
}

// MARK: Shared pieces

/// The last live times per trip, kept in the app group so an offline widget can still show them.
struct TripCache: Codable {
    var updated: Date
    var trips: [TripLine]

    static func key(from: String, to: String) -> String { "nextTripCache.\(from).\(to)" }

    static func save(_ trips: [TripLine], from: String, to: String, at: Date) {
        guard !trips.isEmpty, let data = try? JSONEncoder().encode(TripCache(updated: at, trips: trips)) else { return }
        AppIdentity.groupDefaults.set(data, forKey: key(from: from, to: to))
    }

    static func load(from: String, to: String) -> TripCache? {
        guard let data = AppIdentity.groupDefaults.data(forKey: key(from: from, to: to)) else { return nil }
        return try? JSONDecoder().decode(TripCache.self, from: data)
    }
}

struct WidgetLineBadge: View {
    var line: String
    var colorHex: String
    var mode: String
    var large = false

    var body: some View {
        let c = RGB(hex: colorHex)
        let white = c?.prefersWhiteText ?? true
        HStack(spacing: 2) {
            Image(systemName: Mode(raw: mode).symbol).font(.system(size: large ? 12 : 9, weight: .bold))
            Text(line).font((large ? Font.subheadline : .caption).weight(.bold))
        }
        .foregroundStyle(white ? Color.white : Color.black)
        .padding(.horizontal, large ? 7 : 5)
        .padding(.vertical, large ? 3 : 2)
        .background(Color(red: c?.r ?? 0, green: c?.g ?? 0.6, blue: c?.b ?? 0.9), in: RoundedRectangle(cornerRadius: large ? 6 : 5))
        .widgetAccentable()
        .accessibilityLabel("\(Mode(raw: mode).title) \(line)")
    }
}

/// The wait in whole minutes ("4 min", "Now"), or the clock time an hour or more out.
/// Never a seconds timer: a widget that ticks 12:56 reads like a clock.
struct WaitText: View {
    var leave: Date
    var now: Date

    var body: some View {
        Text(WidgetText.wait(leave, from: now))
            .accessibilityLabel(WidgetText.spokenWait(leave, from: now))
    }
}

/// One compact alert line with a warning icon. The words end at a whole word.
struct NoticeLine: View {
    var notice: WidgetNotice
    var maxChars = 40

    var body: some View {
        let color: Color = notice.level == .severe ? .red : (notice.level == .warning ? .orange : .secondary)
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Image(systemName: notice.level == .info ? "info.circle.fill" : "exclamationmark.triangle.fill")
                .accessibilityHidden(true)
            Text(WidgetText.compactAlert(notice.text, maxChars: maxChars))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .font(.caption2.weight(.semibold))
        .foregroundStyle(color)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Alert: \(notice.text)")
    }
}

enum WidgetStyle {
    static func statusColor(isLive: Bool, status: String) -> Color {
        if status == "Cancelled" { return .red }
        if !isLive || status == "Scheduled" { return .secondary }
        return status.contains("late") ? .orange : .green
    }
}

// MARK: Next trip views

struct NextTripView: View {
    var entry: NextTripEntry
    /// Set by the snapshot tests, which render the view outside a widget host.
    var familyOverride: WidgetFamily?
    /// StandBy and other places without a widget background; set by the snapshot tests.
    var standByOverride: Bool?
    @Environment(\.widgetFamily) private var hostFamily
    @Environment(\.showsWidgetContainerBackground) private var showsBackground

    private var family: WidgetFamily { familyOverride ?? hostFamily }
    private var standBy: Bool { standByOverride ?? !showsBackground }

    /// "Now", "4 min", or the clock time an hour or more out.
    static func wait(_ leave: Date, from now: Date) -> String { WidgetText.wait(leave, from: now) }

    static func statusColor(_ t: TripLine) -> Color { WidgetStyle.statusColor(isLive: t.isLive, status: t.status) }

    private var title: String { WidgetText.title(name: entry.title, from: entry.from, to: entry.to) }
    /// "Burwood to Central" under a saved trip's name; nothing when the title already says it.
    private var subtitle: String? {
        guard !entry.from.isEmpty, !entry.to.isEmpty else { return nil }
        let s = "\(entry.from) to \(entry.to)"
        return s == title ? nil : s
    }

    private func status(_ t: TripLine) -> String { WidgetText.status(isLive: t.isLive, status: t.status) }

    private func link(_ t: TripLine) -> URL? { WidgetText.tripURL(from: entry.fromID, to: entry.toID, leave: t.leave, fromName: entry.from, toName: entry.to) }
    private var alertsLink: URL? { WidgetText.alertsURL(from: entry.fromID, to: entry.toID, fromName: entry.from, toName: entry.to) }

    var body: some View {
        content.widgetURL(entry.trips.first.flatMap { link($0) } ?? entry.url)
    }

    @ViewBuilder private var content: some View {
        switch family {
        case .accessoryInline: inline
        case .accessoryCircular: circular
        case .accessoryRectangular: rectangular
        case .systemSmall: standBy ? AnyView(standByView) : AnyView(small)
        case .systemLarge: large
        default: medium
        }
    }

    // Lock Screen

    /// "T1 4 min, Plat 2"
    private var inline: some View {
        Group {
            if let t = entry.trips.first {
                Text(WidgetText.inline(line: t.line, leave: t.leave, platform: t.platform, now: entry.date))
            } else {
                Text(entry.message ?? "No trips soon")
            }
        }
    }

    private var circular: some View {
        Group {
            if let t = entry.trips.first {
                let mins = max(0, t.leave.timeIntervalSince(entry.date) / 60)
                Gauge(value: min(mins, 20), in: 0...20) {
                    Text(t.line)
                } currentValueLabel: {
                    Text(mins < 1 ? "Now" : (mins >= 60 ? Clock.time(t.leave).replacingOccurrences(of: "am", with: "").replacingOccurrences(of: "pm", with: "") : "\(Int(mins))"))
                        .font(.system(.title3, design: .rounded).weight(.bold))
                        .monospacedDigit()
                        .minimumScaleFactor(0.6)
                }
                .gaugeStyle(.accessoryCircular)
                .widgetAccentable()
                .accessibilityLabel("\(t.line) \(WidgetText.spokenWait(t.leave, from: entry.date))")
            } else {
                ZStack {
                    AccessoryWidgetBackground()
                    Image(systemName: "tram.fill").font(.title3)
                }
                .accessibilityLabel(entry.message ?? "No trips soon")
            }
        }
    }

    /// The next commute departure: the trip, the line with its wait and platform, then the status.
    /// At larger text sizes the status line goes first, so the rows are never cut off (build 210).
    private var rectangular: some View {
        ViewThatFits(in: .vertical) {
            rectangularBody(third: true)
            rectangularBody(third: false)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func rectangularBody(third: Bool) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(title).font(.headline).lineLimit(1).minimumScaleFactor(0.8).widgetAccentable()
            if let t = entry.trips.first {
                HStack(spacing: 4) {
                    Image(systemName: Mode(raw: t.mode).symbol).accessibilityHidden(true)
                    Text(t.line).fontWeight(.bold)
                    WaitText(leave: t.leave, now: entry.date).fontWeight(.semibold)
                    if let p = WidgetText.plat(t.platform) { Text(p) }
                }
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                if third {
                    if let n = entry.notice {
                        NoticeLine(notice: n, maxChars: 24)
                    } else {
                        let then = entry.trips.dropFirst().prefix(2).map { WidgetText.wait($0.leave, from: entry.date) }
                        Text(then.isEmpty ? status(t) : "\(status(t)). Then \(then.joined(separator: ", "))")
                            .font(.caption).lineLimit(1)
                    }
                }
            } else {
                Text(entry.message ?? "No trips soon").font(.caption).lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // Home Screen

    /// Fits every small widget size (148 pt on the smallest iPhones) at any text size: when the full layout is
    /// too tall, the "from to" line goes first, then the title drops to one line, then the status line
    /// (build 210, owner 30 Oct: a trip widget looked cut off).
    private var small: some View {
        ViewThatFits(in: .vertical) {
            smallBody(subtitle: true, titleLines: 2, status: true)
            smallBody(subtitle: false, titleLines: 2, status: true)
            smallBody(subtitle: false, titleLines: 1, status: true)
            smallBody(subtitle: false, titleLines: 1, status: false)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func smallBody(subtitle showSubtitle: Bool, titleLines: Int, status showStatus: Bool) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title).font(.subheadline.weight(.semibold)).lineLimit(titleLines).minimumScaleFactor(0.85)
            if showSubtitle, let s = subtitle { Text(s).font(.caption2).foregroundStyle(Color.secondary).lineLimit(1) }
            Spacer(minLength: 0)
            if let t = entry.trips.first {
                HStack(spacing: 4) {
                    WidgetLineBadge(line: t.line, colorHex: t.colorHex, mode: t.mode)
                    if let p = WidgetText.plat(t.platform) { Text(p).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
                }
                WaitText(leave: t.leave, now: entry.date)
                    .font(.system(.title, design: .rounded).weight(.bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if showStatus {
                    if let n = entry.notice {
                        NoticeLine(notice: n, maxChars: 20)
                    } else {
                        statusLine(t, font: .caption)
                    }
                }
            } else {
                Text(entry.message ?? "No trips soon").font(.caption).foregroundStyle(.secondary).lineLimit(3)
            }
        }
    }

    /// StandBy on a charger: big minutes you can read from across the room.
    private var standByView: some View {
        VStack(alignment: .leading, spacing: 2) {
            if let t = entry.trips.first {
                HStack(spacing: 6) {
                    WidgetLineBadge(line: t.line, colorHex: t.colorHex, mode: t.mode, large: true)
                    Text(title).font(.headline).lineLimit(1)
                }
                WaitText(leave: t.leave, now: entry.date)
                    .font(.system(size: 56, weight: .bold, design: .rounded))
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                if let n = entry.notice {
                    NoticeLine(notice: n, maxChars: 26)
                } else {
                    Text([WidgetText.plat(t.platform), status(t)].compactMap { $0 }.joined(separator: ", "))
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Self.statusColor(t))
                        .lineLimit(1)
                }
            } else {
                Text(entry.message ?? "No trips soon").font(.headline)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private var header: some View { header(subtitle: true, button: 28) }

    /// The title, the "from to" line when it fits on the same line, then Swap and Refresh.
    private func header(subtitle showSubtitle: Bool, button: CGFloat) -> some View {
        HStack(alignment: .center, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(title).font(.headline).lineLimit(1).minimumScaleFactor(0.85).layoutPriority(1)
                if showSubtitle, let s = subtitle { Text(s).font(.caption).foregroundStyle(Color.secondary).lineLimit(1) }
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
            if !entry.live && !entry.fromID.isEmpty {
                if entry.commute {
                    WidgetIconButton(intent: SwapCommuteIntent(), symbol: "arrow.up.arrow.down", label: "Swap direction", size: button)
                }
                WidgetIconButton(intent: RefreshDeparturesIntent(), symbol: "arrow.clockwise", label: "Refresh", size: button)
            }
        }
    }

    /// The Start button for the first service, when there is one to start.
    private var startURL: URL? {
        guard !entry.live, let t = entry.trips.first else { return nil }
        return WidgetText.startURL(from: entry.fromID, to: entry.toID, leave: t.leave, fromName: entry.from, toName: entry.to)
    }

    /// The notice or the time of the last update, then the Start button.
    private var footer: some View {
        HStack(alignment: .center, spacing: 6) {
            noticeOrUpdated
            Spacer(minLength: 4)
            if let u = startURL { StartTripLink(url: u) }
        }
    }

    /// "On time" in its colour, then a small "1 change" and "6 min walk" when they apply.
    private func statusLine(_ t: TripLine, font: Font = .caption2) -> some View {
        HStack(spacing: 4) {
            Text(status(t)).foregroundStyle(Self.statusColor(t)).fontWeight(.semibold)
            if let c = WidgetText.changes(t.changes) { Text(c).foregroundStyle(Color.secondary) }
            if t.walkMinutes > 0 { Text("\(t.walkMinutes) min walk").foregroundStyle(Color.secondary) }
        }
        .font(font)
        .lineLimit(1)
    }

    /// Every row has the same layout; the first is larger. Tapping a row opens that trip.
    @ViewBuilder private func row(_ t: TripLine, first: Bool) -> some View {
        let r = HStack(spacing: 8) {
            WidgetLineBadge(line: t.line, colorHex: t.colorHex, mode: t.mode, large: first)
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 4) {
                    Text(Clock.time(t.leave)).font((first ? Font.subheadline : .footnote).weight(.semibold)).monospacedDigit()
                        .foregroundStyle(Color.primary)
                    if let p = WidgetText.plat(t.platform) { Text(p).font(.caption2).foregroundStyle(Color.secondary) }
                }
                .lineLimit(1)
                statusLine(t)
            }
            Spacer(minLength: 4)
            WaitText(leave: t.leave, now: entry.date)
                .font(first ? .title3.weight(.bold) : .subheadline.weight(.semibold))
                .foregroundStyle(first ? Color.primary : Color.secondary)
                .monospacedDigit()
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
        if let u = link(t) { Link(destination: u) { r }.tint(Color.primary) } else { r }
    }

    @ViewBuilder private var noticeOrUpdated: some View {
        if let n = entry.notice {
            let chars = startURL == nil ? 44 : 32
            if let u = alertsLink { Link(destination: u) { NoticeLine(notice: n, maxChars: chars) } }
            else { NoticeLine(notice: n, maxChars: chars) }
        } else {
            Text(entry.ago ?? "Updated \(Clock.time(entry.updated))").font(.caption2).foregroundStyle(.secondary).monospacedDigit()
        }
    }

    /// The medium widget is about 126 pt tall inside its margins on most iPhones and less on the smallest, so the
    /// full layout (two rows and the footer) does not always fit. The first layout that fits wins: two rows,
    /// then one row, then without the "from to" line, then without the footer. Nothing is ever cut off and
    /// nothing is a fixed height (build 210; owner 30 Oct, build 209: "This one widget looks cut off").
    private var medium: some View {
        ViewThatFits(in: .vertical) {
            mediumBody(rows: 2, subtitle: true, footer: true)
            mediumBody(rows: 1, subtitle: true, footer: true)
            mediumBody(rows: 1, subtitle: false, footer: true)
            mediumBody(rows: 1, subtitle: false, footer: false)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func mediumBody(rows: Int, subtitle: Bool, footer showFooter: Bool) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            header(subtitle: subtitle, button: 24)
            if entry.trips.isEmpty {
                Spacer(minLength: 0)
                Text(entry.message ?? "No trips soon").font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            }
            ForEach(Array(entry.trips.prefix(rows).enumerated()), id: \.offset) { i, t in
                row(t, first: i == 0)
            }
            Spacer(minLength: 0)
            if showFooter { footer }
        }
    }

    /// Up to five rows (four with a notice); fewer when they do not fit, for example on the smallest iPhones
    /// or at a larger text size (build 210).
    private var large: some View {
        let most = entry.notice == nil ? 5 : 4
        return ViewThatFits(in: .vertical) {
            largeBody(rows: most)
            largeBody(rows: most - 1)
            largeBody(rows: most - 2)
            largeBody(rows: 2)
            largeBody(rows: 1)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func largeBody(rows: Int) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            header
            if entry.trips.isEmpty {
                Text(entry.message ?? "No trips soon").font(.subheadline).foregroundStyle(.secondary).lineLimit(3)
            }
            ForEach(Array(entry.trips.prefix(rows).enumerated()), id: \.offset) { i, t in
                row(t, first: i == 0)
                if i == 0 && min(rows, entry.trips.count) > 1 { Divider() }
            }
            Spacer(minLength: 0)
            footer
        }
    }
}

// MARK: Stop board widget

struct StopBoardWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "StopBoard", intent: StopBoardIntent.self, provider: StopBoardProvider()) { entry in
            StopBoardView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Stop board")
        .description("Live departures from one stop, filtered to the lines you use.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular])
    }
}

struct BoardRow: Hashable {
    var line: String
    var colorHex: String
    var mode: String
    var dest: String
    var time: Date
    var isLive: Bool
    var status: String
    var platform: String?
    /// `time` by the timetable, and when this row's live time was made on the phone's clock (build 209).
    var timetable: Date?
    var liveAt: Date?
}

struct StopBoardEntry: TimelineEntry {
    var date: Date
    var stopID: String
    var stopName: String
    var filter: String?
    var rows: [BoardRow]
    var message: String?
    var notice: WidgetNotice?
    var updated: Date = .now
    /// "Updated 7 min ago" once a live time on this entry got too old to call live (build 209).
    var ago: String?

    static let sample = StopBoardEntry(
        date: .now, stopID: "200060", stopName: "Central", filter: nil,
        rows: [BoardRow(line: "T1", colorHex: "#F99D1C", mode: "train", dest: "Emu Plains", time: .now.addingTimeInterval(120), isLive: true, status: "On time", platform: "Platform 18"),
               BoardRow(line: "T4", colorHex: "#005AA3", mode: "train", dest: "Cronulla", time: .now.addingTimeInterval(300), isLive: true, status: "1 min late", platform: "Platform 24"),
               BoardRow(line: "L2", colorHex: "#E4022D", mode: "lightrail", dest: "Randwick", time: .now.addingTimeInterval(420), isLive: false, status: "Scheduled", platform: nil)],
        message: nil)
}

struct StopBoardProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> StopBoardEntry { .sample }

    func snapshot(for configuration: StopBoardIntent, in context: Context) async -> StopBoardEntry {
        if context.isPreview { return .sample }
        return await Self.load(configuration)
    }

    func timeline(for configuration: StopBoardIntent, in context: Context) async -> Timeline<StopBoardEntry> {
        let e = await Self.load(configuration)
        let entries = (0..<15).map { i -> StopBoardEntry in
            var x = e
            x.date = e.updated.addingTimeInterval(Double(i) * 60)
            let (rows, oldest) = Self.settle(e.rows, at: x.date)
            x.rows = WidgetText.upcoming(rows, at: x.date) { $0.time }
            if let o = oldest { x.ago = WidgetLive.ago(o, at: x.date) }
            return x
        }
        return Timeline(entries: entries, policy: .after(WidgetText.reloadDate(updated: e.updated, departures: e.rows.map(\.time))))
    }

    static func load(_ c: StopBoardIntent) async -> StopBoardEntry {
        // No stop is ever picked for you: your first starred stop, else a prompt to choose one.
        guard let stop = c.stop ?? StopChoice.starred.first else {
            return StopBoardEntry(date: .now, stopID: "", stopName: "Stop board", filter: nil, rows: [],
                                  message: "Touch and hold, then Edit Widget to choose a stop.")
        }
        return await entry(stop: stop.ref, lines: c.lines)
    }

    /// The rows as they should read at `at` (WidgetLive): a live time older than the app's rule shows its timetable
    /// time. Also returns the data time of the oldest row that stopped being live, for "Updated N min ago".
    static func settle(_ rows: [BoardRow], at: Date) -> ([BoardRow], Date?) {
        var oldest: Date?
        let out: [BoardRow] = rows.map { r in
            let s = WidgetLive.settle(leave: r.time, timetable: r.timetable, isLive: r.isLive, dataAt: r.liveAt, at: at)
            guard s.demoted else { return r }
            if let l = r.liveAt { oldest = min(oldest ?? l, l) }
            var x = r
            x.time = s.leave
            x.isLive = false
            return x
        }
        return (oldest == nil ? out : out.sorted { $0.time < $1.time }, oldest)
    }

    /// Live departures for one stop, optionally only some lines. Also used by the snapshot tests.
    static func entry(stop: StopRef, lines: String?) async -> StopBoardEntry {
        let wanted = Set((lines ?? "").uppercased().split(whereSeparator: { $0 == "," || $0 == " " }).map(String.init))
        let name = Naming.compact(Naming.short(stop.name))
        guard let r = try? await TransportAPI.shared.departures(stop: stop.id, device: nil) else {
            return StopBoardEntry(date: .now, stopID: stop.id, stopName: name, filter: lines, rows: [],
                                  message: "Live times will be back shortly.")
        }
        let now = Date()
        // Each row ages from its own feed time (liveAt, every server since 28 Oct), else the board's, else now.
        let boardFeed = r.live?.feedTs ?? r.live?.feedAt
        let rows: [BoardRow] = r.items.compactMap { d in
            guard let t = d.bestTime, t > now else { return nil }
            if !wanted.isEmpty && !wanted.contains(d.line.uppercased()) { return nil }
            return BoardRow(line: d.line, colorHex: d.color ?? Mode(raw: d.mode).fallbackHex, mode: d.mode ?? "bus",
                            dest: Naming.compact(Naming.short(d.dest ?? "")), time: t, isLive: d.isLive,
                            status: Delay.text(delayMin: d.delayMin, live: d.isLive, cancelled: d.isCancelled),
                            platform: d.platform, timetable: d.isLive ? d.planned : nil,
                            liveAt: d.isLive ? WidgetLive.dataAt(fetched: now, feedMs: d.liveAt ?? boardFeed, serverNowMs: r.now) : nil)
        }
        let serious = (r.alerts ?? []).first { $0.isSerious }
        let resolved = r.stop.map { Naming.compact(Naming.short($0.name)) }
        return StopBoardEntry(date: now, stopID: stop.id,
                              stopName: (resolved?.allSatisfy(\.isNumber) == false ? resolved : nil) ?? name,
                              filter: wanted.isEmpty ? nil : wanted.sorted().joined(separator: ", "),
                              rows: Array(rows.prefix(10)), message: rows.isEmpty ? "No departures soon." : nil,
                              notice: serious?.title.map { WidgetNotice(text: $0, level: .severe) }, updated: now)
    }
}

struct StopBoardView: View {
    var entry: StopBoardEntry
    var familyOverride: WidgetFamily?
    @Environment(\.widgetFamily) private var hostFamily

    private var family: WidgetFamily { familyOverride ?? hostFamily }

    var body: some View {
        content.widgetURL(URL(string: "nswtransport://stop/\(entry.stopID)"))
    }

    @ViewBuilder private var content: some View {
        switch family {
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text(entry.stopName).font(.headline).lineLimit(1).widgetAccentable()
                ForEach(Array(entry.rows.prefix(2).enumerated()), id: \.offset) { _, r in
                    HStack(spacing: 4) {
                        Text(r.line).fontWeight(.bold)
                        Text(r.dest).lineLimit(1)
                        Spacer(minLength: 2)
                        WaitText(leave: r.time, now: entry.date).monospacedDigit()
                    }
                    .font(.caption)
                }
            }
        case .systemSmall:
            board(rows: 3, compact: true)
        case .systemLarge:
            board(rows: 8, compact: false)
        default:
            board(rows: 4, compact: false)
        }
    }

    private func board(rows count: Int, compact: Bool) -> some View {
        VStack(alignment: .leading, spacing: compact ? 5 : 6) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(entry.stopName).font(.headline).lineLimit(1)
                if let f = entry.filter, !compact { Text(f).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                Spacer(minLength: 0)
            }
            if entry.rows.isEmpty {
                Spacer(minLength: 0)
                Text(entry.message ?? "No departures soon.").font(.subheadline).foregroundStyle(.secondary)
            }
            ForEach(Array(entry.rows.prefix(count).enumerated()), id: \.offset) { i, r in
                HStack(spacing: 6) {
                    WidgetLineBadge(line: r.line, colorHex: r.colorHex, mode: r.mode)
                    if !compact {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(r.dest).font(.subheadline.weight(.medium)).lineLimit(1)
                            Text([WidgetText.plat(r.platform), WidgetText.status(isLive: r.isLive, status: r.status)].compactMap { $0 }.joined(separator: ", "))
                                .font(.caption2)
                                .foregroundStyle(WidgetStyle.statusColor(isLive: r.isLive, status: r.status))
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 2)
                    WaitText(leave: r.time, now: entry.date)
                        .font(i == 0 ? (compact ? Font.subheadline : .headline).weight(.bold) : .subheadline.weight(.semibold))
                        .foregroundStyle(i == 0 || r.isLive ? Color.primary : Color.secondary)
                        .monospacedDigit()
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            if !compact {
                HStack(spacing: 6) {
                    if let n = entry.notice { NoticeLine(notice: n, maxChars: 44) }
                    else { Text(entry.ago ?? "Updated \(Clock.time(entry.updated))").font(.caption2).foregroundStyle(.secondary).monospacedDigit() }
                    Spacer(minLength: 0)
                }
            }
        }
    }
}
