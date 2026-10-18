import Foundation

/// Hard limits that bound memory, disk use and regex work on user-supplied data.
public enum Limits {
    public static let maxTriggerLength = 64
    public static let maxExpansionLength = 4_000
    public static let maxEntries = 500
    public static let maxHistoryItems = 2_000
    public static let maxTranscriptLength = 20_000
}

public enum CleanupLevel: String, Codable, CaseIterable, Sendable, Identifiable, Comparable {
    /// Exactly what the speech engine heard.
    case none
    /// Removes fillers (um, uh), fixes spacing and capitalization.
    case light
    /// Light + spoken commands ("new line") and self-corrections ("no wait").
    case medium
    /// Medium + on-device Apple Intelligence polish (falls back to Medium if unavailable).
    case high

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .none: "None"
        case .light: "Light"
        case .medium: "Medium"
        case .high: "High (AI)"
        }
    }

    public var detail: String {
        switch self {
        case .none: "Exactly what you said."
        case .light: "Removes um and uh, fixes spacing and capitals."
        case .medium: "Also handles \"new line\" and \"no wait\" corrections."
        case .high: "Also polishes grammar with on-device Apple Intelligence."
        }
    }

    private var order: Int {
        switch self {
        case .none: 0
        case .light: 1
        case .medium: 2
        case .high: 3
        }
    }

    public static func < (lhs: CleanupLevel, rhs: CleanupLevel) -> Bool { lhs.order < rhs.order }
}

public enum WritingStyle: String, Codable, CaseIterable, Sendable, Identifiable {
    case formal, casual, veryCasual, excited

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .formal: "Formal."
        case .casual: "Casual"
        case .veryCasual: "very casual"
        case .excited: "Excited!"
        }
    }

    public var detail: String {
        switch self {
        case .formal: "Caps + Punctuation"
        case .casual: "Caps + Less punctuation"
        case .veryCasual: "No Caps + Less punctuation"
        case .excited: "More exclamations"
        }
    }
}

/// Where the text is going. Each context can have its own writing style.
public enum StyleContext: String, Codable, CaseIterable, Sendable, Identifiable, CodingKeyRepresentable {
    case personal, work, email, other

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .personal: "Personal messages"
        case .work: "Work messages"
        case .email: "Email"
        case .other: "Other"
        }
    }
}

public struct Snippet: Codable, Identifiable, Hashable, Sendable {
    public var id: UUID
    public var trigger: String
    public var expansion: String
    public var isStarred: Bool

    public init(id: UUID = UUID(), trigger: String, expansion: String, isStarred: Bool = false) {
        self.id = id
        self.trigger = trigger
        self.expansion = expansion
        self.isStarred = isStarred
    }
}

public struct DictionaryEntry: Codable, Identifiable, Hashable, Sendable {
    public var id: UUID
    /// What the speech engine tends to write, e.g. "cloud code".
    public var heard: String
    /// What it should become, e.g. "Claude Code".
    public var replacement: String

    public init(id: UUID = UUID(), heard: String, replacement: String) {
        self.id = id
        self.heard = heard
        self.replacement = replacement
    }
}

public struct HistoryItem: Codable, Identifiable, Hashable, Sendable {
    public var id: UUID
    public var date: Date
    public var rawText: String
    public var finalText: String
    public var durationSeconds: Double
    public var appName: String?

    public init(
        id: UUID = UUID(),
        date: Date = Date(),
        rawText: String,
        finalText: String,
        durationSeconds: Double,
        appName: String? = nil
    ) {
        self.id = id
        self.date = date
        self.rawText = rawText
        self.finalText = finalText
        self.durationSeconds = durationSeconds
        self.appName = appName
    }

    public var wordCount: Int { TextMetrics.wordCount(finalText) }
}

public enum ValidationError: Error, Equatable, LocalizedError {
    case empty
    case tooLong(max: Int)
    case tooManyEntries(max: Int)

    public var errorDescription: String? {
        switch self {
        case .empty: "This can't be empty."
        case .tooLong(let max): "This is too long (max \(max) characters)."
        case .tooManyEntries(let max): "You've reached the limit of \(max) entries."
        }
    }
}

public enum EntryValidator {
    /// Trims and validates a trigger/heard phrase. Throws on empty or oversized input.
    public static func phrase(_ raw: String) throws -> String {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { throw ValidationError.empty }
        guard value.count <= Limits.maxTriggerLength else { throw ValidationError.tooLong(max: Limits.maxTriggerLength) }
        return value
    }

    /// Validates the text a snippet or dictionary entry expands to.
    public static func expansion(_ raw: String) throws -> String {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { throw ValidationError.empty }
        guard value.count <= Limits.maxExpansionLength else { throw ValidationError.tooLong(max: Limits.maxExpansionLength) }
        return value
    }

    public static func canAdd(count: Int) throws {
        guard count < Limits.maxEntries else { throw ValidationError.tooManyEntries(max: Limits.maxEntries) }
    }
}

public enum TextMetrics {
    public static func wordCount(_ text: String) -> Int {
        text.split(whereSeparator: { $0.isWhitespace }).count
    }
}
