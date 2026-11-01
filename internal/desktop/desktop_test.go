package desktop

import (
	"strings"
	"testing"
)

func TestOnlyBareAltSystemMenuIsBlocked(t *testing.T) {
	for _, tt := range []struct {
		msg    uint32
		wp, lp uintptr
		want   bool
	}{
		{0x112, 0xf100, 0, true}, {0x112, 0xf103, 0, true},
		{0x112, 0xf100, ' ', false}, {0x112, 0xf100, 'f', false},
		{0x112, 0xf060, 0, false}, {0x100, 0x12, 0, false},
	} {
		if got := blockSystemMenu(tt.msg, tt.wp, tt.lp); got != tt.want {
			t.Errorf("message %#x/%#x/%#x: %v, want %v", tt.msg, tt.wp, tt.lp, got, tt.want)
		}
	}
}

func TestAutostartCommandQuotesExecutableAndRejectsInvalidPaths(t *testing.T) {
	got, err := autostartCommand(`C:\Program Files\Daynote\Daynote.exe`)
	if err != nil || got != `"C:\Program Files\Daynote\Daynote.exe" --background` {
		t.Fatalf("command = %q, %v", got, err)
	}
	for _, path := range []string{"", "bad\x00path", `C:\bad"path.exe`, strings.Repeat("x", 250), strings.Repeat("я", 250)} {
		if _, err := autostartCommand(path); err == nil {
			t.Errorf("accepted invalid path %q", path)
		}
	}
	if _, err := autostartCommand(strings.Repeat("x", 244)); err != nil {
		t.Fatalf("rejected last valid command size: %v", err)
	}
	if _, err := autostartCommand(strings.Repeat("x", 245)); err == nil {
		t.Fatal("accepted Run command beyond UTF-16 limit")
	}
	if _, err := autostartCommand(strings.Repeat("😀", 123)); err == nil {
		t.Fatal("counted Unicode runes instead of UTF-16 code units")
	}
}

func TestTooltipUnread(t *testing.T) {
	if got := trayTooltip(0); got != "Daynote" {
		t.Fatal(got)
	}
	if got := trayTooltip(3); got != "Daynote — непрочитанных: 3" {
		t.Fatal(got)
	}
}
