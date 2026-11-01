# Gemini transport

- Derived from Solveo, authenticated through the header only; keys use `Daynote/stt-gemini`. Never echo raw vendor errors or credentials.
- Open verifies setupComplete before microphone capture. Mono PCM16 with native rate; bounded queue, visible backpressure. Drain Events continuously.
- Stop must Flush before Close. After PCM was queued, Flush drains the complete bounded window and returns stt.ErrUnconfirmed: utterance finals/turnComplete do not correlate to audioStreamEnd. Controller exposes this as a review warning while preserving available text. No reconnection/replay and no finalization merely on socket close.
- `go test -race ./internal/stt/gemini` uses fake WebSockets only. Real API/model access and native-rate acceptance require explicit runtime testing.
