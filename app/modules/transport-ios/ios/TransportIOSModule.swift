import ExpoModulesCore
import Foundation
import WidgetKit
import AVFoundation
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

private func hex(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined() }

private func date(_ ms: Double?) -> Date? {
  guard let ms, ms > 0 else { return nil }
  return Date(timeIntervalSince1970: ms / 1000)
}

public class TransportIOSModule: Module {
  /// Activities whose push token is already being followed, so one card never gets two followers.
  private var following = Set<String>()
  /// Siri's "Start my commute" (in the app's own process) posts this after leaving a link in the app group.
  private var intentObserver: NSObjectProtocol?
  private let followingLock = NSLock()

  private func claim(_ id: String) -> Bool {
    followingLock.lock(); defer { followingLock.unlock() }
    return following.insert(id).inserted
  }

  private func release(_ id: String) {
    followingLock.lock(); defer { followingLock.unlock() }
    following.remove(id)
  }

  #if canImport(ActivityKit)
  /// Sends each push token of a trip card to JavaScript as it arrives or changes. The server uses it to
  /// update the card with live times while the phone is locked.
  @available(iOS 16.2, *)
  private func follow(_ a: Activity<LiveTripAttributes>) {
    guard claim(a.id) else { return }
    let id = a.id
    Task { [weak self] in
      for await data in a.pushTokenUpdates {
        self?.sendEvent("onActivityPushToken", ["id": id, "token": hex(data)])
      }
      self?.release(id)
    }
  }
  #endif

  public func definition() -> ModuleDefinition {
    Name("TransportIOS")

    Events("onActivityPushToken", "onIntentQueued")

    OnCreate {
      WatchLink.shared.start()
      self.intentObserver = NotificationCenter.default.addObserver(
        forName: Notification.Name("TransportIntentQueued"), object: nil, queue: .main
      ) { _ in
        // The module lives as long as the app; the observer is removed in OnDestroy.
        self.sendEvent("onIntentQueued", [:])
      }
      #if canImport(ActivityKit)
      if #available(iOS 16.2, *) {
        for a in Activity<LiveTripAttributes>.activities where a.activityState == .active { self.follow(a) }
      }
      #endif
    }

    /// From build 207: Speak alerts get the app's own spoken audio session. Playback, so the Ring/Silent switch does not
    /// mute it (build 206 used the system speech session, which Silent mode silences); voice prompt mode, so it is
    /// mixed like navigation directions; other audio (music, podcasts) is lowered while a line is read, and a podcast
    /// is paused. JavaScript checks for this function before using it (src/lib/nativeExtras.ts speechAudio).
    Function("startSpeechAudio") { () -> Bool in
      do {
        let s = AVAudioSession.sharedInstance()
        try s.setCategory(.playback, mode: .voicePrompt, options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
        try s.setActive(true)
        return true
      } catch {
        return false
      }
    }

    /// Ends the spoken session once the queue is read, so music comes back to full volume.
    Function("endSpeechAudio") { () -> Void in
      _ = try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// From the build with the Apple Watch app: the watch's context (JSON from platform/watchShare.ts). False when
    /// this phone cannot talk to a watch.
    Function("sendWatchContext") { (json: String) -> Bool in
      WatchLink.shared.send(json)
    }

    /// True from the build whose trip card can be updated by push (build 205).
    Function("supportsActivityPush") { () -> Bool in
      #if canImport(ActivityKit)
      if #available(iOS 16.2, *) { return true }
      #endif
      return false
    }

    /// The push token of a trip card, when the system has issued one.
    Function("tripActivityPushToken") { (id: String) -> String? in
      #if canImport(ActivityKit)
      if #available(iOS 16.2, *) {
        guard let a = Activity<LiveTripAttributes>.activities.first(where: { $0.id == id }) else { return nil }
        self.follow(a)
        return a.pushToken.map(hex)
      }
      #endif
      return nil
    }

    OnDestroy {
      if let o = self.intentObserver { NotificationCenter.default.removeObserver(o) }
      self.intentObserver = nil
    }

    /// Reads a string from the app group and removes it, so it is handled once. From build 206.
    Function("takeSharedString") { (key: String) -> String? in
      let d = sharedDefaults()
      let v = d.string(forKey: key)
      if v != nil { d.removeObject(forKey: key) }
      return v
    }

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

    /// 2: the trip card carries `updated` and the widget draws a stale card as "Updated 8:21am" with clock times.
    /// The app reads this to choose the card's stale date (iosNative.cardVersion). Builds without it are version 1.
    Function("liveCardVersion") { () -> Int in
      return 2
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
        // Push updates need the push entitlement; without it the card still starts and the app updates it.
        if let a = try? Activity<LiveTripAttributes>.request(attributes: attrs, content: content, pushType: .token) {
          self.follow(a)
          return a.id
        }
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
