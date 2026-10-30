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
        .font(.caption)
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
            card(lines: 2)
            card(lines: 1)
        }
    }

    private func card(lines: Int) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        WidgetLineBadge(line: state.line, colorHex: state.lineColorHex, mode: state.mode).fixedSize()
                        Text(state.headline(stale: stale)).font(.headline).lineLimit(lines).minimumScaleFactor(0.8)
                    }
                    Text(state.detail(stale: stale))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(lines)
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
                        .frame(maxWidth: 120, alignment: .trailing)
                }
                .layoutPriority(1)
            }
            ProgressView(value: state.arrived(stale: stale) ? 1 : min(max(state.progress, 0), 1))
                .tint(RGB(hex: state.lineColorHex).map { Color(red: $0.r, green: $0.g, blue: $0.b) } ?? Color.blue)
            if !state.arrived(stale: stale) {
                Text(state.outdated(stale: stale) ? "\(state.arriveLine). \(state.updatedLine)" : state.arriveLine)
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.8)
            }
        }
    }
}
