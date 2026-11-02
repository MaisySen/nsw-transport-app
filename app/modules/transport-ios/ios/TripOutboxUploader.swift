import Foundation
import UIKit
import UserNotifications
import ExpoModulesCore

/// Sends the trip's queued registrations (TripOutbox.swift) with a background URLSession (build after 214, 1 Nov 2026).
///
/// A background session's tasks are carried out by iOS itself: while the phone is locked and the app suspended, they
/// wait for a connection when there is none, and a retry waits by the backoff (earliestBeginDate). When a task ends
/// iOS wakes the app in the background (TripOutboxAppDelegate) and the answer is written back here: a 2xx takes the
/// entry out, and a yes to the trip watch that says the server sends Get off now takes the phone's own Get off now
/// alerts off (one voice; harness #4 found two). A force quit cancels the tasks (Apple's rule); the next open sends
/// them again from the queue.
final class TripOutboxUploader: NSObject, URLSessionDataDelegate {
    static let shared = TripOutboxUploader()
    static let sessionId = "com.maisysen.nswtransport.tripoutbox"
    private let lock = NSLock()
    private var bodies: [Int: Data] = [:]
    private var finishEvents: (() -> Void)?

    private lazy var session: URLSession = {
        let c = URLSessionConfiguration.background(withIdentifier: Self.sessionId)
        c.isDiscretionary = false
        c.sessionSendsLaunchEvents = true
        c.timeoutIntervalForRequest = 30
        c.timeoutIntervalForResource = 4 * 3600
        return URLSession(configuration: c, delegate: self, delegateQueue: nil)
    }()

    var defaults: UserDefaults = .standard

    /// Every queued entry gets one task (not yet running ones keep theirs); a retry starts at its own time.
    func kick() {
        session.getAllTasks { tasks in
            let running = Set(tasks.compactMap { $0.taskDescription })
            for e in TripOutbox.load(self.defaults) where !running.contains(Self.tag(e)) {
                self.start(e)
            }
        }
    }

    /// Takes back the tasks of one kind (JavaScript heard yes first, or the trip ended).
    func cancel(kind: String) {
        session.getAllTasks { tasks in
            for t in tasks where (t.taskDescription ?? "").hasPrefix(kind + "|") { t.cancel() }
        }
    }

    static func tag(_ e: TripOutbox.Entry) -> String { "\(e.kind)|\(e.tries ?? 0)|\(Int(e.after))" }

    private func start(_ e: TripOutbox.Entry) {
        guard let r = TripOutbox.request(e, timeout: 30) else { TripOutbox.record(e, outcome: .gone, now: Date(), defaults); return }
        let task: URLSessionTask
        if let b = e.body {
            // A background session uploads from a file only.
            let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("tripoutbox", isDirectory: true)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let f = dir.appendingPathComponent("\(e.kind)-\(e.tries ?? 0).json")
            do { try Data(b.utf8).write(to: f, options: .atomic) } catch { return }
            task = session.uploadTask(with: r, fromFile: f)
        } else {
            task = session.downloadTask(with: r)
        }
        task.taskDescription = Self.tag(e)
        let at = Date(timeIntervalSince1970: e.after / 1000)
        if at > Date() { task.earliestBeginDate = at }
        task.countOfBytesClientExpectsToSend = Int64(e.body?.utf8.count ?? 0) + 600
        task.countOfBytesClientExpectsToReceive = 2000
        task.resume()
    }

    // MARK: URLSession delegate (called in the background when iOS woke the app for it)

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock(); bodies[dataTask.taskIdentifier, default: Data()].append(data); lock.unlock()
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {}

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock(); let body = bodies.removeValue(forKey: task.taskIdentifier); lock.unlock()
        if let e = error as? URLError, e.code == .cancelled { return }
        let parts = (task.taskDescription ?? "").split(separator: "|")
        guard let kind = parts.first.map(String.init),
              let entry = TripOutbox.load(defaults).first(where: { Self.tag($0) == task.taskDescription }) else { return }
        let status = (task.response as? HTTPURLResponse)?.statusCode
        let o = error == nil ? TripOutbox.outcome(status: status) : .retry
        if o == .ok, kind == "watch", let notes = entry.offNotes, !notes.isEmpty, TripOutbox.serverSendsGetOff(body) {
            UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: notes)
        }
        TripOutbox.record(entry, outcome: o, now: Date(), defaults)
        if o == .retry, let next = TripOutbox.load(defaults).first(where: { $0.kind == kind }) { start(next) }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async {
            let f = self.finishEvents
            self.finishEvents = nil
            f?()
        }
    }

    /// iOS woke the app for this session's events (TripOutboxAppDelegate): the handler is called once they are in.
    func handleEvents(_ completion: @escaping () -> Void) {
        DispatchQueue.main.async {
            self.finishEvents = completion
            _ = self.session // reconnects to the session so its events are delivered
            DispatchQueue.main.asyncAfter(deadline: .now() + 25) {
                if let f = self.finishEvents { self.finishEvents = nil; f() }
            }
        }
    }

    /// Keeps the app running for a short while (about 30 s) after it leaves the screen, so a card token that comes after
    /// the phone locked still reaches the queue (harness F-TOKEN-LATE: token at 6 s, phone locked at 4 s).
    private var bgTask: UIBackgroundTaskIdentifier = .invalid
    func holdBriefly(_ seconds: TimeInterval = 25) {
        DispatchQueue.main.async {
            guard self.bgTask == .invalid else { return }
            self.bgTask = UIApplication.shared.beginBackgroundTask(withName: "trip registration") { self.endHold() }
            DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { self.endHold() }
        }
    }

    func endHold() {
        DispatchQueue.main.async {
            guard self.bgTask != .invalid else { return }
            UIApplication.shared.endBackgroundTask(self.bgTask)
            self.bgTask = .invalid
        }
    }
}

/// Hands iOS's background session wake to the uploader (registered in expo-module.config.json). Every subscriber is
/// called for every session (ExpoAppDelegateSubscriberManager), so another session's wake is answered at once.
public final class TripOutboxAppDelegate: ExpoAppDelegateSubscriber {
    public func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        guard identifier == TripOutboxUploader.sessionId else { completionHandler(); return }
        TripOutboxUploader.shared.defaults = TripOutboxShared.defaults()
        TripOutboxUploader.shared.handleEvents(completionHandler)
    }
}

enum TripOutboxShared {
    static func defaults() -> UserDefaults {
        let g = "group.com.maisysen.nswtransport"
        if FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: g) != nil, let d = UserDefaults(suiteName: g) { return d }
        return .standard
    }
}
