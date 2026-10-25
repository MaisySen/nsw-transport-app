import Foundation
#if canImport(WatchConnectivity)
import WatchConnectivity
#endif

/// The phone side of the Apple Watch app. The app hands it a context (Home, Work, starred stops, the trip card
/// and the server address, as JSON); it goes to the watch as the WatchConnectivity application context, which
/// the watch reads the next time it wakes, and straight away as a message when the watch app is open.
/// The watch can also ask for the last context when it starts.
final class WatchLink: NSObject {
  static let shared = WatchLink()
  private static let lastKey = "watch.lastContext"

  private let lock = NSLock()
  private var pending: String?

  /// The last context sent, kept so the watch can ask for it while the app is not running.
  private var last: String? {
    get { UserDefaults.standard.string(forKey: Self.lastKey) }
    set { UserDefaults.standard.set(newValue, forKey: Self.lastKey) }
  }

  #if canImport(WatchConnectivity)
  private var session: WCSession? { WCSession.isSupported() ? WCSession.default : nil }
  #endif

  /// Starts the session once. Safe to call many times.
  func start() {
    #if canImport(WatchConnectivity)
    guard let s = session else { return }
    if s.delegate == nil { s.delegate = self }
    if s.activationState != .activated { s.activate() }
    #endif
  }

  /// Queues the context for the watch. False when this phone has no watch support at all.
  @discardableResult
  func send(_ json: String) -> Bool {
    #if canImport(WatchConnectivity)
    guard session != nil else { return false }
    lock.lock(); pending = json; lock.unlock()
    last = json
    start()
    flush()
    return true
    #else
    return false
    #endif
  }

  private func flush() {
    #if canImport(WatchConnectivity)
    guard let s = session, s.activationState == .activated else { return }
    lock.lock(); let json = pending; lock.unlock()
    guard let json else { return }
    guard s.isPaired, s.isWatchAppInstalled else { return }
    let ctx: [String: Any] = ["json": json, "sentAt": Date().timeIntervalSince1970]
    do {
      try s.updateApplicationContext(ctx)
      lock.lock(); if pending == json { pending = nil }; lock.unlock()
    } catch {}
    if s.isReachable { s.sendMessage(ctx, replyHandler: nil, errorHandler: nil) }
    #endif
  }
}

#if canImport(WatchConnectivity)
extension WatchLink: WCSessionDelegate {
  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    if activationState == .activated { flush() }
  }

  func sessionDidBecomeInactive(_ session: WCSession) {}

  /// A new watch was paired: start again so the context goes to it.
  func sessionDidDeactivate(_ session: WCSession) { session.activate() }

  func sessionWatchStateDidChange(_ session: WCSession) {
    if session.isWatchAppInstalled, let l = last {
      lock.lock(); if pending == nil { pending = l }; lock.unlock()
      flush()
    }
  }

  /// The watch app asks for the last context when it starts and has none, or an old one.
  func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
    if message["want"] as? String == "context", let l = last {
      replyHandler(["json": l, "sentAt": Date().timeIntervalSince1970])
    } else {
      replyHandler([:])
    }
  }
}
#endif
