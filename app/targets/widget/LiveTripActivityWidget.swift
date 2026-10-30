import ActivityKit
import WidgetKit
import SwiftUI

/// Lock Screen card and Dynamic Island for a live trip started with Start trip.
struct LiveTripActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: LiveTripAttributes.self) { context in
            LiveTripLockCard(attrs: context.attributes, state: context.state, stale: context.isStale)
                .padding(16)
                .environment(\.colorScheme, .dark)
                .activityBackgroundTint(Color.black.opacity(0.6))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(URL(string: "nswtransport://go"))
        } dynamicIsland: { context in
            let s = context.state
            let stale = context.isStale
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    LiveTripIslandLeading(state: s)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    LiveTripIslandTrailing(state: s, stale: stale)
                }
                DynamicIslandExpandedRegion(.center) {
                    LiveTripIslandCenter(state: s, stale: stale)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    LiveTripIslandBottom(state: s, stale: stale)
                }
            } compactLeading: {
                LiveTripCompactLeading(state: s, stale: stale)
            } compactTrailing: {
                LiveTripCompactTrailing(state: s, stale: stale)
            } minimal: {
                LiveTripMinimal(state: s, stale: stale)
            }
            .widgetURL(URL(string: "nswtransport://go"))
        }
    }
}

// The Dynamic Island regions are plain views so the native audit (native-tests/native-audit) renders exactly these.

struct LiveTripIslandLeading: View {
    var state: LiveTripAttributes.ContentState
    var body: some View {
        WidgetLineBadge(line: state.line, colorHex: state.lineColorHex, mode: state.mode)
            .padding(.leading, 4)
    }
}

struct LiveTripIslandTrailing: View {
    var state: LiveTripAttributes.ContentState
    var stale = false
    var body: some View {
        // "in 18 minutes" goes onto two lines rather than "in 18 minut…" (native audit).
        MinutesUntil(date: state.countdownTarget, arrived: state.arrived(stale: stale), outdated: state.outdated(stale: stale))
            .font(.title3.weight(.semibold))
            .monospacedDigit()
            .lineLimit(2)
            .minimumScaleFactor(0.6)
            .multilineTextAlignment(.trailing)
            .frame(width: 80, alignment: .trailing)
    }
}

struct LiveTripIslandCenter: View {
    var state: LiveTripAttributes.ContentState
    var stale = false
    var body: some View {
        // Two lines under the camera before "Get off at Sydney…" (native audit).
        Text(state.headline(stale: stale)).font(.subheadline.weight(.semibold)).lineLimit(2).minimumScaleFactor(0.8)
            .multilineTextAlignment(.center)
    }
}

/// Before boarding the line badge; on board just where you get off with a colon ("Rhodes:"), short so the system
/// clock beside the island stays visible (28 Oct: "Off <station>" and "in 2 minutes" covered it).
struct LiveTripCompactLeading: View {
    var state: LiveTripAttributes.ContentState
    var stale = false
    var body: some View {
        if state.phase == "ride" && !state.arrived(stale: stale) {
            Text(state.compactStation)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: 64, alignment: .leading)
        } else {
            WidgetLineBadge(line: state.line, colorHex: state.lineColorHex, mode: state.mode)
        }
    }
}

struct LiveTripCompactTrailing: View {
    var state: LiveTripAttributes.ContentState
    var stale = false
    var body: some View {
        CompactCountdown(date: state.countdownTarget, arrived: state.arrived(stale: stale), outdated: state.outdated(stale: stale))
            .frame(maxWidth: 44, alignment: .trailing)
    }
}

struct LiveTripMinimal: View {
    var state: LiveTripAttributes.ContentState
    var stale = false
    var body: some View {
        CompactCountdown(date: state.countdownTarget, arrived: state.arrived(stale: stale), outdated: state.outdated(stale: stale))
            .frame(maxWidth: 36)
    }
}

/// The Dynamic Island's tiny countdown ("1:59", counting down by itself with no update), a tick once arrived, and
/// the clock time when the live times are old or the moment is more than an hour away. Never "in 2 minutes".
struct CompactCountdown: View {
    var date: Date
    var arrived = false
    var outdated = false
    var body: some View {
        if arrived {
            Image(systemName: "checkmark.circle.fill").accessibilityLabel("Arrived")
        } else if outdated || date.timeIntervalSinceNow > 3600 {
            Text(Clock.time(date))
                .font(.caption2.weight(.semibold))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        } else {
            Text(timerInterval: Date()...max(date, Date()), countsDown: true, showsHours: false)
                .font(.caption.weight(.semibold))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .multilineTextAlignment(.trailing)
        }
    }
}

/// "26 min", "1 min", "Now": whole minutes that keep counting on the Lock Screen (iOS 18), or
/// the clock time on iOS 17, which has no minutes only countdown. Never a seconds timer.
struct MinutesUntil: View {
    var date: Date
    var arrived = false
    /// Old live times: the clock time, never a countdown that could reach "now" on stale data.
    var outdated = false
    var body: some View {
        if arrived {
            Image(systemName: "checkmark.circle.fill").accessibilityLabel("Arrived")
        } else if outdated {
            Text(Clock.time(date))
        } else if #available(iOS 18.0, *) {
            Text(.currentDate, format: .reference(to: date, allowedFields: [.hour, .minute]))
        } else {
            Text(Clock.time(date))
        }
    }
}

struct LiveTripIslandBottom: View {
    var state: LiveTripAttributes.ContentState
    var stale = false
    var body: some View {
        // With the leg's stops (build 210) the stop track replaces the words; the first layout that fits wins, and
        // the plain layout stays for cards without stops and for very large text.
        ViewThatFits(in: .vertical) {
            if state.showsTrack(stale: stale) {
                withTrack(warning: true)
                withTrack(warning: false)
            }
            plain
        }
        .font(.caption)
    }

    private func withTrack(warning: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let t = state.stopTrack {
                StopTrackView(track: t, phase: state.phase, colorHex: state.lineColorHex, mode: state.mode,
                              dimmed: state.outdated(stale: stale), compact: true)
                    .accessibilityLabel(state.trackAccessibility)
            }
            TrackFooter(state: state, stale: stale)
            if warning, let w = state.warning {
                Label(w, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(state.warningIsRed ? Color.red : Color.orange)
                    .lineLimit(1)
            }
        }
    }

    private var plain: some View {
        VStack(alignment: .leading, spacing: 4) {
            // The arrival time stays whole; the detail gives way first (native audit: "Arrive Macquarie University 5:0…").
            HStack {
                Text(state.detail(stale: stale)).foregroundStyle(.secondary).lineLimit(1)
                Spacer(minLength: 4)
                if !state.arrived(stale: stale) {
                    Text(state.outdated(stale: stale) ? state.updatedLine : state.arriveLine).monospacedDigit().lineLimit(1)
                        .minimumScaleFactor(0.75).layoutPriority(1)
                }
            }
            if let w = state.warning, !state.arrived(stale: stale) {
                Label(w, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(state.warningIsRed ? Color.red : Color.orange)
                    .lineLimit(1)
            }
        }
    }
}

/// Under the stop track: the next stop on the left, the arrival on the right. The next stop name stays whole when it
/// can: the arrival drops the destination first, then the two go onto two lines.
struct TrackFooter: View {
    var state: LiveTripAttributes.ContentState
    var stale = false
    var body: some View {
        let old = state.outdated(stale: stale)
        let right = old ? "\(state.arriveTimeLine). \(state.updatedLine)" : state.arriveLine
        let rightShort = old ? state.updatedLine : state.arriveTimeLine
        ViewThatFits(in: .horizontal) {
            row(state.trackNext(stale: stale), right)
            row(state.trackNext(stale: stale), rightShort)
            row(state.trackNext(stale: stale, short: true), rightShort)
            VStack(alignment: .leading, spacing: 2) {
                if let n = state.trackNext(stale: stale, short: true) { nextText(n) }
                Text(rightShort).foregroundStyle(.secondary).monospacedDigit().lineLimit(1).minimumScaleFactor(0.8)
            }
        }
    }

    private func row(_ next: String?, _ right: String) -> some View {
        HStack(spacing: 8) {
            if let n = next { nextText(n).fixedSize() }
            Spacer(minLength: 0)
            Text(right).foregroundStyle(.secondary).monospacedDigit().lineLimit(1).fixedSize()
        }
    }

    private func nextText(_ s: String) -> some View {
        Text(s).fontWeight(.semibold).lineLimit(1)
    }
}

/// The stop track (Bidur, 30 Oct: "add stops here rather than a plain loading bar"): a dot per stop on this leg,
/// the stops behind you filled in the line colour, the service between them and the next stop, the stops to come as
/// rings, a long middle folded into "+6", and your stop off as a bell. Waiting, you are at the first dot. When only the
/// timetable says where the service is, or the times are old, its marker is a dashed ring (never drawn as live).
struct StopTrackView: View {
    var track: LiveTripAttributes.StopTrack
    var phase: String
    var colorHex: String
    var mode: String
    var dimmed = false
    var compact = false

    enum Item: Hashable { case passed, here, vehicle, stop, more(Int), off }

    /// At most 12 dots: up to 3 stops behind you, the marker, then the stops to come (the server and app send 10 at most).
    var items: [Item] {
        var out: [Item] = []
        let next = track.next
        if phase == "wait" {
            out.append(.here)
        } else {
            let room = max(1, 12 - next.count - (track.hidden > 0 ? 1 : 0))
            out += Array(repeating: Item.passed, count: min(max(track.passed, 1), min(room, 3)))
            out.append(.vehicle)
        }
        for i in next.indices {
            if track.hidden > 0 && i == min(track.hiddenAt, next.count - 1) { out.append(.more(track.hidden)) }
            out.append(i == next.count - 1 ? .off : .stop)
        }
        return out
    }

    private var line: Color { RGB(hex: colorHex).map { Color(red: $0.r, green: $0.g, blue: $0.b) } ?? Color.blue }
    private var onLine: Color { (RGB(hex: colorHex)?.prefersWhiteText ?? true) ? Color.white : Color.black }
    private var sure: Bool { track.live && !dimmed }
    private var k: CGFloat { compact ? 0.82 : 1 }

    var body: some View {
        let list = items
        let mark = list.firstIndex(where: { $0 == .vehicle || $0 == .here }) ?? 0
        let behind = phase != "wait" && track.passed > list.filter({ $0 == .passed }).count
        HStack(spacing: 0) {
            if behind { segment(done: true).frame(maxWidth: 10) }
            ForEach(Array(list.enumerated()), id: \.offset) { i, item in
                if i > 0 { segment(done: i <= mark) }
                dot(item)
            }
        }
        .frame(height: 18 * k)
        .accessibilityElement(children: .ignore)
    }

    private func segment(done: Bool) -> some View {
        Capsule()
            .fill(done ? line : Color.white.opacity(0.28))
            .frame(height: (compact ? 2 : 3))
            .frame(minWidth: 3, maxWidth: .infinity)
    }

    @ViewBuilder private func dot(_ item: Item) -> some View {
        switch item {
        case .passed:
            Circle().fill(line).frame(width: 7 * k, height: 7 * k)
        case .stop:
            Circle().strokeBorder(Color.white.opacity(0.6), lineWidth: 1.5).frame(width: 8 * k, height: 8 * k)
        case .more(let n):
            Text("+\(n)")
                .font(.system(size: compact ? 9 : 10, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(Color.white.opacity(0.75))
                .padding(.horizontal, 4)
                .padding(.vertical, 1)
                .overlay(Capsule().strokeBorder(Color.white.opacity(0.35), lineWidth: 1))
                .fixedSize()
        case .off:
            ZStack {
                Circle().fill(line)
                Circle().strokeBorder(Color.white, lineWidth: 1.5)
                Image(systemName: "bell.fill").font(.system(size: 8 * k, weight: .bold)).foregroundStyle(onLine)
            }
            .frame(width: 17 * k, height: 17 * k)
        case .here:
            ZStack {
                Circle().fill(Color.white)
                Image(systemName: "figure.stand").font(.system(size: 9 * k, weight: .bold)).foregroundStyle(Color.black)
            }
            .frame(width: 17 * k, height: 17 * k)
        case .vehicle:
            ZStack {
                if sure { Circle().fill(Color.white) }
                Circle().strokeBorder(Color.white, style: StrokeStyle(lineWidth: 1.5, dash: sure ? [] : [2.5, 2]))
                Image(systemName: Mode(raw: mode).symbol).font(.system(size: 9 * k, weight: .bold))
                    .foregroundStyle(sure ? Color.black : Color.white.opacity(0.85))
            }
            .frame(width: 18 * k, height: 18 * k)
        }
    }
}

/// One card that changes with the trip: waiting, on board, at a change, then the last leg.
/// The first layout that fits wins: the headline, detail and warning on up to two lines, then one (native audit,
/// 30 Oct: "Get off at Syd…" on the smallest iPhone). The line badge never truncates.
struct LiveTripLockCard: View {
    var attrs: LiveTripAttributes
    var state: LiveTripAttributes.ContentState
    var stale = false

    var body: some View {
        ViewThatFits(in: .vertical) {
            // Build 210: the stop track in place of the bar when the card carries the leg's stops.
            if state.showsTrack(stale: stale) {
                card(lines: 2, track: true)
                card(lines: 1, track: true)
                // Large text: the dots already show the stops left, so "6 stops" gives way before the track does.
                card(lines: 1, track: true, detail: false)
            }
            card(lines: 2, track: false)
            card(lines: 1, track: false)
        }
    }

    private func card(lines: Int, track: Bool, detail: Bool = true) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        WidgetLineBadge(line: state.line, colorHex: state.lineColorHex, mode: state.mode).fixedSize()
                        Text(state.headline(stale: stale)).font(.headline).lineLimit(lines).minimumScaleFactor(0.8)
                    }
                    if detail {
                        Text(state.detail(stale: stale))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(lines)
                    }
                    if let w = state.warning, !state.arrived(stale: stale) {
                        Text(w)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(state.warningIsRed ? Color.red : Color.orange)
                            .lineLimit(lines)
                    }
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 0) {
                    Text(state.countdownLabel(stale: stale)).font(.caption2).foregroundStyle(.secondary)
                    // "in 18 minutes" takes two lines before "Get off at <stop>" is cut (native audit).
                    MinutesUntil(date: state.countdownTarget, arrived: state.arrived(stale: stale), outdated: state.outdated(stale: stale))
                        .font(.title2.weight(.bold))
                        .monospacedDigit()
                        .lineLimit(2)
                        .minimumScaleFactor(0.7)
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 100, alignment: .trailing)
                }
                .layoutPriority(1)
            }
            if track, let t = state.stopTrack {
                StopTrackView(track: t, phase: state.phase, colorHex: state.lineColorHex, mode: state.mode,
                              dimmed: state.outdated(stale: stale))
                    .accessibilityLabel(state.trackAccessibility)
                TrackFooter(state: state, stale: stale).font(.caption)
            } else {
                ProgressView(value: state.arrived(stale: stale) ? 1 : min(max(state.progress, 0), 1))
                    .tint(RGB(hex: state.lineColorHex).map { Color(red: $0.r, green: $0.g, blue: $0.b) } ?? Color.blue)
                if !state.arrived(stale: stale) {
                    Text(state.outdated(stale: stale) ? "\(state.arriveLine). \(state.updatedLine)" : state.arriveLine)
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.8)
                }
            }
        }
    }
}
