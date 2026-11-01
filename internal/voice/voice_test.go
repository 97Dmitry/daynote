package voice

import (
	"context"
	"github.com/97Dmitry/daynote/internal/audio"
	"github.com/97Dmitry/daynote/internal/stt"
	"sync"
	"testing"
)

type fakeSession struct {
	events  chan any
	mu      sync.Mutex
	flushed bool
}

func (f *fakeSession) Open(context.Context, string, string, []string) error { return nil }
func (f *fakeSession) Push(string, int, int, []float32) error               { return nil }
func (f *fakeSession) Flush(context.Context, string) error {
	f.mu.Lock()
	f.flushed = true
	f.mu.Unlock()
	f.events <- stt.Update{UtteranceID: "u", Kind: stt.KindFinal, Text: "Последняя фраза"}
	return nil
}
func (f *fakeSession) CloseStream(string) error { return nil }
func (f *fakeSession) Events() <-chan any       { return f.events }
func (f *fakeSession) Close() error             { close(f.events); return nil }

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
	if got.Text != "Последняя фраза" || got.State != "ready" || got.SessionID != "session-1" {
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
