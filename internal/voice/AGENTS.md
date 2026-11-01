# Voice sessions

- One controller owns one microphone session. Capture callbacks must not block on network; Gemini has a bounded queue and reports dropped audio.
- Continuously drain provider events. Stop capture, Flush, Close, drain remaining events, then emit ready. Cancel discards the transcript and never flushes.
- Every renderer event carries the initiating session ID. Transcripts are drafts until the user inserts them into the initiating note. No audio persistence or automatic replay.
- Run `go test -race ./internal/voice ./internal/stt/gemini ./internal/audio`; no real provider or microphone in tests.
