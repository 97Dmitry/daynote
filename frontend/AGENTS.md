# Renderer invariants

- `api.ts` is the only Wails boundary. Browser tests inject a fake bridge; production never falls back to browser storage or sample notes.
- Editor drafts live in React/ref state. Serialize saves; flush before navigation/selection/close. A failed save keeps the current draft and stops navigation. Use current server state after a flush, not the pre-flush closure.
- Voice events are scoped by session ID. Only explicit insertion changes the initiating note. Modal drafts need a close confirmation.
- FullCalendar is v7: plugins under `@fullcalendar/react/*`, explicit theme CSS, `className`/`eventClass` (not v6 `classNames`); theme colors use `--fc-classic-*`. Native dates are local, serialized task instants use ISO UTC.
- `vp test run` runs React behavior tests; `vp exec playwright test` runs Chromium with a fake Wails bridge. Neither verifies Windows native capture or Credential Manager.

- Vite+ owns dev/build/test/lint/fmt. Do not add standalone Vite/Vitest/Prettier configurations or remove catalog overrides. Theme colors are semantic CSS tokens shared by menus, calendar and dialogs. Markdown renders through react-markdown + remark-gfm without raw HTML or automatic image requests.
