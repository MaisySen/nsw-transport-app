// Screenshots of the iPhone widgets for the EAS simulator check (tools/widget-shots.sh, .eas/build/watch-shots.yml).
// Not part of the app: the script compiles this file together with the widget extension's own Swift files (its
// @main taken out) into a command line tool and runs it on an iPhone simulator. The views are the ones the widget
// ships; the data is live from the server. The Home Screen and Lock Screen around them (wallpaper, clock, icon
// grid spacing) are drawn here, so they show layout and content, not the system's own glass or tinting.
import SwiftUI
import UIKit
import WidgetKit

@main
struct WidgetShots {
    @MainActor
    static func main() async {
        let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : FileManager.default.currentDirectoryPath + "/widget-shots"
        try? FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
        // The widget's own "no profile yet" state, so these requests create nothing on the server.
        UserDefaults.standard.set("none", forKey: "apiProfile")

        let strathfield = StopRef(id: "213510", name: "Strathfield Station")
        let kingsCross = StopRef(id: "201110", name: "Kings Cross Station")
        let fiveDock = StopRef(id: "2046100", name: "Five Dock Shops, Great North Rd")

        let train = await NextTripProvider.entry(title: "", from: strathfield, to: kingsCross)
        let bus = await NextTripProvider.entry(title: "", from: strathfield, to: fiveDock)
        let board = await StopBoardProvider.entry(stop: fiveDock, lines: nil)
        let boardStation = await StopBoardProvider.entry(stop: strathfield, lines: nil)
        print("train trips: \(train.trips.count) \(train.message ?? "")")
        print("bus trips: \(bus.trips.count) \(bus.message ?? "")")
        print("bus stop rows: \(board.rows.count), stop number: \(board.stopNo ?? "none") \(board.message ?? "")")
        print("station rows: \(boardStation.rows.count), stop number: \(boardStation.stopNo ?? "none")")

        let small = CGSize(width: 170, height: 170), medium = CGSize(width: 364, height: 170), large = CGSize(width: 364, height: 382)
        for scheme in [ColorScheme.light, .dark] {
            let tag = scheme == .dark ? "dark" : "light"
            save(homeScreen(train: train, bus: bus, board: board), "\(tag)-1-home-screen", scheme, out)
            save(trip(train, .systemSmall, small), "\(tag)-2-trip-small", scheme, out)
            save(trip(train, .systemMedium, medium), "\(tag)-3-trip-medium", scheme, out)
            save(trip(train, .systemLarge, large), "\(tag)-4-trip-large", scheme, out)
            save(trip(bus, .systemMedium, medium), "\(tag)-5-bus-trip-medium", scheme, out)
            save(stop(board, .systemSmall, small), "\(tag)-6-bus-stop-small", scheme, out)
            save(stop(board, .systemMedium, medium), "\(tag)-7-bus-stop-medium", scheme, out)
            save(stop(board, .systemLarge, large), "\(tag)-8-bus-stop-large", scheme, out)
            save(stop(boardStation, .systemMedium, medium), "\(tag)-9-station-board-medium", scheme, out)
        }
        save(lockScreen(train: train, board: board), "lock-screen", .dark, out)
        save(NextTripView(entry: train, familyOverride: .systemSmall, standByOverride: true)
                .padding(16).frame(width: 340, height: 340).background(Color.black), "standby", .dark, out)
        print("done")
    }

    @MainActor
    static func save<V: View>(_ view: V, _ name: String, _ scheme: ColorScheme, _ dir: String) {
        let r = ImageRenderer(content: view.environment(\.colorScheme, scheme))
        r.scale = 3
        guard let img = r.uiImage, let data = img.pngData() else { print("could not draw \(name)"); return }
        do { try data.write(to: URL(fileURLWithPath: dir).appendingPathComponent(name + ".png")) } catch { print("could not save \(name): \(error)") }
        print("saved \(name)")
    }

    static func card<V: View>(_ v: V, _ size: CGSize) -> some View {
        v.padding(16)
            .frame(width: size.width, height: size.height)
            .background(Color(.systemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    static func trip(_ e: NextTripEntry, _ f: WidgetFamily, _ size: CGSize) -> some View {
        card(NextTripView(entry: e, familyOverride: f), size)
    }

    static func stop(_ e: StopBoardEntry, _ f: WidgetFamily, _ size: CGSize) -> some View {
        card(StopBoardView(entry: e, familyOverride: f), size)
    }

    static var wallpaper: some View {
        LinearGradient(colors: [Color(red: 0.12, green: 0.25, blue: 0.45), Color(red: 0.45, green: 0.3, blue: 0.55)],
                       startPoint: .top, endPoint: .bottom)
    }

    static func homeScreen(train: NextTripEntry, bus: NextTripEntry, board: StopBoardEntry) -> some View {
        VStack(spacing: 24) {
            HStack(spacing: 24) {
                trip(train, .systemSmall, CGSize(width: 170, height: 170))
                stop(board, .systemSmall, CGSize(width: 170, height: 170))
            }
            trip(bus, .systemMedium, CGSize(width: 364, height: 170))
            stop(board, .systemMedium, CGSize(width: 364, height: 170))
        }
        .padding(.vertical, 60)
        .frame(width: 430)
        .background(wallpaper)
    }

    static func lockScreen(train: NextTripEntry, board: StopBoardEntry) -> some View {
        VStack(spacing: 8) {
            NextTripView(entry: train, familyOverride: .accessoryInline)
                .font(.title3.weight(.semibold))
                .lineLimit(1)
                .frame(width: 300)
            Text(Date.now, format: .dateTime.hour(.defaultDigits(amPM: .omitted)).minute())
                .font(.system(size: 96, weight: .semibold, design: .rounded))
            HStack(spacing: 12) {
                NextTripView(entry: train, familyOverride: .accessoryCircular)
                    .frame(width: 72, height: 72)
                NextTripView(entry: train, familyOverride: .accessoryRectangular)
                    .frame(width: 170, height: 76, alignment: .leading)
            }
            StopBoardView(entry: board, familyOverride: .accessoryRectangular)
                .frame(width: 170, height: 76, alignment: .leading)
            Spacer()
        }
        .foregroundStyle(.white)
        .padding(.top, 80)
        .frame(width: 430, height: 932)
        .background(wallpaper)
    }
}
