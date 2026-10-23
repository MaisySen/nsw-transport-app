import ActivityKit
import WidgetKit
import SwiftUI
import TransportKit

/// Lock Screen card and Dynamic Island for a followed service.
struct TripLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TripActivityAttributes.self) { context in
            LockScreenCard(attrs: context.attributes, state: context.state)
                .padding(16)
                .activityBackgroundTint(Color(.systemBackground).opacity(0.85))
                .activitySystemActionForegroundColor(.primary)
        } dynamicIsland: { context in
            let a = context.attributes
            let s = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    IslandLeading(attrs: a)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    IslandTrailing(state: s)
                }
                DynamicIslandExpandedRegion(.center) {
                    IslandCenter(attrs: a)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    IslandBottom(state: s)
                }
            } compactLeading: {
                WidgetLineBadge(line: a.line, colorHex: a.lineColorHex, mode: a.mode)
            } compactTrailing: {
                IslandCompactTrailing(state: s)
            } minimal: {
                IslandMinimal(attrs: a, state: s)
            }
        }
    }
}

// The Dynamic Island regions are plain views so the snapshot tests can render them.

struct IslandLeading: View {
    var attrs: TripActivityAttributes
    var body: some View {
        WidgetLineBadge(line: attrs.line, colorHex: attrs.lineColorHex, mode: attrs.mode)
            .padding(.leading, 4)
    }
}

struct IslandTrailing: View {
    var state: TripActivityAttributes.ContentState
    var body: some View {
        Text(timerInterval: Date.now...max(state.departs, Date.now), countsDown: true)
            .font(.title3.weight(.semibold))
            .monospacedDigit()
            .multilineTextAlignment(.trailing)
            .frame(width: 72, alignment: .trailing)
    }
}

struct IslandCenter: View {
    var attrs: TripActivityAttributes
    var body: some View {
        Text("to \(attrs.towards)").font(.subheadline.weight(.semibold)).lineLimit(1)
    }
}

struct IslandBottom: View {
    var state: TripActivityAttributes.ContentState
    var body: some View {
        HStack {
            Text(state.isLive ? state.status : "Scheduled")
                .foregroundStyle(activityStatusColor(state))
            if let p = state.platform, !p.isEmpty { Text(p).foregroundStyle(.secondary) }
            Spacer()
            if let d = state.detail { Text(d).foregroundStyle(.secondary).lineLimit(1) }
        }
        .font(.caption)
    }
}

struct IslandCompactTrailing: View {
    var state: TripActivityAttributes.ContentState
    var body: some View {
        Text(timerInterval: Date.now...max(state.departs, Date.now), countsDown: true)
            .monospacedDigit()
            .frame(width: 44)
            .foregroundStyle(activityStatusColor(state))
    }
}

struct IslandMinimal: View {
    var attrs: TripActivityAttributes
    var state: TripActivityAttributes.ContentState
    var body: some View {
        Image(systemName: Mode(raw: attrs.mode).symbol)
            .foregroundStyle(activityStatusColor(state))
    }
}

func activityStatusColor(_ s: TripActivityAttributes.ContentState) -> Color {
    if s.status == "Cancelled" { return .red }
    if !s.isLive { return .secondary }
    return s.status.contains("late") ? .orange : .green
}

struct LockScreenCard: View {
    var attrs: TripActivityAttributes
    var state: TripActivityAttributes.ContentState

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    WidgetLineBadge(line: attrs.line, colorHex: attrs.lineColorHex, mode: attrs.mode)
                    Text("to \(attrs.towards)").font(.headline).lineLimit(1)
                }
                Text(attrs.to.map { "\(attrs.from) to \($0)" } ?? "From \(attrs.from)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    Text(state.isLive ? state.status : "Scheduled")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(activityStatusColor(state))
                    if let p = state.platform, !p.isEmpty { Text(p).font(.caption) }
                    if let d = state.detail { Text(d).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 0) {
                Text("Leaves").font(.caption2).foregroundStyle(.secondary)
                Text(timerInterval: Date.now...max(state.departs, Date.now), countsDown: true)
                    .font(.title.weight(.bold))
                    .monospacedDigit()
                    .multilineTextAlignment(.trailing)
                    .frame(width: 96, alignment: .trailing)
                Text(Clock.time(state.departs)).font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}
