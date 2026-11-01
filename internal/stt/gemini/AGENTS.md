# Gemini transport

- Derived from Solveo, authenticated through the header only; keys use `Daynote/stt-gemini`. Never echo raw vendor errors or credentials.
- Open verifies setupComplete before microphone capture. Mono PCM16 with native rate; bounded queue, visible backpressure. Drain Events continuously.
- Stop must Flush before Close. After PCM was queued, drain the complete bounded window even after an earlier final, so late phrases are retained. Flush returns stt.ErrUnconfirmed because there is no stream-wide acknowledgment. Controller evaluates retained utterance kinds after Close and event draining: warn for a pending interim or no nonempty final, not merely the missing stream acknowledgment. turnComplete alone never finalizes interim text. No reconnection/replay or finalization on socket close.
- `go test -race ./internal/stt/gemini` uses fake WebSockets only. Real API/model access and native-rate acceptance require explicit runtime testing.
