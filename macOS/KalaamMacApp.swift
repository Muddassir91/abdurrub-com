import SwiftUI

@main
struct KalaamMacApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        Window("Kalaam", id: "main") {
            MacRootView()
                .environment(appDelegate.store)
                .environment(appDelegate.controller)
                .environment(appDelegate.macState)
        }
        .defaultSize(width: 980, height: 680)

        MenuBarExtra("Kalaam", systemImage: "waveform") {
            MenuBarContent(startHandsFree: { appDelegate.startHandsFree() })
                .environment(appDelegate.store)
        }
    }
}

struct MenuBarContent: View {
    @Environment(AppStore.self) private var store
    @Environment(\.openWindow) private var openWindow
    let startHandsFree: () -> Void

    var body: some View {
        Button("Start dictating (\(HotkeyPreset.preset(id: store.settings.hotkeyID).title))", action: startHandsFree)
        Button("Open Kalaam") {
            openWindow(id: "main")
            NSApp.activate()
        }
        Divider()
        Button("Quit Kalaam") { NSApp.terminate(nil) }
            .keyboardShortcut("q")
    }
}
