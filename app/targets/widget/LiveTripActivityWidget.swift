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
                    WidgetLineBadge(line: s.line, colorHex: s.lineColorHex, mode: s.mode)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    MinutesUntil(date: s.countdownTarget, arrived: s.arrived(stale: stale))
                        .font(.title3.weight(.semibold))
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .multilineTextAlignment(.trailing)
                        .frame(width: 80, alignment: .trailing)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(s.headline(stale: stale)).font(.subheadline.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.8)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    LiveTripIslandBottom(state: s, stale: stale)
                }
            } compactLeading: {
                // Before boarding the line ("T1" then the minutes); on board the next thing to do ("Off Redfern").
                if s.phase == "ride" && !s.arrived(stale: stale) {
                    Text(s.compactAction)
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                        .frame(maxWidth: 84, alignment: .leading)
                } else {
                    WidgetLineBadge(line: s.line, colorHex: s.lineColorHex, mode: s.mode)
                }
            } compactTrailing: {
                MinutesUntil(date: s.countdownTarget, arrived: s.arrived(stale: stale))
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .frame(maxWidth: 56)
            } minimal: {
                WidgetLineBadge(line: s.line, colorHex: s.lineColorHex, mode: s.mode)
            }
            .widgetURL(URL(string: "nswtransport://go"))
        }
    }
}

/// "26 min", "1 min", "Now": whole minutes that keep counting on the Lock Screen (iOS 18), or
/// the clock time on iOS 17, which has no minutes only countdown. Never a seconds timer.
struct MinutesUntil: View {
    var date: Date
    var arrived = false
    var body: some View {
        if arrived {
            Image(systemName: "checkmark.circle.fill").accessibilityLabel("Arrived")
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
            HStack {
                Text(state.detail(stale: stale)).foregroundStyle(.secondary).lineLimit(1)
                Spacer()
                if !state.arrived(stale: stale) {
                    Text(state.arriveLine).monospacedDigit().lineLimit(1)
                }
            }
            if let w = state.warning, !state.arrived(stale: stale) {
                Label(w, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(w.contains("miss") ? Color.red : Color.orange)
                    .lineLimit(1)
            }
        }
        .font(.caption)
    }
}

/// One card that changes with the trip: waiting, on board, at a change, then the last leg.
struct LiveTripLockCard: View {
    var attrs: LiveTripAttributes
    var state: LiveTripAttributes.ContentState
    var stale = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        WidgetLineBadge(line: state.line, colorHex: state.lineColorHex, mode: state.mode)
                        Text(state.headline(stale: stale)).font(.headline).lineLimit(1).minimumScaleFactor(0.8)
                    }
                    Text(state.detail(stale: stale))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    if let w = state.warning, !state.arrived(stale: stale) {
                        Text(w)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(w.contains("miss") ? Color.red : Color.orange)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 0) {
                    Text(state.arrived(stale: stale) ? "Arrived" : (state.phase == "wait" ? "Leaves" : "Get off")).font(.caption2).foregroundStyle(.secondary)
                    MinutesUntil(date: state.countdownTarget, arrived: state.arrived(stale: stale))
                        .font(.title2.weight(.bold))
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .multilineTextAlignment(.trailing)
                }
            }
            ProgressView(value: state.arrived(stale: stale) ? 1 : min(max(state.progress, 0), 1))
                .tint(RGB(hex: state.lineColorHex).map { Color(red: $0.r, green: $0.g, blue: $0.b) } ?? Color.blue)
            if !state.arrived(stale: stale) {
                Text(state.arriveLine).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
        }
    }
}
