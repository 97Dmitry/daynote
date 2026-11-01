// Package instance prevents two processes from owning the same local data folder.
package instance

import (
	"fmt"
	"golang.org/x/sys/windows"
)

// Acquire uses file sharing rather than a session-local named mutex, so it also
// covers another Windows session opening the same user's LocalAppData directory.
// The stable lock file is intentionally retained after its handle is closed.
func Acquire(path string) (func(), error) {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	handle, err := windows.CreateFile(p, windows.GENERIC_READ|windows.GENERIC_WRITE, 0, nil, windows.OPEN_ALWAYS, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return nil, fmt.Errorf("каталог Daynote уже используется или недоступен: %w", err)
	}
	return func() { _ = windows.CloseHandle(handle) }, nil
}
