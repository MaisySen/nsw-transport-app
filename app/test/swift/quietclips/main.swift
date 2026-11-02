import Foundation

// Runs QuietClips (modules/transport-ios/ios/QuietClips.swift) in a temporary folder and prints one JSON line per case.
func out(_ c: String, _ d: [String: Any]) {
  var x = d; x["case"] = c
  let j = try! JSONSerialization.data(withJSONObject: x, options: [.sortedKeys])
  print(String(data: j, encoding: .utf8)!)
}
let dir = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("quietclips-\(getpid())/Library/Sounds", isDirectory: true)
let wav = QuietClips.silentWav()
let bytes = [UInt8](wav)
let head = String(bytes: bytes[0..<4], encoding: .ascii) ?? ""
let wave = String(bytes: bytes[8..<12], encoding: .ascii) ?? ""
let size = Int(bytes[4]) | Int(bytes[5]) << 8 | Int(bytes[6]) << 16 | Int(bytes[7]) << 24
let silent = bytes[44...].allSatisfy { $0 == 0 }
out("wav", ["head": head, "wave": wave, "riffSize": size, "len": bytes.count, "silent": silent, "rate": Int(bytes[24]) | Int(bytes[25]) << 8, "bits": Int(bytes[34])])
let on = QuietClips.apply(true, dir: dir)
let files = (try? FileManager.default.contentsOfDirectory(atPath: dir.path).sorted()) ?? []
out("on", ["ok": on, "files": files, "present": QuietClips.present(dir: dir)])
let off = QuietClips.apply(false, dir: dir)
let left = (try? FileManager.default.contentsOfDirectory(atPath: dir.path).sorted()) ?? []
out("off", ["ok": off, "files": left, "present": QuietClips.present(dir: dir), "again": QuietClips.apply(false, dir: dir)])
let now = Date(timeIntervalSince1970: 1_000_000)
out("lease", [
  "all": QuietClips.shouldBeQuiet(wanted: true, headphones: true, leaseUntil: now.addingTimeInterval(45), now: now),
  "speaker": QuietClips.shouldBeQuiet(wanted: true, headphones: false, leaseUntil: now.addingTimeInterval(45), now: now),
  "notWanted": QuietClips.shouldBeQuiet(wanted: false, headphones: true, leaseUntil: now.addingTimeInterval(45), now: now),
  "expired": QuietClips.shouldBeQuiet(wanted: true, headphones: true, leaseUntil: now.addingTimeInterval(-1), now: now),
  "noLease": QuietClips.shouldBeQuiet(wanted: true, headphones: true, leaseUntil: nil, now: now),
])
try? FileManager.default.removeItem(at: dir.deletingLastPathComponent().deletingLastPathComponent())
