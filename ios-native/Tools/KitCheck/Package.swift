// swift-tools-version: 6.0
// Linux check: compiles the shared TransportKit (models, API client, formatting)
// and decodes real responses from the live backend. Run: swift run KitCheck
import PackageDescription

let package = Package(
    name: "KitCheck",
    targets: [
        .target(name: "TransportKit", path: "Sources/TransportKit", swiftSettings: [.swiftLanguageMode(.v5)]),
        .executableTarget(name: "KitCheck", dependencies: ["TransportKit"], swiftSettings: [.swiftLanguageMode(.v5)]),
    ]
)
