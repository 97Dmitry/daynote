# Renderer invariants

- `api.ts` is the only Wails boundary. Browser tests inject a fake bridge; production never falls back to browser storage or sample notes.
- Editor drafts live in React/ref state. Serialize saves; flush before navigation/selection/close. A failed save keeps the current draft and stops navigation. Use current server state after a flush, not the pre-flush closure.
- Voice events are scoped by session ID. Only explicit insertion changes the initiating note. Modal drafts need a close confirmation.
- FullCalendar is v7: plugins under `@fullcalendar/react/*`, explicit theme CSS, `className`/`eventClass` (not v6 `classNames`); theme colors use `--fc-classic-*`. Native dates are local, serialized task instants use ISO UTC.
- `pnpm test` runs React behavior tests; `pnpm test:browser` runs Chromium with a fake Wails bridge. Neither verifies Windows native capture or Credential Manager.
