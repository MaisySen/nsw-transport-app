import Foundation

/// 2 Nov (Bidur: "Silent mode. Airpod or headphone on. App talks only when app opened", then "Find a way to do this
/// from in app"): one voice, never two. While the app itself speaks a locked trip into the headphones (TripAwake), the
/// trip push's spoken sounds would talk over it when the ring switch is on. iOS looks for a notification sound in the
/// app's own Library/Sounds before the app bundle (UNNotificationSound), so for that time the three clip names point
/// at a silent copy there: the push still shows its banner and taps, the app is the one voice. The copies live only on a
/// lease the app renews every refresh (45 s) and only while the headphones are in; everything else removes them.
/// Foundation only, so the tests compile and run it with swiftc.
enum QuietClips {
  /// The bundled spoken sounds a trip push or the phone's own get off alert names (app.json expo-notifications sounds).
  static let names = ["getoff_soon", "getoff_now", "arrival"]

  /// A short silent WAV (16 bit mono PCM, 8 kHz): a valid notification sound that makes no noise.
  static func silentWav(ms: Int = 200) -> Data {
    let rate: UInt32 = 8000
    let samples = UInt32(max(1, ms)) * rate / 1000
    let dataBytes = samples * 2
    var d = Data()
    func u32(_ v: UInt32) { var x = v.littleEndian; withUnsafeBytes(of: &x) { d.append(contentsOf: $0) } }
    func u16(_ v: UInt16) { var x = v.littleEndian; withUnsafeBytes(of: &x) { d.append(contentsOf: $0) } }
    d.append(contentsOf: Array("RIFF".utf8)); u32(36 + dataBytes); d.append(contentsOf: Array("WAVE".utf8))
    d.append(contentsOf: Array("fmt ".utf8)); u32(16); u16(1); u16(1); u32(rate); u32(rate * 2); u16(2); u16(16)
    d.append(contentsOf: Array("data".utf8)); u32(dataBytes)
    d.append(Data(count: Int(dataBytes)))
    return d
  }

  /// The app container's Library/Sounds, the first place iOS looks for a notification sound.
  static func soundsDir() -> URL? {
    guard let lib = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first else { return nil }
    return lib.appendingPathComponent("Sounds", isDirectory: true)
  }

  /// Whether the silent copies should be in place: the app wants them, the headphones are in, the lease has not run out.
  static func shouldBeQuiet(wanted: Bool, headphones: Bool, leaseUntil: Date?, now: Date) -> Bool {
    guard wanted, headphones, let until = leaseUntil else { return false }
    return now < until
  }

  /// Puts the silent copies in place (on) or removes them (off). Returns whether the directory now matches. Any error
  /// leaves the bundle's clips in charge (the copies are removed, never half written).
  @discardableResult
  static func apply(_ on: Bool, dir: URL? = soundsDir()) -> Bool {
    guard let dir else { return false }
    let fm = FileManager.default
    if on {
      do {
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        let wav = silentWav()
        for n in names { try wav.write(to: dir.appendingPathComponent(n + ".wav"), options: .atomic) }
        return true
      } catch {
        _ = apply(false, dir: dir)
        return false
      }
    }
    var ok = true
    for n in names {
      let f = dir.appendingPathComponent(n + ".wav")
      if fm.fileExists(atPath: f.path) { do { try fm.removeItem(at: f) } catch { ok = false } }
    }
    return ok
  }

  /// Whether the silent copies are there now.
  static func present(dir: URL? = soundsDir()) -> Bool {
    guard let dir else { return false }
    return names.contains { FileManager.default.fileExists(atPath: dir.appendingPathComponent($0 + ".wav").path) }
  }
}
