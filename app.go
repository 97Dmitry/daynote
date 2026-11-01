package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/97Dmitry/daynote/internal/audio"
	"github.com/97Dmitry/daynote/internal/secrets"
	"github.com/97Dmitry/daynote/internal/store"
	"github.com/97Dmitry/daynote/internal/stt"
	"github.com/97Dmitry/daynote/internal/stt/gemini"
	"github.com/97Dmitry/daynote/internal/voice"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type Settings struct {
	BackupFolder  string `json:"backupFolder"`
	KeyConfigured bool   `json:"keyConfigured"`
	LastBackup    string `json:"lastBackup"`
	BackupError   string `json:"backupError"`
	DataFolder    string `json:"dataFolder"`
}
type config struct {
	BackupFolder string `json:"backupFolder"`
}
type App struct {
	data       *store.Store
	secrets    secrets.Store
	voice      *voice.Controller
	dir        string
	ctx        context.Context
	mu         sync.Mutex
	settings   Settings
	dirty      chan struct{}
	cancel     context.CancelFunc
	done       chan struct{}
	allowClose atomic.Bool
	restoreMu  sync.Mutex
}

func newApp(dir string, keys secrets.Store) (*App, error) {
	data, err := store.Open(filepath.Join(dir, "daynote.db"))
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	a := &App{data: data, secrets: keys, dir: dir, dirty: make(chan struct{}, 1), cancel: cancel, done: make(chan struct{}), settings: Settings{DataFolder: dir}}
	b, err := os.ReadFile(filepath.Join(dir, "settings.json"))
	if err == nil {
		var cfg config
		if e := json.Unmarshal(b, &cfg); e != nil {
			_ = data.Close()
			cancel()
			return nil, errors.New("не удалось прочитать settings.json; файл не изменён")
		}
		a.settings.BackupFolder = cfg.BackupFolder
	} else if !os.IsNotExist(err) {
		_ = data.Close()
		cancel()
		return nil, err
	}
	a.voice = voice.New(gemini.New(func() (string, bool, error) { return keys.Get(stt.KeyName("gemini")) }), audio.NewCapturer(), func(e voice.Event) { a.emit("voice", e) })
	go a.backupLoop(ctx)
	return a, nil
}
func (a *App) startup(ctx context.Context) { a.mu.Lock(); a.ctx = ctx; a.mu.Unlock() }
func (a *App) emit(name string, value any) {
	a.mu.Lock()
	ctx := a.ctx
	a.mu.Unlock()
	if ctx != nil {
		wruntime.EventsEmit(ctx, name, value)
	}
}
func (a *App) shutdown(context.Context) { a.voice.Cancel(); a.cancel(); <-a.done; _ = a.data.Close() }
func (a *App) beforeClose(context.Context) bool {
	if a.allowClose.Load() {
		return false
	}
	a.emit("app:closing", true)
	return true
}
func (a *App) CloseWindow()                  { a.allowClose.Store(true); wruntime.Quit(a.ctx) }
func (a *App) Load() (store.Snapshot, error) { return a.data.Snapshot() }
func (a *App) changed() {
	select {
	case a.dirty <- struct{}{}:
	default:
	}
}
func (a *App) SaveNote(n store.Note) (store.Note, error) {
	out, err := a.data.SaveNote(n)
	if err == nil {
		a.changed()
	}
	return out, err
}
func (a *App) SaveTopic(t store.Topic) (store.Topic, error) {
	out, err := a.data.SaveTopic(t)
	if err == nil {
		a.changed()
	}
	return out, err
}
func (a *App) SaveTask(t store.Task) (store.Task, error) {
	out, err := a.data.SaveTask(t)
	if err == nil {
		a.changed()
	}
	return out, err
}
func (a *App) Delete(kind, id string) (store.Snapshot, error) {
	if err := a.data.Delete(kind, id); err != nil {
		return store.Snapshot{}, err
	}
	a.changed()
	return a.Load()
}
func (a *App) Move(kind, id string, delta int, scope string) (store.Snapshot, error) {
	if err := a.data.Move(kind, id, delta, scope); err != nil {
		return store.Snapshot{}, err
	}
	a.changed()
	return a.Load()
}
func (a *App) GetSettings() (Settings, error) {
	_, ok, err := a.secrets.Get(stt.KeyName("gemini"))
	a.mu.Lock()
	defer a.mu.Unlock()
	out := a.settings
	out.KeyConfigured = ok
	return out, err
}
func (a *App) SetGeminiKey(key string) error {
	key = strings.TrimSpace(key)
	if key == "" {
		return a.secrets.Delete(stt.KeyName("gemini"))
	}
	if len(key) > 4000 {
		return errors.New("слишком длинный API-ключ")
	}
	return a.secrets.Set(stt.KeyName("gemini"), key)
}
func (a *App) ChooseBackupFolder() (Settings, error) {
	dir, err := wruntime.OpenDirectoryDialog(a.ctx, wruntime.OpenDialogOptions{Title: "Папка резервных копий (например, OneDrive)"})
	if err != nil {
		return Settings{}, err
	}
	if dir == "" {
		return a.GetSettings()
	}
	// Verify the chosen folder is writable before changing the setting.
	if _, err = a.data.Export(dir); err != nil {
		return Settings{}, err
	}
	if err = a.setBackupFolder(dir); err != nil {
		return Settings{}, err
	}
	a.changed()
	return a.GetSettings()
}
func (a *App) setBackupFolder(dir string) error {
	b, _ := json.MarshalIndent(config{BackupFolder: dir}, "", "  ")
	path := filepath.Join(a.dir, "settings.json")
	tmp, err := os.CreateTemp(a.dir, ".settings-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err = tmp.Write(b); err != nil {
		_ = tmp.Close()
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	if err = os.Rename(tmp.Name(), path); err != nil {
		return err
	}
	a.mu.Lock()
	a.settings.BackupFolder = dir
	a.mu.Unlock()
	return nil
}
func (a *App) BackupNow() (Settings, error) {
	a.mu.Lock()
	dir := a.settings.BackupFolder
	a.mu.Unlock()
	if dir == "" {
		return Settings{}, errors.New("сначала выберите папку резервных копий")
	}
	_, err := a.data.Export(dir)
	a.mu.Lock()
	if err != nil {
		a.settings.BackupError = err.Error()
	} else {
		a.settings.LastBackup = time.Now().Format(time.RFC3339)
		a.settings.BackupError = ""
	}
	a.mu.Unlock()
	settings, _ := a.GetSettings()
	a.emit("backup", settings)
	return settings, err
}
func (a *App) backupLoop(ctx context.Context) {
	defer close(a.done)
	timer := time.NewTimer(time.Hour)
	if !timer.Stop() {
		<-timer.C
	}
	defer timer.Stop()
	pending := false
	for {
		select {
		case <-a.dirty:
			pending = true
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			timer.Reset(2 * time.Second)
		case <-timer.C:
			if pending {
				a.mu.Lock()
				configured := a.settings.BackupFolder != ""
				a.mu.Unlock()
				if configured {
					_, _ = a.BackupNow()
				}
				pending = false
			}
		case <-ctx.Done():
			// Cancellation can win select before a queued change was observed.
			select {
			case <-a.dirty:
				pending = true
			default:
			}
			if pending {
				a.mu.Lock()
				configured := a.settings.BackupFolder != ""
				a.mu.Unlock()
				if configured {
					_, _ = a.BackupNow()
				}
			}
			return
		}
	}
}
func (a *App) RestoreBackup() (store.Snapshot, error) {
	path, err := wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{Title: "Восстановить резервную копию Daynote", Filters: []wruntime.FileFilter{{DisplayName: "Daynote JSON", Pattern: "*.json"}}})
	if err != nil {
		return store.Snapshot{}, err
	}
	if path == "" {
		return a.Load()
	}
	f, err := os.Open(path)
	if err != nil {
		return store.Snapshot{}, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, store.MaxBackupBytes+1))
	if err != nil {
		return store.Snapshot{}, err
	}
	if _, err = store.ParseBackup(data); err != nil {
		return store.Snapshot{}, err
	}
	answer, err := wruntime.MessageDialog(a.ctx, wruntime.MessageDialogOptions{Type: wruntime.QuestionDialog, Title: "Заменить данные?", Message: "Текущие заметки, темы и задачи будут заменены резервной копией. Перед заменой сохранится локальная аварийная копия.", Buttons: []string{"Заменить", "Отмена"}, DefaultButton: "Отмена", CancelButton: "Отмена"})
	if err != nil {
		return store.Snapshot{}, err
	}
	if answer != "Заменить" {
		return a.Load()
	}
	if err = a.restore(data); err != nil {
		return store.Snapshot{}, err
	}
	a.changed()
	return a.Load()
}
func (a *App) restore(data []byte) error {
	a.restoreMu.Lock()
	defer a.restoreMu.Unlock()
	if _, err := store.ParseBackup(data); err != nil {
		return err
	}
	dir := filepath.Join(a.dir, "recovery")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	if _, err := a.data.Export(dir); err != nil {
		return err
	}
	return a.data.Import(data)
}
func (a *App) StartVoice(sessionID string) error {
	if sessionID == "" || len(sessionID) > 128 {
		return errors.New("некорректная сессия записи")
	}
	return a.voice.Start(sessionID)
}
func (a *App) StopVoice() error { return a.voice.Stop() }
func (a *App) CancelVoice()     { a.voice.Cancel() }
