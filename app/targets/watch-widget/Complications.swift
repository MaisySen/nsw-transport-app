// Complications and Smart Stack widgets on Apple Watch: the next service for the trip in progress (from the
// iPhone), else Home to Work or back by time of day, with its line, a live countdown and the platform.
//   Rectangular: "T1 4:12, Plat 2" and what it is for. Circular: a countdown ring. Inline and corner: the countdown.
//
// Battery: they draw with system countdowns (Text style .timer, ProgressView timerInterval), so a timeline has one
// entry per service instead of one a minute. Build 210: on each reload they load the commute themselves when the kept
// times are over 4 minutes old (before, they never loaded anything and changed only after the watch app was opened),
// and reload on WatchRefresh's clock: every 20 minutes in the weekday peaks, 30 in the day, 45 in the evening,
// hourly overnight, 5 while a trip runs (from the phone's card, no loading). The watch app still reloads them when
// what they show changes.
import SwiftUI
import WidgetKit

#if !SNAPSHOT_TESTS
@main
struct TransportWatchWidgets: WidgetBundle {
    var body: some Widget {
        NextTrainComplication()
    }
}
#endif

struct NextTrainComplication: Widget {
    let kind = "NextTrain"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: NextProvider()) { entry in
            NextView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Next train")
        .description("Your trip in progress, else Home to Work in the morning and back in the evening.")
        .supportedFamilies([.accessoryRectangular, .accessoryCircular, .accessoryInline, .accessoryCorner])
    }
}

struct NextEntry: TimelineEntry {
    enum Kind { case live, commute, empty }
    let date: Date
    let kind: Kind
    var line: String = ""
    var colorHex: String?
    var target: Date?
    var platform: String?
    /// "To work", "Off at Redfern", or what to set on the iPhone when there is nothing to show.
    var title: String
    /// "Strathfield to Kings Cross", "then 9:52am" or "Updated 9:41am".
    var detail: String?
    var relevance: TimelineEntryRelevance?

    var plat: String? { WText.platform(platform) }

    /// "T1 4:12, Plat 2", counting down by itself.
    var countdownText: Text {
        guard let t = target else { return Text(title) }
        var s = Text(line.isEmpty ? "" : "\(line) ") + Text(t, style: .timer).monospacedDigit()
        if let p = plat { s = s + Text(", \(p)") }
        return s
    }

    /// For VoiceOver: "T1 at 9:52am, Plat 2, To work".
    var spoken: String {
        guard let t = target else { return [title, detail].compactMap { $0 }.joined(separator: ". ") }
        return [line.isEmpty ? nil : line, "at \(Clock.hhmm(t))", plat, title].compactMap { $0 }.joined(separator: ", ")
    }

    /// Where the ring starts: full until 15 minutes before, then it empties to the departure.
    var ringRange: ClosedRange<Date>? {
        guard let t = target, t > date else { return nil }
        return max(date, t.addingTimeInterval(-15 * 60))...t
    }
}

struct NextProvider: TimelineProvider {
    func placeholder(in context: Context) -> NextEntry {
        NextEntry(date: Date(), kind: .commute, target: Date().addingTimeInterval(240), title: "Next train")
    }

    func getSnapshot(in context: Context, completion: @escaping (NextEntry) -> Void) {
        let entries = NextProvider.entries(now: Date(), context: WatchStore.loadContext(), snapshot: WatchStore.loadSnapshot())
        completion(entries.first ?? placeholder(in: context))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NextEntry>) -> Void) {
        Task {
            let now = Date()
            let ctx = WatchStore.loadContext()
            var snap = WatchStore.loadSnapshot()
            let live = ctx?.live?.isActive(now: now) == true
            var failed = false
            // Build 210: the complication loads the commute itself when the kept times are old (it used to wait for
            // the watch app to be opened). One call, 8 s at most; on failure the kept times show with "Updated".
            if !live, let c = ctx, let m = c.commute(now: now), WatchRefresh.commuteStale(snap, key: m.key, now: now) {
                let (s, f) = await WatchRefresh.load(c, into: snap, stops: false, now: now)
                failed = f
                if !f { snap = s; WatchStore.save(s) }
            }
            let entries = NextProvider.entries(now: Date(), context: ctx, snapshot: snap)
            completion(Timeline(entries: entries, policy: .after(WatchRefresh.next(now, live: live, failed: failed))))
        }
    }

    /// One entry per service from what the watch keeps: each starts when the one before it leaves.
    static func entries(now: Date, context: WatchContext?, snapshot: WatchSnapshot) -> [NextEntry] {
        guard let c = context else {
            return [NextEntry(date: now, kind: .empty, title: "Open Transport", detail: "on your iPhone")]
        }
        if let l = c.live, l.isActive(now: now) {
            let ride = l.phase == "ride"
            let next: String? = ride ? l.nextStop.map { "Next: \(WText.short($0))" } : "Off at \(WText.short(l.getOffAt))"
            let entry = NextEntry(date: now, kind: .live, line: l.line, colorHex: l.lineColorHex, target: l.target,
                                  platform: ride ? nil : l.platform,
                                  title: ride ? "Off at \(WText.short(l.getOffAt))" : "Your trip",
                                  detail: l.warning ?? next,
                                  relevance: TimelineEntryRelevance(score: 100))
            var out = [entry]
            if l.target > now {
                out.append(NextEntry(date: l.target, kind: .live, line: l.line, colorHex: l.lineColorHex,
                                     title: ride ? "Off at \(WText.short(l.getOffAt))" : "Your trip",
                                     detail: ride ? "Get off now" : "Leaving now",
                                     relevance: TimelineEntryRelevance(score: 100)))
            }
            return out
        }
        guard let m = c.commute(now: now) else {
            return [NextEntry(date: now, kind: .empty, title: c.home == nil || c.work == nil ? "Set Home and Work" : "Change Home or Work", detail: "on your iPhone")]
        }
        let services = snapshot.commuteKey == m.key ? WatchSnapshot.upcoming(snapshot.commute, now: now).filter { !$0.cancelled } : []
        let stale = snapshot.commuteAt.map { now.timeIntervalSince($0) > 5 * 60 } ?? true
        let route = "\(WText.short(m.from.name)) to \(WText.short(m.to.name))"
        var out: [NextEntry] = []
        var start = now
        for (i, s) in services.enumerated() where s.time > now {
            var detail = route
            if i + 1 < services.count { detail = "then \(Clock.hhmm(services[i + 1].time))" }
            if stale, let at = snapshot.commuteAt { detail = "Updated \(Clock.hhmm(at))" }
            let soon = s.time.timeIntervalSince(start) < 20 * 60
            out.append(NextEntry(date: start, kind: .commute, line: s.line, colorHex: s.colorHex, target: s.time, platform: s.platform,
                                 title: m.title, detail: detail, relevance: TimelineEntryRelevance(score: soon ? 50 : 10)))
            start = s.time
        }
        out.append(NextEntry(date: start, kind: .empty, title: m.title, detail: "Open Transport for times"))
        return out
    }
}

struct NextView: View {
    @Environment(\.widgetFamily) private var hostFamily
    @Environment(\.isLuminanceReduced) private var dimmed
    let entry: NextEntry
    /// Set by the native audit (native-tests/native-audit), which renders the view outside a widget host.
    var familyOverride: WidgetFamily? = nil

    private var family: WidgetFamily { familyOverride ?? hostFamily }

    var body: some View {
        Group {
            switch family {
            case .accessoryCircular: circular
            case .accessoryInline: entry.countdownText
            case .accessoryCorner: corner
            default: rectangular
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(entry.spoken)
    }

    private var tint: Color { Color(hexString: entry.colorHex).opacity(dimmed ? 0.7 : 1) }

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 1) {
            if entry.target == nil {
                Text(entry.title).font(.headline).lineLimit(1)
                if let d = entry.detail { Text(d).font(.caption2).foregroundStyle(.secondary).lineLimit(2) }
            } else {
                entry.countdownText
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
            if let r = entry.ringRange, let t = entry.target {
                ProgressView(timerInterval: r, countsDown: true, label: { EmptyView() }, currentValueLabel: { EmptyView() })
                    .progressViewStyle(.circular)
                    .tint(tint)
                    .widgetAccentable()
                VStack(spacing: 0) {
                    Text(entry.line).font(.system(size: 12, weight: .bold, design: .rounded))
                    Text(t, style: .timer)
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
            if let t = entry.target {
                Text(t, style: .timer)
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
