import SwiftUI
import TransportKit

/// Journey replay for tests and demos. It runs the real live trip engine on a fake clock, 60 times
/// faster than real time, with fake live data, and writes everything that happens to ReplayLog.
///
/// -liveReplay YES: Start trip on any planned trip replays that trip. Each leg runs late or early
///   by the minutes in -liveReplayShift (default "2", comma separated per leg).
/// -liveReplayDemo YES: starts a built in trip on launch, Strathfield to Redfern on a T1 3 min
///   late, change to a T4 1 min early, off at Kings Cross.
///
/// Once a run has arrived the fake server answers with the next service on the line, 4 minutes
/// later, the way the real one can; the trip must end at arrival and not follow it.
@MainActor
final class LiveReplay {
    static var current: LiveReplay?
    static var enabled: Bool { UserDefaults.standard.bool(forKey: "liveReplay") }

    struct FakeStop { var id: String; var name: String; var at: Date }

    let legs: [WatchLeg]
    let stops: [[FakeStop]]
    let alight: [Int]
    let shifts: [Double]
    private(set) var now: Date
    let step: TimeInterval = 30
    /// Real time per 30 fake seconds, from -liveReplayTick in milliseconds (default 500).
    let tick: Duration = .milliseconds(max(100, UserDefaults.standard.integer(forKey: "liveReplayTick") == 0 ? 500 : UserDefaults.standard.integer(forKey: "liveReplayTick")))
    var task: Task<Void, Never>?
    private var lastLock = ""

    init(legs: [WatchLeg], stops: [[FakeStop]], alight: [Int], shifts: [Double]) {
        self.legs = legs
        self.stops = stops
        self.alight = alight
        self.shifts = shifts
        let first = stops.first?.first?.at ?? Date()
        self.now = first.addingTimeInterval(-4 * 60)
    }

    /// A replay of a planned trip: each leg boards at its stop, gets off at its stop, and runs on
    /// one more stop after it.
    convenience init(legs: [WatchLeg], shifts: [Double]) {
        var stops: [[FakeStop]] = []
        for l in legs {
            let dep = l.planned ?? Date()
            let arr = l.arrPlanned ?? dep.addingTimeInterval(4 * 60)
            stops.append([FakeStop(id: l.stopId ?? "a", name: l.from ?? "Start", at: dep),
                          FakeStop(id: l.toStopId ?? "b", name: l.to ?? "Stop", at: arr),
                          FakeStop(id: "after", name: "Next station", at: arr.addingTimeInterval(3 * 60))])
        }
        self.init(legs: legs, stops: stops, alight: Array(repeating: 1, count: legs.count), shifts: shifts)
    }

    /// The built in two leg trip with a change.
    static func demo(t0: Date) -> LiveReplay {
        func at(_ m: Double) -> Date { t0.addingTimeInterval(m * 60) }
        let s1 = [FakeStop(id: "213510", name: "Strathfield Station", at: at(0)), FakeStop(id: "213910", name: "Burwood Station", at: at(3)),
                  FakeStop(id: "213110", name: "Ashfield Station", at: at(6)), FakeStop(id: "201510", name: "Redfern Station", at: at(9)),
                  FakeStop(id: "200060", name: "Central Station", at: at(11))]
        let s2 = [FakeStop(id: "201511", name: "Redfern Station", at: at(15)), FakeStop(id: "200070", name: "Central Station", at: at(17)),
                  FakeStop(id: "200080", name: "Town Hall Station", at: at(18)), FakeStop(id: "200090", name: "Martin Place Station", at: at(20)),
                  FakeStop(id: "201110", name: "Kings Cross Station", at: at(22)), FakeStop(id: "202710", name: "Edgecliff Station", at: at(25))]
        let legs = [
            WatchLeg(mode: "train", line: "T1", tripId: "replay-T1", stopId: "213510", toStopId: "201510", from: "Strathfield Station", to: "Redfern Station",
                     planned: at(0), arrPlanned: at(9), estimated: nil, fromPlatform: "Platform 5", toPlatform: "Platform 4", color: "#F99D1C", towards: "Hornsby", destId: nil, walkBefore: nil),
            WatchLeg(mode: "train", line: "T4", tripId: "replay-T4", stopId: "201511", toStopId: "201110", from: "Redfern Station", to: "Kings Cross Station",
                     planned: at(15), arrPlanned: at(22), estimated: nil, fromPlatform: "Platform 11", toPlatform: "Platform 2", color: "#005AA3", towards: "Bondi Junction", destId: nil, walkBefore: 2),
        ]
        return LiveReplay(legs: legs, stops: [s1, s2], alight: [3, 4], shifts: [3, -1])
    }

    func advance() { now = now.addingTimeInterval(step) }

    /// When the replay stops: 15 minutes past the planned arrival, plus any delay.
    var stopAt: Date {
        let i = legs.count - 1
        let arr = stops[i][alight[i]].at.addingTimeInterval(max(shifts[i], 0) * 60)
        return arr.addingTimeInterval(15 * 60)
    }

    /// The fake /api/service answers at the fake now.
    func services() -> [ServiceResponse?] {
        legs.indices.map { i in
            let shift = i < shifts.count ? shifts[i] : 0
            let arrived = stops[i][alight[i]].at.addingTimeInterval(shift * 60 + 90)
            return now > arrived ? service(i, shift: 0, plannedShift: 4) : service(i, shift: shift, plannedShift: 0)
        }
    }

    private func service(_ i: Int, shift: Double, plannedShift: Double) -> ServiceResponse? {
        var items: [String] = []
        var next = stops[i].count - 1
        var found = false
        for (k, s) in stops[i].enumerated() {
            let p = s.at.addingTimeInterval(plannedShift * 60)
            let e = p.addingTimeInterval(shift * 60)
            if !found && e > now { next = k; found = true }
            items.append("{\"id\":\"\(s.id)\",\"name\":\"\(s.name)\",\"planned\":\(p.timeIntervalSince1970),\"estimated\":\(e.timeIntervalSince1970)}")
        }
        let line = legs[i].line ?? ""
        let json = "{\"tripId\":\"replay-\(i)\(plannedShift == 0 ? "" : "-next")\",\"line\":\"\(line)\",\"mode\":\"train\",\"live\":true,\"delayMin\":\(Int(shift)),\"mineIndex\":0,\"alightIndex\":\(alight[i]),\"nextIndex\":\(next),\"stops\":[\(items.joined(separator: ","))]}"
        return try? TransportAPI.makeDecoder().decode(ServiceResponse.self, from: Data(json.utf8))
    }

    /// Logs a Lock Screen state only when it changed.
    func lockScreen(_ text: String) {
        guard text != lastLock else { return }
        lastLock = text
        ReplayLog.shared.add("lock screen: " + text)
    }
}

/// What happened during a replay, in order, with the fake time.
@MainActor
@Observable
final class ReplayLog {
    static let shared = ReplayLog()
    var lines: [String] = []
    var done = false
    @ObservationIgnored private var lastState = ""

    func add(_ text: String) {
        guard let r = LiveReplay.current else { return }
        lines.append("\(Clock.time(r.now)) \(text)")
    }

    /// Logs a state line only when it changed.
    func state(_ text: String) {
        guard text != lastState else { return }
        lastState = text
        add("state: " + text)
    }
}

extension AppStore {
    /// The built in demo trip, started on launch with -liveReplayDemo YES.
    func startReplayDemo() async {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = Clock.sydney
        var c = cal.dateComponents([.year, .month, .day], from: Date())
        c.hour = 21; c.minute = 30
        let r = LiveReplay.demo(t0: cal.date(from: c) ?? Date())
        let from = StopRef(id: "213510", name: "Strathfield Station"), to = StopRef(id: "201110", name: "Kings Cross Station")
        if liveTrip != nil { await endLiveTrip(silent: true) }
        liveTrip = LiveTripRecord(title: "Strathfield to Kings Cross", from: from, to: to, legs: r.legs, fare: nil, started: Date())
        liveServices = Array(repeating: nil, count: r.legs.count)
        liveAlerted = []
        openLiveTrip = true
        runReplay(r, title: "Strathfield to Kings Cross: T1 3 min late, change at Redfern, T4 1 min early")
    }

    /// Replays the trip just started with Start trip.
    func startReplay(for trip: LiveTripRecord) {
        let shifts = (UserDefaults.standard.string(forKey: "liveReplayShift") ?? "2")
            .split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
        let r = LiveReplay(legs: trip.legs, shifts: trip.legs.indices.map { $0 < shifts.count ? shifts[$0] : (shifts.last ?? 0) })
        runReplay(r, title: "\(trip.title): " + r.shifts.map { $0 == 0 ? "on time" : ($0 > 0 ? "\(Int($0)) min late" : "\(Int(-$0)) min early") }.joined(separator: ", then "))
    }

    private func runReplay(_ r: LiveReplay, title: String) {
        LiveReplay.current?.task?.cancel()
        LiveReplay.current = r
        ReplayLog.shared.lines = []
        ReplayLog.shared.done = false
        ReplayLog.shared.add("start: " + title)
        liveTask?.cancel()
        liveTask = nil
        if let trip = liveTrip {
            liveState = LiveTripLogic.compute(legs: trip.legs, services: r.services(), now: r.now)
            LiveTripActivities.start(record: trip, state: liveState)
        }
        // Its own task: arrival and End trip cancel the live loop, the replay keeps its clock.
        r.task = Task { [weak self] in
            guard let self else { return }
            var sawEnd = false
            while !Task.isCancelled && r.now < r.stopAt {
                if self.liveTrip != nil { await self.refreshLive() } else if !sawEnd { sawEnd = true }
                try? await Task.sleep(for: r.tick)
                r.advance()
            }
            ReplayLog.shared.add(self.liveTrip == nil ? "15 min after arrival: no trip running, nothing more sent" : "still running 15 min after arrival")
            ReplayLog.shared.done = true
        }
    }
}

/// The replay clock and the latest lines over the app while a replay runs. The whole log is the
/// accessibility value of "replayLog" so the UI test can read it.
struct ReplayOverlay: View {
    private var log: ReplayLog { ReplayLog.shared }

    var body: some View {
        if LiveReplay.current != nil {
            VStack(alignment: .leading, spacing: 2) {
                Text(log.done ? "Replay finished" : "Replay, fake time \(LiveReplay.current.map { Clock.time($0.now) } ?? "")")
                    .font(.caption.weight(.bold))
                ForEach(Array(log.lines.suffix(4).enumerated()), id: \.offset) { _, l in
                    Text(l).font(.caption2.monospaced()).lineLimit(1)
                }
            }
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .padding(.horizontal, 10)
            .allowsHitTesting(false)
            .accessibilityElement(children: .ignore)
            .accessibilityIdentifier("replayLog")
            .accessibilityLabel(log.done ? "Replay finished" : "Replay running")
            .accessibilityValue(log.lines.joined(separator: "\n"))
        }
    }
}
