//go:build windows

package desktop

import (
	"bytes"
	"image/png"
	"runtime"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
	"unsafe"
)

func TestWindowsStructLayouts(t *testing.T) {
	if unsafe.Sizeof(uintptr(0)) != 8 {
		t.Skip("supported Windows target is x64")
	}
	if got := unsafe.Sizeof(notifyIconData{}); got != 976 {
		t.Errorf("NOTIFYICONDATAW size = %d", got)
	}
	if got := unsafe.Offsetof(notifyIconData{}.info); got != 304 {
		t.Errorf("szInfo offset = %d", got)
	}
	if got := unsafe.Offsetof(notifyIconData{}.balloonIcon); got != 968 {
		t.Errorf("hBalloonIcon offset = %d", got)
	}
	if got := unsafe.Sizeof(windowClass{}); got != 80 {
		t.Errorf("WNDCLASSEXW size = %d", got)
	}
	if got := unsafe.Sizeof(windowMessage{}); got != 48 {
		t.Errorf("MSG size = %d", got)
	}
	if got := unsafe.Sizeof(flashInfo{}); got != 32 {
		t.Errorf("FLASHWINFO size = %d", got)
	}
}

// Exercise actual procedure forwarding on a private hidden test HWND. This does
// not create a tray icon, play sound, write Run keys, or claim UI acceptance.
func TestMainHookForwardsAndRestores(t *testing.T) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	var forwarded atomic.Int32
	original := syscall.NewCallback(func(hwnd uintptr, msg uint32, wp, lp uintptr) uintptr {
		if msg == 0x112 || msg == wmClose {
			forwarded.Add(1)
			return 123
		}
		value, _, _ := defWindowProc.Call(hwnd, uintptr(msg), wp, lp)
		return value
	})
	className := wide("Daynote.DesktopHookTest")
	instance, _, _ := kernel32.NewProc("GetModuleHandleW").Call(0)
	wc := windowClass{size: uint32(unsafe.Sizeof(windowClass{})), proc: original, instance: instance, className: className}
	if atom, _, err := user32.NewProc("RegisterClassExW").Call(uintptr(unsafe.Pointer(&wc))); atom == 0 {
		t.Fatal(err)
	}
	defer user32.NewProc("UnregisterClassW").Call(uintptr(unsafe.Pointer(className)), instance)
	hwnd, _, err := createWindow.Call(0, uintptr(unsafe.Pointer(className)), 0, 0, 0, 0, 0, 0, 0, 0, instance, 0)
	if hwnd == 0 {
		t.Fatal(err)
	}
	defer destroyWindow.Call(hwnd)
	defer func() { mainHooksMu.Lock(); delete(mainHooks, hwnd); mainHooksMu.Unlock() }()
	hidden := make(chan struct{}, 1)
	h := &Host{callbacks: Callbacks{Hide: func() { hidden <- struct{}{} }}}
	if err := h.attachMainHook(hwnd); err != nil {
		t.Fatal(err)
	}
	defer h.restoreMainHook()
	send := user32.NewProc("SendMessageW")
	if got, _, _ := send.Call(hwnd, 0x112, 0xf100, 0); got != 0 {
		t.Fatalf("bare Alt returned %d", got)
	}
	if got, _, _ := send.Call(hwnd, 0x112, 0xf100, ' '); got != 123 {
		t.Fatalf("Alt+Space returned %d", got)
	}
	if got, _, _ := send.Call(hwnd, wmClose, 0, 0); got != 0 {
		t.Fatalf("close returned %d", got)
	}
	select {
	case <-hidden:
	case <-time.After(time.Second):
		t.Fatal("close did not request hide")
	}
	if forwarded.Load() != 1 {
		t.Fatalf("forwarded %d messages", forwarded.Load())
	}
	h.AllowQuit()
	if got, _, _ := send.Call(hwnd, wmClose, 0, 0); got != 123 {
		t.Fatalf("allowed close returned %d", got)
	}
	h.restoreMainHook()
	if got, _, _ := getWindowLong.Call(hwnd, wndProcIndex()); got != original {
		t.Fatalf("original procedure not restored: %#x", got)
	}
	if got, _, _ := send.Call(hwnd, 0x112, 0xf100, 0); got != 123 {
		t.Fatalf("restored Alt returned %d", got)
	}
}

func TestEmbeddedIconsAreValidAndOwned(t *testing.T) {
	for _, data := range [][]byte{baseIcon, unreadIcon} {
		if _, err := png.Decode(bytes.NewReader(data)); err != nil {
			t.Fatal(err)
		}
		icon, err := loadIcon(data)
		if err != nil {
			t.Fatal(err)
		}
		if ok, _, err := destroyIcon.Call(icon); ok == 0 {
			t.Fatalf("DestroyIcon: %v", err)
		}
	}
}

func TestUTF16FieldsAreTerminatedAndDoNotSplitSurrogates(t *testing.T) {
	var dst [4]uint16
	putText(dst[:], "ab😀")
	if dst != [4]uint16{'a', 'b', 0, 0} {
		t.Fatalf("%x", dst)
	}
	putText(dst[:], "x\x00y")
	if dst != [4]uint16{'x', ' ', 'y', 0} {
		t.Fatalf("%x", dst)
	}
}
