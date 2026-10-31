import SwiftUI
import WidgetKit

/// Live Activities: the Lock Screen card and every Dynamic Island presentation (compact, minimal, expanded) for
/// both activities, the followed service (TripLiveActivity) and Start trip (LiveTripActivityWidget). Sizes are
/// Apple's published Live Activity sizes in points; the SE has no Dynamic Island. Lock Screen cards are drawn on
/// dark glass in every appearance (the app sets that), so they are shown once per text size.
@MainActor
enum LiveActivityAudit {
    struct Phone { let name: String; let lock: CGFloat; let island: Bool; let compact: CGFloat; let minimal: CGFloat; let expanded: CGFloat }
    static let phones = [
        Phone(name: "se", lock: 343, island: false, compact: 0, minimal: 0, expanded: 0),
        Phone(name: "std", lock: 361, island: true, compact: 52.33, minimal: 36.67, expanded: 371),
        Phone(name: "promax", lock: 408, island: true, compact: 62.33, minimal: 45, expanded: 408),
    ]
    static let lockMaxHeight: CGFloat = 160
    static let islandHeight: CGFloat = 36.67

    // The countdowns in these views read the real clock, so the times are relative to now.
    static func m(_ min: Double) -> Date { Date().addingTimeInterval(min * 60) }

    static let followed: [(String, TripActivityAttributes, TripActivityAttributes.ContentState)] = [
        ("normal", TripActivityAttributes(line: "T4", lineColorHex: "#005AA3", mode: "train", from: "Bondi Junction", towards: "Cronulla", to: "Parramatta"),
         .init(departs: m(6.5), arrives: m(44), status: "On time", isLive: true, platform: "Platform 1", detail: "3 stops away", stopsAway: 3)),
        ("long", TripActivityAttributes(line: "610X", lineColorHex: "#00B5EF", mode: "bus", from: "Sydney Olympic Park",
                                        towards: "Macquarie University via Epping and North Ryde", to: "Macquarie University"),
         .init(departs: m(14.5), arrives: m(70), status: "12 min late", isLive: true, platform: "Stand D", detail: "11 stops away", stopsAway: 11)),
        ("nolive", TripActivityAttributes(line: "F1", lineColorHex: "#00774B", mode: "ferry", from: "Circular Quay", towards: "Manly", to: nil),
         .init(departs: m(9.5), arrives: nil, status: "Scheduled", isLive: false, platform: "Wharf 3", detail: nil, stopsAway: nil)),
        ("cancelled", TripActivityAttributes(line: "T1", lineColorHex: "#F99D1C", mode: "train", from: "Chatswood", towards: "Hornsby", to: "Hornsby"),
         .init(departs: m(3.5), arrives: m(25), status: "Cancelled", isLive: true, platform: "Platform 4", detail: "Next one in 8 min", stopsAway: nil)),
        ("later", TripActivityAttributes(line: "L2", lineColorHex: "#E4022D", mode: "lightrail", from: "Circular Quay", towards: "Randwick", to: "Randwick"),
         .init(departs: m(85), arrives: m(120), status: "On time", isLive: true, platform: nil, detail: nil, stopsAway: nil)),
    ]

    static func live(_ phase: String, line: String = "T9", hex: String = "#D11F2F", mode: String = "train", next: String? = "Epping",
                     left: Int? = 4, off: String = "Macquarie University", warning: String? = nil, progress: Double = 0.4,
                     towards: String? = "Hornsby", platform: String? = "Platform 16", departs: Double? = 5.5, legArrives: Double? = 18.5,
                     dest: String? = "Macquarie University", updated: Double? = -0.5,
                     track: LiveTripAttributes.StopTrack? = nil) -> LiveTripAttributes.ContentState {
        LiveTripAttributes.ContentState(line: line, lineColorHex: hex, mode: mode, nextStop: next, stopsLeft: left, getOffAt: off,
                                        arrival: m(42), phase: phase, warning: warning, progress: progress, fareLine: nil,
                                        towards: towards, platform: platform, departs: departs.map { m($0) },
                                        legArrives: legArrives.map { m($0) }, destination: dest, updated: updated.map { m($0) },
                                        stopTrack: track)
    }

    static let liveTrips: [(String, LiveTripAttributes.ContentState, Bool)] = [
        ("wait", live("wait"), false),
        ("ride", live("ride", next: "Sydney Olympic Park", off: "Sydney Olympic Park"), false),
        ("change", live("change", line: "M1", hex: "#168388", mode: "metro", off: "Chatswood",
                        warning: "Tight change at Chatswood, 3 min to walk to Platform 1"), false),
        ("miss", live("ride", line: "610X", hex: "#00B5EF", mode: "bus", next: "Victoria Road after Church Street", off: "Macquarie Centre",
                      warning: "You'll likely miss the 5:12pm T1 to Hornsby at Epping", progress: 0.8), false),
        ("stale", live("ride", next: "Epping", updated: -21), true),
        ("arrived", live("arrived", progress: 1), false),
        // Build 210 stop track (30 Oct): the leg's stops instead of the plain bar.
        ("stops", live("ride", line: "501", hex: "#00B5EF", mode: "bus", next: "Victoria Rd at Belmore St", left: 6, off: "Top Ryde City",
                       warning: "4 min late", progress: 0.45, towards: "Top Ryde", legArrives: 5, dest: "Top Ryde City",
                       track: .init(passed: 5, next: ["Victoria Rd at Belmore St", "Ryde Hospital", "Blaxland Rd at Pope St", "Church St",
                                                      "Devlin St", "Top Ryde City"], live: true)), false),
        ("stops-long", live("ride", line: "610X", hex: "#00B5EF", mode: "bus", next: "Windsor Rd after Old Northern Rd", left: 16,
                            off: "Macquarie Centre and University", warning: "You'll likely miss the 5:12pm T1 to Hornsby at Epping", progress: 0.2,
                            dest: "Macquarie University via North Ryde",
                            track: .init(passed: 2, next: ["Windsor Rd after Old Northern Rd", "Norwest Business Park Station",
                                                           "Showground Rd at Carrington Rd", "Castle Hill Rd at Pennant Hills", "Cherrybrook",
                                                           "Beecroft Rd at Kandy Ave", "Epping Rd at Blaxland Rd", "Herring Rd at Waterloo",
                                                           "Macquarie Centre and University"], hidden: 7, hiddenAt: 8, live: true)), false),
        ("stops-timetable", live("ride", line: "T1", hex: "#F99D1C", mode: "train", next: nil, left: nil, off: "Hornsby",
                                 warning: "Timetable times, not live", progress: 0.3, towards: "Berowra", dest: "Hornsby",
                                 track: .init(passed: 3, next: ["Waitara", "Hornsby"], live: false)), false),
        ("stops-wait", live("wait", line: "M1", hex: "#168388", mode: "metro", next: "Chatswood", off: "Macquarie University",
                            towards: "Tallawong", platform: "Platform 1",
                            track: .init(passed: 1, next: ["North Ryde", "Macquarie Park", "Macquarie University"], live: true)), false),
        ("stops-yours", live("ride", line: "L2", hex: "#E4022D", mode: "lightrail", next: "Randwick", left: 1, off: "Randwick", progress: 0.95,
                             towards: "Randwick", legArrives: 1.5, dest: "Randwick",
                             track: .init(passed: 12, next: ["Randwick"], live: true)), false),
        ("stops-stale", live("ride", next: "Epping", updated: -21,
                             track: .init(passed: 4, next: ["Epping", "Macquarie University"], live: true)), true),
        // Build 211 (31 Oct): the owner's build 210 trip on his iPhone (T1, 2 stops, 3 min late), the same on time,
        // one stop with a 1 minute countdown, and an hour long ride with many stops.
        ("owner-late", live("ride", line: "T1", hex: "#F99D1C", mode: "train", next: "Ashfield", left: 2, off: "Croydon",
                            warning: "3 min late", progress: 0.6, towards: "Emu Plains", platform: nil, legArrives: 6.5, dest: "Croydon",
                            track: .init(passed: 3, next: ["Ashfield", "Croydon"], live: true)), false),
        ("owner-ontime", live("ride", line: "T1", hex: "#F99D1C", mode: "train", next: "Ashfield", left: 2, off: "Croydon",
                              warning: nil, progress: 0.6, towards: "Emu Plains", platform: nil, legArrives: 6.5, dest: "Croydon",
                              track: .init(passed: 3, next: ["Ashfield", "Croydon"], live: true)), false),
        ("one-stop", live("ride", line: "M1", hex: "#168388", mode: "metro", next: "Chatswood", left: 1, off: "Chatswood",
                          warning: nil, progress: 0.9, towards: "Sydenham", platform: nil, legArrives: 1.3, dest: "Chatswood",
                          track: .init(passed: 6, next: ["Chatswood"], live: true)), false),
        ("hour", live("ride", line: "T8", hex: "#00954C", mode: "train", next: "Wolli Creek", left: 14, off: "Macarthur",
                      warning: "2 min late", progress: 0.1, towards: "Macarthur", platform: nil, legArrives: 65, dest: "Macarthur",
                      track: .init(passed: 2, next: ["Wolli Creek", "Turrella", "Bardwell Park", "Bexley North", "Kingsgrove", "Beverly Hills",
                                                     "Narwee", "Riverwood", "Padstow", "Macarthur"], hidden: 4, hiddenAt: 8, live: true)), false),
    ]

    static func lock<V: View>(_ v: V, surface: String, scenario: String, p: Phone) {
        // The system pads the card by 16 pt (the activity sets .padding(16)); the card may be up to 160 pt tall.
        let inner = CGSize(width: p.lock - 32, height: lockMaxHeight - 32)
        for t in Audit.types {
            Audit.shot(v.environment(\.colorScheme, .dark), surface: surface, scenario: scenario, device: p.name, type: t, scheme: .dark, box: inner,
                       picture: LockCardFrame(content: v.environment(\.colorScheme, .dark), width: p.lock))
        }
    }

    static func region<V: View>(_ v: V, surface: String, scenario: String, p: Phone, box: CGSize, round: CGFloat) {
        for t in Audit.types {
            Audit.shot(v.environment(\.colorScheme, .dark), surface: surface, scenario: scenario, device: p.name, type: t, scheme: .dark, box: box,
                       picture: IslandPill(content: v.environment(\.colorScheme, .dark), box: box, round: round))
        }
    }

    static func expanded<L: View, T: View, C: View, B: View>(_ l: L, _ tr: T, _ c: C, _ b: B, surface: String, scenario: String, p: Phone) {
        // Expanded: leading and trailing either side of the camera, the centre under it, the bottom below; 160 pt at most.
        let w = p.expanded - 36
        let side = (w * 0.3).rounded()
        let inner = CGSize(width: w, height: lockMaxHeight - 24)
        let layout = VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .center, spacing: 6) {
                l.frame(width: side, alignment: .leading)
                c.frame(maxWidth: .infinity)
                tr.frame(width: side, alignment: .trailing)
            }
            .frame(minHeight: 36)
            b
        }
        .frame(width: w, height: inner.height, alignment: .top)
        // Each region is also checked on its own in its box.
        for t in Audit.types {
            Audit.shot(layout.environment(\.colorScheme, .dark), surface: surface, scenario: scenario, device: p.name, type: t, scheme: .dark, box: inner,
                       picture: IslandPill(content: layout.environment(\.colorScheme, .dark), box: inner, round: 44))
        }
        for (name, v, box) in [("leading", AnyView(l), CGSize(width: side, height: 52)), ("trailing", AnyView(tr), CGSize(width: side, height: 52)),
                               ("center", AnyView(c), CGSize(width: w - 2 * side - 12, height: 52)), ("bottom", AnyView(b), CGSize(width: w, height: 70))] {
            for t in Audit.types {
                let typed = v.environment(\.colorScheme, .dark)
                let o = Audit.overflow(typed.environment(\.dynamicTypeSize, t.1), box: box)
                let fits = o.allSatisfy { $0 >= 0 && $0 <= 0.5 }
                Audit.records.append(Audit.Record(surface: surface + "-" + name, scenario: scenario, device: p.name, type: t.0, scheme: "dark",
                                                  box: [Double(box.width), Double(box.height)], overflow: o, fits: fits, file: ""))
            }
        }
    }

    static func run() {
        for p in phones {
            for (s, a, st) in followed {
                lock(LockScreenCard(attrs: a, state: st), surface: "follow-lock", scenario: s, p: p)
                guard p.island else { continue }
                let c = CGSize(width: p.compact, height: islandHeight)
                region(WidgetLineBadge(line: a.line, colorHex: a.lineColorHex, mode: a.mode), surface: "follow-compact-leading", scenario: s, p: p, box: c, round: 18)
                region(IslandCompactTrailing(state: st), surface: "follow-compact-trailing", scenario: s, p: p, box: c, round: 18)
                region(IslandMinimal(attrs: a, state: st), surface: "follow-minimal", scenario: s, p: p, box: CGSize(width: p.minimal, height: islandHeight), round: 18)
                expanded(IslandLeading(attrs: a), IslandTrailing(state: st), IslandCenter(attrs: a), IslandBottom(state: st),
                         surface: "follow-expanded", scenario: s, p: p)
            }
            let attrs = LiveTripAttributes(title: "To Macquarie University", legsCount: 2)
            for (s, st, stale) in liveTrips {
                lock(LiveTripLockCard(attrs: attrs, state: st, stale: stale), surface: "trip-lock", scenario: s, p: p)
                guard p.island else { continue }
                let c = CGSize(width: p.compact, height: islandHeight)
                region(LiveTripCompactLeading(state: st, stale: stale), surface: "trip-compact-leading", scenario: s, p: p, box: c, round: 18)
                region(LiveTripCompactTrailing(state: st, stale: stale), surface: "trip-compact-trailing", scenario: s, p: p, box: c, round: 18)
                region(LiveTripMinimal(state: st, stale: stale), surface: "trip-minimal", scenario: s, p: p, box: CGSize(width: p.minimal, height: islandHeight), round: 18)
                expanded(LiveTripIslandLeading(state: st), LiveTripIslandTrailing(state: st, stale: stale), LiveTripIslandCenter(state: st, stale: stale),
                         LiveTripIslandBottom(state: st, stale: stale), surface: "trip-expanded", scenario: s, p: p)
            }
        }
    }
}

/// The Lock Screen card on dark glass, cut to its rounded shape like the system does.
struct LockCardFrame<V: View>: View {
    var content: V
    var width: CGFloat
    var body: some View {
        content
            .frame(width: width - 32, height: LiveActivityAudit.lockMaxHeight - 32)
            .padding(16)
            .frame(width: width, height: LiveActivityAudit.lockMaxHeight)
            .background(Color.black.opacity(0.6))
            .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
            .padding(16)
            .background(LinearGradient(colors: [Color(red: 0.25, green: 0.35, blue: 0.6), Color(red: 0.6, green: 0.4, blue: 0.5)], startPoint: .top, endPoint: .bottom))
    }
}

/// A Dynamic Island region on the black island, cut to its box.
struct IslandPill<V: View>: View {
    var content: V
    var box: CGSize
    var round: CGFloat
    var body: some View {
        content
            .frame(width: box.width, height: box.height)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Color.black)
            .clipShape(RoundedRectangle(cornerRadius: round, style: .continuous))
            .padding(16)
            .background(Color(white: 0.85))
    }
}
