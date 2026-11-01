import AVFoundation
import Foundation

/// Build 213 (1 Nov, Bidur: "Was in silent. But headphone on" and "Never spoke"): Kylie's own clips with the app open.
/// The JavaScript (nativeExtras.playClip) asks for a clip at its moment, once, never for a moment from before the app
/// came to the front (voiceGate), and the running trip's push stays soundless while the app is open, so nothing is heard
/// twice. In headphones the clip plays in a playback session (the Silent switch does not mute what goes to the ears,
/// other audio is ducked, not stopped); on the speaker it plays in the ambient session, which the Silent switch mutes,
/// as Bidur chose. Only the three bundled clips; nothing runs with the app in the background.
final class ClipPlayer: NSObject, AVAudioPlayerDelegate {
  static let shared = ClipPlayer()
  /// The clips bundled as notification sounds (app.json expo-notifications sounds), the only names played.
  static let names: Set<String> = ["getoff_soon", "getoff_now", "arrival"]

  private let lock = NSLock()
  private var player: AVAudioPlayer?

  /// "headphones" (wired, Bluetooth incl. AirPods, LE), "speaker" (the phone's own speaker or earpiece) or "other"
  /// (car, AirPlay, HDMI...). Read from the current route, so it follows plugging in and taking out.
  static func route() -> String {
    let outs = AVAudioSession.sharedInstance().currentRoute.outputs.map { $0.portType }
    let ears: [AVAudioSession.Port] = [.headphones, .bluetoothA2DP, .bluetoothHFP, .bluetoothLE]
    if outs.contains(where: { ears.contains($0) }) { return "headphones" }
    if outs.contains(.builtInSpeaker) || outs.contains(.builtInReceiver) { return "speaker" }
    return "other"
  }

  /// Plays one clip now. headphones true: playback session (heard in Silent mode, in the ears only, because the JS
  /// passes true only while the route is headphones); false: ambient session (Silent mutes it on the speaker). False when
  /// the clip is unknown, missing from the bundle, or iOS refuses the session; the JS then says the words instead.
  func play(_ name: String, headphones: Bool) -> Bool {
    guard Self.names.contains(name), let url = Bundle.main.url(forResource: name, withExtension: "wav") else { return false }
    let s = AVAudioSession.sharedInstance()
    do {
      if headphones {
        try s.setCategory(.playback, mode: .voicePrompt, options: [.mixWithOthers, .duckOthers])
      } else {
        try s.setCategory(.ambient, mode: .default, options: [])
      }
      try s.setActive(true)
      let p = try AVAudioPlayer(contentsOf: url)
      p.delegate = self
      lock.lock()
      let old = player
      player = p
      lock.unlock()
      old?.stop()
      if p.play() { return true }
      finish(p)
      return false
    } catch {
      return false
    }
  }

  func audioPlayerDidFinishPlaying(_ p: AVAudioPlayer, successfully flag: Bool) { finish(p) }

  func audioPlayerDecodeErrorDidOccur(_ p: AVAudioPlayer, error: Error?) { finish(p) }

  /// Lets the session go once the clip is done, so music comes back up, and leaves the ambient category the app's
  /// spoken alerts use (startAlertAudio), so the next phone-voice alert still follows the Silent switch on the speaker.
  private func finish(_ p: AVAudioPlayer) {
    lock.lock()
    guard player === p else { lock.unlock(); return }
    player = nil
    lock.unlock()
    let s = AVAudioSession.sharedInstance()
    try? s.setActive(false, options: .notifyOthersOnDeactivation)
    try? s.setCategory(.ambient, mode: .default, options: [])
  }
}
