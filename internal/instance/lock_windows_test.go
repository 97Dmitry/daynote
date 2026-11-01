package instance

import (
	"path/filepath"
	"testing"
)

func TestDataDirectoryHasOneOwner(t *testing.T) {
	path := filepath.Join(t.TempDir(), "owner.lock")
	release, err := Acquire(path)
	if err != nil {
		t.Fatal(err)
	}
	second, err := Acquire(path)
	if err == nil {
		second()
		release()
		t.Fatal("second owner acquired the same data directory")
	}
	release()
	again, err := Acquire(path)
	if err != nil {
		t.Fatal("released directory stayed locked", err)
	}
	again()
}
