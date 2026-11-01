# Daynote engineering notes

- Windows x64 desktop app: Go/Wails v2 + React/TypeScript. Read the approved design in `docs/superpowers/specs/2026-11-02-daynote-design.md`.
- Go owns persisted state and validation. SQLite stays under LocalAppData; OneDrive receives versioned JSON snapshots only. Never point the working database at a cloud-sync folder.
- Note dates are calendar dates (`YYYY-MM-DD`); task intervals are absolute instants with explicit offsets. Pinned notes form a separate top group in every sort mode. Manual positions survive switching sorts.
- Gemini keys use the Daynote prefix in Windows Credential Manager. Never return keys to the renderer or include them in snapshots/logs. No raw audio persistence. No real provider requests in tests.
- Solveo is a read-only source for the narrow audio/STT/secret implementation; do not modify it or copy user data.
- Generate Wails bindings through `make bindings`, never by hand. Run `make check` before claiming a build works; Windows runtime/microphone acceptance is separate.
- Public source repository: do not commit build outputs, databases, backups, secrets, local settings or dependencies. Use Vite+ (`vp`) with pnpm and preserve frontend/pnpm-lock.yaml and pnpm-workspace.yaml.

- Theme is a Go preference (system/light/dark) persisted together with backupFolder. Renderer localStorage caches only this UI preference for first paint, never notes. Keep generated Wails files excluded from Vite+ format/lint.

- Background lifecycle: X/Alt+F4 requests a renderer save handshake, then hides; only tray Quit requests exit. Preserve modal drafts on hide and show the window on persistence/native-tray failure. Keep taskbar/Alt+Tab styles intact. See `docs/superpowers/specs/2026-11-02-background-reminders-design.md`.
- Reminder receipts are persisted before shell delivery. Schema/backup v2 accepts v1 JSON; imports atomically clear runtime notification receipts. Catch-up is a rolling 24-hour window; never add raw receipt history to backups.
- Autostart writes only the current user's Daynote Run value on an explicit settings action. Do not mutate a real user's registry from agent checks. Releases publish the exact CI artifact after both jobs pass; verify remote publication and checksums before reporting a release.
