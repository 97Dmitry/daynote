# Renderer invariants

- `api.ts` is the only Wails boundary. Browser tests inject a fake bridge; production never falls back to browser storage or sample notes.
- Editor drafts live in React/ref state. Serialize saves; flush before navigation/selection/close. A failed save keeps the current draft and stops navigation. Use current server state after a flush, not the pre-flush closure.
- Voice events are scoped by session ID. Only explicit insertion changes the initiating note. Modal drafts need a close confirmation.
- FullCalendar is v7: plugins under `@fullcalendar/react/*`, explicit theme CSS, `className`/`eventClass` (not v6 `classNames`); theme colors use `--fc-classic-*`. Native dates are local, serialized task instants use ISO UTC.
- `vp test run` runs React behavior tests; `vp exec playwright test` runs Chromium with a fake Wails bridge. Neither verifies Windows native capture or Credential Manager.

- Vite+ owns dev/build/test/lint/fmt. Do not add standalone Vite/Vitest/Prettier configurations or remove catalog overrides. Theme colors are semantic CSS tokens shared by menus, calendar and dialogs. Markdown renders through react-markdown + remark-gfm without raw HTML or automatic image requests.
- Calendar events come from Go Occurrences for the visible range; ignore stale responses. Event IDs identify instances, taskId identifies the series, date is the original date. Drag/resize recurring events through SaveException; never send an expanded interval to SaveTask. Inbox navigation carries occurrenceDate.
- Markdown source uses one CodeMirror view per note (keyed by note.id). Keep it mounted across preview toggles; external text updates are undoable transactions with an annotation to avoid onChange loops. Save formatting uses lazy Prettier Markdown only; preserve prose breaks and disable embedded code formatting. `flush(false)` is raw debounce autosave; explicit `flush()` must format even an already autosaved draft. Keep the signature check across async format/save to protect newer input.
