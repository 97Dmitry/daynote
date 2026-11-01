package main

import (
	"context"
	"crypto/rand"
	"errors"
	"github.com/97Dmitry/daynote/internal/desktop"
)

type CloseRequest struct {
	ID   string `json:"id"`
	Quit bool   `json:"quit"`
}

func (a *App) context() context.Context { a.mu.Lock(); defer a.mu.Unlock(); return a.ctx }
func (a *App) ShowWindow()              { a.showWindow() }

// Only native callbacks create quit requests. The renderer can acknowledge a
// particular request, but cannot turn an ordinary window close into process exit.
func (a *App) requestClose(quit bool) CloseRequest {
	a.mu.Lock()
	if !a.nativeHealthy {
		quit = true
	}
	req := CloseRequest{ID: rand.Text(), Quit: quit}
	a.pendingClose = req
	ready := a.rendererReady
	a.mu.Unlock()
	if quit {
		a.showWindow()
	}
	if ready {
		a.emit("app:closing", req)
	} else {
		_ = a.CompleteClose(req.ID)
	}
	return req
}
func (a *App) CancelClose(id string) {
	a.mu.Lock()
	if a.pendingClose.ID == id {
		a.pendingClose = CloseRequest{}
	}
	a.mu.Unlock()
}
func (a *App) CompleteClose(id string) error {
	a.closeOperation.Lock()
	defer a.closeOperation.Unlock()
	a.mu.Lock()
	req := a.pendingClose
	a.mu.Unlock()
	if id == "" || req.ID != id {
		return nil
	}
	if req.Quit {
		a.voice.Cancel()
	} else {
		_ = a.voice.Stop()
	}
	a.mu.Lock()
	if a.pendingClose.ID != id {
		a.mu.Unlock()
		return nil
	}
	a.pendingClose = CloseRequest{}
	host := a.host
	a.mu.Unlock()
	if req.Quit {
		a.allowClose.Store(true)
		if host != nil {
			host.AllowQuit()
		}
		a.quitWindow()
	} else {
		a.hideWindow()
	}
	return nil
}
func (a *App) RendererReady() {
	a.mu.Lock()
	first := !a.rendererReady
	a.rendererReady = true
	show := first && a.desktopInitialized && !a.background
	a.mu.Unlock()
	if show {
		a.showWindow()
	}
	a.publishNotifications()
}
func (a *App) attachDesktop(host *desktop.Host, err error) {
	a.mu.Lock()
	a.host = host
	a.desktopInitialized = true
	a.nativeHealthy = host != nil && err == nil
	show := a.rendererReady && !a.background
	a.mu.Unlock()
	if err != nil {
		a.desktopFailure(err)
	} else if show {
		a.showWindow()
	}
	a.startScheduler()
}
func (a *App) desktopFailure(err error) {
	if err == nil {
		err = errors.New("трей недоступен")
	}
	a.mu.Lock()
	a.nativeHealthy = false
	a.settings.NotificationError = "Интеграция Windows: " + err.Error()
	a.mu.Unlock()
	a.showWindow()
	a.emit("desktop:error", err.Error())
}
