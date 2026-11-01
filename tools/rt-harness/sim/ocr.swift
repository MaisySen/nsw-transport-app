// Reads the words on each screenshot with Apple's Vision text recognizer (macOS runner, no network):
//   swift ocr.swift a.png b.png ...   -> one JSON line per picture: {"file":..., "w":..., "h":..., "lines":[{"t","x","y","w","h"}]}
// x and y are fractions of the picture from its top left, so the Dynamic Island band and the Lock Screen card can be
// told apart by position.
import Foundation
import Vision
import AppKit

for path in CommandLine.arguments.dropFirst() {
    guard let img = NSImage(contentsOfFile: path) else { continue }
    var rect = CGRect(origin: .zero, size: img.size)
    guard let cg = img.cgImage(forProposedRect: &rect, context: nil, hints: nil) else { continue }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = false
    try? VNImageRequestHandler(cgImage: cg).perform([req])
    var lines: [[String: Any]] = []
    for o in req.results ?? [] {
        guard let c = o.topCandidates(1).first else { continue }
        let b = o.boundingBox
        lines.append(["t": c.string, "x": b.minX, "y": 1 - b.maxY, "w": b.width, "h": b.height, "c": c.confidence])
    }
    let out: [String: Any] = ["file": (path as NSString).lastPathComponent, "w": cg.width, "h": cg.height, "lines": lines]
    if let d = try? JSONSerialization.data(withJSONObject: out), let s = String(data: d, encoding: .utf8) { print(s) }
}
