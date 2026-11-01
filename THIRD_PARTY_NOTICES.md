# Third-party software

Daynote uses the dependencies pinned in `go.sum` and `frontend/pnpm-lock.yaml`.

Core components include Wails v2 (MIT), go-webview2 (MIT), React (MIT), Vite (MIT), FullCalendar standard plugins (MIT), Radix UI (MIT), Lucide (ISC), coder/websocket (ISC), modernc.org/sqlite (BSD-3-Clause), and golang.org/x/sys (BSD-3-Clause). No FullCalendar Premium plugins are used. The SQLite engine is in the public domain; the Go driver and its supporting packages have separate notices.

Redistributed build artifacts include a `licenses` directory generated from the installed Go and frontend dependency trees. Refer to those files for the full license texts and copyright notices. Dependency versions and notices are tied to each build.

The microphone capture, Gemini transport, and credential-store implementation originate from the author's Solveo project. No Solveo credentials, settings, audio, or note data are included.
