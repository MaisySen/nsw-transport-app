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
        // One line, "6 min" (build 211; was "in 18 minutes" on two lines).
        MinutesUntil(date: state.departs)
            .font(.title3.weight(.semibold))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .lineProbe("follow-island-countdown", text: MinutesUntil.words(state.departs), lines: 1, font: .title3.weight(.semibold).monospacedDigit(), minScale: 0.6)
            .multilineTextAlignment(.trailing)
            // Round 2 (build 211): 4 pt in from the right edge like the badge on the left, clear of the rounded corner.
            .padding(.trailing, 4)
            .frame(minWidth: 80, maxWidth: 104, alignment: .trailing)
    }
}

struct IslandCenter: View {
    var attrs: TripActivityAttributes
    var body: some View {
        // One line under the camera (round 2, build 211), shrinking to 0.7 before it is cut at its end; was two lines.
        let to = "to \(shortTowards(attrs.towards))"
        return Text(to).font(.subheadline.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.7).truncationMode(.tail)
            .lineProbe("follow-island-to", text: to, lines: 1, font: .subheadline.weight(.semibold), minScale: 0.7)
            .multilineTextAlignment(.center)
            .accessibilityLabel("to \(attrs.towards)")
    }
}

/// A long destination drops its "via" part on the Lock Screen and in the Island ("to Macquarie University via Epping
/// and North Ryde" was cut on every phone, build 211 line check); the line badge and the stops tell the service apart.
func shortTowards(_ s: String) -> String {
    guard s.count > 28, let r = s.range(of: " via ") else { return s }
    return String(s[..<r.lowerBound])
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

    /// The countdown takes at most 100 pt on one line, shrinking before it is cut (build 211), and the left side gives way: "to <where>" stays on one line
    /// (round 2), then the detail goes, then the platform (native audit, 30 Oct: "in 6 minut…", "On / time" wrapping, "to Macquar…").
    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            left()
                .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .trailing, spacing: 0) {
                Text("Leaves").font(.caption2).foregroundStyle(.secondary)
                // One line, "18 min" (build 211; was "in 18 minutes" on two lines); it shrinks before it is cut.
                MinutesUntil(date: state.departs)
                    .font(.title2.weight(.bold))
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)  // xxxLarge with a warning: shrink, never "in 18 mi…" (31 Oct readiness audit)
                    .lineProbe("follow-lock-countdown", text: MinutesUntil.words(state.departs), lines: 1, font: .title2.weight(.bold).monospacedDigit(), minScale: 0.5)
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 100, alignment: .trailing)
                    .fixedSize(horizontal: true, vertical: false)
                Text(Clock.time(state.departs)).font(.caption).foregroundStyle(.secondary).fixedSize()
            }
            .layoutPriority(1)
        }
    }

    private func left() -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                WidgetLineBadge(line: attrs.line, colorHex: attrs.lineColorHex, mode: attrs.mode).fixedSize()
                // One line (round 2, build 211; it could take two), shrinking to 0.7 before it is cut at its end.
                Text("to \(shortTowards(attrs.towards))").font(.headline).lineLimit(1).minimumScaleFactor(0.7).truncationMode(.tail)
                    .lineProbe("follow-lock-to", text: "to \(shortTowards(attrs.towards))", lines: 1, font: .headline, minScale: 0.7)
                    .accessibilityLabel("to \(attrs.towards)")
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
