//go:build windows && !bindings

package main

import (
	"embed"
	"github.com/97Dmitry/daynote/internal/instance"
	"github.com/97Dmitry/daynote/internal/secrets"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"golang.org/x/sys/windows"
	"os"
	"path/filepath"
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
	release, err := instance.Acquire(filepath.Join(dir, "owner.lock"))
	if err != nil {
		message(err.Error())
		return
	}
	defer release()
	app, err := newApp(dir, secrets.NewCredentialManager())
	if err != nil {
		message("Не удалось открыть данные Daynote: " + err.Error())
		return
	}
	err = wails.Run(&options.App{Title: "Daynote", Width: 1380, Height: 880, MinWidth: 1000, MinHeight: 650, BackgroundColour: &options.RGBA{R: 247, G: 249, B: 252, A: 255}, AssetServer: &assetserver.Options{Assets: assets}, OnStartup: app.startup, OnShutdown: app.shutdown, OnBeforeClose: app.beforeClose, Bind: []interface{}{app}})
	if err != nil {
		message(err.Error())
	}
}
