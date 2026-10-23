import WidgetKit
import SwiftUI
import AppIntents
import TransportKit

#if !SNAPSHOT_TESTS
@main
struct TransportWidgets: WidgetBundle {
    var body: some Widget {
        NextTripWidget()
        StopBoardWidget()
        TripLiveActivity()
    }
}
#endif

// MARK: Next trip widget

/// The next services for a trip you pick, or Smart: Home to Work in the morning and back in the evening.
/// Data comes from the server, so the widget needs no shared storage with the app.
struct NextTripWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "NextTrip", intent: NextTripIntent.self, provider: NextTripProvider()) { entry in
            NextTripView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Next trip")
        .description("A live countdown for your trip. Smart shows Home to Work in the morning and back in the evening.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge,
                            .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

struct TripLine: Hashable {
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

    var walkMinutes: Int {
        guard let b = board else { return 0 }
        return max(0, Int((b.timeIntervalSince(leave) / 60).rounded()))
    }

    /// nswtransport://follow/STOP/LINE opens the service on the map and starts the Lock Screen countdown.
    var followURL: URL? {
        guard let s = stopID, !s.isEmpty else { return nil }
        let l = line.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? line
        return URL(string: "nswtransport://follow/\(s)/\(l)")
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

    static let sample = NextTripEntry(
        date: .now, title: "Home", from: "Burwood", to: "Central",
        trips: [TripLine(line: "T1", colorHex: "#F99D1C", mode: "train", leave: .now.addingTimeInterval(240),
                         arrive: .now.addingTimeInterval(1000), isLive: true, status: "On time", platform: "Platform 1"),
                TripLine(line: "T1", colorHex: "#F99D1C", mode: "train", leave: .now.addingTimeInterval(840),
                         arrive: .now.addingTimeInterval(1600), isLive: true, status: "2 min late", platform: "Platform 1"),
                TripLine(line: "T2", colorHex: "#0098CD", mode: "train", leave: .now.addingTimeInterval(1320),
                         arrive: .now.addingTimeInterval(2100), isLive: false, status: "Scheduled", platform: "Platform 2")],
        message: nil, fromID: "213410", toID: "200060")

    var url: URL? {
        guard !fromID.isEmpty, !toID.isEmpty else { return URL(string: "nswtransport://tab/home") }
        return URL(string: "nswtransport://trip/\(fromID)/\(toID)")
    }
}

struct NextTripProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> NextTripEntry { .sample }

    func snapshot(for configuration: NextTripIntent, in context: Context) async -> NextTripEntry {
        if context.isPreview { return .sample }
        return await Self.load(configuration)
    }

    func timeline(for configuration: NextTripIntent, in context: Context) async -> Timeline<NextTripEntry> {
        let e = await Self.load(configuration)
        // One entry a minute so departed services drop off and the ring moves; the seconds tick on their own.
        let entries = (0..<20).map { i -> NextTripEntry in
            var x = e
            x.date = e.updated.addingTimeInterval(Double(i) * 60)
            x.trips = e.trips.filter { $0.leave > x.date.addingTimeInterval(-20) }
            if x.trips.isEmpty, x.message == nil { x.message = "Checking for the next one" }
            return x
        }
        // Fresh live data every five minutes, sooner when the next service is about to go.
        let soon = e.trips.first.map { $0.leave.addingTimeInterval(30) } ?? e.updated.addingTimeInterval(300)
        let next = min(e.updated.addingTimeInterval(300), max(soon, e.updated.addingTimeInterval(90)))
        return Timeline(entries: entries, policy: .after(next))
    }

    static func load(_ c: NextTripIntent) async -> NextTripEntry {
        if let f = c.from, let t = c.to {
            return await entry(title: Naming.compact(t.name), from: f.ref, to: t.ref)
        }
        if let t = c.trip, !t.isSmart {
            return await entry(title: t.name, from: t.from, to: t.to)
        }
        guard let pick = await SmartTrip.pick() else {
            return NextTripEntry(date: .now, title: "Transport", from: "", to: "", trips: [],
                                 message: "Touch and hold, then Edit Widget to pick a trip.")
        }
        var e = await entry(title: pick.title, from: pick.from, to: pick.to)
        e.relevance = TimelineEntryRelevance(score: pick.relevance, duration: 30 * 60)
        return e
    }

    /// Live trips for one pair of stops. Also used by the snapshot tests.
    static func entry(title: String, from: StopRef, to: StopRef) async -> NextTripEntry {
        let api = TransportAPI.shared
        let fromName = Naming.compact(Naming.short(from.name)), toName = Naming.compact(Naming.short(to.name))
        guard let r = try? await api.trip(from: from.id, to: to.id, count: 6) else {
            return NextTripEntry(date: .now, title: title, from: fromName, to: toName,
                                 trips: [], message: "Live times will be back shortly.", fromID: from.id, toID: to.id)
        }
        let now = Date()
        let ok = r.journeys.filter { ($0.leave ?? .distantPast) > now.addingTimeInterval(-30) && $0.firstTransit != nil }
        let trips: [TripLine] = ok.compactMap { j in
            guard let leave = j.leave, let f = j.firstTransit else { return nil }
            return TripLine(line: f.line ?? "", colorHex: f.color ?? Mode(raw: f.mode).fallbackHex, mode: f.mode ?? "bus",
                            leave: leave, arrive: j.arrive, isLive: j.live == true,
                            status: Delay.text(delayMin: f.delayMin, live: f.isLive, cancelled: j.anyCancelled == true),
                            platform: f.fromPlatform, changes: j.changes ?? 0, stopID: f.stopId, board: j.board)
        }
        let rName = r.from.map { Naming.compact(Naming.short($0.name)) }
        let toResolved = r.to.map { Naming.compact(Naming.short($0.name)) }
        return NextTripEntry(date: now, title: title,
                             from: (rName?.allSatisfy(\.isNumber) == false ? rName : nil) ?? fromName,
                             to: (toResolved?.allSatisfy(\.isNumber) == false ? toResolved : nil) ?? toName,
                             trips: Array(trips.prefix(6)), message: trips.isEmpty ? "No trips soon." : nil,
                             fromID: from.id, toID: to.id, notice: notice(for: ok.first), updated: now)
    }

    /// The one thing worth knowing before you leave, most serious first.
    static func notice(for j: Journey?) -> WidgetNotice? {
        guard let j else { return nil }
        let legs = j.transitLegs
        if j.anyCancelled == true { return WidgetNotice(text: "Cancelled. Take the next one.", level: .severe) }
        if let l = legs.first(where: { $0.platformChangedFrom != nil }), let p = l.fromPlatform {
            return WidgetNotice(text: "Now \(p), was \(l.platformChangedFrom ?? "")", level: .warning)
        }
        let alerts = legs.flatMap { $0.alerts ?? [] }
        if let a = alerts.first(where: { $0.isSerious }), let t = a.title { return WidgetNotice(text: t, level: .severe) }
        let words = ["buses replace", "trackwork", "not running", "changed timetable", "delays"]
        if let a = alerts.first(where: { a in words.contains { (a.title ?? "").lowercased().contains($0) } }), let t = a.title {
            return WidgetNotice(text: t, level: .warning)
        }
        if let l = legs.first, let d = l.delayMin, d >= 5 { return WidgetNotice(text: "Running \(d) min late", level: .warning) }
        return nil
    }
}

// MARK: Shared pieces

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
    }
}

/// Minutes and seconds that tick on the widget itself, stopping at 0:00.
struct TickingCountdown: View {
    var leave: Date
    var now: Date

    var body: some View {
        if leave.timeIntervalSince(now) >= 3600 {
            Text(Clock.time(leave))
        } else {
            Text(timerInterval: min(now, leave)...leave, countsDown: true)
        }
    }
}

struct UpdatedFooter: View {
    var updated: Date
    var compact = false

    var body: some View {
        HStack(spacing: 4) {
            Text(compact ? Clock.time(updated) : "Updated \(Clock.time(updated))")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .monospacedDigit()
            Spacer(minLength: 0)
            RefreshButton()
        }
    }
}

struct RefreshButton: View {
    var body: some View {
        Button(intent: RefreshDeparturesIntent()) {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
                .frame(width: 24, height: 24)
                .background(.quaternary, in: Circle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .accessibilityLabel("Refresh")
    }
}

struct NoticeLine: View {
    var notice: WidgetNotice

    var body: some View {
        let color: Color = notice.level == .severe ? .red : (notice.level == .warning ? .orange : .secondary)
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Image(systemName: notice.level == .info ? "info.circle.fill" : "exclamationmark.triangle.fill")
            Text(notice.text).lineLimit(1)
        }
        .font(.caption2.weight(.semibold))
        .foregroundStyle(color)
    }
}

enum WidgetStyle {
    static func statusColor(isLive: Bool, status: String) -> Color {
        if status == "Cancelled" { return .red }
        if !isLive { return .secondary }
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

    /// "Now", "4 min", "1 hr 5 min", the way Maps shows a wait.
    static func wait(_ leave: Date, from now: Date, inline: Bool = false) -> String {
        let m = Int((leave.timeIntervalSince(now) / 60).rounded(.down))
        if m <= 0 { return "Now" }
        let text = m < 60 ? "\(m) min" : (m % 60 == 0 ? "\(m / 60) hr" : "\(m / 60) hr \(m % 60) min")
        return inline ? "in \(text)" : text
    }

    static func statusColor(_ t: TripLine) -> Color { WidgetStyle.statusColor(isLive: t.isLive, status: t.status) }

    private func statusText(_ t: TripLine) -> String {
        let s = t.isLive ? t.status : "Scheduled"
        return t.walkMinutes > 0 ? "\(t.walkMinutes) min walk first. \(s)" : s
    }

    /// The pill on the first row that starts the Lock Screen countdown for that service.
    @ViewBuilder private func trackButton(_ t: TripLine) -> some View {
        if let u = t.followURL {
            Link(destination: u) {
                Label("Track", systemImage: "location.fill")
                    .font(.caption2.weight(.semibold))
                    .labelStyle(.titleAndIcon)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(.tint.opacity(0.15), in: Capsule())
                    .foregroundStyle(.tint)
            }
        }
    }

    var body: some View {
        content.widgetURL(entry.url)
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

    private var inline: some View {
        Group {
            if let t = entry.trips.first {
                Text("\(Image(systemName: Mode(raw: t.mode).symbol)) \(t.line) \(Self.wait(t.leave, from: entry.date, inline: true))")
            } else {
                Text(entry.message ?? "No trips")
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
                    Text(mins < 1 ? "Now" : "\(Int(mins))")
                        .font(.system(.title3, design: .rounded).weight(.bold))
                        .monospacedDigit()
                }
                .gaugeStyle(.accessoryCircular)
                .widgetAccentable()
            } else {
                ZStack {
                    AccessoryWidgetBackground()
                    Image(systemName: "tram.fill").font(.title3)
                }
            }
        }
    }

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("\(entry.title): \(entry.to)").font(.headline).lineLimit(1).widgetAccentable()
            if let t = entry.trips.first {
                HStack(spacing: 4) {
                    Image(systemName: Mode(raw: t.mode).symbol)
                    Text(t.line).fontWeight(.bold)
                    TickingCountdown(leave: t.leave, now: entry.date).monospacedDigit()
                }
                if let n = entry.notice {
                    Text(n.text).font(.caption).lineLimit(1)
                } else {
                    let then = entry.trips.dropFirst().prefix(2).map { Clock.time($0.leave) }
                    Text(then.isEmpty ? statusText(t) : "\(statusText(t)). Then \(then.joined(separator: ", "))")
                        .font(.caption).lineLimit(1)
                }
            } else {
                Text(entry.message ?? "No trips").font(.caption)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // Home Screen

    private var small: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(entry.title).font(.headline).lineLimit(1)
                    Text("to \(entry.to)").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 2)
                RefreshButton()
            }
            Spacer(minLength: 0)
            if let t = entry.trips.first {
                HStack(spacing: 4) {
                    WidgetLineBadge(line: t.line, colorHex: t.colorHex, mode: t.mode)
                    if let p = t.platform { Text(p.replacingOccurrences(of: "Platform", with: "Plat")).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
                }
                TickingCountdown(leave: t.leave, now: entry.date)
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .multilineTextAlignment(.leading)
                if let n = entry.notice {
                    NoticeLine(notice: n)
                } else {
                    Text(statusText(t))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Self.statusColor(t))
                        .lineLimit(1)
                }
            } else {
                Text(entry.message ?? "No trips").font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    /// StandBy on a charger: one huge countdown you can read from across the room.
    private var standByView: some View {
        VStack(alignment: .leading, spacing: 2) {
            if let t = entry.trips.first {
                HStack(spacing: 6) {
                    WidgetLineBadge(line: t.line, colorHex: t.colorHex, mode: t.mode, large: true)
                    Text("to \(entry.to)").font(.headline).lineLimit(1)
                }
                TickingCountdown(leave: t.leave, now: entry.date)
                    .font(.system(size: 64, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                Text(entry.notice?.text ?? "\(statusText(t))\(t.platform.map { ". \($0)" } ?? "")")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(entry.notice == nil ? Self.statusColor(t) : .orange)
                    .lineLimit(1)
            } else {
                Text(entry.message ?? "No trips").font(.headline)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(entry.title).font(.headline).lineLimit(1)
            Text("\(entry.from) to \(entry.to)").font(.caption).foregroundStyle(.secondary).lineLimit(1)
            Spacer(minLength: 0)
        }
    }

    private func row(_ t: TripLine, first: Bool) -> some View {
        HStack(spacing: 8) {
            WidgetLineBadge(line: t.line, colorHex: t.colorHex, mode: t.mode)
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 4) {
                    Text(Clock.time(t.leave)).font(.subheadline.weight(.semibold)).monospacedDigit()
                    if let p = t.platform {
                        Text(p.replacingOccurrences(of: "Platform", with: "Plat")).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Text(t.changes > 0 ? "\(statusText(t)). \(t.changes) change\(t.changes == 1 ? "" : "s")" : statusText(t))
                    .font(.caption2)
                    .foregroundStyle(Self.statusColor(t))
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            if first {
                TickingCountdown(leave: t.leave, now: entry.date)
                    .font(.title3.weight(.bold))
                    .monospacedDigit()
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 80, alignment: .trailing)
            } else {
                Text(Self.wait(t.leave, from: entry.date))
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }

    private var medium: some View {
        VStack(alignment: .leading, spacing: 6) {
            header
            if entry.trips.isEmpty {
                Spacer(minLength: 0)
                Text(entry.message ?? "No trips").font(.subheadline).foregroundStyle(.secondary)
            }
            ForEach(Array(entry.trips.prefix(entry.notice == nil ? 3 : 2).enumerated()), id: \.offset) { i, t in
                row(t, first: i == 0)
            }
            Spacer(minLength: 0)
            HStack(spacing: 6) {
                if let n = entry.notice { NoticeLine(notice: n) }
                else { Text("Updated \(Clock.time(entry.updated))").font(.caption2).foregroundStyle(.secondary).monospacedDigit() }
                Spacer(minLength: 0)
                if let t = entry.trips.first { trackButton(t) }
                RefreshButton()
            }
        }
    }

    private var large: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            if let t = entry.trips.first {
                HStack(alignment: .center) {
                    VStack(alignment: .leading, spacing: 2) {
                        WidgetLineBadge(line: t.line, colorHex: t.colorHex, mode: t.mode, large: true)
                        Text(t.platform ?? statusText(t)).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 0) {
                        TickingCountdown(leave: t.leave, now: entry.date)
                            .font(.system(size: 40, weight: .bold, design: .rounded))
                            .monospacedDigit()
                            .multilineTextAlignment(.trailing)
                        Text(statusText(t)).font(.caption.weight(.semibold)).foregroundStyle(Self.statusColor(t))
                    }
                }
                if let n = entry.notice { NoticeLine(notice: n) }
                Divider()
            } else {
                Text(entry.message ?? "No trips").font(.subheadline).foregroundStyle(.secondary)
            }
            ForEach(Array(entry.trips.dropFirst().prefix(5).enumerated()), id: \.offset) { _, t in
                row(t, first: false)
            }
            Spacer(minLength: 0)
            HStack(spacing: 6) {
                Text("Updated \(Clock.time(entry.updated))").font(.caption2).foregroundStyle(.secondary).monospacedDigit()
                Spacer(minLength: 0)
                if let t = entry.trips.first { trackButton(t) }
                RefreshButton()
            }
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
            x.rows = e.rows.filter { $0.time > x.date.addingTimeInterval(-20) }
            return x
        }
        return Timeline(entries: entries, policy: .after(e.updated.addingTimeInterval(300)))
    }

    static func load(_ c: StopBoardIntent) async -> StopBoardEntry {
        let stop = c.stop ?? StopChoice.popular[0]
        return await entry(stop: stop.ref, lines: c.lines)
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
        let rows: [BoardRow] = r.items.compactMap { d in
            guard let t = d.bestTime, t > now.addingTimeInterval(-30) else { return nil }
            if !wanted.isEmpty && !wanted.contains(d.line.uppercased()) { return nil }
            return BoardRow(line: d.line, colorHex: d.color ?? Mode(raw: d.mode).fallbackHex, mode: d.mode ?? "bus",
                            dest: Naming.short(d.dest ?? ""), time: t, isLive: d.isLive,
                            status: Delay.text(delayMin: d.delayMin, live: d.isLive, cancelled: d.isCancelled),
                            platform: d.platform)
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
                        Text(NextTripView.wait(r.time, from: entry.date)).monospacedDigit()
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
                if compact { RefreshButton() }
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
                            Text([r.platform, r.isLive ? r.status : "Scheduled"].compactMap { $0 }.joined(separator: ". "))
                                .font(.caption2)
                                .foregroundStyle(WidgetStyle.statusColor(isLive: r.isLive, status: r.status))
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 2)
                    if i == 0 {
                        TickingCountdown(leave: r.time, now: entry.date)
                            .font((compact ? Font.subheadline : .headline).weight(.bold))
                            .monospacedDigit()
                            .multilineTextAlignment(.trailing)
                            .frame(maxWidth: 70, alignment: .trailing)
                    } else {
                        Text(NextTripView.wait(r.time, from: entry.date))
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(r.isLive ? Color.primary : Color.secondary)
                            .monospacedDigit()
                            .lineLimit(1)
                    }
                }
            }
            Spacer(minLength: 0)
            if !compact {
                HStack(spacing: 6) {
                    if let n = entry.notice { NoticeLine(notice: n) }
                    else { Text("Updated \(Clock.time(entry.updated))").font(.caption2).foregroundStyle(.secondary).monospacedDigit() }
                    Spacer(minLength: 0)
                    RefreshButton()
                }
            }
        }
    }
}
