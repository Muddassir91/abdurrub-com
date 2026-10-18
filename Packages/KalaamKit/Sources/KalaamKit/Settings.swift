import Foundation

/// User preferences. Contains no personal content, so it lives in UserDefaults.
/// Anything the user says or types (history, snippets, dictionary) is stored encrypted instead.
public struct AppSettings: Codable, Equatable, Sendable {
    public var cleanupLevel: CleanupLevel = .medium
    public var styles: [StyleContext: WritingStyle] = [
        .personal: .casual,
        .work: .formal,
        .email: .formal,
        .other: .formal,
    ]
    /// BCP-47 identifier, e.g. "en-US".
    public var languageID: String = "en-US"
    /// 0 means "don't keep history at all".
    public var historyRetentionDays: Int = 30
    /// macOS: identifier of the chosen hotkey preset.
    public var hotkeyID: String = "ctrl-l"
    /// macOS: show the small resting pill above the Dock.
    public var showIdlePill: Bool = true
    /// macOS: put the previous clipboard back after pasting.
    public var restoreClipboard: Bool = true
    /// iOS: stop recording automatically after a pause.
    public var autoStopOnSilence: Bool = true
    /// iOS: dictated text is removed from the clipboard after this many seconds.
    public var clipboardExpirySeconds: Int = 300

    public init() {}

    public func style(for context: StyleContext) -> WritingStyle {
        styles[context] ?? .formal
    }

    public static let retentionChoices: [Int] = [0, 1, 7, 30, 90, 365]

    // Decode field-by-field so adding a setting in a future version never wipes the others.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = AppSettings()
        cleanupLevel = (try? c.decode(CleanupLevel.self, forKey: .cleanupLevel)) ?? d.cleanupLevel
        styles = (try? c.decode([StyleContext: WritingStyle].self, forKey: .styles)) ?? d.styles
        languageID = (try? c.decode(String.self, forKey: .languageID)) ?? d.languageID
        historyRetentionDays = (try? c.decode(Int.self, forKey: .historyRetentionDays)) ?? d.historyRetentionDays
        hotkeyID = (try? c.decode(String.self, forKey: .hotkeyID)) ?? d.hotkeyID
        showIdlePill = (try? c.decode(Bool.self, forKey: .showIdlePill)) ?? d.showIdlePill
        restoreClipboard = (try? c.decode(Bool.self, forKey: .restoreClipboard)) ?? d.restoreClipboard
        autoStopOnSilence = (try? c.decode(Bool.self, forKey: .autoStopOnSilence)) ?? d.autoStopOnSilence
        clipboardExpirySeconds = (try? c.decode(Int.self, forKey: .clipboardExpirySeconds)) ?? d.clipboardExpirySeconds
    }
}
