package main

import (
	"context"
	"github.com/97Dmitry/daynote/internal/secrets"
	"github.com/97Dmitry/daynote/internal/store"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAppBackupRestoreAndSettingsExcludeKey(t *testing.T) {
	dir := t.TempDir()
	a, err := newApp(dir, secrets.NewMemory())
	if err != nil {
		t.Fatal(err)
	}
	defer a.shutdown(context.Background())
	if err = a.SetGeminiKey("test-key-not-for-disk"); err != nil {
		t.Fatal(err)
	}
	settings, err := a.GetSettings()
	if err != nil || !settings.KeyConfigured {
		t.Fatal(settings, err)
	}
	if err = a.setBackupFolder(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(dir, "settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "test-key-not-for-disk") {
		t.Fatal("key on disk")
	}
	_, err = a.SaveNote(store.Note{Title: "Keep", Date: "2026-11-02"})
	if err != nil {
		t.Fatal(err)
	}
	if err = a.restore([]byte(`{"version":999}`)); err == nil {
		t.Fatal("bad restore accepted")
	}
	snap, _ := a.Load()
	if len(snap.Notes) != 1 {
		t.Fatal("restore lost data")
	}
	backup, err := a.data.Export(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(backup)
	_, _ = a.SaveNote(store.Note{Title: "second", Date: "2026-11-03"})
	if err = a.restore(data); err != nil {
		t.Fatal(err)
	}
	snap, _ = a.Load()
	if len(snap.Notes) != 1 {
		t.Fatal("restore did not replace")
	}
	entries, _ := os.ReadDir(filepath.Join(dir, "recovery"))
	if len(entries) != 1 {
		t.Fatal("missing recovery backup")
	}
}

func TestNativeRestoreConfirmationYesAndNo(t *testing.T) {
	a, err := newApp(t.TempDir(), secrets.NewMemory())
	if err != nil {
		t.Fatal(err)
	}
	defer a.shutdown(context.Background())
	_, _ = a.SaveNote(store.Note{Title: "Before", Date: "2026-11-02"})
	path, err := a.data.Export(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	_, _ = a.SaveNote(store.Note{Title: "After", Date: "2026-11-03"})
	a.pickRestore = func() (string, error) { return path, nil }
	a.confirmRestore = func(wruntime.MessageDialogOptions) (string, error) { return "No", nil }
	snap, err := a.RestoreBackup()
	if err != nil {
		t.Fatal(err)
	}
	if len(snap.Notes) != 2 {
		t.Fatal("negative confirmation changed data")
	}
	a.confirmRestore = func(wruntime.MessageDialogOptions) (string, error) { return "Yes", nil }
	snap, err = a.RestoreBackup()
	if err != nil {
		t.Fatal(err)
	}
	if len(snap.Notes) != 1 || snap.Notes[0].Title != "Before" {
		t.Fatal("affirmative Windows confirmation did not restore snapshot")
	}
}

func TestShutdownBacksUpLastChange(t *testing.T) {
	for range 30 {
		a, err := newApp(t.TempDir(), secrets.NewMemory())
		if err != nil {
			t.Fatal(err)
		}
		dir := t.TempDir()
		if err = a.setBackupFolder(dir); err != nil {
			t.Fatal(err)
		}
		if _, err = a.SaveNote(store.Note{Title: "Last edit", Date: "2026-11-02"}); err != nil {
			t.Fatal(err)
		}
		a.shutdown(context.Background())
		entries, err := os.ReadDir(dir)
		if err != nil {
			t.Fatal(err)
		}
		if len(entries) != 1 {
			t.Fatal("last change not backed up at shutdown")
		}
	}
}

func TestCanceledBackupWorkerDrainsQueuedChange(t *testing.T) {
	for range 30 {
		s, err := store.Open(filepath.Join(t.TempDir(), "notes.db"))
		if err != nil {
			t.Fatal(err)
		}
		dir := t.TempDir()
		a := &App{data: s, secrets: secrets.NewMemory(), dirty: make(chan struct{}, 1), done: make(chan struct{}), settings: Settings{BackupFolder: dir}}
		_, err = s.SaveNote(store.Note{Title: "Pending", Date: "2026-11-02"})
		if err != nil {
			t.Fatal(err)
		}
		a.changed()
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		a.backupLoop(ctx)
		entries, err := os.ReadDir(dir)
		_ = s.Close()
		if err != nil {
			t.Fatal(err)
		}
		if len(entries) != 1 {
			t.Fatal("queued change skipped when shutdown wins select")
		}
	}
}
