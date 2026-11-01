# Storage and backups

- Store owns the SQLite connection and an in-memory snapshot under one mutex. Apply changes to a clone, validate the whole graph, persist the difference in a transaction, then swap state. Never expose mutable internal slices.
- Notes survive task/topic deletion; note deletion removes task links. Manual positions are independent of pinned/date sorting. Move scope filters visible topic/pin peers.
- Restore validates version, dates, intervals and references before changing anything. App creates a local recovery export before import. Export is temp-write, sync, close, rename with a unique name; no live SQLite files in OneDrive.
- `go test -race ./internal/store` uses temporary databases, never user data.

- Schema and snapshots are version 3. Open migrates SQLite v1/v2 in application code; ParseBackup normalizes legacy v1/v2 JSON before validation. Unknown future versions must fail without replacing data.
- ClaimDue holds the store mutex and commits unique notification receipts before delivery. Deduplication includes task ID, reminder ID and computed UTC due instant. Inbox receipts are local runtime state, excluded from backups and cleared atomically by import. Task deletion cascades them.
- Recurring receipts also include original occurrence date. Keep the old single-task hash stable across migrations. Inverse reminder windows must account for large offsets and moved exceptions outside the original date range. Never enumerate a series from its beginning just to fetch a visible week.
