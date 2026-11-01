//go:build windows && !bindings

package main

import (
	"embed"
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
	name, _ := windows.UTF16PtrFromString(`Local\Daynote.Desktop`)
	mutex, err := windows.CreateMutex(nil, false, name)
	if err != nil {
		if err == windows.ERROR_ALREADY_EXISTS {
			if mutex != 0 {
				_ = windows.CloseHandle(mutex)
			}
			message("Daynote уже запущен. Откройте его окно на панели задач.")
			return
		}
		message(err.Error())
		return
	}
	defer windows.CloseHandle(mutex)
	dir := os.Getenv("LOCALAPPDATA")
	if dir == "" {
		message("Не найден каталог LOCALAPPDATA")
		return
	}
	app, err := newApp(filepath.Join(dir, "Daynote"), secrets.NewCredentialManager())
	if err != nil {
		message("Не удалось открыть данные Daynote: " + err.Error())
		return
	}
	err = wails.Run(&options.App{Title: "Daynote", Width: 1380, Height: 880, MinWidth: 1000, MinHeight: 650, BackgroundColour: &options.RGBA{R: 247, G: 249, B: 252, A: 255}, AssetServer: &assetserver.Options{Assets: assets}, OnStartup: app.startup, OnShutdown: app.shutdown, OnBeforeClose: app.beforeClose, Bind: []interface{}{app}})
	if err != nil {
		message(err.Error())
	}
}
