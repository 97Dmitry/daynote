package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/97Dmitry/daynote/internal/secrets"
)

type unreadableSecrets struct{ secrets.Store }

func (unreadableSecrets) Get(string) (string, bool, error) {
	return "", false, errors.New("credential store unavailable")
}
func TestThemeDoesNotDependOnGeminiCredentials(t *testing.T) {
	a, err := newApp(t.TempDir(), unreadableSecrets{secrets.NewMemory()})
	if err != nil {
		t.Fatal(err)
	}
	defer a.shutdown(context.Background())
	if err = a.SetTheme("dark"); err != nil {
		t.Fatal("theme change incorrectly reads Gemini credentials", err)
	}
}

func TestThemePersistsWithoutLosingBackupFolder(t *testing.T) {
	dir := t.TempDir()
	a, err := newApp(dir, secrets.NewMemory())
	if err != nil {
		t.Fatal(err)
	}
	settings, err := a.GetSettings()
	if err != nil || settings.Theme != "system" {
		t.Fatal(settings, err)
	}
	backup := t.TempDir()
	if err = a.setBackupFolder(backup); err != nil {
		t.Fatal(err)
	}
	if err = a.SetTheme("dark"); err != nil {
		t.Fatal(err)
	}
	if err = a.setBackupFolder(backup); err != nil {
		t.Fatal(err)
	}
	a.shutdown(context.Background())
	a, err = newApp(dir, secrets.NewMemory())
	if err != nil {
		t.Fatal(err)
	}
	defer a.shutdown(context.Background())
	settings, err = a.GetSettings()
	if err != nil || settings.Theme != "dark" || settings.BackupFolder != backup {
		t.Fatal("preferences overwritten", settings, err)
	}
	if err = a.SetTheme("invalid"); err == nil {
		t.Fatal("invalid theme accepted")
	}
	bytes, err := os.ReadFile(filepath.Join(dir, "settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cfg map[string]any
	if err = json.Unmarshal(bytes, &cfg); err != nil {
		t.Fatal(err)
	}
	if cfg["theme"] != "dark" || cfg["backupFolder"] != backup {
		t.Fatal(cfg)
	}
}
