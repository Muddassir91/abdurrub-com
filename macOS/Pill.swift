import AppKit
import Observation
import SwiftUI

/// The small floating pill above the Dock. It never takes focus, so the app you're typing
/// into stays active and receives the paste.
final class PillPanel: NSPanel {
    init() {
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: 44, height: 10),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        isFloatingPanel = true
        level = .statusBar
        backgroundColor = .clear
        isOpaque = false
        hasShadow = false
        hidesOnDeactivate = false
        becomesKeyOnlyIfNeeded = true
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

@MainActor
final class PillController {
    private let panel = PillPanel()
    private let controller: DictationController
    private let store: AppStore

    init(controller: DictationController, store: AppStore, onTapIdle: @escaping () -> Void) {
        self.controller = controller
        self.store = store
        let view = PillView(
            controller: controller,
            onTapIdle: onTapIdle,
            onCancel: { controller.cancel() },
            onConfirm: { Task { await controller.stopAndProcess() } }
        )
        let hosting = NSHostingView(rootView: view)
        hosting.sizingOptions = []
        panel.contentView = hosting
        update()
        observe()
    }

    private func observe() {
        withObservationTracking {
            _ = controller.phase
            _ = store.settings.showIdlePill
        } onChange: { [weak self] in
            Task { @MainActor in
                self?.update()
                self?.observe()
            }
        }
    }

    private func update() {
        let phase = controller.phase
        if phase == .idle, !store.settings.showIdlePill {
            panel.orderOut(nil)
            return
        }
        let size = Self.size(for: phase)
        guard let screen = NSScreen.main else { return }
        let visible = screen.visibleFrame
        let frame = NSRect(x: visible.midX - size.width / 2, y: visible.minY + 10, width: size.width, height: size.height)
        panel.setFrame(frame, display: true, animate: false)
        panel.orderFrontRegardless()
    }

    static func size(for phase: DictationController.Phase) -> NSSize {
        switch phase {
        case .idle: NSSize(width: 44, height: 10)
        case .recording(handsFree: false), .transcribing: NSSize(width: 76, height: 30)
        case .recording(handsFree: true): NSSize(width: 124, height: 30)
        case .failed: NSSize(width: 360, height: 34)
        }
    }
}

struct PillView: View {
    let controller: DictationController
    let onTapIdle: () -> Void
    let onCancel: () -> Void
    let onConfirm: () -> Void

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .animation(.spring(duration: 0.25), value: controller.phase)
    }

    @ViewBuilder
    private var content: some View {
        switch controller.phase {
        case .idle:
            Capsule()
                .fill(.black.opacity(0.7))
                .overlay(Capsule().stroke(.white.opacity(0.35), lineWidth: 0.5))
                .padding(1)
                .onTapGesture(perform: onTapIdle)
                .help("Click to dictate hands-free")

        case .recording(let handsFree):
            HStack(spacing: 8) {
                if handsFree {
                    circleButton("xmark", background: .white.opacity(0.25), foreground: .white, action: onCancel)
                        .help("Cancel (Esc)")
                }
                Waveform(levels: controller.levels)
                if handsFree {
                    circleButton("checkmark", background: .white, foreground: .black, action: onConfirm)
                        .help("Finish and paste")
                }
            }
            .padding(.horizontal, 6)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Capsule().fill(.black))

        case .transcribing:
            ProgressView()
                .controlSize(.small)
                .tint(.white)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Capsule().fill(.black))

        case .failed(let message):
            Text(message)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.white)
                .lineLimit(1)
                .padding(.horizontal, 12)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Capsule().fill(.black))
                .overlay(Capsule().stroke(.red, lineWidth: 1.5))
        }
    }

    private func circleButton(_ symbol: String, background: Color, foreground: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(foreground)
                .frame(width: 18, height: 18)
                .background(Circle().fill(background))
        }
        .buttonStyle(.plain)
    }
}

/// Ten 2-pt bars that follow your voice.
struct Waveform: View {
    let levels: [Float]

    var body: some View {
        HStack(spacing: 2) {
            ForEach(levels.indices, id: \.self) { index in
                Capsule()
                    .fill(.white)
                    .frame(width: 2, height: 2 + CGFloat(levels[index]) * 14)
            }
        }
        .frame(height: 16)
        .animation(.linear(duration: 0.08), value: levels)
    }
}
