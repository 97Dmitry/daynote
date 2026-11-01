//go:build windows

package desktop

import (
	"errors"
	"fmt"
	"os"
	"runtime"
	"sync"
	"sync/atomic"
	"syscall"
	"unsafe"
)

type operation struct {
	run    func() error
	result chan error
}

// Host's hidden top-level window, shell icon and HICONs belong to its locked
// message-loop thread. Main-window callbacks only request app-level actions.
type Host struct {
	callbacks      Callbacks
	mu             sync.Mutex
	closeMu        sync.Mutex
	queue          []operation
	hwnd           uintptr
	closing        bool
	done           chan struct{}
	closeErr       error
	icons          [2]uintptr
	unread         int
	trayAdded      bool
	taskbarMessage uint32
	main           atomic.Uintptr
	quit           atomic.Bool
	hook           *mainHook
}

var (
	hosts        sync.Map
	hostCallback = syscall.NewCallback(hostWindowProc)
	registerOnce sync.Once
	registerErr  error
)

func Start(callbacks Callbacks) (*Host, error) {
	h := &Host{callbacks: callbacks, done: make(chan struct{})}
	ready := make(chan error, 1)
	go h.loop(ready)
	if err := <-ready; err != nil {
		<-h.done
		return nil, err
	}
	return h, nil
}

func (h *Host) loop(ready chan<- error) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	defer close(h.done)
	defer h.cleanup()
	instance, _, _ := kernel32.NewProc("GetModuleHandleW").Call(0)
	className := wide("Daynote.TrayHost")
	registerOnce.Do(func() {
		wc := windowClass{size: uint32(unsafe.Sizeof(windowClass{})), proc: hostCallback, instance: instance, className: className}
		if atom, _, err := user32.NewProc("RegisterClassExW").Call(uintptr(unsafe.Pointer(&wc))); atom == 0 {
			registerErr = fmt.Errorf("register tray host class: %w", err)
		}
	})
	if registerErr != nil {
		ready <- registerErr
		return
	}
	h.taskbarMessage = registeredMessage("TaskbarCreated")
	if h.taskbarMessage == 0 {
		ready <- errors.New("register Explorer restart message failed")
		return
	}
	var err error
	for i, data := range [][]byte{baseIcon, unreadIcon} {
		h.icons[i], err = loadIcon(data)
		if err != nil {
			ready <- err
			return
		}
	}
	// A hidden top-level tool window receives Explorer broadcasts. HWND_MESSAGE
	// would miss TaskbarCreated. These styles never touch the Wails main window.
	hwnd, _, winErr := createWindow.Call(0x80, uintptr(unsafe.Pointer(className)), 0, 0, 0, 0, 0, 0, 0, 0, instance, 0)
	if hwnd == 0 {
		ready <- fmt.Errorf("create tray host: %w", winErr)
		return
	}
	h.hwnd = hwnd
	hosts.Store(hwnd, h)
	if err = h.addTray(); err != nil {
		ready <- err
		return
	}
	ready <- nil
	var msg windowMessage
	for {
		ok, _, err := getMessage.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if int32(ok) == -1 {
			h.closeErr = fmt.Errorf("tray message loop: %w", err)
			h.reportFailure(h.closeErr)
			return
		}
		if ok == 0 {
			h.mu.Lock()
			expected := h.closing
			h.mu.Unlock()
			if !expected {
				h.closeErr = errors.New("Windows tray host stopped unexpectedly")
				h.reportFailure(h.closeErr)
			}
			return
		}
		translateMessage.Call(uintptr(unsafe.Pointer(&msg)))
		dispatchMessage.Call(uintptr(unsafe.Pointer(&msg)))
	}
}

func (h *Host) cleanup() {
	// Disable the close interception even if this loop exited unexpectedly.
	h.quit.Store(true)
	if h.hook != nil {
		h.restoreMainHook()
	}
	if h.hwnd != 0 {
		// Also attempt deletion after an uncertain NIM_MODIFY failure: Shell may
		// still retain the old icon even when the most recent update failed.
		data := h.trayData()
		shellNotify.Call(nimDelete, uintptr(unsafe.Pointer(&data)))
		h.trayAdded = false
	}
	if h.hwnd != 0 {
		destroyWindow.Call(h.hwnd)
		hosts.Delete(h.hwnd)
	}
	for i, icon := range h.icons {
		if icon != 0 {
			destroyIcon.Call(icon)
			h.icons[i] = 0
		}
	}
}

func (h *Host) call(run func() error, closing bool) error {
	op := operation{run: run, result: make(chan error, 1)}
	h.mu.Lock()
	select {
	case <-h.done:
		h.mu.Unlock()
		return errors.New("desktop host is closed")
	default:
	}
	if h.closing {
		h.mu.Unlock()
		return errors.New("desktop host is closing")
	}
	if closing {
		h.closing = true
	}
	h.queue = append(h.queue, op)
	if ok, _, err := postMessage.Call(h.hwnd, wmWork, 0, 0); ok == 0 {
		h.queue = h.queue[:len(h.queue)-1]
		if closing {
			h.closing = false
		}
		h.mu.Unlock()
		return fmt.Errorf("post desktop operation: %w", err)
	}
	h.mu.Unlock()
	select {
	case err := <-op.result:
		return err
	case <-h.done:
		return errors.New("desktop host stopped before operation completed")
	}
}

func (h *Host) work() {
	for {
		h.mu.Lock()
		if len(h.queue) == 0 {
			h.mu.Unlock()
			return
		}
		op := h.queue[0]
		h.queue[0] = operation{}
		h.queue = h.queue[1:]
		h.mu.Unlock()
		op.result <- op.run()
	}
}

func (h *Host) Close() error {
	h.closeMu.Lock()
	defer h.closeMu.Unlock()
	h.mu.Lock()
	alreadyClosing := h.closing
	h.mu.Unlock()
	if alreadyClosing {
		<-h.done
		return h.closeErr
	}
	select {
	case <-h.done:
		return h.closeErr
	default:
	}
	err := h.call(func() error {
		h.quit.Store(true)
		h.restoreMainHook()
		postQuit.Call(0)
		return nil
	}, true)
	if err != nil {
		return err
	}
	<-h.done
	return h.closeErr
}

func (h *Host) AllowQuit() { h.quit.Store(true) }

func (h *Host) AttachMainWindow() error {
	return h.call(func() error {
		if h.main.Load() != 0 {
			return nil
		}
		hwnd := findMain(uint32(os.Getpid()))
		if hwnd == 0 {
			return errors.New("Daynote main window was not found")
		}
		return h.attachMainHook(hwnd)
	}, false)
}

func (h *Host) trayData() notifyIconData {
	icon := h.icons[0]
	if h.unread > 0 {
		icon = h.icons[1]
	}
	data := notifyIconData{size: uint32(unsafe.Sizeof(notifyIconData{})), hwnd: h.hwnd, id: 1,
		flags: nifMessage | nifIcon | nifTip, callbackMessage: wmTray, icon: icon}
	putText(data.tip[:], trayTooltip(h.unread))
	return data
}

func (h *Host) addTray() error {
	data := h.trayData()
	if ok, _, err := shellNotify.Call(nimAdd, uintptr(unsafe.Pointer(&data))); ok == 0 {
		return fmt.Errorf("add Windows tray icon: %w", err)
	}
	h.trayAdded = true
	return nil
}

func (h *Host) ensureTray() error {
	if h.trayAdded {
		return nil
	}
	return h.addTray()
}

func (h *Host) SetUnread(count int) error {
	return h.call(func() error {
		if count < 0 {
			count = 0
		}
		h.unread = count
		if err := h.ensureTray(); err != nil {
			return err
		}
		data := h.trayData()
		if ok, _, err := shellNotify.Call(nimModify, uintptr(unsafe.Pointer(&data))); ok == 0 {
			h.trayAdded = false
			return fmt.Errorf("update Windows tray icon: %w", err)
		}
		return nil
	}, false)
}

func (h *Host) Notify(notice Notice) error {
	return h.call(func() error {
		if err := h.ensureTray(); err != nil {
			return err
		}
		data := h.trayData()
		data.flags = nifInfo
		putText(data.info[:], notice.Body)
		putText(data.infoTitle[:], notice.Title)
		// The explicit MessageBeep below is the sole requested sound. Suppress
		// Shell's default balloon sound to avoid two signals for one reminder.
		data.infoFlags = 1 | 0x10 // NIIF_INFO | NIIF_NOSOUND
		if ok, _, err := shellNotify.Call(nimModify, uintptr(unsafe.Pointer(&data))); ok == 0 {
			h.trayAdded = false
			return fmt.Errorf("show Windows reminder: %w", err)
		}
		if notice.Sound {
			user32.NewProc("MessageBeep").Call(0x40)
		}
		if hwnd := h.main.Load(); hwnd != 0 {
			if visible, _, _ := user32.NewProc("IsWindowVisible").Call(hwnd); visible != 0 {
				flash := flashInfo{size: uint32(unsafe.Sizeof(flashInfo{})), hwnd: hwnd, flags: 2, count: 3}
				user32.NewProc("FlashWindowEx").Call(uintptr(unsafe.Pointer(&flash)))
			}
		}
		return nil
	}, false)
}

func invoke(callback func()) {
	if callback != nil {
		go callback()
	}
}

func (h *Host) reportFailure(err error) {
	// Preserve error-before-show ordering for the application's fallback state.
	go func() {
		if h.callbacks.Error != nil {
			h.callbacks.Error(err)
		}
		if h.callbacks.Show != nil {
			h.callbacks.Show()
		}
	}()
}

func hostWindowProc(hwnd uintptr, msg uint32, wp, lp uintptr) uintptr {
	if value, ok := hosts.Load(hwnd); ok {
		h := value.(*Host)
		switch {
		case msg == h.taskbarMessage:
			h.trayAdded = false
			if err := h.addTray(); err != nil {
				h.reportFailure(err)
			}
			return 0
		case msg == wmWork:
			h.work()
			return 0
		case msg == wmTray:
			switch uint32(lp) {
			case 0x203:
				invoke(h.callbacks.Show) // WM_LBUTTONDBLCLK
			case 0x205, 0x7b:
				h.menu() // WM_RBUTTONUP / WM_CONTEXTMENU
			case 0x405:
				invoke(h.callbacks.OpenNotifications) // NIN_BALLOONUSERCLICK
			}
			return 0
		case msg == wmClose:
			return 0
		case msg == wmDestroy:
			postQuit.Call(0)
			return 0
		}
	}
	result, _, _ := defWindowProc.Call(hwnd, uintptr(msg), wp, lp)
	return result
}

func (h *Host) menu() {
	menu, _, _ := user32.NewProc("CreatePopupMenu").Call()
	if menu == 0 {
		return
	}
	defer user32.NewProc("DestroyMenu").Call(menu)
	for i, title := range []string{"Открыть Daynote", "Уведомления", "Выход"} {
		p := wide(title)
		user32.NewProc("AppendMenuW").Call(menu, 0, uintptr(i+1), uintptr(unsafe.Pointer(p)))
	}
	var position point
	if ok, _, _ := user32.NewProc("GetCursorPos").Call(uintptr(unsafe.Pointer(&position))); ok == 0 {
		return
	}
	foregroundWindow.Call(h.hwnd)
	command, _, _ := user32.NewProc("TrackPopupMenu").Call(menu, 0x102, uintptr(position.x), uintptr(position.y), 0, h.hwnd, 0) // TPM_RETURNCMD | TPM_RIGHTBUTTON
	postMessage.Call(h.hwnd, 0, 0, 0)
	switch command {
	case 1:
		invoke(h.callbacks.Show)
	case 2:
		invoke(h.callbacks.OpenNotifications)
	case 3:
		invoke(h.callbacks.Quit)
	}
}
