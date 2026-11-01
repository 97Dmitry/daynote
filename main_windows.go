//go:build windows && !bindings

package main

import (
	"context"
	"embed"
	"errors"
	"github.com/97Dmitry/daynote/internal/desktop"
	"github.com/97Dmitry/daynote/internal/instance"
	"github.com/97Dmitry/daynote/internal/secrets"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	windowopts "github.com/wailsapp/wails/v2/pkg/options/windows"
	"golang.org/x/sys/windows"
	"os"
	"path/filepath"
	"slices"
	"unsafe"
)

//go:embed all:frontend/dist
var assets embed.FS

func message(text string) {
	user32 := windows.NewLazySystemDLL("user32.dll")
	p, _ := windows.UTF16PtrFromString(text)
	title, _ := windows.UTF16PtrFromString("Daynote")
	_, _, _ = user32.NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(p)), uintptr(unsafe.Pointer(title)), 0x10)
}
func main() {
	dir := os.Getenv("LOCALAPPDATA")
	if dir == "" {
		message("Не найден каталог LOCALAPPDATA")
		return
	}
	dir = filepath.Join(dir, "Daynote")
	if err := os.MkdirAll(dir, 0700); err != nil {
		message(err.Error())
		return
	}
	background := slices.Contains(os.Args[1:], "--background")
	release, err := instance.Acquire(filepath.Join(dir, "owner.lock"))
	if err != nil {
		if errors.Is(err, windows.ERROR_SHARING_VIOLATION) {
			if background || desktop.ShowExisting() {
				return
			}
		}
		message(err.Error())
		return
	}
	defer release()
	app, err := newApp(dir, secrets.NewCredentialManager())
	if err != nil {
		message("Не удалось открыть данные Daynote: " + err.Error())
		return
	}
	app.background = background
	err = wails.Run(&options.App{Title: "Daynote", StartHidden: true, Windows: &windowopts.Options{WindowClassName: desktop.MainWindowClass, OnResume: app.wakeReminders}, OnDomReady: func(context.Context) {
		host, e := desktop.Start(desktop.Callbacks{Show: app.ShowWindow, Hide: func() { app.requestClose(false) }, Quit: func() { app.requestClose(true) }, OpenNotifications: app.openNotifications, Error: app.desktopFailure})
		if e == nil {
			e = host.AttachMainWindow()
			if e != nil {
				_ = host.Close()
				host = nil
			}
		}
		app.attachDesktop(host, e)
	}, Width: 1380, Height: 880, MinWidth: 1000, MinHeight: 650, BackgroundColour: &options.RGBA{R: 247, G: 249, B: 252, A: 255}, AssetServer: &assetserver.Options{Assets: assets}, OnStartup: app.startup, OnShutdown: app.shutdown, OnBeforeClose: app.beforeClose, Bind: []interface{}{app}})
	if err != nil {
		message(err.Error())
	}
}
