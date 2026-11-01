package main

import (
	"context"
	"errors"
	"github.com/97Dmitry/daynote/internal/desktop"
	"github.com/97Dmitry/daynote/internal/reminders"
	"github.com/97Dmitry/daynote/internal/store"
)

type desktopSink struct{ app *App }

func (s desktopSink) Notify(b reminders.Batch) error {
	s.app.mu.Lock()
	host := s.app.host
	s.app.mu.Unlock()
	if host == nil {
		return errors.New("системное уведомление недоступно; напоминание сохранено в списке")
	}
	return host.Notify(desktop.Notice{Title: b.Title, Body: b.Body, Sound: b.Sound})
}
func (s desktopSink) SetUnread(n int) error {
	s.app.mu.Lock()
	host := s.app.host
	s.app.mu.Unlock()
	if host == nil {
		return nil
	}
	err := host.SetUnread(n)
	if err != nil {
		s.app.mu.Lock()
		healthy := s.app.nativeHealthy
		s.app.mu.Unlock()
		if healthy {
			s.app.desktopFailure(err)
		}
	}
	return err
}
func (a *App) startScheduler() {
	a.mu.Lock()
	if a.scheduler != nil {
		a.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	service := reminders.New(a.data, desktopSink{a}, func(items []store.Notification, err error) {
		if err != nil {
			a.mu.Lock()
			a.settings.NotificationError = err.Error()
			a.mu.Unlock()
			a.emit("reminder:error", err.Error())
		}
		if items != nil {
			a.emit("notifications", items)
		}
	})
	a.scheduler = service
	a.schedulerCancel = cancel
	a.schedulerDone = done
	a.mu.Unlock()
	go func() { defer close(done); service.Run(ctx) }()
}
func (a *App) Notifications() ([]store.Notification, error) { return a.data.Notifications() }
func (a *App) AcknowledgeNotification(id string) ([]store.Notification, error) {
	if err := a.data.Acknowledge(id); err != nil {
		return nil, err
	}
	items, err := a.data.Notifications()
	if err != nil {
		return nil, err
	}
	count := 0
	for _, n := range items {
		if !n.Read {
			count++
		}
	}
	a.mu.Lock()
	host := a.host
	if count == 0 {
		a.settings.NotificationError = ""
	}
	a.mu.Unlock()
	if host != nil {
		if e := host.SetUnread(count); e != nil {
			a.emit("reminder:error", e.Error())
		}
	}
	a.emit("notifications", items)
	return items, nil
}
func (a *App) publishNotifications() {
	items, err := a.data.Notifications()
	if err == nil {
		a.emit("notifications", items)
	}
	a.mu.Lock()
	message := a.settings.NotificationError
	a.mu.Unlock()
	if message != "" {
		a.emit("reminder:error", message)
	}
}
func (a *App) openNotifications() { a.showWindow(); a.emit("notifications:open", true) }

func (a *App) wakeReminders() {
	a.mu.Lock()
	service := a.scheduler
	a.mu.Unlock()
	if service != nil {
		service.Wake()
	}
}
