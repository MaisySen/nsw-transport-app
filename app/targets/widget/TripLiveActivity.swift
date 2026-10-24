import ActivityKit
import WidgetKit
import SwiftUI

/// Lock Screen card and Dynamic Island for a followed service.
struct TripLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TripActivityAttributes.self) { context in
            // Dark glass on every wallpaper, like the system's own Lock Screen activities.
            LockScreenCard(attrs: context.attributes, state: context.state)
                .padding(16)
                .environment(\.colorScheme, .dark)
                .activityBackgroundTint(Color.black.opacity(0.6))
                .activitySystemActionForegroundColor(.white)
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
        MinutesUntil(date: state.departs)
            .font(.title3.weight(.semibold))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .multilineTextAlignment(.trailing)
            .frame(width: 80, alignment: .trailing)
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
        MinutesUntil(date: state.departs)
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .frame(maxWidth: 56)
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
                MinutesUntil(date: state.departs)
                    .font(.title2.weight(.bold))
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .multilineTextAlignment(.trailing)
                    .frame(width: 110, alignment: .trailing)
                Text(Clock.time(state.departs)).font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}
