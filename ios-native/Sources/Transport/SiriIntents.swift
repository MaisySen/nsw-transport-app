import AppIntents
import CoreLocation
import TransportKit

/// Siri and Shortcuts: "Next train home in Transport" and "Ask Transport". Answers come from
/// /api/ask with live data, using the home and work stops set with Add home and Add work.
enum SiriAsk {
    struct Reply: Decodable { var reply: String?; var text: String? }

    static func place(_ key: String) -> StopRef? {
        guard let d = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(StopRef.self, from: d)
    }

    /// The last known position, if location is allowed and the reading is under 30 minutes old.
    static func recentLocation() -> CLLocation? {
        let m = CLLocationManager()
        guard m.authorizationStatus == .authorizedWhenInUse || m.authorizationStatus == .authorizedAlways,
              let l = m.location, l.timestamp.timeIntervalSinceNow > -1800 else { return nil }
        return l
    }

    static func answer(_ question: String, useLocation: Bool = true) async -> String {
        var c = URLComponents(url: TransportAPI.defaultBase.appendingPathComponent("api/ask"), resolvingAgainstBaseURL: false)!
        var items = [URLQueryItem(name: "q", value: question),
                     URLQueryItem(name: "profile", value: TransportAPI.shared.profile)]
        if let h = place("placeHome") { items.append(URLQueryItem(name: "home", value: "\(h.id)|\(h.name)")) }
        if let w = place("placeWork") { items.append(URLQueryItem(name: "work", value: "\(w.id)|\(w.name)")) }
        if useLocation, let l = recentLocation() {
            items.append(URLQueryItem(name: "lat", value: String(format: "%.5f", l.coordinate.latitude)))
            items.append(URLQueryItem(name: "lon", value: String(format: "%.5f", l.coordinate.longitude)))
        }
        c.queryItems = items
        guard let url = c.url else { return "I could not ask that." }
        var req = URLRequest(url: url)
        req.timeoutInterval = 20
        do {
            let (data, _) = try await URLSession.shared.data(for: req)
            let r = try JSONDecoder().decode(Reply.self, from: data)
            return r.reply ?? r.text ?? "I did not get an answer for that."
        } catch {
            return "I could not reach live times. Check your signal and try again."
        }
    }

    /// Next service home: from where you are, or from work when there is no recent location.
    static func nextHome() async -> String {
        guard let home = place("placeHome") else {
            return "Set your home stop first. Open Transport, go to Trips and tap Add home."
        }
        if recentLocation() != nil {
            return await answer("next train to home")
        }
        if let work = place("placeWork"), work.id != home.id {
            return await answer("next train \(work.name) to \(home.name)", useLocation: false)
        }
        return "I need to know where you are. Allow location for Transport, or set Add work in Trips."
    }
}

struct NextTrainHomeIntent: AppIntent {
    static let title: LocalizedStringResource = "Next train home"
    static let description = IntentDescription("Says when the next service home leaves, from live times.")
    static let openAppWhenRun = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let text = await SiriAsk.nextHome()
        return .result(dialog: IntentDialog(stringLiteral: text))
    }
}

struct AskTransportIntent: AppIntent {
    static let title: LocalizedStringResource = "Ask Transport"
    static let description = IntentDescription("Ask about any train, bus, ferry or trip and hear the live answer.")
    static let openAppWhenRun = false

    @Parameter(title: "Question", requestValueDialog: "What do you want to know?")
    var question: String

    static var parameterSummary: some ParameterSummary {
        Summary("Ask Transport \(\.$question)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let text = await SiriAsk.answer(question)
        return .result(dialog: IntentDialog(stringLiteral: text))
    }
}

struct TransportShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: NextTrainHomeIntent(),
            phrases: [
                "Next train home in \(.applicationName)",
                "\(.applicationName) next train home",
                "When is my next train home in \(.applicationName)",
                "Get me home with \(.applicationName)",
            ],
            shortTitle: "Next train home",
            systemImageName: "house.fill"
        )
        AppShortcut(
            intent: AskTransportIntent(),
            phrases: [
                "Ask \(.applicationName)",
                "Ask \(.applicationName) a question",
            ],
            shortTitle: "Ask Transport",
            systemImageName: "bubble.left.and.bubble.right.fill"
        )
    }
}
