// Screenshots of the Apple Watch complications for the EAS simulator check (tools/widget-shots.sh). Not part of the
// app: the script compiles this file with the complications' own Swift files (Complications.swift without its @main,
// WatchCore.swift) and runs it on a watch simulator. The trips are real stops and the times come live from the server
// through the same WatchAPI and NextProvider the complications use. The watch face around them is drawn here.
import ImageIO
import SwiftUI
import WidgetKit

@main
struct ComplicationShots {
    static let context = """
    {"v":2,"base":"https://nsw-transport-bot.sites.tab.bot","profile":null,"home":null,"work":null,"flip":null,"starred":[],"live":null,"trips":[{"key":"213510>201110","name":"","kind":"mine","from":{"id":"213510","name":"Strathfield Station"},"to":{"id":"201110","name":"Kings Cross Station, Potts Point"},"plan":null},{"key":"213510>2046100","name":"","kind":"mine","from":{"id":"213510","name":"Strathfield Station"},"to":{"id":"2046100","name":"Five Dock Shops, Great North Rd"},"plan":null}],"times":{}}
    """

    @MainActor
    static func main() async {
        let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : FileManager.default.currentDirectoryPath + "/complications"
        try? FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
        guard let ctx = WatchContext.decode(context), let api = WatchAPI(ctx) else { print("no context"); return }
        var snap = WatchSnapshot()
        for card in ctx.cards() {
            do {
                snap.trips[card.key] = try await api.load(card, count: 6)
                snap.tripsAt[card.key] = Date()
                print("\(card.key): \(snap.trips[card.key]?.count ?? 0) services")
            } catch { print("\(card.key): \(error)") }
        }
        let now = Date()
        guard let entry = NextProvider.entries(now: now, context: ctx, snapshot: snap).first else { print("no entry"); return }
        let empty = NextProvider.entries(now: now, context: nil, snapshot: WatchSnapshot()).first
        save(face(entry), "complications-face", out)
        save(one(entry, .accessoryRectangular, CGSize(width: 184, height: 74)), "complication-rectangular", out)
        save(one(entry, .accessoryCircular, CGSize(width: 54, height: 54)), "complication-circular", out)
        save(one(entry, .accessoryInline, CGSize(width: 184, height: 24)), "complication-inline", out)
        if let e = empty { save(one(e, .accessoryRectangular, CGSize(width: 184, height: 74)), "complication-rectangular-empty", out) }
        print("done")
    }

    @MainActor
    static func save<V: View>(_ view: V, _ name: String, _ dir: String) {
        let r = ImageRenderer(content: view.environment(\.colorScheme, .dark))
        r.scale = 2
        guard let img = r.cgImage else { print("could not draw \(name)"); return }
        let url = URL(fileURLWithPath: dir).appendingPathComponent(name + ".png") as CFURL
        guard let dest = CGImageDestinationCreateWithURL(url, "public.png" as CFString, 1, nil) else { print("could not save \(name)"); return }
        CGImageDestinationAddImage(dest, img, nil)
        print(CGImageDestinationFinalize(dest) ? "saved \(name)" : "could not save \(name)")
    }

    static func one(_ e: NextEntry, _ f: WidgetFamily, _ size: CGSize) -> some View {
        NextView(entry: e, familyOverride: f)
            .foregroundStyle(.white)
            .frame(width: size.width, height: size.height)
            .padding(8)
            .background(Color.black)
    }

    /// A Modular style face: the time, the rectangular complication, then a circular and the inline line.
    static func face(_ e: NextEntry) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                NextView(entry: e, familyOverride: .accessoryInline).font(.system(size: 13)).lineLimit(1)
                Spacer()
                Text(Date.now, format: .dateTime.hour(.defaultDigits(amPM: .omitted)).minute())
                    .font(.system(size: 17, weight: .semibold, design: .rounded))
            }
            NextView(entry: e, familyOverride: .accessoryRectangular)
                .frame(height: 74)
            HStack(spacing: 8) {
                NextView(entry: e, familyOverride: .accessoryCircular).frame(width: 54, height: 54)
                Spacer()
            }
        }
        .foregroundStyle(.white)
        .padding(12)
        .frame(width: 208, height: 248)
        .background(Color.black)
    }
}
