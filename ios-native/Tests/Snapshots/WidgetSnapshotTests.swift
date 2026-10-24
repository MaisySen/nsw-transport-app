import XCTest
import SwiftUI
import WidgetKit
import TransportKit

/// Renders the home screen widget, the Lock Screen widgets, the Live Activity and the
/// Dynamic Island with live data from the backend, in light and dark, as PNG files.
/// The views are the same ones the widget extension ships.
@MainActor
final class WidgetSnapshotTests: XCTestCase {
    private let from = StopRef(id: "213410", name: "Burwood Station")
    private let to = StopRef(id: "10101100", name: "Central Station")

    func testRenderWidgetsAndLiveActivity() async throws {
        let entry = await NextTripProvider.entry(title: "Home", from: from, to: to)
        XCTAssertFalse(entry.trips.isEmpty, "No live trips came back for Burwood to Central: \(entry.message ?? "")")

        let (attrs, state) = try await liveActivityData()

        let board = await StopBoardProvider.entry(stop: StopRef(id: "200060", name: "Central Station"), lines: nil)
        let boardT1 = await StopBoardProvider.entry(stop: from, lines: "T1, T2")

        for scheme in [ColorScheme.light, .dark] {
            let tag = scheme == .dark ? "dark" : "light"
            save(homeScreen(entry: entry), "\(tag)-w1-home-screen-widgets", scheme)
            save(widget(entry, .systemSmall, size: CGSize(width: 158, height: 158)), "\(tag)-w2-widget-small", scheme)
            save(widget(entry, .systemMedium, size: CGSize(width: 338, height: 158)), "\(tag)-w3-widget-medium", scheme)
            save(lockScreen(entry: entry, attrs: attrs, state: state), "\(tag)-w4-lock-screen", scheme)
            save(liveActivityCard(attrs: attrs, state: state).padding(12).background(Wallpaper()), "\(tag)-w5-live-activity", scheme)
            save(widget(entry, .systemLarge, size: CGSize(width: 338, height: 354)), "\(tag)-w6-widget-large", scheme)
            save(boardWidget(board, .systemSmall, size: CGSize(width: 158, height: 158)), "\(tag)-b1-board-small", scheme)
            save(boardWidget(board, .systemMedium, size: CGSize(width: 338, height: 158)), "\(tag)-b2-board-medium", scheme)
            save(boardWidget(board, .systemLarge, size: CGSize(width: 338, height: 354)), "\(tag)-b3-board-large", scheme)
            save(boardWidget(boardT1, .systemMedium, size: CGSize(width: 338, height: 158)), "\(tag)-b4-board-filtered", scheme)
        }
        save(standBy(entry: entry), "standby-1-next-trip", .dark)
        save(lockAccessories(entry: entry, board: board), "lock-accessories", .dark)
        // The Dynamic Island is always dark.
        save(islandCompact(attrs: attrs, state: state), "island-1-compact", .dark)
        save(islandExpanded(attrs: attrs, state: state), "island-2-expanded", .dark)
        save(islandMinimal(attrs: attrs, state: state), "island-3-minimal", .dark)
    }

    /// The same views with fixed data that has everything at once (a wait of 12 min 56 s, a long
    /// alert, a change, a walk, no live data on one service), every size, light and dark.
    func testRenderWidgetFixtureAllSizes() {
        let now = Date()
        func t(_ s: Double, _ line: String, _ hex: String, live: Bool, status: String, plat: String?, changes: Int = 0) -> TripLine {
            TripLine(line: line, colorHex: hex, mode: "train", leave: now.addingTimeInterval(s), arrive: now.addingTimeInterval(s + 900),
                     isLive: live, status: status, platform: plat, changes: changes)
        }
        let trips = [t(776, "T1", "#F99D1C", live: true, status: "On time", plat: "Platform 1"),
                     t(1500, "T1", "#F99D1C", live: true, status: "2 min late", plat: "Platform 1"),
                     t(2160, "T9", "#D11F2F", live: false, status: "Scheduled", plat: "Platform 4", changes: 1),
                     t(2700, "T1", "#F99D1C", live: true, status: "On time", plat: "Platform 1"),
                     t(4560, "T1", "#F99D1C", live: false, status: "Scheduled", plat: "Platform 1")]
        var e = NextTripEntry(date: now, title: "", from: "Strathfield", to: "Kings Cross", trips: trips, message: nil,
                              fromID: "213510", toID: "201110", updated: now)
        let plain = e
        e.notice = WidgetNotice(text: "T1 Western Line: Trains run to a changed timetable between Penrith and Emu Plains", level: .warning)
        var named = plain
        named.title = "Work"
        for scheme in [ColorScheme.light, .dark] {
            let tag = scheme == .dark ? "dark" : "light"
            save(widget(plain, .systemSmall, size: CGSize(width: 158, height: 158)), "fx-\(tag)-1-small", scheme)
            save(widget(e, .systemMedium, size: CGSize(width: 338, height: 158)), "fx-\(tag)-2-medium-alert", scheme)
            save(widget(named, .systemMedium, size: CGSize(width: 338, height: 158)), "fx-\(tag)-3-medium-named", scheme)
            save(widget(e, .systemLarge, size: CGSize(width: 338, height: 354)), "fx-\(tag)-4-large", scheme)
            save(lockAccessories(entry: plain, board: nil), "fx-\(tag)-5-lock-screen", scheme)
        }
        // A departed service is never shown: at each entry date every trip is still to come.
        for x in NextTripProvider.entries(from: plain) {
            XCTAssertTrue(x.trips.allSatisfy { $0.leave > x.date }, "a departed service is on the widget at \(x.date)")
        }
    }

    // MARK: Data

    private func liveActivityData() async throws -> (TripActivityAttributes, TripActivityAttributes.ContentState) {
        let r = try await TransportAPI.shared.trip(from: from.id, to: to.id, count: 4)
        let j = try XCTUnwrap(r.journeys.first { $0.firstTransit != nil && ($0.leave ?? .distantPast) > Date() } ?? r.journeys.first)
        let leg = try XCTUnwrap(j.firstTransit)
        let attrs = TripActivityAttributes(
            line: leg.line ?? "", lineColorHex: leg.color ?? Mode(raw: leg.mode).fallbackHex, mode: leg.mode ?? "train",
            from: Naming.short(from.name), towards: Naming.short(leg.towards ?? to.name), to: Naming.short(to.name))
        let stops = leg.stops
        let state = TripActivityAttributes.ContentState(
            departs: leg.departTime ?? Date().addingTimeInterval(300), arrives: j.arrive,
            status: Delay.text(delayMin: leg.delayMin, live: leg.isLive, cancelled: leg.cancelled == true),
            isLive: leg.isLive, platform: leg.fromPlatform,
            detail: j.arrive.map { "Arrive \(Clock.time($0))" }, stopsAway: stops)
        return (attrs, state)
    }

    // MARK: Scenes

    private func widget(_ entry: NextTripEntry, _ family: WidgetFamily, size: CGSize) -> some View {
        NextTripView(entry: entry, familyOverride: family)
            .padding(16)
            .frame(width: size.width, height: size.height)
            .background(Color(.systemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private func homeScreen(entry: NextTripEntry) -> some View {
        VStack(spacing: 20) {
            HStack(spacing: 22) {
                widget(entry, .systemSmall, size: CGSize(width: 158, height: 158))
                VStack(spacing: 6) {
                    AppIconStub()
                    Text("Transport").font(.caption2).foregroundStyle(.white)
                }
                .frame(width: 158)
            }
            widget(entry, .systemMedium, size: CGSize(width: 338, height: 158))
        }
        .padding(.vertical, 40)
        .frame(width: 393)
        .background(Wallpaper())
    }

    private func lockScreen(entry: NextTripEntry, attrs: TripActivityAttributes, state: TripActivityAttributes.ContentState) -> some View {
        VStack(spacing: 6) {
            VStack(spacing: 6) {
                NextTripView(entry: entry, familyOverride: .accessoryInline)
                    .font(.title3.weight(.semibold))
                Text(Date.now, format: .dateTime.hour(.defaultDigits(amPM: .omitted)).minute())
                    .font(.system(size: 92, weight: .semibold, design: .rounded))
                NextTripView(entry: entry, familyOverride: .accessoryRectangular)
                    .frame(width: 160, height: 72, alignment: .leading)
            }
            .foregroundStyle(.white)
            Spacer(minLength: 120)
            liveActivityCard(attrs: attrs, state: state)
                .padding(.horizontal, 12)
        }
        .padding(.top, 70)
        .padding(.bottom, 40)
        .frame(width: 393, height: 852)
        .background(Wallpaper())
    }

    private func liveActivityCard(attrs: TripActivityAttributes, state: TripActivityAttributes.ContentState) -> some View {
        LockScreenCard(attrs: attrs, state: state)
            .padding(16)
            .environment(\.colorScheme, .dark)
            .frame(width: 369)
            .background(Color.black.opacity(0.6))
            .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private func islandCompact(attrs: TripActivityAttributes, state: TripActivityAttributes.ContentState) -> some View {
        HStack(spacing: 0) {
            WidgetLineBadge(line: attrs.line, colorHex: attrs.lineColorHex, mode: attrs.mode)
                .padding(.leading, 12)
            Spacer(minLength: 126)
            IslandCompactTrailing(state: state)
                .padding(.trailing, 12)
        }
        .foregroundStyle(.white)
        .frame(width: 250, height: 37)
        .background(Capsule().fill(.black))
        .padding(20)
        .background(Wallpaper())
    }

    private func islandExpanded(attrs: TripActivityAttributes, state: TripActivityAttributes.ContentState) -> some View {
        VStack(spacing: 10) {
            HStack(alignment: .center) {
                IslandLeading(attrs: attrs)
                Spacer()
                IslandCenter(attrs: attrs)
                Spacer()
                IslandTrailing(state: state)
            }
            IslandBottom(state: state)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 20)
        .padding(.top, 18)
        .padding(.bottom, 16)
        .frame(width: 371)
        .background(RoundedRectangle(cornerRadius: 44, style: .continuous).fill(.black))
        .padding(11)
        .background(Wallpaper())
    }

    private func islandMinimal(attrs: TripActivityAttributes, state: TripActivityAttributes.ContentState) -> some View {
        IslandMinimal(attrs: attrs, state: state)
            .frame(width: 37, height: 37)
            .background(Circle().fill(.black))
            .padding(20)
            .background(Wallpaper())
    }

    private func boardWidget(_ e: StopBoardEntry, _ family: WidgetFamily, size: CGSize) -> some View {
        StopBoardView(entry: e, familyOverride: family)
            .padding(16)
            .frame(width: size.width, height: size.height)
            .background(Color(.systemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    /// StandBy: the phone on its side on a charger, the widget drawn without its background.
    private func standBy(entry: NextTripEntry) -> some View {
        HStack(spacing: 16) {
            NextTripView(entry: entry, familyOverride: .systemSmall, standByOverride: true)
                .padding(20)
                .frame(width: 330, height: 330)
            Text(Date.now, format: .dateTime.hour(.defaultDigits(amPM: .omitted)).minute())
                .font(.system(size: 120, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.9))
                .frame(width: 400)
        }
        .foregroundStyle(.white)
        .frame(width: 852, height: 393)
        .background(Color.black)
    }

    /// The Lock Screen widget row: the ring, the trip and the stop board, white on the wallpaper.
    private func lockAccessories(entry: NextTripEntry, board: StopBoardEntry?) -> some View {
        VStack(spacing: 14) {
            NextTripView(entry: entry, familyOverride: .accessoryInline)
                .font(.headline)
            HStack(spacing: 12) {
                NextTripView(entry: entry, familyOverride: .accessoryCircular)
                    .frame(width: 72, height: 72)
                NextTripView(entry: entry, familyOverride: .accessoryRectangular)
                    .frame(width: 170, height: 72, alignment: .leading)
            }
            if let board {
                StopBoardView(entry: board, familyOverride: .accessoryRectangular)
                    .frame(width: 170, height: 72, alignment: .leading)
            }
        }
        .foregroundStyle(.white)
        .padding(30)
        .frame(width: 393)
        .background(Wallpaper())
    }

    // MARK: Output

    private func save<V: View>(_ view: V, _ name: String, _ scheme: ColorScheme) {
        let r = ImageRenderer(content: view.environment(\.colorScheme, scheme))
        r.scale = 3
        guard let png = r.uiImage?.pngData() else {
            XCTFail("Could not render \(name)")
            return
        }
        let a = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
        a.name = name
        a.lifetime = .keepAlways
        add(a)
        let dir = ProcessInfo.processInfo.environment["SNAPSHOT_DIR"] ?? NSTemporaryDirectory()
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
    }
}

private struct Wallpaper: View {
    var body: some View {
        LinearGradient(colors: [Color(red: 0.16, green: 0.32, blue: 0.55), Color(red: 0.42, green: 0.27, blue: 0.52)],
                       startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

private struct AppIconStub: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
            .fill(Color(red: 0.0, green: 0.48, blue: 1.0))
            .frame(width: 62, height: 62)
            .overlay(Image(systemName: "tram.fill").font(.system(size: 28, weight: .semibold)).foregroundStyle(.white))
    }
}
