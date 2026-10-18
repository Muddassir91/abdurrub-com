import UIKit
import UniformTypeIdentifiers

enum Clipboard {
    /// Copies text that stays on this iPhone only (no Universal Clipboard to other devices)
    /// and is cleared automatically after `seconds`.
    static func copy(_ text: String, expiresAfter seconds: Int) {
        var options: [UIPasteboard.OptionsKey: Any] = [.localOnly: true]
        if seconds > 0 {
            options[.expirationDate] = Date().addingTimeInterval(TimeInterval(seconds))
        }
        UIPasteboard.general.setItems([[UTType.utf8PlainText.identifier: text]], options: options)
    }
}
