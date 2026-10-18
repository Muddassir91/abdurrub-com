// swift-tools-version: 6.2
import PackageDescription

// KalaamKit holds all platform-independent logic: text cleanup, styles,
// snippets, the hotkey gesture state machine, stats and encrypted storage.
// It has zero third-party dependencies on purpose (no supply-chain risk).
let package = Package(
    name: "KalaamKit",
    platforms: [.macOS(.v26), .iOS(.v26)],
    products: [
        .library(name: "KalaamKit", targets: ["KalaamKit"])
    ],
    targets: [
        .target(name: "KalaamKit"),
        .testTarget(name: "KalaamKitTests", dependencies: ["KalaamKit"])
    ]
)
