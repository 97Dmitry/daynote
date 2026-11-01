# Background reminders implementation plan

**Spec:** `docs/superpowers/specs/2026-11-02-background-reminders-design.md`, approved by user.

**Architecture:** Store owns task reminder definitions and durable notification receipts; Go app owns scheduling/close coordination; native desktop host owns tray/hooks/sound/autostart; renderer owns editable drafts/forms. Release reuses the exact checked artifact.

## Task 1 — Native desktop integration (worker-owned internal/desktop)

`desktop.Callbacks{Show,Hide,Quit,OpenNotifications func()}`; `desktop.Notice{Title,Body string; Sound bool}`. `Start(Callbacks)(*Host,error)`, `(*Host).AttachMainWindow()error`, `Notify(Notice)error`, `SetUnread(int)error`, `AllowQuit()`, `Close()error`; `MainWindowClass` const, `ShowExisting()bool`, `Supported` const, `AutostartEnabled()(bool,error)`, `SetAutostart(bool)error`.

- [x] Native predicates/command/layout tests RED, implement Windows host and non-Windows stubs, compile/run native tests in CI. Block only SC_KEYMENU with lp=0; preserve Alt+Space/Alt+Tab. Hook WM_CLOSE for renderer-coordinated hide, bypass via AllowQuit. Same-thread message loop owns tray resources and restores Explorer icon.

## Task 2 — Checked GitHub Releases (worker-owned .github)

- [x] fake-gh publication tests; build-N draft→upload→publish, EXE/full ZIP/checksums, exact artifact ID, required job gates, head/retry/concurrency checks. No real local release mutation; workflow runs after user-authorized source publication.

## Task 3 — Data and scheduler (root-owned internal/store, internal/reminders)

- [x] Add `Reminder{ID,Kind,At string;MinutesBefore int;Sound bool}`, `Task.Reminders`. Validate IDs/duplicates/time/range. Deep-copy slices.
- [x] Schema/backup v2; application migration from SQLite v1, old JSON v1 normalization; new notification receipt table with task FK cascade. Preserve transactions and reject future versions.
- [x] `Store.ClaimDue(time.Time)([]Notification,error)`, `Notifications()([]Notification,error)`, `Acknowledge(id string)error` (empty ID = all). Claim + durable inbox before external notification, deterministic due identity, 24h catch-up, skip done tasks. Import clears receipts atomically.
- [x] Tests relative/absolute/multiple/catch-up/restart/move/done/delete/import and invalid definitions; fake native sink verifies scheduling errors retain inbox.

## Task 4 — Lifecycle/UI integration (root-owned app*.go/main*.go/frontend)

- [x] App starts scheduler after native host is ready, refreshes unread state, groups simultaneous notices, reports shell errors. Stop/join before Store.Close.
- [x] Close requests have IDs and hide/quit intent; renderer flushes, preserves hide drafts, confirms quit modal cancellation, acknowledges exact request. Tray-only authority to request quit; voice stops on hide and cancels only on approved quit. Error restores window.
- [x] Main starts hidden until host/renderer readiness; normal startup shows, --background does not. Existing process is shown on second launch. Native startup failure keeps visible exit path.
- [x] Reminder rows in task editor, persistent notifications view/read markers/task navigation, autostart settings. Generate bindings via make bindings.
- [x] Go/React/browser regressions, make check, native Windows CI, final independent review and fixes.

## Task 5 — Delivery

- [x] Update concise module guidance, user docs and manual Windows checklist.
- [ ] Commit/push only scoped files, wait for checks and release job, download published assets and verify checksums. Automated evidence does not establish actual Alt/tray/sound/sign-in behavior on user's Windows.
