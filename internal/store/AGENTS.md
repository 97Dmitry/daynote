# Storage and backups

- Store owns the SQLite connection and an in-memory snapshot under one mutex. Apply changes to a clone, validate the whole graph, persist the difference in a transaction, then swap state. Never expose mutable internal slices.
- Notes survive task/topic deletion; note deletion removes task links. Manual positions are independent of pinned/date sorting. Move scope filters visible topic/pin peers.
- Restore validates version, dates, intervals and references before changing anything. App creates a local recovery export before import. Export is temp-write, sync, close, rename with a unique name; no live SQLite files in OneDrive.
- `go test -race ./internal/store` uses temporary databases, never user data.
