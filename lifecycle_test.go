package main

import (
	"context"
	"errors"
	"fmt"
	"github.com/97Dmitry/daynote/internal/secrets"
	"testing"
)

func TestCloseRequestSeparatesHideAndTrayQuit(t *testing.T) {
	a, err := newApp(t.TempDir(), secrets.NewMemory())
	if err != nil {
		t.Fatal(err)
	}
	defer a.shutdown(context.Background())
	hidden, quit, shown := 0, 0, 0
	a.hideWindow = func() { hidden++ }
	a.quitWindow = func() { quit++ }
	a.showWindow = func() { shown++ }
	a.mu.Lock()
	a.nativeHealthy = true
	a.rendererReady = true
	a.mu.Unlock()
	hide := a.requestClose(false)
	if err = a.CompleteClose(hide.ID); err != nil {
		t.Fatal(err)
	}
	if hidden != 1 || quit != 0 {
		t.Fatal("X must hide, not quit", hidden, quit)
	}
	stale := a.requestClose(false)
	exit := a.requestClose(true)
	if err = a.CompleteClose(stale.ID); err != nil {
		t.Fatal(err)
	}
	if quit != 0 {
		t.Fatal("stale request quit")
	}
	if err = a.CompleteClose(exit.ID); err != nil {
		t.Fatal(err)
	}
	if quit != 1 || shown == 0 {
		t.Fatal("tray quit did not finish", quit, shown)
	}
}
func TestCanceledQuitCannotLeakIntoLaterHide(t *testing.T) {
	a, err := newApp(t.TempDir(), secrets.NewMemory())
	if err != nil {
		t.Fatal(err)
	}
	defer a.shutdown(context.Background())
	hidden, quit := 0, 0
	a.hideWindow = func() { hidden++ }
	a.quitWindow = func() { quit++ }
	a.showWindow = func() {}
	a.mu.Lock()
	a.nativeHealthy = true
	a.rendererReady = true
	a.mu.Unlock()
	exit := a.requestClose(true)
	a.CancelClose(exit.ID)
	_ = a.CompleteClose(exit.ID)
	hide := a.requestClose(false)
	_ = a.CompleteClose(hide.ID)
	if hidden != 1 || quit != 0 {
		t.Fatal(hidden, quit)
	}
}

func TestDesktopFailureShowsWindowAndChangesCloseToExit(t *testing.T) {
	a, err := newApp(t.TempDir(), secrets.NewMemory())
	if err != nil {
		t.Fatal(err)
	}
	defer a.shutdown(context.Background())
	shown, hidden, quit := 0, 0, 0
	a.showWindow = func() { shown++ }
	a.hideWindow = func() { hidden++ }
	a.quitWindow = func() { quit++ }
	a.nativeHealthy, a.rendererReady = true, true
	a.desktopFailure(errors.New("tray unavailable"))
	if shown != 1 {
		t.Fatal("lost tray must reveal the window")
	}
	req := a.requestClose(false)
	if !req.Quit {
		t.Fatal("lost tray must permit normal exit")
	}
	_ = a.CompleteClose(req.ID)
	if hidden != 0 || quit != 1 {
		t.Fatal("window became inaccessible", hidden, quit)
	}
}

func TestRendererReadinessDoesNotFlashBackgroundWindow(t *testing.T) {
	for _, background := range []bool{false, true} {
		t.Run(fmt.Sprint(background), func(t *testing.T) {
			a, err := newApp(t.TempDir(), secrets.NewMemory())
			if err != nil {
				t.Fatal(err)
			}
			defer a.shutdown(context.Background())
			shown := 0
			a.showWindow = func() { shown++ }
			a.background, a.desktopInitialized = background, true
			a.RendererReady()
			a.RendererReady()
			want := 1
			if background {
				want = 0
			}
			if shown != want {
				t.Fatal("unexpected initial visibility", shown, want)
			}
		})
	}
}
