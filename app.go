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
	"github.com/97Dmitry/daynote/internal/desktop"
	"github.com/97Dmitry/daynote/internal/reminders"
	"github.com/97Dmitry/daynote/internal/secrets"
	"github.com/97Dmitry/daynote/internal/store"
	"github.com/97Dmitry/daynote/internal/stt"
	"github.com/97Dmitry/daynote/internal/stt/gemini"
	"github.com/97Dmitry/daynote/internal/voice"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type Settings struct {
	BackupFolder       string `json:"backupFolder"`
	KeyConfigured      bool   `json:"keyConfigured"`
	LastBackup         string `json:"lastBackup"`
	BackupError        string `json:"backupError"`
	DataFolder         string `json:"dataFolder"`
	Theme              string `json:"theme"`
	Autostart          bool   `json:"autostart"`
	AutostartSupported bool   `json:"autostartSupported"`
	AutostartError     string `json:"autostartError"`
	NotificationError  string `json:"notificationError"`
}
type config struct {
	BackupFolder string `json:"backupFolder"`
	Theme        string `json:"theme"`
}
type App struct {
	data                                                         *store.Store
	secrets                                                      secrets.Store
	voice                                                        *voice.Controller
	dir                                                          string
	ctx                                                          context.Context
	mu                                                           sync.Mutex
	settings                                                     Settings
	dirty                                                        chan struct{}
	cancel                                                       context.CancelFunc
	done                                                         chan struct{}
	allowClose                                                   atomic.Bool
	restoreMu                                                    sync.Mutex
	preferencesMu                                                sync.Mutex
	pickRestore                                                  func() (string, error)
	confirmRestore                                               func(wruntime.MessageDialogOptions) (string, error)
	host                                                         *desktop.Host
	nativeHealthy, desktopInitialized, rendererReady, background bool
	pendingClose                                                 CloseRequest
	closeOperation                                               sync.Mutex
	showWindow, hideWindow, quitWindow                           func()
	startupWrite                                                 func(bool) error
	startupRead                                                  func() (bool, error)
	scheduler                                                    *reminders.Service
	schedulerCancel                                              context.CancelFunc
	schedulerDone                                                chan struct{}
}

func newApp(dir string, keys secrets.Store) (*App, error) {
	data, err := store.Open(filepath.Join(dir, "daynote.db"))
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	a := &App{data: data, secrets: keys, dir: dir, dirty: make(chan struct{}, 1), cancel: cancel, done: make(chan struct{}), settings: Settings{DataFolder: dir, Theme: "system"}}
	a.showWindow = func() {
		if ctx := a.context(); ctx != nil {
			wruntime.WindowShow(ctx)
			wruntime.WindowUnminimise(ctx)
		}
	}
	a.hideWindow = func() {
		if ctx := a.context(); ctx != nil {
			wruntime.WindowHide(ctx)
		}
	}
	a.quitWindow = func() {
		if ctx := a.context(); ctx != nil {
			wruntime.Quit(ctx)
		}
	}
	a.startupWrite = desktop.SetAutostart
	a.startupRead = desktop.AutostartEnabled
	a.pickRestore = func() (string, error) {
		return wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{Title: "Восстановить резервную копию Daynote", Filters: []wruntime.FileFilter{{DisplayName: "Daynote JSON", Pattern: "*.json"}}})
	}
	a.confirmRestore = func(options wruntime.MessageDialogOptions) (string, error) {
		return wruntime.MessageDialog(a.ctx, options)
	}
	b, err := os.ReadFile(filepath.Join(dir, "settings.json"))
	if err == nil {
		var cfg config
		if e := json.Unmarshal(b, &cfg); e != nil {
			_ = data.Close()
			cancel()
			return nil, errors.New("не удалось прочитать settings.json; файл не изменён")
		}
		a.settings.BackupFolder = cfg.BackupFolder
		if validTheme(cfg.Theme) {
			a.settings.Theme = cfg.Theme
		}
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
func (a *App) shutdown(context.Context) {
	a.voice.Cancel()
	a.mu.Lock()
	stop, done, host := a.schedulerCancel, a.schedulerDone, a.host
	a.mu.Unlock()
	if stop != nil {
		stop()
		<-done
	}
	a.cancel()
	<-a.done
	if host != nil {
		_ = host.Close()
	}
	_ = a.data.Close()
}
func (a *App) beforeClose(context.Context) bool {
	if a.allowClose.Load() {
		return false
	}
	a.requestClose(false)
	return true
}
func (a *App) Load() (store.Snapshot, error) { return a.data.Snapshot() }
func (a *App) changed() {
	select {
	case a.dirty <- struct{}{}:
	default:
	}
	a.mu.Lock()
	scheduler := a.scheduler
	a.mu.Unlock()
	if scheduler != nil {
		scheduler.Wake()
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
func (a *App) SaveTaskWithConfirmation(t store.Task, discardExceptions bool) (store.Task, error) {
	out, err := a.data.SaveTaskWithConfirmation(t, discardExceptions)
	if err == nil {
		a.changed()
	}
	return out, err
}
func (a *App) TaskChangeImpact(t store.Task) (int, error) { return a.data.TaskChangeImpact(t) }
func (a *App) Occurrences(from, to string) ([]store.Occurrence, error) {
	return a.data.Occurrences(from, to)
}
func (a *App) Occurrence(taskID, date string) (store.Occurrence, error) {
	return a.data.Occurrence(taskID, date)
}
func (a *App) SaveException(taskID string, ex store.TaskException) error {
	err := a.data.SaveException(taskID, ex)
	if err == nil {
		a.changed()
	}
	return err
}
func (a *App) ResetException(taskID, date string) error {
	err := a.data.ResetException(taskID, date)
	if err == nil {
		a.changed()
	}
	return err
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
	enabled, startupErr := a.startupRead()
	a.mu.Lock()
	defer a.mu.Unlock()
	out := a.settings
	out.KeyConfigured = ok
	out.Autostart = enabled
	out.AutostartSupported = desktop.Supported
	if startupErr != nil {
		out.AutostartError = startupErr.Error()
	}
	return out, err
}
func (a *App) SetAutostart(enabled bool) error { return a.startupWrite(enabled) }
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
	return a.updatePreferences(func(cfg *config) { cfg.BackupFolder = dir })
}
func validTheme(theme string) bool { return theme == "system" || theme == "light" || theme == "dark" }
func (a *App) SetTheme(theme string) error {
	if !validTheme(theme) {
		return errors.New("неизвестная тема оформления")
	}
	if err := a.updatePreferences(func(cfg *config) { cfg.Theme = theme }); err != nil {
		return err
	}
	return nil
}
func (a *App) updatePreferences(update func(*config)) error {
	a.preferencesMu.Lock()
	defer a.preferencesMu.Unlock()
	a.mu.Lock()
	cfg := config{BackupFolder: a.settings.BackupFolder, Theme: a.settings.Theme}
	a.mu.Unlock()
	update(&cfg)
	b, _ := json.MarshalIndent(cfg, "", "  ")
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
	if err = tmp.Sync(); err != nil {
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
	a.settings.BackupFolder = cfg.BackupFolder
	a.settings.Theme = cfg.Theme
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
	path, err := a.pickRestore()
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
	answer, err := a.confirmRestore(wruntime.MessageDialogOptions{Type: wruntime.QuestionDialog, Title: "Заменить данные?", Message: "Текущие заметки, темы и задачи будут заменены резервной копией. Перед заменой сохранится локальная аварийная копия.", Buttons: []string{"Yes", "No"}, DefaultButton: "No", CancelButton: "No"})
	if err != nil {
		return store.Snapshot{}, err
	}
	if answer != "Yes" {
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
