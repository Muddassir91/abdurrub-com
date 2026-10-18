import Foundation

/// Maps the app you're dictating into to a style context (macOS knows the frontmost app).
public enum AppCategory {
    static let personal: Set<String> = [
        "com.apple.MobileSMS",
        "net.whatsapp.WhatsApp",
        "desktop.WhatsApp",
        "ru.keepcoder.Telegram",
        "org.telegram.desktop",
        "org.whispersystems.signal-desktop",
        "com.facebook.archon",
        "com.hnc.Discord",
    ]
    static let work: Set<String> = [
        "com.tinyspeck.slackmacgap",
        "com.microsoft.teams2",
        "com.microsoft.teams",
        "notion.id",
        "com.linear",
        "com.figma.Desktop",
        "com.atlassian.trello",
        "com.clickup.desktop-app",
    ]
    static let email: Set<String> = [
        "com.apple.mail",
        "com.microsoft.Outlook",
        "com.superhuman.electron",
        "com.readdle.smartemail-Mac",
        "com.readdle.SparkDesktop",
        "it.bloop.airmail2",
        "com.mimestream.Mimestream",
    ]

    public static func context(forBundleID bundleID: String?) -> StyleContext {
        guard let id = bundleID else { return .other }
        if personal.contains(id) { return .personal }
        if work.contains(id) { return .work }
        if email.contains(id) { return .email }
        return .other
    }
}
