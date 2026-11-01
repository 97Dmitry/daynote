package voice

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/97Dmitry/daynote/internal/audio"
	"github.com/97Dmitry/daynote/internal/stt"
	"sync"
	"testing"
)

type fakeSession struct {
	events       chan any
	mu           sync.Mutex
	flushed      bool
	flushErr     error
	flushKind    string
	flushUpdates []stt.Update
	closeUpdates []stt.Update
}

func (f *fakeSession) Open(context.Context, string, string, []string) error { return nil }
func (f *fakeSession) Push(string, int, int, []float32) error               { return nil }
func (f *fakeSession) Flush(context.Context, string) error {
	f.mu.Lock()
	f.flushed = true
	f.mu.Unlock()
	kind := f.flushKind
	if kind == "" {
		kind = stt.KindFinal
	}
	updates := f.flushUpdates
	if updates == nil {
		updates = []stt.Update{{UtteranceID: "u", Kind: kind, Text: "Последняя фраза"}}
	}
	for _, update := range updates {
		f.events <- update
	}
	return f.flushErr
}
func (f *fakeSession) CloseStream(string) error { return nil }
func (f *fakeSession) Events() <-chan any       { return f.events }
func (f *fakeSession) Close() error {
	for _, update := range f.closeUpdates {
		f.events <- update
	}
	close(f.events)
	return nil
}

type fakeProvider struct{ s *fakeSession }

func (p fakeProvider) Describe() stt.Description                                   { return stt.Description{} }
func (p fakeProvider) Status(context.Context) []stt.Check                          { return nil }
func (p fakeProvider) Prepare(context.Context, func(string)) error                 { return nil }
func (p fakeProvider) Start(context.Context, func(string)) (stt.SessionAPI, error) { return p.s, nil }
func (p fakeProvider) Stop(context.Context) error                                  { return nil }

type fakeCapture struct{}

func (fakeCapture) Start(context.Context, audio.Source, func(audio.Frame), func(error)) (audio.Device, func(), error) {
	return audio.Device{Name: "test"}, func() {}, nil
}
func TestStopIncludesLastFinalAndCancelDiscards(t *testing.T) {
	s := &fakeSession{events: make(chan any, 8)}
	var mu sync.Mutex
	var latest Event
	c := New(fakeProvider{s}, fakeCapture{}, func(e Event) { mu.Lock(); latest = e; mu.Unlock() })
	if err := c.Start("session-1"); err != nil {
		t.Fatal(err)
	}
	if err := c.Start("session-2"); err == nil {
		t.Fatal("second capture started")
	}
	if err := c.Stop(); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	got := latest
	mu.Unlock()
	if got.Text != "Последняя фраза" || got.State != "ready" || got.SessionID != "session-1" || got.Warning != "" || got.Error != "" {
		t.Fatal(got)
	}
	s = &fakeSession{events: make(chan any, 8)}
	c = New(fakeProvider{s}, fakeCapture{}, func(e Event) { mu.Lock(); latest = e; mu.Unlock() })
	if err := c.Start("cancel"); err != nil {
		t.Fatal(err)
	}
	c.Cancel()
	mu.Lock()
	got = latest
	mu.Unlock()
	if got.Text != "" || got.State != "cancelled" {
		t.Fatal(got)
	}
	if s.flushed {
		t.Fatal("cancel flushed audio")
	}
}

func TestUnconfirmedStopPreservesTextAndShowsReviewWarning(t *testing.T) {
	s := &fakeSession{events: make(chan any, 8), flushErr: stt.ErrUnconfirmed, flushKind: stt.KindPartial}
	var mu sync.Mutex
	var latest Event
	c := New(fakeProvider{s}, fakeCapture{}, func(e Event) { mu.Lock(); latest = e; mu.Unlock() })
	if err := c.Start("review"); err != nil {
		t.Fatal(err)
	}
	if err := c.Stop(); err != nil {
		t.Fatal("review warning prevented use of available text", err)
	}
	mu.Lock()
	got := latest
	mu.Unlock()
	b, _ := json.Marshal(got)
	var fields map[string]any
	_ = json.Unmarshal(b, &fields)
	warning, _ := fields["warning"].(string)
	if got.Text != "Последняя фраза" || got.Error != "" || warning == "" {
		t.Fatal("missing preserved draft/review warning", got)
	}
}

func TestStopReviewsTranscriptAfterDrainingEvents(t *testing.T) {
	final := stt.Update{UtteranceID: "one", Kind: stt.KindFinal, Text: "Первая фраза"}
	partial := stt.Update{UtteranceID: "two", Kind: stt.KindPartial, Text: "Последняя фра"}
	last := stt.Update{UtteranceID: "two", Kind: stt.KindFinal, Text: "Последняя фраза"}
	for _, tt := range []struct {
		name                     string
		beforeClose, duringClose []stt.Update
		text                     string
		warning                  bool
	}{
		{"all received phrases are final", []stt.Update{final, last}, nil, "Первая фраза\nПоследняя фраза", false},
		{"last final arrives during close", []stt.Update{final, partial}, []stt.Update{last}, "Первая фраза\nПоследняя фраза", false},
		{"late interim after earlier final", []stt.Update{final}, []stt.Update{partial}, "Первая фраза\nПоследняя фра", true},
		{"partial without final", []stt.Update{partial}, nil, "Последняя фра", true},
		{"no transcript received", []stt.Update{}, nil, "", true},
		{"final for another utterance", []stt.Update{partial, final}, nil, "Последняя фра\nПервая фраза", true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			s := &fakeSession{events: make(chan any, 8), flushErr: stt.ErrUnconfirmed, flushUpdates: tt.beforeClose, closeUpdates: tt.duringClose}
			var mu sync.Mutex
			var latest Event
			c := New(fakeProvider{s}, fakeCapture{}, func(e Event) { mu.Lock(); latest = e; mu.Unlock() })
			if err := c.Start("review"); err != nil {
				t.Fatal(err)
			}
			if err := c.Stop(); err != nil {
				t.Fatal(err)
			}
			mu.Lock()
			got := latest
			mu.Unlock()
			if got.Text != tt.text || got.State != "ready" || got.Error != "" || (got.Warning != "") != tt.warning {
				t.Fatal("incorrect final transcript/review status", got)
			}
		})
	}
}

func TestStopKeepsRealFailureEvenWithFinalText(t *testing.T) {
	failure := errors.New("connection lost")
	s := &fakeSession{events: make(chan any, 8), flushErr: failure}
	var mu sync.Mutex
	var latest Event
	c := New(fakeProvider{s}, fakeCapture{}, func(e Event) { mu.Lock(); latest = e; mu.Unlock() })
	if err := c.Start("failure"); err != nil {
		t.Fatal(err)
	}
	if err := c.Stop(); !errors.Is(err, failure) {
		t.Fatal("real error was suppressed", err)
	}
	mu.Lock()
	got := latest
	mu.Unlock()
	if got.Error != failure.Error() || got.Text != "Последняя фраза" {
		t.Fatal(got)
	}
}
