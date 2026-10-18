import Foundation
import KalaamKit
import Observation

/// Owns all user data.
///
/// - Settings (no personal content) → UserDefaults.
/// - History, snippets, dictionary → AES-256-GCM encrypted files in the app's private
///   container, keyed by a device-only Keychain key.
///
/// If existing data can't be decrypted, the store goes read-only rather than overwrite it,
/// and the UI offers an explicit reset.
@MainActor
@Observable
final class AppStore {
    static let keychainService = "com.abdurrub.kalaam.datakey"
    private static let settingsKey = "settings.v1"

    private(set) var settings: AppSettings
    private(set) var history: [HistoryItem] = []
    private(set) var snippets: [Snippet] = []
    private(set) var dictionary: [DictionaryEntry] = []
    /// Non-nil when encrypted storage couldn't be opened. Nothing is written in that state.
    private(set) var storageError: String?

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var historyFile: EncryptedFileStore<[HistoryItem]>?
    @ObservationIgnored private var snippetsFile: EncryptedFileStore<[Snippet]>?
    @ObservationIgnored private var dictionaryFile: EncryptedFileStore<[DictionaryEntry]>?

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        settings = Self.loadSettings(from: defaults)
        openEncryptedStorage()
    }

    var pipeline: DictationPipeline {
        DictationPipeline(settings: settings, snippets: snippets, dictionary: dictionary)
    }

    var stats: UsageStats { UsageStats.compute(history) }

    // MARK: - Settings

    func updateSettings(_ change: (inout AppSettings) -> Void) {
        var copy = settings
        change(&copy)
        guard copy != settings else { return }
        let retentionChanged = copy.historyRetentionDays != settings.historyRetentionDays
        settings = copy
        if let data = try? JSONEncoder().encode(settings) {
            defaults.set(data, forKey: Self.settingsKey)
        }
        if retentionChanged {
            history = HistoryPolicy.prune(history, retentionDays: settings.historyRetentionDays)
            persist(history, to: historyFile)
        }
    }

    private static func loadSettings(from defaults: UserDefaults) -> AppSettings {
        guard let data = defaults.data(forKey: settingsKey),
              let settings = try? JSONDecoder().decode(AppSettings.self, from: data) else {
            return AppSettings()
        }
        return settings
    }

    // MARK: - History

    func addHistory(_ item: HistoryItem) {
        guard settings.historyRetentionDays > 0 else { return }
        history = HistoryPolicy.prune([item] + history, retentionDays: settings.historyRetentionDays)
        persist(history, to: historyFile)
    }

    func deleteHistory(_ id: HistoryItem.ID) {
        history.removeAll { $0.id == id }
        persist(history, to: historyFile)
    }

    func clearHistory() {
        history = []
        persist(history, to: historyFile)
    }

    // MARK: - Snippets

    func addSnippet(trigger: String, expansion: String) throws {
        try EntryValidator.canAdd(count: snippets.count)
        let snippet = Snippet(trigger: try EntryValidator.phrase(trigger), expansion: try EntryValidator.expansion(expansion))
        snippets.insert(snippet, at: 0)
        persist(snippets, to: snippetsFile)
    }

    func updateSnippet(_ id: Snippet.ID, trigger: String, expansion: String) throws {
        guard let index = snippets.firstIndex(where: { $0.id == id }) else { return }
        snippets[index].trigger = try EntryValidator.phrase(trigger)
        snippets[index].expansion = try EntryValidator.expansion(expansion)
        persist(snippets, to: snippetsFile)
    }

    func toggleStar(_ id: Snippet.ID) {
        guard let index = snippets.firstIndex(where: { $0.id == id }) else { return }
        snippets[index].isStarred.toggle()
        persist(snippets, to: snippetsFile)
    }

    func deleteSnippet(_ id: Snippet.ID) {
        snippets.removeAll { $0.id == id }
        persist(snippets, to: snippetsFile)
    }

    // MARK: - Dictionary

    func addDictionaryEntry(heard: String, replacement: String) throws {
        try EntryValidator.canAdd(count: dictionary.count)
        let entry = DictionaryEntry(heard: try EntryValidator.phrase(heard), replacement: try EntryValidator.expansion(replacement))
        dictionary.insert(entry, at: 0)
        persist(dictionary, to: dictionaryFile)
    }

    func deleteDictionaryEntry(_ id: DictionaryEntry.ID) {
        dictionary.removeAll { $0.id == id }
        persist(dictionary, to: dictionaryFile)
    }

    // MARK: - Erase

    /// Deletes every file and the encryption key, then starts fresh.
    func eraseAllData() {
        try? historyFile?.delete()
        try? snippetsFile?.delete()
        try? dictionaryFile?.delete()
        KeychainKeyProvider.destroyKey(service: Self.keychainService)
        defaults.removeObject(forKey: Self.settingsKey)
        settings = AppSettings()
        history = []
        snippets = []
        dictionary = []
        storageError = nil
        openEncryptedStorage()
    }

    // MARK: - Storage

    private func openEncryptedStorage() {
        do {
            let key = try KeychainKeyProvider.loadOrCreateKey(service: Self.keychainService)
            let directory = try Self.dataDirectory()
            let history = EncryptedFileStore<[HistoryItem]>(url: directory.appending(path: "history.enc"), key: key)
            let snippets = EncryptedFileStore<[Snippet]>(url: directory.appending(path: "snippets.enc"), key: key)
            let dictionary = EncryptedFileStore<[DictionaryEntry]>(url: directory.appending(path: "dictionary.enc"), key: key)

            self.history = HistoryPolicy.prune(try history.load() ?? [], retentionDays: settings.historyRetentionDays)
            self.snippets = try snippets.load() ?? []
            self.dictionary = try dictionary.load() ?? []

            historyFile = history
            snippetsFile = snippets
            dictionaryFile = dictionary
        } catch {
            historyFile = nil
            snippetsFile = nil
            dictionaryFile = nil
            storageError = "Your saved data couldn't be unlocked, so Kalaam isn't saving anything. Use \"Erase all data\" in Settings to start fresh."
        }
    }

    private func persist<T: Codable>(_ value: T, to file: EncryptedFileStore<T>?) {
        guard storageError == nil, let file else { return }
        do {
            try file.save(value)
        } catch {
            storageError = "Couldn't save your data: \(error.localizedDescription)"
        }
    }

    private static func dataDirectory() throws -> URL {
        var directory = try FileManager.default
            .url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appending(path: "Kalaam", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        // The key never leaves this device, so a backup copy of these files would be unreadable.
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? directory.setResourceValues(values)
        return directory
    }
}
