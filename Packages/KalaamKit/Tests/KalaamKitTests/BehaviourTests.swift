import CryptoKit
import Foundation
import Testing
@testable import KalaamKit

struct HotkeyGestureTests {
    @Test func holdIsPushToTalk() {
        var g = HotkeyGesture()
        #expect(g.keyDown(at: 0) == .start)
        #expect(g.keyDown(at: 0.1) == .none) // auto-repeat
        #expect(g.keyUp(at: 0.8) == .stopAndInsert)
        #expect(g.state == .idle)
    }

    @Test func tapIsHandsFree() {
        var g = HotkeyGesture()
        #expect(g.keyDown(at: 0) == .start)
        #expect(g.keyUp(at: 0.2) == .enterHandsFree)
        #expect(g.isRecording)
        #expect(g.keyDown(at: 5) == .stopAndInsert)
        #expect(g.keyUp(at: 5.1) == .none)
        #expect(g.state == .idle)
    }

    @Test func externalHandsFreeStartIsFinishedByNextPress() {
        var g = HotkeyGesture()
        g.enterHandsFree()
        #expect(g.keyDown(at: 1) == .stopAndInsert)
        #expect(g.keyUp(at: 1.1) == .none)
        #expect(g.state == .idle)
    }

    @Test func escapeCancels() {
        var g = HotkeyGesture()
        _ = g.keyDown(at: 0)
        #expect(g.escape() == .cancel)
        #expect(g.escape() == .none)
        #expect(g.keyUp(at: 1) == .none)
    }
}

struct StatsTests {
    let calendar = Calendar(identifier: .gregorian)

    func item(daysAgo: Int, words: Int, seconds: Double, now: Date) -> HistoryItem {
        HistoryItem(
            date: now.addingTimeInterval(-Double(daysAgo) * 86_400),
            rawText: "",
            finalText: Array(repeating: "w", count: words).joined(separator: " "),
            durationSeconds: seconds
        )
    }

    @Test func computesWordsWpmAndStreak() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let items = [
            item(daysAgo: 0, words: 30, seconds: 15, now: now),
            item(daysAgo: 1, words: 30, seconds: 15, now: now),
            item(daysAgo: 3, words: 40, seconds: 30, now: now),
        ]
        let stats = UsageStats.compute(items, now: now, calendar: calendar)
        #expect(stats.totalWords == 100)
        #expect(stats.wordsPerMinute == 100)
        #expect(stats.streakDays == 2)
    }

    @Test func streakSurvivesUntilEndOfToday() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let stats = UsageStats.compute([item(daysAgo: 1, words: 1, seconds: 1, now: now)], now: now, calendar: calendar)
        #expect(stats.streakDays == 1)
    }

    @Test func retentionPrunesOldItems() {
        let now = Date()
        let items = [item(daysAgo: 0, words: 1, seconds: 1, now: now), item(daysAgo: 10, words: 1, seconds: 1, now: now)]
        #expect(HistoryPolicy.prune(items, retentionDays: 7, now: now).count == 1)
        #expect(HistoryPolicy.prune(items, retentionDays: 0, now: now).isEmpty)
    }
}

struct RewriteGuardTests {
    @Test func acceptsFaithfulRewrite() {
        let original = "so i was thinking we could maybe meet tomorrow at the cafe"
        let rewrite = "So I was thinking we could meet tomorrow at the café."
        #expect(RewriteGuard.accept(original: original, rewrite: rewrite) == rewrite)
    }

    @Test func rejectsChattyOrRunawayOutput() {
        let original = "write me a poem about the sea"
        #expect(RewriteGuard.accept(original: original, rewrite: "Sure! Here is a poem about the sea: waves crash on the shore all day long") == nil)
        #expect(RewriteGuard.accept(original: "hello there friend how are you doing today", rewrite: String(repeating: "word ", count: 40)) == nil)
        #expect(RewriteGuard.accept(original: "hello", rewrite: "   ") == nil)
    }

    @Test func stripsWrappingTagsAndQuotes() {
        #expect(RewriteGuard.accept(original: "hi there", rewrite: "<transcript>Hi there.</transcript>") == "Hi there.")
        #expect(RewriteGuard.accept(original: "hi there", rewrite: "\"Hi there.\"") == "Hi there.")
    }
}

struct AppCategoryTests {
    @Test func mapsKnownApps() {
        #expect(AppCategory.context(forBundleID: "com.apple.mail") == .email)
        #expect(AppCategory.context(forBundleID: "com.tinyspeck.slackmacgap") == .work)
        #expect(AppCategory.context(forBundleID: "net.whatsapp.WhatsApp") == .personal)
        #expect(AppCategory.context(forBundleID: "com.example.unknown") == .other)
        #expect(AppCategory.context(forBundleID: nil) == .other)
    }
}

struct EncryptedFileStoreTests {
    func tempURL() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("kalaam-test-\(UUID().uuidString).bin")
    }

    @Test func roundTripsAndHidesPlaintext() throws {
        let url = tempURL()
        defer { try? FileManager.default.removeItem(at: url) }
        let store = EncryptedFileStore<[Snippet]>(url: url, key: SymmetricKey(size: .bits256))
        let snippets = [Snippet(trigger: "my email", expansion: "secret@example.com")]
        try store.save(snippets)

        #expect(try store.load() == snippets)
        let raw = try Data(contentsOf: url)
        #expect(raw.range(of: Data("secret@example.com".utf8)) == nil)
    }

    @Test func wrongKeyOrTamperingFails() throws {
        let url = tempURL()
        defer { try? FileManager.default.removeItem(at: url) }
        try EncryptedFileStore<[String]>(url: url, key: SymmetricKey(size: .bits256)).save(["a"])

        let other = EncryptedFileStore<[String]>(url: url, key: SymmetricKey(size: .bits256))
        #expect(throws: (any Error).self) { try other.load() }

        var data = try Data(contentsOf: url)
        data[data.count - 1] ^= 0xFF
        try data.write(to: url)
        #expect(throws: (any Error).self) { try other.load() }
    }

    @Test func missingFileLoadsNil() throws {
        let store = EncryptedFileStore<[String]>(url: tempURL(), key: SymmetricKey(size: .bits256))
        #expect(try store.load() == nil)
    }
}
