import AppIntents
import SwiftUI
import WidgetKit

// MARK: Control Center (iOS 18)

/// Opens the trip from Work to Home with live times.
@available(iOS 18.0, *)
struct TrainHomeControl: ControlWidget {
    static let kind = "com.maisysen.nswtransport.control.trainHome"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: OpenTrainHomeIntent()) {
                Label("Train home", systemImage: "house.fill")
            }
        }
        .displayName("Next train home")
        .description("Opens your trip from Work to Home with live times.")
    }
}

/// Opens the commute for this time of day and starts its next trip.
@available(iOS 18.0, *)
struct StartCommuteControl: ControlWidget {
    static let kind = "com.maisysen.nswtransport.control.startCommute"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: OpenStartCommuteIntent()) {
                Label("Start commute", systemImage: "tram.fill")
            }
        }
        .displayName("Start my commute")
        .description("Starts the next trip between Home and Work.")
    }
}

// MARK: Widget buttons (iOS 17)

/// The swap button on the Next trip widget: turns the Home and Work commute round until 12pm or midnight,
/// whichever comes first. The app's commute card swap still applies on top.
struct SwapCommuteIntent: AppIntent {
    static var title: LocalizedStringResource { "Swap direction" }
    static var isDiscoverable: Bool { false }

    init() {}

    func perform() async throws -> some IntentResult {
        let d = TSShared.defaults
        let key = TSShared.halfDayKey(Date())
        if d.string(forKey: TSShared.widgetFlipKey) == key {
            d.removeObject(forKey: TSShared.widgetFlipKey)
        } else {
            d.set(key, forKey: TSShared.widgetFlipKey)
        }
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}

/// A small round button on a widget that runs an intent in place.
struct WidgetIconButton<I: AppIntent>: View {
    var intent: I
    var symbol: String
    var label: String

    var body: some View {
        Button(intent: intent) {
            Image(systemName: symbol)
                .font(.caption.weight(.bold))
                .foregroundStyle(Color.primary)
                .frame(width: 28, height: 28)
                .background(Circle().fill(Color.secondary.opacity(0.18)))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// The Start button: opens the app and starts the trip leaving closest to `leave`.
struct StartTripLink: View {
    var url: URL

    var body: some View {
        Link(destination: url) {
            Label("Start", systemImage: "location.fill")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.white)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(Capsule().fill(Color.accentColor))
        }
        .accessibilityLabel("Start trip")
    }
}
