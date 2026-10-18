import Foundation

public struct UsageStats: Equatable, Sendable {
    public var totalWords: Int
    public var wordsPerMinute: Int
    public var streakDays: Int

    public init(totalWords: Int, wordsPerMinute: Int, streakDays: Int) {
        self.totalWords = totalWords
        self.wordsPerMinute = wordsPerMinute
        self.streakDays = streakDays
    }

    public static func compute(_ items: [HistoryItem], now: Date = Date(), calendar: Calendar = .current) -> UsageStats {
        let words = items.reduce(0) { $0 + $1.wordCount }
        let minutes = items.reduce(0.0) { $0 + max(0, $1.durationSeconds) } / 60
        let wpm = minutes > 0 ? Int((Double(words) / minutes).rounded()) : 0

        let days = Set(items.map { calendar.startOfDay(for: $0.date) })
        var day = calendar.startOfDay(for: now)
        if !days.contains(day) {
            // A streak survives until the end of today even if you haven't dictated yet.
            guard let yesterday = calendar.date(byAdding: .day, value: -1, to: day), days.contains(yesterday) else {
                return UsageStats(totalWords: words, wordsPerMinute: wpm, streakDays: 0)
            }
            day = yesterday
        }
        var streak = 0
        while days.contains(day) {
            streak += 1
            guard let previous = calendar.date(byAdding: .day, value: -1, to: day) else { break }
            day = previous
        }
        return UsageStats(totalWords: words, wordsPerMinute: wpm, streakDays: streak)
    }
}

public enum HistoryPolicy {
    /// Applies the retention setting and the hard item cap. Newest items are kept.
    public static func prune(_ items: [HistoryItem], retentionDays: Int, now: Date = Date()) -> [HistoryItem] {
        guard retentionDays > 0 else { return [] }
        let cutoff = now.addingTimeInterval(-Double(retentionDays) * 86_400)
        return Array(
            items
                .filter { $0.date >= cutoff }
                .sorted { $0.date > $1.date }
                .prefix(Limits.maxHistoryItems)
        )
    }
}
