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
        // "in 18 minutes" goes onto two lines rather than "in 18 minut…" (native audit).
        MinutesUntil(date: state.departs)
            .font(.title3.weight(.semibold))
            .monospacedDigit()
            .lineLimit(2)
            .minimumScaleFactor(0.6)
            .multilineTextAlignment(.trailing)
            .frame(width: 80, alignment: .trailing)
    }
}

struct IslandCenter: View {
    var attrs: TripActivityAttributes
    var body: some View {
        Text("to \(attrs.towards)").font(.subheadline.weight(.semibold)).lineLimit(2).minimumScaleFactor(0.8)
            .multilineTextAlignment(.center)
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

/// The tiny countdown ("6:12", counting down by itself), the same one the Start trip activity uses. "in 6 minutes"
/// never fitted the compact island and showed as "in 6 mi…" (native audit, 30 Oct).
struct IslandCompactTrailing: View {
    var state: TripActivityAttributes.ContentState
    var body: some View {
        CompactCountdown(date: state.departs)
            .frame(maxWidth: 44, alignment: .trailing)
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

    /// The countdown takes at most 120 pt (two lines when it needs them) and the left side gives way: "to <where>" may take two lines, then the
    /// detail goes, then the platform (native audit, 30 Oct: "in 6 minut…", "On / time" wrapping, "to Macquar…").
    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            ViewThatFits(in: .vertical) {
                left(towardsLines: 2)
                left(towardsLines: 1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .trailing, spacing: 0) {
                Text("Leaves").font(.caption2).foregroundStyle(.secondary)
                // "in 18 minutes" takes two lines before the left side is cut (native audit).
                MinutesUntil(date: state.departs)
                    .font(.title2.weight(.bold))
                    .monospacedDigit()
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 120, alignment: .trailing)
                Text(Clock.time(state.departs)).font(.caption).foregroundStyle(.secondary).fixedSize()
            }
            .layoutPriority(1)
        }
    }

    private func left(towardsLines: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                WidgetLineBadge(line: attrs.line, colorHex: attrs.lineColorHex, mode: attrs.mode).fixedSize()
                Text("to \(attrs.towards)").font(.headline).lineLimit(towardsLines).minimumScaleFactor(0.85)
            }
            Text(attrs.to.map { "\(attrs.from) to \($0)" } ?? "From \(attrs.from)")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            ViewThatFits(in: .horizontal) {
                statusRow(platform: true, detail: true)
                statusRow(platform: true, detail: false)
                statusRow(platform: false, detail: false)
            }
            .font(.caption)
            .lineLimit(1)
        }
    }

    private func statusRow(platform: Bool, detail: Bool) -> some View {
        HStack(spacing: 6) {
            Text(state.isLive ? state.status : "Scheduled")
                .fontWeight(.semibold)
                .foregroundStyle(activityStatusColor(state))
                .fixedSize()
            if platform, let p = state.platform, !p.isEmpty { Text(p).fixedSize() }
            if detail, let d = state.detail { Text(d).foregroundStyle(.secondary).fixedSize() }
        }
    }
}
