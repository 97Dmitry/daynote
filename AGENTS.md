# Daynote engineering notes

- Windows x64 desktop app: Go/Wails v2 + React/TypeScript. Read the approved design in `docs/superpowers/specs/2026-11-02-daynote-design.md`.
- Go owns persisted state and validation. SQLite stays under LocalAppData; OneDrive receives versioned JSON snapshots only. Never point the working database at a cloud-sync folder.
- Note dates are calendar dates (`YYYY-MM-DD`); task intervals are absolute instants with explicit offsets. Pinned notes form a separate top group in every sort mode. Manual positions survive switching sorts.
- Gemini keys use the Daynote prefix in Windows Credential Manager. Never return keys to the renderer or include them in snapshots/logs. No raw audio persistence. No real provider requests in tests.
- Solveo is a read-only source for the narrow audio/STT/secret implementation; do not modify it or copy user data.
- Generate Wails bindings through `make bindings`, never by hand. Run `make check` before claiming a build works; Windows runtime/microphone acceptance is separate.
- Public source repository: do not commit build outputs, databases, backups, secrets, local settings or dependencies. Use pnpm and preserve its lockfile.
