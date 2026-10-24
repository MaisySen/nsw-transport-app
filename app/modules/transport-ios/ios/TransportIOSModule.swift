import ExpoModulesCore
import Foundation
import WidgetKit
#if canImport(ActivityKit)
import ActivityKit
#endif

/// The app group the widget reads. Until it is registered for the team, the app is signed
/// without it and writes go to the app's own defaults, which the widget cannot see.
private let appGroup = "group.com.maisysen.nswtransport"

private func sharedDefaults() -> UserDefaults {
  if FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) != nil,
     let d = UserDefaults(suiteName: appGroup) {
    return d
  }
  return .standard
}

private func decoder() -> JSONDecoder {
  let d = JSONDecoder()
  d.dateDecodingStrategy = .millisecondsSince1970
  return d
}

private func date(_ ms: Double?) -> Date? {
  guard let ms, ms > 0 else { return nil }
  return Date(timeIntervalSince1970: ms / 1000)
}

public class TransportIOSModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TransportIOS")

    Function("hasAppGroup") { () -> Bool in
      FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) != nil
    }

    /// A string value, or nil to remove the key.
    Function("setSharedString") { (key: String, value: String?) in
      let d = sharedDefaults()
      if let value { d.set(value, forKey: key) } else { d.removeObject(forKey: key) }
    }

    /// A JSON value stored as Data, the way the widget reads it with data(forKey:). Nil removes the key.
    Function("setSharedJSON") { (key: String, json: String?) in
      let d = sharedDefaults()
      if let json { d.set(Data(json.utf8), forKey: key) } else { d.removeObject(forKey: key) }
    }

    Function("setSharedBool") { (key: String, value: Bool) in
      sharedDefaults().set(value, forKey: key)
    }

    Function("reloadWidgets") { (kind: String?) in
      if let kind, !kind.isEmpty {
        WidgetCenter.shared.reloadTimelines(ofKind: kind)
      } else {
        WidgetCenter.shared.reloadAllTimelines()
      }
    }

    Function("areActivitiesEnabled") { () -> Bool in
      #if canImport(ActivityKit)
      if #available(iOS 16.2, *) {
        return ActivityAuthorizationInfo().areActivitiesEnabled
      }
      #endif
      return false
    }

    Function("tripActivityIds") { () -> [String] in
      #if canImport(ActivityKit)
      if #available(iOS 16.2, *) {
        return Activity<LiveTripAttributes>.activities.map { $0.id }
      }
      #endif
      return []
    }

    /// Starts the trip card. Any other trip card is ended first: one card per trip.
    AsyncFunction("startTripActivity") { (title: String, legsCount: Int, stateJSON: String, staleMs: Double?) async throws -> String? in
      #if canImport(ActivityKit)
      if #available(iOS 16.2, *) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return nil }
        let state = try decoder().decode(LiveTripAttributes.ContentState.self, from: Data(stateJSON.utf8))
        for a in Activity<LiveTripAttributes>.activities {
          await a.end(nil, dismissalPolicy: .immediate)
        }
        let attrs = LiveTripAttributes(title: title, legsCount: legsCount)
        let content = ActivityContent(state: state, staleDate: date(staleMs))
        let a = try Activity<LiveTripAttributes>.request(attributes: attrs, content: content, pushType: nil)
        return a.id
      }
      #endif
      return nil
    }

    /// Updates the card. Alerts for each step come from notifications, so the card itself stays quiet.
    AsyncFunction("updateTripActivity") { (id: String, stateJSON: String, staleMs: Double?) async throws -> Bool in
      #if canImport(ActivityKit)
      if #available(iOS 16.2, *) {
        guard let a = Activity<LiveTripAttributes>.activities.first(where: { $0.id == id }) else { return false }
        let state = try decoder().decode(LiveTripAttributes.ContentState.self, from: Data(stateJSON.utf8))
        await a.update(ActivityContent(state: state, staleDate: date(staleMs)))
        return true
      }
      #endif
      return false
    }

    /// Ends the card. With a final state it stays on the Lock Screen for a short while, else it goes now.
    AsyncFunction("endTripActivity") { (id: String?, stateJSON: String?, dismissAfterSeconds: Double) async throws in
      #if canImport(ActivityKit)
      if #available(iOS 16.2, *) {
        let final: ActivityContent<LiveTripAttributes.ContentState>? = try stateJSON.map {
          ActivityContent(state: try decoder().decode(LiveTripAttributes.ContentState.self, from: Data($0.utf8)), staleDate: nil)
        }
        let policy: ActivityUIDismissalPolicy = dismissAfterSeconds > 0
          ? .after(Date().addingTimeInterval(dismissAfterSeconds)) : .immediate
        for a in Activity<LiveTripAttributes>.activities where id == nil || a.id == id {
          await a.end(final, dismissalPolicy: policy)
        }
      }
      #endif
    }
  }
}
