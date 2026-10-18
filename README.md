# Kalaam

Private voice dictation for your Mac and iPhone. Hold a shortcut, talk, let go, and clean text appears in whatever app you're using.

Built as a personal, from-scratch alternative to subscription dictation apps. It's inspired by how those apps *feel* to use; none of their code, name, logo or sounds are used.

- **No subscription, no API keys, no accounts.** Speech recognition and AI cleanup use Apple's on-device engines, which come free with macOS 26 and iOS 26.
- **Nothing leaves your device.** The Mac app is sandboxed *without* network permission, so macOS itself blocks it from going online.
- **Encrypted at rest.** History, snippets and your dictionary are AES-256-GCM encrypted with a device-only Keychain key.
- **Zero third-party dependencies.** Nothing to get hijacked in a supply-chain attack.

See [SECURITY.md](SECURITY.md) for the full threat model.

## What it does

| | Mac (MacBook, Mac mini) | iPhone |
|---|---|---|
| Start dictating | Hold **⌃L** anywhere (configurable) | Action Button, Siri ("Dictate with Kalaam"), or the big mic button |
| Push-to-talk | Hold > 0.5 s, release to paste | — |
| Hands-free | Tap once, tap again to finish. **Esc** cancels | Stops when you pause, or tap to finish |
| Where text goes | Typed into the app you're in | Copied (stays on the iPhone, auto-clears after 5 min) |
| Floating pill | Above the Dock: waveform, ✕ / ✓ in hands-free | — |
| Writing styles | Formal / Casual / very casual / Excited, per app type (chat, work, email) | Same styles |
| Cleanup | Removes "um/uh", handles "no wait…" and "scratch that", "new line", "new paragraph" | Same |
| AI polish (optional) | On-device Apple Intelligence | Same |
| Snippets | Say "my email" → your full address | Same |
| Dictionary | "cloud code" → "Claude Code" | Same |
| History & stats | Search, copy, words, WPM, streak | Same |

## Requirements

- **Xcode 26** on one of your Macs (free from the Mac App Store).
- **macOS 26** on the MacBook and Mac mini; **iOS 26** on the iPhone.
- AI polish needs Apple Intelligence (Apple silicon Mac, iPhone 15 Pro or newer) and is optional. Everything else works without it.
- A free Apple ID. See [Signing and the 7-day limit](#signing-and-the-7-day-limit) below.

## Setup (about 10 minutes)

```bash
git clone <this repo> kalaam && cd kalaam
make setup        # installs XcodeGen via Homebrew, creates Config/Local.xcconfig
```

1. Open `Config/Local.xcconfig` and set `DEVELOPMENT_TEAM` to your Team ID (Xcode → Settings → Accounts → your Apple ID). If Xcode later says the bundle ID is taken, change `BUNDLE_ID_PREFIX`.
2. `make open` generates and opens `Kalaam.xcodeproj`.

### Install on a Mac (do this on both the MacBook and the Mac mini)

1. In Xcode, pick the **KalaamMac** scheme and **My Mac**, then press **⌘R**.
2. Allow **Microphone** when asked.
3. Click **Allow** next to **Paste into apps** on the Home screen and switch Kalaam on in System Settings. Without this, text is copied and you paste it with ⌘V yourself.
4. Optional: **Settings → Open Kalaam at login**.
5. Hold **⌃L** in any app and talk.

To keep a copy that runs without Xcode: **Product → Archive → Distribute App → Custom → Copy App**, then drag Kalaam into `/Applications`.

### Install on the iPhone

1. Connect the iPhone with a cable. On the iPhone: **Settings → Privacy & Security → Developer Mode → On** (it restarts).
2. In Xcode, pick the **KalaamiOS** scheme and your iPhone, then press **⌘R**.
3. First launch only: **Settings → General → VPN & Device Management → (your Apple ID) → Trust**.
4. Set up one-press dictation: **Settings → Action Button → Shortcut → Kalaam → Start Dictation**.

### Signing and the 7-day limit

With a **free** Apple ID, Mac apps you build keep working. iPhone apps you build expire after **7 days**; plug the phone in and press ⌘R again to renew. That's the free route.

An Apple Developer Program membership ($99/year) removes the 7-day limit. It's optional and Apple's fee, not this app's. Nothing in Kalaam requires it.

## How it works

```
 Mac: ⌃L (Carbon hotkey) ─┐
 iPhone: button / Action ─┤
                          ▼
          AVAudioEngine (mic, in memory only)
                          ▼
          SpeechAnalyzer (Apple, on-device)
                          ▼
     KalaamKit: dictionary → cleanup → [AI polish] → style → snippets
                          ▼
 Mac: concealed clipboard + ⌘V, old clipboard restored
 iPhone: local-only clipboard with expiry
```

```
Packages/KalaamKit/   Pure Swift logic + unit tests: cleanup, styles, snippets, hotkey
                      gesture state machine, stats, AES-GCM storage, Keychain key
Shared/               Code used by both apps: audio, speech engine, AI polish,
                      encrypted store, dictation controller, SwiftUI screens
macOS/                Hotkey, floating pill, paste, Mac screens, sandbox entitlements
iOS/                  iPhone screens, Action Button / Siri intent, clipboard
project.yml           XcodeGen spec (the .xcodeproj is generated, not committed)
```

## Development

```bash
make test        # unit tests for KalaamKit
make build-mac   # compile the Mac app without signing
make build-ios   # compile the iPhone app without signing
```

CI runs all three on every push (`.github/workflows/ci.yml`).

## Languages

Kalaam uses whatever languages Apple's on-device speech engine supports; open **Settings → Language** to see the list on your device. Writing styles are tuned for English.

## Known limits

- **iPhone can't type into other apps directly.** iOS doesn't let apps paste into other apps, and keyboard extensions can't use the microphone, so on iPhone the text is copied for you to paste. A custom keyboard that inserts your latest dictation is a possible next step; it needs the paid developer account (App Groups).
- **AI polish** may occasionally leave text unchanged: if the on-device model's output doesn't look like a faithful edit, Kalaam falls back to the rule-based cleanup on purpose.
- Mac shortcuts are chosen from a preset list. Fn/Globe can't be used as a shortcut without extra permissions Kalaam avoids on purpose.
