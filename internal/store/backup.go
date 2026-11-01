package store

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"
)

const MaxBackupBytes = 64 << 20

func ParseBackup(data []byte) (Snapshot, error) {
	var v Snapshot
	if len(data) > MaxBackupBytes {
		return v, errors.New("резервная копия больше 64 МБ")
	}
	if err := json.Unmarshal(data, &v); err != nil {
		return v, errors.New("некорректный JSON резервной копии")
	}
	if err := validate(v); err != nil {
		return v, err
	}
	if v.Topics == nil {
		v.Topics = []Topic{}
	}
	if v.Notes == nil {
		v.Notes = []Note{}
	}
	if v.Tasks == nil {
		v.Tasks = []Task{}
	}
	return v, nil
}
func (s *Store) Import(data []byte) error {
	v, err := ParseBackup(data)
	if err != nil {
		return err
	}
	return s.change(func(next *Snapshot) error { *next = v; return nil })
}
func (s *Store) Export(dir string) (string, error) {
	info, err := os.Stat(dir)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", errors.New("выберите папку для резервных копий")
	}
	snap, err := s.Snapshot()
	if err != nil {
		return "", err
	}
	data, err := json.MarshalIndent(snap, "", "  ")
	if err != nil {
		return "", err
	}
	f, err := os.CreateTemp(dir, ".daynote-partial-*")
	if err != nil {
		return "", err
	}
	temp := f.Name()
	defer os.Remove(temp)
	if _, err = f.Write(data); err != nil {
		_ = f.Close()
		return "", err
	}
	if err = f.Sync(); err != nil {
		_ = f.Close()
		return "", err
	}
	if err = f.Close(); err != nil {
		return "", err
	}
	name := filepath.Join(dir, "daynote-backup-"+time.Now().UTC().Format("20060102T150405.000000000Z")+"-"+rand.Text()[:8]+".json")
	if err = os.Rename(temp, name); err != nil {
		return "", err
	}
	return name, nil
}
