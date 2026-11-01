// Package stt defines PCM stream and transcription events for Gemini.
package stt

import "errors"

// Update kinds. A final closes its utterance; partial text may still change.
const (
	KindStarted = "started"
	KindPartial = "partial"
	KindFinal   = "final"
)

// ErrBackpressure means the frame was dropped because the worker is not keeping up.
var ErrBackpressure = errors.New("распознавание не успевает принимать звук")

// ErrUnconfirmed means bounded draining ended without a stream-wide completion
// acknowledgment. After Close and event draining, the consumer checks retained
// final/interim text to decide whether a review warning is needed.
var ErrUnconfirmed = errors.New("не получена окончательная расшифровка последней фразы: проверьте текст; доступный текст можно сохранить")

// Update is a transcript change for one utterance of one stream.
type Update struct {
	StreamID    string `json:"stream_id"`
	UtteranceID string `json:"utterance_id"`
	Revision    int    `json:"revision"`
	Kind        string `json:"kind"`
	StartSample int64  `json:"start_sample"`
	EndSample   int64  `json:"end_sample"`
	Text        string `json:"text"`
}

// StreamError ends one stream; the session stays usable.
type StreamError struct {
	StreamID string
	Message  string
}
