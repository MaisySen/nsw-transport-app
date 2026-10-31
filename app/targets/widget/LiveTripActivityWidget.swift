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
        // Build 211 (31 Oct, owner's iPhone on build 210): the countdown on one line ("6 min", was "in 5 / minutes"),
        // and the delay under it ("3 min late", "On time"), which the Island did not show while the Lock Screen did.
        let countdown = MinutesUntil.words(state.countdownTarget, arrived: state.arrived(stale: stale), outdated: state.outdated(stale: stale))
        let delay = state.delayStatus(stale: stale)
        return VStack(alignment: .trailing, spacing: 1) {
            MinutesUntil(date: state.countdownTarget, arrived: state.arrived(stale: stale), outdated: state.outdated(stale: stale))
                .font(.title3.weight(.semibold))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .lineProbe("island-countdown", text: countdown, lines: 1, font: .title3.weight(.semibold).monospacedDigit(), minScale: 0.6)
            if let d = delay {
                Text(d)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(delayColor(d))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .lineProbe("island-delay", text: d, lines: 1, font: .caption2.weight(.semibold), minScale: 0.8)
            }
        }
        .frame(minWidth: 80, maxWidth: 104, alignment: .trailing)
    }
}

/// Late in orange, on time in green: the Lock Screen's colours, both clear on the black Island.
func delayColor(_ words: String) -> Color { words == "On time" ? .green : .orange }

struct LiveTripIslandCenter: View {
    var state: LiveTripAttributes.ContentState
    var stale = false
    @Environment(\.dynamicTypeSize) private var typeSize
    var body: some View {
        // Two lines under the camera before "Get off at Sydney…" (native audit), shrinking to 0.65 before it is cut
        // (31 Oct final check: "Sydney Olym..." at the largest text, "You've arrived at Macquarie Univers..." on the 6.1 inch).
        // Very large text (build 211 line check): just the stop name, "Macquarie University", so it stays whole.
        let headline = typeSize >= .xxLarge ? state.bareHeadline(stale: stale) : state.headline(stale: stale)
        return Text(headline).font(.subheadline.weight(.semibold)).lineLimit(2).minimumScaleFactor(0.65)
            .lineProbe("island-stop", text: headline, lines: 2, font: .subheadline.weight(.semibold), minScale: 0.65)
            .accessibilityLabel(state.headline(stale: stale))
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

/// "6 min", "1 hr, 5 min", "Now": whole minutes that keep counting by themselves on the Lock Screen and in the Island
/// (iOS 18), on one line, or the clock time on iOS 17, which has no minutes only countdown. Never a seconds timer.
/// Build 211 (31 Oct): was "in 6 minutes", which went onto two lines on the owner's iPhone ("Get off / in 6 / minutes"
/// on the Lock Screen, "in 5 / minutes" in the Island) and pushed the stop track off the Lock Screen card.
/// Rounded down like the widgets' "5 min" (WidgetText.wait): "5 min" at 5:59 to go.
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
        } else if date.timeIntervalSinceNow < 60 {
            Text("Now")
        } else if #available(iOS 18.0, *) {
            // The units in US English: "6 min", "1 hr, 5 min" (the phone's Australian English writes "6 min.").
            Text(TimeDataSource<Range<Date>>.dateRange(endingAt: date), format: Self.style)
                .environment(\.locale, Self.unitsLocale)
        } else {
            Text(Clock.time(date))
        }
    }

    /// Hours and minutes with short units: "6 min", "1 hr, 5 min".
    @available(iOS 18.0, *)
    static var style: Date.ComponentsFormatStyle {
        Date.ComponentsFormatStyle(style: .abbreviated, locale: unitsLocale, fields: [.hour, .minute])
    }
    static let unitsLocale = Locale(identifier: "en_US")

    /// The words the countdown shows right now (the native audit's line check reads them).
    static func words(_ date: Date, arrived: Bool = false, outdated: Bool = false) -> String {
        if arrived { return "" }
        if outdated { return Clock.time(date) }
        let now = Date()
        if date.timeIntervalSince(now) < 60 { return "Now" }
        if #available(iOS 18.0, *) { return style.format(now..<date) }
        return Clock.time(date)
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
            // The delay is beside the countdown now (build 211); a change or timetable warning stays here.
            if warning, let w = state.warning, state.delayStatus(stale: stale) == nil {
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
            if let w = state.warning, !state.arrived(stale: stale), state.delayStatus(stale: stale) == nil {
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
            // Very large text (build 211 line check): the next stop alone, the arrival time gives way before the name is cut.
            if let n = state.trackNext(stale: stale, short: true) {
                HStack(spacing: 0) { nextText(n).fixedSize(); Spacer(minLength: 0) }
            }
            // Last: one row whatever the width, the stop name smaller and then cut at its end, so a long name never
            // pushes the stop track off the card (snapshot run 41016955137: the 610X card fell back to the bar).
            HStack(spacing: 8) {
                if let n = state.trackNext(stale: stale, short: true) {
                    nextText(n).minimumScaleFactor(0.75).truncationMode(.tail)
                        .lineProbe("next-stop", text: n, lines: 1, font: .caption.weight(.semibold), minScale: 0.75)
                    Spacer(minLength: 0)
                } else {
                    Spacer(minLength: 0)
                    Text(rightShort).foregroundStyle(.secondary).monospacedDigit().lineLimit(1).fixedSize()
                }
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
/// 30 Oct: "Get off at Syd…" on the smallest iPhone). The line badge never truncates. The stop name shrinks to 0.7
/// in every layout before it is cut (31 Oct final check: "Get off at Macquarie Univer..." on the SE at normal text,
/// "Get off at Rand..." at the largest text; was 0.8).
struct LiveTripLockCard: View {
    var attrs: LiveTripAttributes
    var state: LiveTripAttributes.ContentState
    var stale = false
    @Environment(\.dynamicTypeSize) private var typeSize

    /// The stop track, except at the largest text sizes with a long stop name: there the name stays whole on the bar
    /// layouts (build 211 line check: "Macquarie Centre and University" was cut beside the track at xxxLarge).
    private var showsTrack: Bool {
        guard state.showsTrack(stale: stale) else { return false }
        return typeSize < .xxLarge || state.bareHeadline(stale: stale).count <= 16
    }

    var body: some View {
        ViewThatFits(in: .vertical) {
            // Build 210: the stop track in place of the bar when the card carries the leg's stops. The stop off
            // name stays whole first (owner, 30 Oct: "Get off at Five..."): "6 stops" and the late or change words
            // share one line before the headline is cut, and the track stays before the bar layouts are used.
            // Build 211 (31 Oct): the owner's build 210 iPhone showed the bar, not the stop track, on a T1 trip with
            // "2 stops" and "3 min late" on their own lines under a two line "in 6 / minutes": that card was too tall
            // for the Lock Screen. Now the countdown is one line ("6 min") and the track layouts put the stops and the
            // delay on one line ("2 stops · 3 min late"), so the track fits with room to spare.
            if showsTrack {
                card(lines: 2, track: true, merged: true)
                card(lines: 1, track: true, merged: true, headLines: 2)
                card(lines: 1, track: true, merged: true, headLines: 2, headScale: 0.65)
                card(lines: 1, track: true, merged: true)
            }
            card(lines: 2, track: false)
            // The stop name keeps its two lines before the detail and warning do (31 Oct readiness audit: "Get off at
            // Chatsw..." on the SE with a change warning, the owner's "Get off at Five..." case).
            card(lines: 1, track: false, headLines: 2)
            // Largest text (xxxLarge) with a change or late warning: the detail and warning share one line, and the stop
            // name keeps two lines and shrinks a little before it is cut (31 Oct final check: "Get off at C..." on the
            // SE, "Get off at Sydney Olymp..." on the 6.1 inch, both already in 209).
            card(lines: 1, track: false, merged: true, headLines: 2, headScale: 0.65)
            card(lines: 1, track: false)
        }
    }

    /// "6 stops · 4 min late" on one line: the detail in grey, the warning in its colour. With the stop track and no
    /// warning, "2 stops · On time" in green when the stops are live (build 211, the same words as the Island).
    private func detailAndWarning(_ lines: Int, track: Bool = false) -> some View {
        let d = state.detail(stale: stale)
        let w = state.arrived(stale: stale) ? nil : state.warning
        var t = Text(d).foregroundColor(.secondary)
        if let w, !w.isEmpty {
            let warn = Text(w).fontWeight(.semibold).foregroundColor(state.warningIsRed ? .red : .orange)
            t = d.isEmpty ? warn : t + Text(" · ").foregroundColor(.secondary) + warn
        } else if track, let on = state.delayStatus(stale: stale) {
            let ok = Text(on).fontWeight(.semibold).foregroundColor(delayColor(on))
            t = d.isEmpty ? ok : t + Text(" · ").foregroundColor(.secondary) + ok
        }
        return t.font(.subheadline).lineLimit(lines).minimumScaleFactor(0.85)
    }

    private func card(lines: Int, track: Bool, merged: Bool = false, headLines: Int? = nil, headScale: CGFloat = 0.7) -> some View {
        // Worked out here so the view expression stays quick to type check.
        // Very large text (build 211 line check): the stop name alone ("Macquarie University"); the label over the
        // countdown already says "Get off" or "Arrived", and VoiceOver still reads the whole line.
        let headline = typeSize >= .xxLarge ? state.bareHeadline(stale: stale) : state.headline(stale: stale)
        let headMax: Int = headLines ?? lines
        let countdown = MinutesUntil.words(state.countdownTarget, arrived: state.arrived(stale: stale), outdated: state.outdated(stale: stale))
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        WidgetLineBadge(line: state.line, colorHex: state.lineColorHex, mode: state.mode).fixedSize()
                        Text(headline).font(.headline).lineLimit(headMax).minimumScaleFactor(headScale)
                            .lineProbe("lock-stop", text: headline, lines: headMax, font: .headline, minScale: headScale)
                            .accessibilityLabel(state.headline(stale: stale))
                    }
                    if merged {
                        detailAndWarning(lines, track: track)
                    } else {
                        // An empty detail (no live stop count) takes no line.
                        if !track || !state.detail(stale: stale).isEmpty {
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
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 0) {
                    Text(state.countdownLabel(stale: stale)).font(.caption2).foregroundStyle(.secondary)
                    // One line, "6 min" (build 211: "in 6 / minutes" on the owner's iPhone); it shrinks before it is cut.
                    MinutesUntil(date: state.countdownTarget, arrived: state.arrived(stale: stale), outdated: state.outdated(stale: stale))
                        .font(.title2.weight(.bold))
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)  // xxxLarge with a warning: shrink, never "in 18 mi…" (31 Oct readiness audit)
                        .lineProbe("lock-countdown", text: countdown, lines: 1, font: .title2.weight(.bold).monospacedDigit(), minScale: 0.5)
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 100, alignment: .trailing)
                        // Only as wide as "6 min" needs, so the stop name gets the rest (build 211).
                        .fixedSize(horizontal: true, vertical: false)
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
