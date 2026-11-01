// Package desktop owns native tray integration without changing main-window styles.
package desktop

import (
	"fmt"
	"strings"
	"unicode/utf16"
)

const MainWindowClass = "Daynote.Main"

type Callbacks struct {
	Show, Hide, Quit, OpenNotifications func()
	Error                               func(error)
}
type Notice struct {
	Title, Body string
	Sound       bool
}

func blockSystemMenu(msg uint32, wp, lp uintptr) bool {
	return msg == 0x0112 && wp&0xfff0 == 0xf100 && lp == 0
}

func autostartCommand(executable string) (string, error) {
	if executable == "" || strings.ContainsAny(executable, "\x00\"") {
		return "", fmt.Errorf("invalid executable path")
	}
	command := `"` + executable + `" --background`
	// Run keys have a documented 260-character command-line limit, including NUL.
	if len(utf16.Encode([]rune(command)))+1 > 260 {
		return "", fmt.Errorf("autostart command exceeds Windows Run limit")
	}
	return command, nil
}

func trayTooltip(unread int) string {
	if unread <= 0 {
		return "Daynote"
	}
	return fmt.Sprintf("Daynote — непрочитанных: %d", unread)
}
