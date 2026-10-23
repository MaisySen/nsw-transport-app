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
                    WidgetLineBadge(line: a.line, colorHex: a.lineColorHex, mode: a.mode)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(timerInterval: Date.now...max(s.departs, Date.now), countsDown: true)
                        .font(.title3.weight(.semibold))
                        .monospacedDigit()
                        .multilineTextAlignment(.trailing)
                        .frame(width: 72, alignment: .trailing)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text("to \(a.towards)").font(.subheadline.weight(.semibold)).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Text(s.isLive ? s.status : "Scheduled")
                            .foregroundStyle(statusColor(s))
                        if let p = s.platform, !p.isEmpty { Text(p).foregroundStyle(.secondary) }
                        Spacer()
                        if let d = s.detail { Text(d).foregroundStyle(.secondary).lineLimit(1) }
                    }
                    .font(.caption)
                }
            } compactLeading: {
                WidgetLineBadge(line: a.line, colorHex: a.lineColorHex, mode: a.mode)
            } compactTrailing: {
                Text(timerInterval: Date.now...max(s.departs, Date.now), countsDown: true)
                    .monospacedDigit()
                    .frame(width: 44)
                    .foregroundStyle(statusColor(s))
            } minimal: {
                Image(systemName: Mode(raw: a.mode).symbol)
                    .foregroundStyle(statusColor(s))
            }
        }
    }
}

private func statusColor(_ s: TripActivityAttributes.ContentState) -> Color {
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
                        .foregroundStyle(statusColor(state))
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
