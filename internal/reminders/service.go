// Package reminders schedules local task reminders independently of renderer visibility.
package reminders

import (
	"context"
	"errors"
	"fmt"
	"github.com/97Dmitry/daynote/internal/store"
	"strings"
	"sync"
	"time"
)

type Batch struct {
	Title, Body string
	Sound       bool
}
type Sink interface {
	Notify(Batch) error
	SetUnread(int) error
}
type Service struct {
	mu      sync.Mutex
	data    *store.Store
	sink    Sink
	changed func([]store.Notification, error)
	wake    chan struct{}
}

func New(data *store.Store, sink Sink, changed func([]store.Notification, error)) *Service {
	return &Service{data: data, sink: sink, changed: changed, wake: make(chan struct{}, 1)}
}
func (s *Service) Wake() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}
func (s *Service) Run(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	_ = s.Tick(time.Now())
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_ = s.Tick(time.Now())
		case <-s.wake:
			_ = s.Tick(time.Now())
		}
	}
}
func (s *Service) Tick(now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	due, claimErr := s.data.ClaimDue(now)
	inbox, listErr := s.data.Notifications()
	errs := []error{claimErr, listErr}
	if listErr == nil {
		unread := 0
		for _, n := range inbox {
			if !n.Read {
				unread++
			}
		}
		errs = append(errs, s.sink.SetUnread(unread))
	}
	if len(due) > 0 {
		b := Batch{Title: due[0].TaskTitle}
		lines := []string{}
		if len(due) > 1 {
			b.Title = fmt.Sprintf("Напоминания: %d", len(due))
		}
		for i, n := range due {
			b.Sound = b.Sound || n.Sound
			if i < 4 {
				start, _ := time.Parse(time.RFC3339, n.TaskStart)
				lines = append(lines, n.TaskTitle+" — "+start.Local().Format("02.01 15:04"))
			}
		}
		b.Body = strings.Join(lines, "\n")
		errs = append(errs, s.sink.Notify(b))
	}
	err := errors.Join(errs...)
	if s.changed != nil {
		s.changed(inbox, err)
	}
	return err
}
