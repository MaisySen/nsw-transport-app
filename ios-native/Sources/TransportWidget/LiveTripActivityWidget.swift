import ActivityKit
import WidgetKit
import SwiftUI
import TransportKit

/// Lock Screen card and Dynamic Island for a live trip started with Start trip.
struct LiveTripActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: LiveTripAttributes.self) { context in
            LiveTripLockCard(attrs: context.attributes, state: context.state)
                .padding(16)
                .environment(\.colorScheme, .dark)
                .activityBackgroundTint(Color.black.opacity(0.6))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(URL(string: "nswtransport://go"))
        } dynamicIsland: { context in
            let s = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    WidgetLineBadge(line: s.line, colorHex: s.lineColorHex, mode: s.mode)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(timerInterval: Date.now...max(s.arrival, Date.now), countsDown: true)
                        .font(.title3.weight(.semibold))
                        .monospacedDigit()
                        .multilineTextAlignment(.trailing)
                        .frame(width: 72, alignment: .trailing)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(liveTripHeadline(s)).font(.subheadline.weight(.semibold)).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    LiveTripIslandBottom(state: s)
                }
            } compactLeading: {
                WidgetLineBadge(line: s.line, colorHex: s.lineColorHex, mode: s.mode)
            } compactTrailing: {
                Text(timerInterval: Date.now...max(s.arrival, Date.now), countsDown: true)
                    .monospacedDigit()
                    .frame(width: 44)
            } minimal: {
                WidgetLineBadge(line: s.line, colorHex: s.lineColorHex, mode: s.mode)
            }
            .widgetURL(URL(string: "nswtransport://go"))
        }
    }
}

func liveTripHeadline(_ s: LiveTripAttributes.ContentState) -> String {
    if s.phase == "wait" { return "Board at \(s.nextStop ?? s.getOffAt)" }
    if let n = s.nextStop { return "Next stop: \(n)" }
    return "To \(s.getOffAt)"
}

func liveTripStopsLine(_ s: LiveTripAttributes.ContentState) -> String {
    guard let n = s.stopsLeft else { return "Get off at \(s.getOffAt)" }
    if n <= 0 { return "Get off at \(s.getOffAt)" }
    return n == 1 ? "1 stop to \(s.getOffAt)" : "\(n) stops to \(s.getOffAt)"
}

struct LiveTripIslandBottom: View {
    var state: LiveTripAttributes.ContentState
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(liveTripStopsLine(state)).foregroundStyle(.secondary).lineLimit(1)
                Spacer()
                Text("Arrive \(Clock.time(state.arrival))").monospacedDigit()
            }
            if let w = state.warning {
                Label(w, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(w.contains("miss") ? Color.red : Color.orange)
                    .lineLimit(1)
            }
        }
        .font(.caption)
    }
}

struct LiveTripLockCard: View {
    var attrs: LiveTripAttributes
    var state: LiveTripAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        WidgetLineBadge(line: state.line, colorHex: state.lineColorHex, mode: state.mode)
                        Text(liveTripHeadline(state)).font(.headline).lineLimit(1)
                    }
                    Text(liveTripStopsLine(state))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    if let w = state.warning {
                        Text(w)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(w.contains("miss") ? Color.red : Color.orange)
                            .lineLimit(1)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 0) {
                    Text("Arrive").font(.caption2).foregroundStyle(.secondary)
                    Text(timerInterval: Date.now...max(state.arrival, Date.now), countsDown: true)
                        .font(.title.weight(.bold))
                        .monospacedDigit()
                        .multilineTextAlignment(.trailing)
                        .frame(width: 96, alignment: .trailing)
                    Text(Clock.time(state.arrival)).font(.caption).foregroundStyle(.secondary)
                }
            }
            ProgressView(value: min(max(state.progress, 0), 1))
                .tint(RGB(hex: state.lineColorHex).map { Color(red: $0.r, green: $0.g, blue: $0.b) } ?? Color.blue)
            if let f = state.fareLine {
                Text(f).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            }
        }
    }
}
