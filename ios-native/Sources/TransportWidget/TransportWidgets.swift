import WidgetKit
import SwiftUI
import TransportKit

#if !SNAPSHOT_TESTS
@main
struct TransportWidgets: WidgetBundle {
    var body: some Widget {
        NextTripWidget()
        TripLiveActivity()
    }
}
#endif

// MARK: Next trip widget

/// Shows the next live trips for your first commute, or your first saved trip.
/// The trip comes from your profile on the server, so the widget needs no shared storage with the app.
struct NextTripWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NextTrip", provider: NextTripProvider()) { entry in
            NextTripView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Next trip")
        .description("Live leave in times for your commute or saved trip.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
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
}

struct NextTripEntry: TimelineEntry {
    var date: Date
    var title: String
    var from: String
    var to: String
    var trips: [TripLine]
    var message: String?

    static let sample = NextTripEntry(
        date: .now, title: "Home", from: "Burwood", to: "Central",
        trips: [TripLine(line: "T1", colorHex: "#F99D1C", mode: "train", leave: .now.addingTimeInterval(240),
                         arrive: .now.addingTimeInterval(1000), isLive: true, status: "On time", platform: "Platform 1")],
        message: nil)
}

struct NextTripProvider: TimelineProvider {
    func placeholder(in context: Context) -> NextTripEntry { .sample }

    func getSnapshot(in context: Context, completion: @escaping (NextTripEntry) -> Void) {
        if context.isPreview { completion(.sample); return }
        Task { completion(await Self.load()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NextTripEntry>) -> Void) {
        Task {
            let e = await Self.load()
            // One entry a minute so the "4 min" text stays right; fresh data every five minutes.
            let entries = (0..<15).map { i -> NextTripEntry in
                var x = e
                x.date = e.date.addingTimeInterval(Double(i) * 60)
                x.trips = e.trips.filter { $0.leave > x.date.addingTimeInterval(-30) }
                return x
            }
            completion(Timeline(entries: entries, policy: .after(e.date.addingTimeInterval(5 * 60))))
        }
    }

    static func load() async -> NextTripEntry {
        let api = TransportAPI.shared
        var pick: (String, StopRef, StopRef)?
        if let c = try? await api.commutes(device: nil), let first = c.items.first(where: { $0.active != false }) {
            pick = (first.name ?? "Commute", first.from, first.to)
        } else if let s = try? await api.saved(), let first = s.first {
            pick = (first.name.prefix(1).uppercased() + first.name.dropFirst(), first.from, first.to)
        }
        guard let pick else {
            return NextTripEntry(date: .now, title: "Transport", from: "", to: "", trips: [],
                                 message: "Save a trip in the app to see it here.")
        }
        let (title, from, to) = pick
        return await entry(title: title, from: from, to: to)
    }

    /// Live trips for one pair of stops. Also used by the snapshot tests.
    static func entry(title: String, from: StopRef, to: StopRef) async -> NextTripEntry {
        let api = TransportAPI.shared
        guard let r = try? await api.trip(from: from.id, to: to.id, count: 4) else {
            return NextTripEntry(date: .now, title: title, from: Naming.short(from.name), to: Naming.short(to.name),
                                 trips: [], message: "Live times will be back shortly.")
        }
        let trips: [TripLine] = r.journeys.compactMap { j in
            guard let leave = j.leave, leave > Date().addingTimeInterval(-30), let f = j.firstTransit else { return nil }
            return TripLine(line: f.line ?? "", colorHex: f.color ?? Mode(raw: f.mode).fallbackHex, mode: f.mode ?? "bus",
                            leave: leave, arrive: j.arrive, isLive: j.live == true,
                            status: Delay.text(delayMin: f.delayMin, live: f.isLive, cancelled: j.anyCancelled == true),
                            platform: f.fromPlatform)
        }
        return NextTripEntry(date: .now, title: title, from: Naming.compact(Naming.short(from.name)), to: Naming.compact(Naming.short(to.name)),
                             trips: Array(trips.prefix(3)), message: trips.isEmpty ? "No trips soon." : nil)
    }
}

struct WidgetLineBadge: View {
    var line: String
    var colorHex: String
    var mode: String

    var body: some View {
        let white = RGB(hex: colorHex)?.prefersWhiteText ?? true
        let c = RGB(hex: colorHex)
        HStack(spacing: 2) {
            Image(systemName: Mode(raw: mode).symbol).font(.system(size: 9, weight: .bold))
            Text(line).font(.caption.weight(.bold))
        }
        .foregroundStyle(white ? Color.white : Color.black)
        .padding(.horizontal, 5)
        .padding(.vertical, 2)
        .background(Color(red: c?.r ?? 0, green: c?.g ?? 0.6, blue: c?.b ?? 0.9), in: RoundedRectangle(cornerRadius: 5))
    }
}

struct NextTripView: View {
    var entry: NextTripEntry
    /// Set by the snapshot tests, which render the view outside a widget host.
    var familyOverride: WidgetFamily?
    @Environment(\.widgetFamily) private var hostFamily

    private var family: WidgetFamily { familyOverride ?? hostFamily }

    /// "Now", "4 min", "1 hr 5 min", the way Maps shows a wait.
    static func wait(_ leave: Date, from now: Date, inline: Bool = false) -> String {
        let m = Int((leave.timeIntervalSince(now) / 60).rounded(.down))
        if m <= 0 { return "Now" }
        let text = m < 60 ? "\(m) min" : (m % 60 == 0 ? "\(m / 60) hr" : "\(m / 60) hr \(m % 60) min")
        return inline ? "in \(text)" : text
    }

    static func statusColor(_ t: TripLine) -> Color {
        if t.status == "Cancelled" { return .red }
        if !t.isLive { return .secondary }
        return t.status.contains("late") ? .orange : .green
    }

    var body: some View {
        switch family {
        case .accessoryInline:
            if let t = entry.trips.first {
                Text("\(t.line) \(Self.wait(t.leave, from: entry.date, inline: true))")
            } else {
                Text(entry.message ?? "No trips")
            }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text("\(entry.title): \(entry.to)").font(.headline).lineLimit(1)
                if let t = entry.trips.first {
                    HStack(spacing: 4) {
                        Text(t.line).fontWeight(.bold)
                        Text(Self.wait(t.leave, from: entry.date)).monospacedDigit()
                    }
                    Text(t.isLive ? t.status : "Scheduled").font(.caption)
                } else {
                    Text(entry.message ?? "No trips").font(.caption)
                }
            }
        case .systemSmall:
            VStack(alignment: .leading, spacing: 6) {
                Text(entry.title).font(.headline)
                Text("to \(entry.to)").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                Spacer(minLength: 0)
                if let t = entry.trips.first {
                    WidgetLineBadge(line: t.line, colorHex: t.colorHex, mode: t.mode)
                    Text(Self.wait(t.leave, from: entry.date))
                        .font(.title.weight(.bold))
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    Text(t.isLive ? t.status : "Scheduled")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Self.statusColor(t))
                } else {
                    Text(entry.message ?? "No trips").font(.caption).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        default:
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(entry.title).font(.headline)
                    Text("\(entry.from) to \(entry.to)").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    Spacer()
                }
                if entry.trips.isEmpty {
                    Text(entry.message ?? "No trips").font(.subheadline).foregroundStyle(.secondary)
                }
                ForEach(entry.trips, id: \.self) { t in
                    HStack {
                        WidgetLineBadge(line: t.line, colorHex: t.colorHex, mode: t.mode)
                        VStack(alignment: .leading, spacing: 0) {
                            Text(Clock.time(t.leave)).font(.subheadline.weight(.semibold)).monospacedDigit()
                            Text(t.isLive ? t.status : "Scheduled")
                                .font(.caption2)
                                .foregroundStyle(Self.statusColor(t))
                        }
                        Spacer()
                        Text(Self.wait(t.leave, from: entry.date))
                            .font(.title3.weight(.semibold))
                            .monospacedDigit()
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                }
                Spacer(minLength: 0)
            }
        }
    }
}
