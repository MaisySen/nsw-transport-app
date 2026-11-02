import AVFoundation
import CoreLocation
import Foundation
import UIKit

/// 2 Nov (Bidur: "Silent mode. Airpod or headphone on. App talks only when app opened", then "Find a way to do this
/// from in app"): the app keeps running while a trip is on and the phone is locked, the way turn by turn guidance
/// does, so it can say Get off now into the headphones.
///
/// While a trip runs (JavaScript starts this at Start trip, with the app in front, and stops it at arrival, End trip,
/// cancel, or when the headphones have been out for 5 minutes in the background) the app receives location updates in
/// the background: When In Use authorization (no Always prompt), UIBackgroundModes location, the blue location
/// indicator shown, about 100 m accuracy and a 100 m distance filter (cell and Wi-Fi, little GPS: battery first). iOS 17
/// and later also hold a CLBackgroundActivitySession, the documented way for a When In Use app to keep its session.
/// Every 15 s, and on a new position at most every 5 s, it tells JavaScript to refresh the trip (onTripWake). It stops
/// itself at the deadline JavaScript gives (30 min after the trip's last arrival, at most 4 h), when location is turned
/// off for the app, and when the app is closed. The location itself is not used or sent anywhere: it only keeps the
/// trip's voice alive.
final class TripAwake: NSObject, CLLocationManagerDelegate {
  static let shared = TripAwake()

  /// Called on the main thread with the time (ms) whenever JavaScript should refresh the trip.
  var onWake: ((Double) -> Void)?

  private var manager: CLLocationManager?
  private var activity: AnyObject?
  private var timer: DispatchSourceTimer?
  private var until: Date?
  private var lastWake = Date.distantPast
  private var quietWanted = false
  private var quietUntil: Date?
  private var observers: [NSObjectProtocol] = []

  var running: Bool { manager != nil }

  /// "ok" when the app can keep running for a trip: location allowed (When In Use is enough) and the build declares the
  /// location and audio background modes. Else "noBackgroundMode", "unavailable" (Location Services off),
  /// "notDetermined" or "denied". Never prompts.
  static func status(checkServices: Bool = true) -> String {
    let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
    guard modes.contains("location"), modes.contains("audio") else { return "noBackgroundMode" }
    // Not asked on the main thread (Apple: it can block the UI there); start() relies on the authorization alone.
    if checkServices, !Thread.isMainThread, !CLLocationManager.locationServicesEnabled() { return "unavailable" }
    switch CLLocationManager().authorizationStatus {
    case .authorizedWhenInUse, .authorizedAlways: return "ok"
    case .notDetermined: return "notDetermined"
    case .denied, .restricted: return "denied"
    @unknown default: return "denied"
    }
  }

  /// Starts (or keeps, moving the deadline) the trip's background session. Main thread, app in front. Returns status().
  func start(untilMs: Double) -> String {
    let st = Self.status(checkServices: false)
    guard st == "ok" else { stop(); return st }
    until = Date(timeIntervalSince1970: untilMs / 1000)
    if manager != nil { return "ok" }
    let m = CLLocationManager()
    m.delegate = self
    m.desiredAccuracy = kCLLocationAccuracyHundredMeters
    m.distanceFilter = 100
    m.activityType = .otherNavigation
    m.pausesLocationUpdatesAutomatically = false
    m.allowsBackgroundLocationUpdates = true
    m.showsBackgroundLocationIndicator = true
    manager = m
    m.startUpdatingLocation()
    if #available(iOS 17.0, *) { activity = CLBackgroundActivitySession() }
    observe()
    let t = DispatchSource.makeTimerSource(queue: .main)
    t.schedule(deadline: .now() + 15, repeating: 15, leeway: .seconds(2))
    t.setEventHandler { [weak self] in self?.tick(force: true) }
    t.resume()
    timer = t
    return "ok"
  }

  /// Stops everything: location, the activity session, the timer, and the silent push clips (the push talks again).
  func stop() {
    timer?.cancel()
    timer = nil
    if let m = manager {
      m.stopUpdatingLocation()
      m.allowsBackgroundLocationUpdates = false
      m.delegate = nil
    }
    manager = nil
    if #available(iOS 17.0, *) { (activity as? CLBackgroundActivitySession)?.invalidate() }
    activity = nil
    until = nil
    quietWanted = false
    quietUntil = nil
    for o in observers { NotificationCenter.default.removeObserver(o) }
    observers = []
    QuietClips.apply(false)
  }

  /// The app voices the locked trip (on) until untilMs, or not (off). Main thread. Returns whether the copies are in.
  func setQuiet(_ on: Bool, untilMs: Double) -> Bool {
    quietWanted = on && running
    quietUntil = quietWanted ? Date(timeIntervalSince1970: untilMs / 1000) : nil
    return reconcileQuiet()
  }

  @discardableResult
  private func reconcileQuiet() -> Bool {
    let want = QuietClips.shouldBeQuiet(wanted: quietWanted, headphones: ClipPlayer.route() == "headphones", leaseUntil: quietUntil, now: Date())
    if want != QuietClips.present() { QuietClips.apply(want) }
    return want
  }

  private func observe() {
    let nc = NotificationCenter.default
    // Headphones in or out: the silent copies follow at once (out: the push talks again on the speaker), and the trip is
    // refreshed so JavaScript sees the new route.
    observers.append(nc.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] _ in
      self?.reconcileQuiet()
      self?.tick(force: true)
    })
    // The app closed from the app switcher while running in the background: nothing is left silent.
    observers.append(nc.addObserver(forName: UIApplication.willTerminateNotification, object: nil, queue: .main) { [weak self] _ in
      self?.stop()
    })
  }

  private func tick(force: Bool) {
    guard running else { return }
    let now = Date()
    if let u = until, now >= u { stop(); return }
    reconcileQuiet()
    if !force && now.timeIntervalSince(lastWake) < 5 { return }
    lastWake = now
    onWake?(now.timeIntervalSince1970 * 1000)
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    tick(force: false)
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    switch manager.authorizationStatus {
    case .authorizedWhenInUse, .authorizedAlways, .notDetermined: break
    default: stop()
    }
  }
}
