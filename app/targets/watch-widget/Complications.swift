// Complications and Smart Stack widgets on Apple Watch: the next service for the trip in progress (from the
// iPhone), else your first trip on the watch (Home to Work or back by time of day, else the first saved trip), with
// its line, whole minutes to go ("T1 2 min") and the platform.
//   Rectangular: "T1 2 min, Plat 2", the trip and the one after. Circular: the line over the minutes, with a ring
//   that empties over the last 15 minutes. Inline and corner: "T1 2 min".
//
// Battery: the complications never load anything and never count seconds. They draw the times the watch app last
// loaded (or the times the phone sent) and the trip card from the iPhone, as a timeline worked out in advance with
// one entry per minute for the next hour at most. The watch app reloads them only when what they show changes; on
// their own they reload at most every 15 minutes (every 5 while a trip runs).
import SwiftUI
import WidgetKit

@main
struct TransportWatchWidgets: WidgetBundle {
    var body: some Widget {
        NextTrainComplication()
    }
}

struct NextTrainComplication: Widget {
    let kind = "NextTrain"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: NextProvider()) { entry in
            NextView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Next train")
        .description("Your first trip's next 3 services in whole minutes, with the platform. Tap to open the trip. Your trip in progress while it runs.")
        .supportedFamilies([.accessoryRectangular, .accessoryCircular, .accessoryInline, .accessoryCorner])
    }
}

struct NextEntry: TimelineEntry {
    enum Kind { case live, trip, empty }
    let date: Date
    let kind: Kind
    var line: String = ""
    var colorHex: String?
    var target: Date?
    var platform: String?
    var status: WStatus = .onTime
    /// The services after `target` on the same trip, for "2, 16, 18 min".
    var later: [Date] = []
    /// Where a tap opens the watch app: the trip screen of this trip.
    var url: URL?
    /// "To work", "Off at Redfern", the trip, or what to do on the iPhone when there is nothing to show.
    var title: String
    /// "then 9:52am", "Next stop: Burwood" or "Updated 9:41am".
    var detail: String?
    var relevance: TimelineEntryRelevance?

    var plat: String? { WText.platform(platform) }

    /// Whole minutes from this entry's moment: "Now", "2 min", or the time an hour or more away.
    var minutesText: String {
        guard let t = target else { return "" }
        return Clock.countdown(t, from: date)
    }

    /// "T1 2 min, Plat 2"
    var countdownText: String {
        guard target != nil else { return title }
        var s = line.isEmpty ? minutesText : "\(line) \(minutesText)"
        if let p = plat { s += ", \(p)" }
        return s
    }

    /// "2, 16, 18 min": the next service and the ones after it in whole minutes; "Now, 14, 16 min" when the first
    /// is leaving. Times an hour or more away are left out.
    var scheduleText: String {
        guard let t = target else { return title }
        let all = [t] + later
        let ms = all.map { Clock.minutes(until: $0, from: date) }.filter { $0 < 60 }
        guard !ms.isEmpty else { return Clock.hhmm(t) }
        let parts = ms.map { $0 < 1 ? "Now" : String($0) }
        if parts == ["Now"] { return "Now" }
        return parts.joined(separator: ", ") + " min"
    }

    /// "T1 2, 16, 18 min" for the inline complication.
    var inlineText: String {
        guard target != nil else { return title }
        return line.isEmpty ? scheduleText : "\(line) \(scheduleText)"
    }

    /// For VoiceOver: "T1 in 2 minutes, then 16 and 18 minutes, Plat 2, To work".
    var spoken: String {
        guard let t = target else { return [title, detail].compactMap { $0 }.joined(separator: ". ") }
        let when = status == .cancelled ? "cancelled" : "in \(WText.minsSpoken(t, now: date))"
        let then = later.prefix(2).map { Clock.minutes(until: $0, from: date) }.filter { $0 < 60 }.map { String($0) }
        let thenText: String? = then.isEmpty ? nil : "then " + then.joined(separator: " and ") + " minutes"
        return [line.isEmpty ? nil : line, when, thenText, plat, title].compactMap { $0 }.joined(separator: ", ")
    }

    /// How full the ring is: full until 15 minutes before, then it empties a step each minute.
    var ring: Double {
        guard let t = target else { return 0 }
        return min(1, max(0, t.timeIntervalSince(date) / (15 * 60)))
    }

    var tint: Color { status == .onTime ? Color(hexString: colorHex) : status.color }
}

extension WStatus {
    var color: Color {
        switch self {
        case .onTime: return .green
        case .slightlyLate: return .orange
        case .late, .cancelled: return .red
        }
    }
}

struct NextProvider: TimelineProvider {
    /// At most this many minute entries in one timeline (an hour), so a timeline stays small.
    static let maxEntries = 60

    func placeholder(in context: Context) -> NextEntry {
        NextEntry(date: Date(), kind: .trip, target: Date().addingTimeInterval(240), title: "Next train")
    }

    func getSnapshot(in context: Context, completion: @escaping (NextEntry) -> Void) {
        let entries = NextProvider.entries(now: Date(), context: WatchStore.loadContext(), snapshot: WatchStore.loadSnapshot())
        completion(entries.first ?? placeholder(in: context))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NextEntry>) -> Void) {
        let now = Date()
        let ctx = WatchStore.loadContext()
        let entries = NextProvider.entries(now: now, context: ctx, snapshot: WatchStore.loadSnapshot())
        let live = ctx?.live?.isActive(now: now) == true
        completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(live ? 5 * 60 : 15 * 60))))
    }

    /// Minute entries counting down to each service in turn: every whole minute before `target`, from `start`.
    static func minuteEntries(from start: Date, to target: Date, make: (Date) -> NextEntry, limit: Int) -> [NextEntry] {
        var out: [NextEntry] = []
        var at = start
        while at < target, out.count < limit {
            out.append(make(at))
            // The next moment the whole minutes to go change.
            let left = target.timeIntervalSince(at)
            let step = left.truncatingRemainder(dividingBy: 60)
            at = at.addingTimeInterval(step > 0.5 ? step : 60)
        }
        return out
    }

    static func entries(now: Date, context: WatchContext?, snapshot: WatchSnapshot) -> [NextEntry] {
        guard let c = context else {
            return [NextEntry(date: now, kind: .empty, title: "Open Transport", detail: "on your iPhone")]
        }
        if let l = c.live, l.isActive(now: now) {
            let ride = l.phase == "ride"
            let title = ride ? "Off at \(WText.short(l.getOffAt))" : "Your trip"
            let detail: String? = l.warning ?? (ride ? l.nextStop.map { "Next: \(WText.short($0))" } : "Off at \(WText.short(l.getOffAt))")
            var out = minuteEntries(from: now, to: l.target, make: { d in
                NextEntry(date: d, kind: .live, line: l.line, colorHex: l.lineColorHex, target: l.target,
                          platform: ride ? nil : l.platform, status: l.isRisk ? .late : .onTime, title: title, detail: detail,
                          relevance: TimelineEntryRelevance(score: 100))
            }, limit: maxEntries)
            if out.isEmpty || l.target > now {
                out.append(NextEntry(date: max(now, l.target), kind: .live, line: l.line, colorHex: l.lineColorHex,
                                     title: title, detail: ride ? "Get off now" : "Leaving now",
                                     relevance: TimelineEntryRelevance(score: 100)))
            }
            return out
        }
        guard let card = c.cards(now: now).first else {
            return [NextEntry(date: now, kind: .empty, title: "Save a trip", detail: "on your iPhone")]
        }
        let found = snapshot.services(for: card, context: c, now: now)
        let services = found.list.filter { !$0.cancelled }
        let stale = found.fromPhone || (found.at.map { now.timeIntervalSince($0) > 5 * 60 } ?? true)
        // "Strathfield" (where it goes) beside the line, like "T1 Strathfield 2, 16, 18 min".
        let title = WText.short(card.to.name)
        let url = WatchLinks.trip(card.key)
        var out: [NextEntry] = []
        var start = now
        for (i, s) in services.enumerated() where s.time > start {
            let later = services.dropFirst(i + 1).prefix(2).map(\.time)
            let where_: String = card.isCommute ? card.name : "From \(WText.short(card.from.name))"
            let parts: [String?] = [where_, WText.platform(s.platform)]
            var detail: String? = parts.compactMap { $0 }.joined(separator: ", ")
            if stale, let at = found.at { detail = "Updated \(Clock.hhmm(at))" }
            let left = maxEntries - out.count
            if left <= 0 { break }
            out += minuteEntries(from: start, to: s.time, make: { d in
                NextEntry(date: d, kind: .trip, line: s.line, colorHex: s.colorHex, target: s.time, platform: s.platform,
                          status: s.status, later: Array(later), url: url, title: title, detail: detail,
                          relevance: TimelineEntryRelevance(score: s.time.timeIntervalSince(d) < 20 * 60 ? 50 : 10))
            }, limit: left)
            start = s.time
        }
        if out.count < maxEntries {
            out.append(NextEntry(date: start, kind: .empty, url: url, title: card.title, detail: "Open Transport for times"))
        }
        return out
    }
}

struct NextView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.isLuminanceReduced) private var dimmed
    let entry: NextEntry

    var body: some View {
        Group {
            switch family {
            case .accessoryCircular: circular
            case .accessoryInline: Text(entry.kind == .trip ? entry.inlineText : entry.countdownText)
            case .accessoryCorner: corner
            default: rectangular
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(entry.spoken)
        .widgetURL(entry.url)
    }

    private var tint: Color { entry.tint.opacity(dimmed ? 0.7 : 1) }

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 1) {
            if entry.target == nil {
                Text(entry.title).font(.headline).lineLimit(1)
                if let d = entry.detail { Text(d).font(.caption2).foregroundStyle(.secondary).lineLimit(2) }
            } else if entry.kind == .trip {
                // "T1 Strathfield" / "2, 16, 18 min" / "From Kings Cross, Plat 1"
                HStack(spacing: 4) {
                    Text(entry.line).font(.headline).foregroundStyle(tint).widgetAccentable()
                    Text(entry.title).font(.headline).lineLimit(1)
                }
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                Text(entry.scheduleText)
                    .font(.headline.monospacedDigit())
                    .foregroundStyle(entry.status == .onTime ? Color.primary : entry.status.color)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                if let d = entry.detail { Text(d).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
            } else {
                Text(entry.countdownText)
                    .font(.headline)
                    .foregroundStyle(tint)
                    .widgetAccentable()
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text(entry.title).font(.caption).lineLimit(1)
                if let d = entry.detail { Text(d).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var circular: some View {
        ZStack {
            if entry.target != nil {
                ProgressView(value: entry.ring)
                    .progressViewStyle(.circular)
                    .tint(tint)
                    .widgetAccentable()
                VStack(spacing: 0) {
                    Text(entry.line).font(.system(size: 12, weight: .bold, design: .rounded))
                    Text(entry.minutesText)
                        .font(.system(size: 11, weight: .medium, design: .rounded).monospacedDigit())
                        .multilineTextAlignment(.center)
                        .minimumScaleFactor(0.5)
                }
                .padding(.horizontal, 6)
            } else {
                AccessoryWidgetBackground()
                Image(systemName: "tram.fill").font(.title3)
            }
        }
    }

    private var corner: some View {
        Group {
            if entry.target != nil {
                Text(entry.minutesText)
                    .font(.system(size: 14, weight: .semibold, design: .rounded).monospacedDigit())
                    .widgetAccentable()
                    .widgetLabel { Text([entry.line, entry.plat].compactMap { $0 }.joined(separator: " ")) }
            } else {
                Image(systemName: "tram.fill")
                    .widgetLabel { Text(entry.title) }
            }
        }
    }
}
