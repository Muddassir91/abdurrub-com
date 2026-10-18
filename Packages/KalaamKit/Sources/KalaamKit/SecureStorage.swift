import CryptoKit
import Foundation
import Security

public enum SecureStorageError: Error, Equatable {
    case keychain(OSStatus)
    case corruptKey
    case sealFailed
}

/// A Codable value stored on disk encrypted with AES-256-GCM.
///
/// GCM is authenticated: if the file is tampered with, decryption fails rather than
/// returning altered data. On iOS the file additionally gets complete Data Protection,
/// so it's unreadable while the phone is locked.
public struct EncryptedFileStore<Value: Codable>: @unchecked Sendable {
    public let url: URL
    private let key: SymmetricKey

    public init(url: URL, key: SymmetricKey) {
        self.url = url
        self.key = key
    }

    public func load() throws -> Value? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let data = try Data(contentsOf: url)
        let box = try AES.GCM.SealedBox(combined: data)
        let plain = try AES.GCM.open(box, using: key)
        return try JSONDecoder().decode(Value.self, from: plain)
    }

    public func save(_ value: Value) throws {
        let plain = try JSONEncoder().encode(value)
        guard let sealed = try AES.GCM.seal(plain, using: key).combined else { throw SecureStorageError.sealFailed }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        #if os(iOS)
        try sealed.write(to: url, options: [.atomic, .completeFileProtection])
        #else
        try sealed.write(to: url, options: [.atomic])
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        #endif
    }

    public func delete() throws {
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        try FileManager.default.removeItem(at: url)
    }
}

/// Creates (once) and loads the app's 256-bit data key from the Keychain.
///
/// The key is marked "this device only" so it never syncs to iCloud Keychain or
/// migrates in a backup — copying the encrypted files elsewhere is useless without it.
public enum KeychainKeyProvider {
    public static func loadOrCreateKey(service: String, account: String = "data-key") throws -> SymmetricKey {
        if let existing = try load(service: service, account: account) {
            return existing
        }
        let key = SymmetricKey(size: .bits256)
        try store(key, service: service, account: account)
        return key
    }

    /// Removes the key. All encrypted data becomes permanently unreadable.
    public static func destroyKey(service: String, account: String = "data-key") {
        for useDataProtection in [true, false] {
            var query = baseQuery(service: service, account: account)
            if useDataProtection { query[kSecUseDataProtectionKeychain as String] = true }
            SecItemDelete(query as CFDictionary)
        }
    }

    private static func baseQuery(service: String, account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    private static func load(service: String, account: String) throws -> SymmetricKey? {
        // Prefer the modern data-protection keychain; fall back to the legacy macOS keychain
        // (needed when the app is ad-hoc signed without a team).
        for useDataProtection in [true, false] {
            var query = baseQuery(service: service, account: account)
            query[kSecReturnData as String] = true
            query[kSecMatchLimit as String] = kSecMatchLimitOne
            if useDataProtection { query[kSecUseDataProtectionKeychain as String] = true }

            var item: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &item)
            switch status {
            case errSecSuccess:
                guard let data = item as? Data, data.count == 32 else { throw SecureStorageError.corruptKey }
                return SymmetricKey(data: data)
            case errSecItemNotFound, errSecMissingEntitlement:
                continue
            default:
                throw SecureStorageError.keychain(status)
            }
        }
        return nil
    }

    private static func store(_ key: SymmetricKey, service: String, account: String) throws {
        let data = key.withUnsafeBytes { Data($0) }
        var lastStatus: OSStatus = errSecSuccess
        for useDataProtection in [true, false] {
            var query = baseQuery(service: service, account: account)
            query[kSecValueData as String] = data
            query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            query[kSecAttrSynchronizable as String] = false
            if useDataProtection { query[kSecUseDataProtectionKeychain as String] = true }

            lastStatus = SecItemAdd(query as CFDictionary, nil)
            if lastStatus == errSecSuccess { return }
            if lastStatus != errSecMissingEntitlement { break }
        }
        throw SecureStorageError.keychain(lastStatus)
    }
}
