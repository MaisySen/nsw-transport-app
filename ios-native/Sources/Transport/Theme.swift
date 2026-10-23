import SwiftUI
import TransportKit

extension Color {
    init(hex: String?, fallback: Color = .accentColor) {
        if let c = RGB(hex: hex) {
            self = Color(red: c.r, green: c.g, blue: c.b)
        } else {
            self = fallback
        }
    }

    static let liveGreen = Color(red: 0.13, green: 0.70, blue: 0.36)
}

/// The coloured line pill, like the badges on station signs.
struct LineBadge: View {
    var line: String
    var colorHex: String?
    var mode: String?
    var compact = false

    var body: some View {
        let m = Mode(raw: mode)
        let hex = colorHex ?? m.fallbackHex
        let white = RGB(hex: hex)?.prefersWhiteText ?? true
        HStack(spacing: 3) {
            Image(systemName: m.symbol)
                .font(.caption2.weight(.bold))
                .imageScale(.small)
            Text(line.isEmpty ? m.title : line)
                .font(compact ? .caption.weight(.bold) : .subheadline.weight(.bold))
                .lineLimit(1)
                .fixedSize()
        }
        .foregroundStyle(white ? Color.white : Color.black)
        .padding(.horizontal, compact ? 6 : 8)
        .padding(.vertical, compact ? 2 : 4)
        .background(Color(hex: hex), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        .accessibilityLabel("\(m.title) \(line)")
    }
}

/// Green "Live" with a soft pulse, or grey "Scheduled". A scheduled time is never shown as live.
struct LiveBadge: View {
    var isLive: Bool
    var cancelled = false
    @State private var pulse = false

    var body: some View {
        if cancelled {
            label("Cancelled", color: .red, dot: false)
        } else if isLive {
            label("Live", color: .liveGreen, dot: true)
        } else {
            label("Scheduled", color: .secondary, dot: false)
        }
    }

    private func label(_ text: String, color: Color, dot: Bool) -> some View {
        HStack(spacing: 4) {
            if dot {
                Circle()
                    .fill(color)
                    .frame(width: 6, height: 6)
                    .opacity(pulse ? 0.35 : 1)
                    .animation(.easeInOut(duration: 1).repeatForever(autoreverses: true), value: pulse)
                    .onAppear { pulse = true }
            }
            Text(text)
                .font(.caption2.weight(.semibold))
                .textCase(.uppercase)
        }
        .foregroundStyle(color)
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(color.opacity(0.12), in: Capsule())
        .accessibilityLabel(text)
    }
}

/// A big ticking countdown: "4 min", "Now". Redraws every second on its own.
struct CountdownLabel: View {
    var to: Date
    var cancelled = false
    var isLive = false

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
            VStack(alignment: .trailing, spacing: 0) {
                Text(TransportKit.Countdown.big(until: to, now: ctx.date))
                    .font(.title2.weight(.semibold))
                    .monospacedDigit()
                    .contentTransition(.numericText(countsDown: true))
                    .foregroundStyle(cancelled ? Color.secondary : (isLive ? Color.liveGreen : Color.primary))
                    .strikethrough(cancelled)
                let unit = TransportKit.Countdown.unit(until: to, now: ctx.date)
                if !unit.isEmpty {
                    Text(unit)
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(.secondary)
                }
            }
            .animation(.default, value: TransportKit.Countdown.minutes(until: to, now: ctx.date))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(cancelled ? "Cancelled" : TransportKit.Countdown.phrase(until: to))
    }
}

/// "Live data updated 11:21:05" with a dot that flashes on each refresh.
struct UpdatedLine: View {
    var updated: Date?
    var isLoading: Bool
    var liveCount: Int?

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(isLoading ? Color.orange : Color.liveGreen)
                .frame(width: 7, height: 7)
                .scaleEffect(isLoading ? 1.4 : 1)
                .animation(.easeInOut(duration: 0.4), value: isLoading)
            if let updated {
                Text("Live data updated \(Clock.seconds(updated))")
            } else {
                Text("Loading live times")
            }
            Spacer()
            if let liveCount { Text("\(liveCount) live") }
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
    }
}

/// Occupancy shown as one to three filled person glyphs.
struct CrowdView: View {
    var occupancy: Occupancy?

    var body: some View {
        if let level = occupancy?.level, level > 0 {
            HStack(spacing: 1) {
                ForEach(0..<3, id: \.self) { i in
                    Image(systemName: i < min(level, 3) ? "person.fill" : "person")
                }
            }
            .font(.caption2)
            .foregroundStyle(level >= 3 ? Color.orange : Color.secondary)
            .accessibilityLabel(occupancy?.text ?? "Occupancy")
        }
    }
}

struct StatusText: View {
    var delayMin: Int?
    var isLive: Bool
    var cancelled: Bool

    var body: some View {
        let t = Delay.text(delayMin: delayMin, live: isLive, cancelled: cancelled)
        Text(t)
            .foregroundStyle(color)
    }

    private var color: Color {
        if cancelled { return .red }
        guard isLive, let d = delayMin else { return .secondary }
        if d >= 3 { return .orange }
        if d < 0 { return .blue }
        return .liveGreen
    }
}

/// The time line on a row: live time, with the timetable time struck through when they differ.
struct TimePair: View {
    var planned: Date?
    var estimated: Date?
    var isLive: Bool

    var body: some View {
        HStack(spacing: 4) {
            if isLive, let e = estimated {
                Text(Clock.time(e)).fontWeight(.semibold)
                if let p = planned, abs(p.timeIntervalSince(e)) >= 60 {
                    Text(Clock.time(p)).strikethrough().foregroundStyle(.secondary)
                }
            } else if let p = planned {
                Text(Clock.time(p))
            }
        }
        .monospacedDigit()
    }
}

/// Haptics wired to the store's counters.
struct HapticsModifier: ViewModifier {
    @Environment(AppStore.self) private var store
    func body(content: Content) -> some View {
        content
            .sensoryFeedback(.impact(weight: .light), trigger: store.hapticTick)
            .sensoryFeedback(.success, trigger: store.successTick)
    }
}

extension View {
    func appHaptics() -> some View { modifier(HapticsModifier()) }

    /// Runs `action` now and then every `seconds` while the view is on screen and the app is active.
    func autoRefresh(every seconds: Int, active: Bool, _ action: @escaping () async -> Void) -> some View {
        task(id: active) {
            guard active else { return }
            while !Task.isCancelled {
                await action()
                try? await Task.sleep(for: .seconds(seconds))
            }
        }
    }
}

struct BannerOverlay: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        if let b = store.banner {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: b.symbol)
                    .font(.title3)
                    .foregroundStyle(.tint)
                VStack(alignment: .leading, spacing: 2) {
                    Text(b.title).font(.subheadline.weight(.semibold))
                    if let d = b.detail {
                        Text(d).font(.footnote).foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
            .padding(.horizontal, 12)
            .transition(.move(edge: .top).combined(with: .opacity))
            .onTapGesture { withAnimation { store.banner = nil } }
            .accessibilityAddTraits(.isStaticText)
        }
    }
}
