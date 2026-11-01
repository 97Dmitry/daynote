//go:build windows

package desktop

import (
	"fmt"
	"sync"
	"sync/atomic"
	"syscall"
)

type mainHook struct {
	host     *Host
	original uintptr
	disabled atomic.Bool
}

var (
	mainHooksMu sync.Mutex
	mainHooks   = map[uintptr]*mainHook{}
	// Windows and any later subclass can retain this address until process exit.
	mainCallback  = syscall.NewCallback(mainWindowProc)
	getWindowLong = windowLongProc("GetWindowLongPtrW", "GetWindowLongW")
	setWindowLong = windowLongProc("SetWindowLongPtrW", "SetWindowLongW")
)

func windowLongProc(name64, name32 string) *syscall.LazyProc {
	if ^uintptr(0) == 0xffffffff {
		return user32.NewProc(name32)
	}
	return user32.NewProc(name64)
}

func wndProcIndex() uintptr { index := -4; return uintptr(index) }

func (h *Host) attachMainHook(hwnd uintptr) error {
	// SetWindowLongPtr is valid across threads within this process. The common-
	// controls SetWindowSubclass API is deliberately not used across Wails' thread.
	// Protect the installation so a concurrently dispatched message cannot see
	// the new callback before its original procedure has been retained.
	mainHooksMu.Lock()
	defer mainHooksMu.Unlock()
	if _, exists := mainHooks[hwnd]; exists {
		return fmt.Errorf("main window already has a Daynote hook")
	}
	hook := &mainHook{host: h}
	mainHooks[hwnd] = hook
	original, _, err := setWindowLong.Call(hwnd, wndProcIndex(), mainCallback)
	if original == 0 {
		delete(mainHooks, hwnd)
		return fmt.Errorf("install main window hook: %w", err)
	}
	hook.original = original
	h.hook = hook
	h.main.Store(hwnd)
	return nil
}

func (h *Host) restoreMainHook() {
	hook := h.hook
	if hook == nil {
		return
	}
	hook.disabled.Store(true)
	hwnd := h.main.Swap(0)
	mainHooksMu.Lock()
	defer mainHooksMu.Unlock()
	current, _, _ := getWindowLong.Call(hwnd, wndProcIndex())
	if current == mainCallback {
		if previous, _, err := setWindowLong.Call(hwnd, wndProcIndex(), hook.original); previous == 0 {
			h.closeErr = fmt.Errorf("restore main window procedure: %w", err)
			return
		}
		// Retain the disabled record even after successful restoration: an
		// invocation already entering our thunk may still be waiting for this
		// lock. This one main-window record can safely live until process exit.
	}
	// If another library installed a hook after us, its forwarding chain may
	// still call ours. Retain this disabled forwarding record until WM_NCDESTROY;
	// overwriting that library's procedure would corrupt the chain.
	h.hook = nil
}

func mainWindowProc(hwnd uintptr, msg uint32, wp, lp uintptr) uintptr {
	mainHooksMu.Lock()
	hook := mainHooks[hwnd]
	mainHooksMu.Unlock()
	if hook == nil {
		result, _, _ := defWindowProc.Call(hwnd, uintptr(msg), wp, lp)
		return result
	}
	if !hook.disabled.Load() {
		if blockSystemMenu(msg, wp, lp) {
			return 0
		}
		if msg == wmClose && !hook.host.quit.Load() {
			invoke(hook.host.callbacks.Hide)
			return 0
		}
		if showMessage != 0 && msg == showMessage {
			invoke(hook.host.callbacks.Show)
			return 0
		}
	}
	result, _, _ := user32.NewProc("CallWindowProcW").Call(hook.original, hwnd, uintptr(msg), wp, lp)
	if msg == wmNCDestroy {
		hook.disabled.Store(true)
		hook.host.main.CompareAndSwap(hwnd, 0)
		mainHooksMu.Lock()
		if mainHooks[hwnd] == hook {
			delete(mainHooks, hwnd)
		}
		mainHooksMu.Unlock()
	}
	return result
}
