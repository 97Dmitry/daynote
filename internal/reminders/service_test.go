package reminders

import (
	"errors"
	"github.com/97Dmitry/daynote/internal/store"
	"path/filepath"
	"testing"
	"time"
)

type fakeSink struct {
	calls  int
	unread int
	fail   bool
	last   Batch
}

func (s *fakeSink) Notify(b Batch) error {
	s.calls++
	s.last = b
	if s.fail {
		return errors.New("shell unavailable")
	}
	return nil
}
func (s *fakeSink) SetUnread(n int) error { s.unread = n; return nil }
func TestSchedulerKeepsInboxOnShellFailureAndDoesNotReplay(t *testing.T) {
	data, err := store.Open(filepath.Join(t.TempDir(), "data.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer data.Close()
	now := time.Date(2026, 11, 2, 9, 0, 0, 0, time.UTC)
	for _, id := range []string{"a", "b"} {
		_, err = data.SaveTask(store.Task{Title: id, Start: "2026-11-02T09:30:00Z", End: "2026-11-02T10:00:00Z", Reminders: []store.Reminder{{ID: id, Kind: "before", MinutesBefore: 30, Sound: id == "a"}}})
		if err != nil {
			t.Fatal(err)
		}
	}
	sink := &fakeSink{fail: true}
	service := New(data, sink, nil)
	if err = service.Tick(now); err == nil {
		t.Fatal("shell error hidden")
	}
	inbox, _ := data.Notifications()
	if len(inbox) != 2 || sink.calls != 1 || !sink.last.Sound || sink.unread != 2 {
		t.Fatal(inbox, sink)
	}
	sink.fail = false
	if err = service.Tick(now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if sink.calls != 1 {
		t.Fatal("replayed notification after failed shell delivery")
	}
	_ = data.Acknowledge("")
	if err = service.Tick(now.Add(2 * time.Second)); err != nil {
		t.Fatal(err)
	}
	if sink.unread != 0 {
		t.Fatal("badge not cleared")
	}
}
