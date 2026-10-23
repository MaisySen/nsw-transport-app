// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "Transport",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        // The app itself. xtool bundles this library product as the app.
        .library(name: "Transport", targets: ["Transport"]),
        // The widget extension (home screen widget and Live Activity).
        .library(name: "TransportWidget", targets: ["TransportWidget"]),
    ],
    targets: [
        // Models, API client and Live Activity attributes shared by the app and the widget.
        .target(
            name: "TransportKit",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .target(
            name: "Transport",
            dependencies: ["TransportKit"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .target(
            name: "TransportWidget",
            dependencies: ["TransportKit"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
