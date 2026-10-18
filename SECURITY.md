# Security and privacy

Kalaam handles two sensitive things: your **voice** and what you **say** (messages, emails, addresses in snippets). The design goal is that neither can leave your device, and what's stored on it is unreadable to anyone else.

## Threat model

| Threat | Mitigation |
|---|---|
| Audio or text sent to a server | No networking code. The Mac app is sandboxed **without** `network.client`/`network.server`, so macOS blocks every connection. Speech recognition (`SpeechAnalyzer`) and AI polish (`FoundationModels`) run on-device; their models are downloaded by the OS, not by Kalaam. |
| Compromised dependency (supply chain) | Zero third-party packages. Only Apple frameworks. CI actions pinned to commit SHAs; CI token is read-only. |
| Someone copies the data files (backup, stolen disk, another app) | History, snippets and dictionary are AES-256-GCM encrypted. The key lives in the Keychain as `AfterFirstUnlockThisDeviceOnly`: not synced to iCloud, not in backups, so copied files can't be decrypted elsewhere. GCM is authenticated: tampered files fail to open rather than load altered data. On iPhone, files also get `NSFileProtectionComplete` (unreadable while locked). On Mac, files are `0600` inside the sandbox container. |
| Recordings lingering on disk | Audio is never written to disk. It's streamed from memory to the speech engine and discarded. |
| Clipboard leaks | Mac: pasted text is marked `org.nspasteboard.ConcealedType`/`TransientType` so clipboard managers skip it, and your previous clipboard is restored. iPhone: copied text is `localOnly` (no Universal Clipboard to other devices) and expires (5 min by default). |
| Keylogging / over-broad permissions | The Mac hotkey uses `RegisterEventHotKey`, which sees only its own shortcut, not your typing, and needs no Input Monitoring permission. Pasting uses the narrow "post events" permission (`CGRequestPostEventAccess`) instead of full Accessibility control. Esc is grabbed only while recording. |
| Microphone left on | Recording only while the shortcut is active. Hands-free sessions auto-stop after 10 minutes. The pill (Mac) and the record button (iPhone) always show when it's listening. |
| Prompt injection via dictated text ("ignore previous instructions…") | The on-device model gets the transcript wrapped in tags with instructions to treat it as text only. Output then passes `RewriteGuard`: chatty replies, large length changes or empty output are rejected and the deterministic cleanup is used instead. The model has no tools and no access to anything else. |
| Malicious or accidental regex in snippets/dictionary | User text is always escaped (`escapedPattern`/`escapedTemplate`), so it's matched literally. Inputs are length- and count-limited. Transcripts are capped at 20,000 characters. |
| Corrupted or undecryptable data overwritten | If stored data can't be decrypted, the app goes read-only and shows a warning instead of overwriting it. "Erase all data" is an explicit, confirmed action that deletes files and destroys the key. |
| Data kept longer than needed | History retention is configurable (default 30 days; "Don't save" available). "Clear history" and "Erase all data" in Settings. |
| Logging sensitive content | Kalaam doesn't log transcripts. No analytics, crash reporters or telemetry. |
| Hard-coded secrets / personal IDs in the repo | There are no secrets. Your Apple Team ID lives in the git-ignored `Config/Local.xcconfig`. |

## Platform hardening

- **Mac:** App Sandbox, Hardened Runtime, entitlements limited to the microphone.
- **iPhone:** no entitlements beyond the defaults; no URL schemes (no externally triggerable entry points other than the system Shortcuts intent, which only opens the app and starts listening visibly).
- `PrivacyInfo.xcprivacy` declares no tracking and no collected data.

## Reporting

This is a personal project. If you find a problem, open a private issue or contact the owner directly rather than posting details publicly.
