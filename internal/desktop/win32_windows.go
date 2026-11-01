//go:build windows

package desktop

import (
	_ "embed"
	"fmt"
	"runtime"
	"strings"
	"syscall"
	"unicode/utf16"
	"unsafe"
)

const Supported = true

const (
	wmClose     = 0x10
	wmDestroy   = 2
	wmNCDestroy = 0x82
	wmTray      = 0x8001
	wmWork      = 0x8002
	nimAdd      = 0
	nimModify   = 1
	nimDelete   = 2
	nifMessage  = 1
	nifIcon     = 2
	nifTip      = 4
	nifInfo     = 0x10
)

var (
	user32           = syscall.NewLazyDLL("user32.dll")
	kernel32         = syscall.NewLazyDLL("kernel32.dll")
	shell32          = syscall.NewLazyDLL("shell32.dll")
	defWindowProc    = user32.NewProc("DefWindowProcW")
	postMessage      = user32.NewProc("PostMessageW")
	createWindow     = user32.NewProc("CreateWindowExW")
	destroyWindow    = user32.NewProc("DestroyWindow")
	getMessage       = user32.NewProc("GetMessageW")
	translateMessage = user32.NewProc("TranslateMessage")
	dispatchMessage  = user32.NewProc("DispatchMessageW")
	postQuit         = user32.NewProc("PostQuitMessage")
	shellNotify      = shell32.NewProc("Shell_NotifyIconW")
	destroyIcon      = user32.NewProc("DestroyIcon")
	foregroundWindow = user32.NewProc("SetForegroundWindow")
	showWindowAsync  = user32.NewProc("ShowWindowAsync")
)

// All pointer-sized fields follow the native Windows ABI on amd64 and arm64.
type point struct{ x, y int32 }
type windowMessage struct {
	hwnd           uintptr
	message        uint32
	wparam, lparam uintptr
	time           uint32
	position       point
	private        uint32
}
type windowClass struct {
	size, style                        uint32
	proc                               uintptr
	classExtra, windowExtra            int32
	instance, icon, cursor, background uintptr
	menuName, className                *uint16
	iconSmall                          uintptr
}
type notifyIconData struct {
	size                       uint32
	hwnd                       uintptr
	id, flags, callbackMessage uint32
	icon                       uintptr
	tip                        [128]uint16
	state, stateMask           uint32
	info                       [256]uint16
	version                    uint32
	infoTitle                  [64]uint16
	infoFlags                  uint32
	guid                       [16]byte
	balloonIcon                uintptr
}
type flashInfo struct {
	size                  uint32
	hwnd                  uintptr
	flags, count, timeout uint32
}

//go:embed tray.png
var baseIcon []byte

//go:embed tray-unread.png
var unreadIcon []byte

func wide(s string) *uint16 { p, _ := syscall.UTF16PtrFromString(s); return p }

func putText(dst []uint16, s string) {
	clear(dst)
	units := utf16.Encode([]rune(strings.ReplaceAll(s, "\x00", " ")))
	limit := len(dst) - 1
	if len(units) > limit {
		units = units[:limit]
		if len(units) > 0 && units[len(units)-1] >= 0xd800 && units[len(units)-1] <= 0xdbff {
			units = units[:len(units)-1]
		}
	}
	copy(dst, units)
}

func loadIcon(data []byte) (uintptr, error) {
	if len(data) == 0 {
		return 0, fmt.Errorf("empty tray icon")
	}
	// CreateIconFromResourceEx requires DWORD-aligned data; these are owned icons.
	words := make([]uint32, (len(data)+3)/4)
	copy(unsafe.Slice((*byte)(unsafe.Pointer(&words[0])), len(data)), data)
	width, _, _ := user32.NewProc("GetSystemMetrics").Call(49)
	height, _, _ := user32.NewProc("GetSystemMetrics").Call(50)
	icon, _, err := user32.NewProc("CreateIconFromResourceEx").Call(uintptr(unsafe.Pointer(&words[0])), uintptr(len(data)), 1, 0x30000, width, height, 0)
	runtime.KeepAlive(words)
	if icon == 0 {
		return 0, fmt.Errorf("create tray icon: %w", err)
	}
	return icon, nil
}

func findMain(pid uint32) uintptr {
	name := wide(MainWindowClass)
	var previous uintptr
	for {
		hwnd, _, _ := user32.NewProc("FindWindowExW").Call(0, previous, uintptr(unsafe.Pointer(name)), 0)
		if hwnd == 0 {
			return 0
		}
		var owner uint32
		user32.NewProc("GetWindowThreadProcessId").Call(hwnd, uintptr(unsafe.Pointer(&owner)))
		if pid == 0 || owner == pid {
			return hwnd
		}
		previous = hwnd
	}
}

func registeredMessage(name string) uint32 {
	p := wide(name)
	id, _, _ := user32.NewProc("RegisterWindowMessageW").Call(uintptr(unsafe.Pointer(p)))
	return uint32(id)
}

var showMessage = registeredMessage("Daynote.ShowMain")

func ShowExisting() bool {
	hwnd := findMain(0)
	if hwnd == 0 {
		return false
	}
	if showMessage != 0 {
		postMessage.Call(hwnd, uintptr(showMessage), 0, 0)
	}
	showWindowAsync.Call(hwnd, 9) // SW_RESTORE retains normal taskbar and Alt+Tab.
	foregroundWindow.Call(hwnd)
	return true
}
