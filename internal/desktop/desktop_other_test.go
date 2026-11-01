//go:build !windows

package desktop

import "testing"

func TestUnsupportedAutostartIsExplicit(t *testing.T) {
	if Supported {
		t.Fatal("non-Windows desktop reported native support")
	}
	if enabled, err := AutostartEnabled(); enabled || err != nil {
		t.Fatalf("status = %v, %v", enabled, err)
	}
	if err := SetAutostart(true); err == nil {
		t.Fatal("unsupported autostart unexpectedly succeeded")
	}
	if err := SetAutostart(false); err == nil {
		t.Fatal("unsupported autostart disable unexpectedly succeeded")
	}
}
