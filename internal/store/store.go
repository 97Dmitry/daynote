package store

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

type Store struct {
	mu    sync.Mutex
	db    *sql.DB
	state Snapshot
}

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db, state: Snapshot{Version: 2, Topics: []Topic{}, Notes: []Note{}, Tasks: []Task{}}}
	fail := func(e error) (*Store, error) { _ = db.Close(); return nil, e }
	if _, err = db.Exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;"); err != nil {
		return fail(err)
	}
	var version int
	if err = db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return fail(err)
	}
	if version != 0 && version != 1 && version != 2 {
		return fail(errors.New("неподдерживаемая версия базы; данные не изменены"))
	}
	if version == 0 {
		var count int
		if err = db.QueryRow("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").Scan(&count); err != nil {
			return fail(err)
		}
		if count != 0 {
			return fail(errors.New("неизвестная структура базы; данные не изменены"))
		}
		_, err = db.Exec(`BEGIN; CREATE TABLE topics(id TEXT PRIMARY KEY,data BLOB NOT NULL); CREATE TABLE notes(id TEXT PRIMARY KEY,topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,data BLOB NOT NULL); CREATE TABLE tasks(id TEXT PRIMARY KEY,data BLOB NOT NULL); CREATE TABLE task_notes(task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,note_id TEXT REFERENCES notes(id) ON DELETE CASCADE,PRIMARY KEY(task_id,note_id)); PRAGMA user_version=1; COMMIT;`)
		if err != nil {
			return fail(err)
		}
		version = 1
	}
	if version == 1 {
		_, err = db.Exec(`BEGIN; CREATE TABLE notification_receipts(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,payload BLOB NOT NULL,is_read INTEGER NOT NULL DEFAULT 0); PRAGMA user_version=2; COMMIT;`)
		if err != nil {
			return fail(err)
		}
	}
	for _, table := range []string{"topics", "notes", "tasks"} {
		rows, e := db.Query("SELECT data FROM " + table)
		if e != nil {
			return fail(e)
		}
		for rows.Next() {
			var b []byte
			if e = rows.Scan(&b); e != nil {
				break
			}
			switch table {
			case "topics":
				var v Topic
				e = json.Unmarshal(b, &v)
				s.state.Topics = append(s.state.Topics, v)
			case "notes":
				var v Note
				e = json.Unmarshal(b, &v)
				s.state.Notes = append(s.state.Notes, v)
			case "tasks":
				var v Task
				e = json.Unmarshal(b, &v)
				s.state.Tasks = append(s.state.Tasks, v)
			}
			if e != nil {
				break
			}
		}
		if e == nil {
			e = rows.Err()
		}
		_ = rows.Close()
		if e != nil {
			return fail(e)
		}
	}
	if err = validate(s.state); err != nil {
		return fail(err)
	}
	s.sort()
	return s, nil
}
func (s *Store) Close() error { return s.db.Close() }
func clone(v Snapshot) Snapshot {
	v.Topics = slices.Clone(v.Topics)
	v.Notes = slices.Clone(v.Notes)
	v.Tasks = slices.Clone(v.Tasks)
	for i := range v.Tasks {
		v.Tasks[i].NoteIDs = slices.Clone(v.Tasks[i].NoteIDs)
		if v.Tasks[i].NoteIDs == nil {
			v.Tasks[i].NoteIDs = []string{}
		}
		v.Tasks[i].Reminders = slices.Clone(v.Tasks[i].Reminders)
		if v.Tasks[i].Reminders == nil {
			v.Tasks[i].Reminders = []Reminder{}
		}
	}
	return v
}
func (s *Store) sort() {
	sort.SliceStable(s.state.Topics, func(i, j int) bool {
		a, b := s.state.Topics[i], s.state.Topics[j]
		if a.Position == b.Position {
			return a.ID < b.ID
		}
		return a.Position < b.Position
	})
	sort.SliceStable(s.state.Notes, func(i, j int) bool {
		a, b := s.state.Notes[i], s.state.Notes[j]
		if a.Position == b.Position {
			return a.ID < b.ID
		}
		return a.Position < b.Position
	})
}
func (s *Store) Snapshot() (Snapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return clone(s.state), nil
}
func (s *Store) change(fn func(*Snapshot) error) error {
	return s.changeState(fn, false)
}
func (s *Store) changeState(fn func(*Snapshot) error, resetNotifications bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := clone(s.state)
	if err := fn(&next); err != nil {
		return err
	}
	if err := validate(next); err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if resetNotifications {
		if _, err = tx.Exec("DELETE FROM notification_receipts"); err != nil {
			return err
		}
	}
	oldMaps, newMaps := encode(s.state), encode(next)
	for _, table := range []string{"tasks", "notes", "topics"} {
		for id := range oldMaps[table] {
			if _, ok := newMaps[table][id]; !ok {
				if _, err = tx.Exec("DELETE FROM "+table+" WHERE id=?", id); err != nil {
					return err
				}
			}
		}
	}
	for _, table := range []string{"topics", "notes", "tasks"} {
		for id, b := range newMaps[table] {
			if reflect.DeepEqual(b, oldMaps[table][id]) {
				continue
			}
			if table == "notes" {
				var n Note
				_ = json.Unmarshal(b, &n)
				var topic any
				if n.TopicID != "" {
					topic = n.TopicID
				}
				_, err = tx.Exec("INSERT INTO notes(id,topic_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET topic_id=excluded.topic_id,data=excluded.data", id, topic, b)
			} else {
				_, err = tx.Exec("INSERT INTO "+table+"(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data", id, b)
			}
			if err != nil {
				return err
			}
		}
	}
	for _, t := range next.Tasks {
		if reflect.DeepEqual(newMaps["tasks"][t.ID], oldMaps["tasks"][t.ID]) {
			continue
		}
		if _, err = tx.Exec("DELETE FROM task_notes WHERE task_id=?", t.ID); err != nil {
			return err
		}
		for _, id := range t.NoteIDs {
			if _, err = tx.Exec("INSERT INTO task_notes(task_id,note_id) VALUES(?,?)", t.ID, id); err != nil {
				return err
			}
		}
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	s.state = next
	s.sort()
	return nil
}
func encode(s Snapshot) map[string]map[string][]byte {
	out := map[string]map[string][]byte{"topics": {}, "notes": {}, "tasks": {}}
	for _, v := range s.Topics {
		out["topics"][v.ID], _ = json.Marshal(v)
	}
	for _, v := range s.Notes {
		out["notes"][v.ID], _ = json.Marshal(v)
	}
	for _, v := range s.Tasks {
		out["tasks"][v.ID], _ = json.Marshal(v)
	}
	return out
}
func (s *Store) SaveNote(n Note) (Note, error) {
	err := s.change(func(v *Snapshot) error {
		now := time.Now().UTC().Format(time.RFC3339Nano)
		n.Title = strings.TrimSpace(n.Title)
		if n.ID == "" {
			n.ID = rand.Text()
			n.CreatedAt = now
			for _, p := range v.Notes {
				n.Position = max(n.Position, p.Position+1)
			}
			n.UpdatedAt = now
			v.Notes = append(v.Notes, n)
			return nil
		}
		for i, p := range v.Notes {
			if p.ID == n.ID {
				n.CreatedAt = p.CreatedAt
				n.Position = p.Position
				n.UpdatedAt = now
				v.Notes[i] = n
				return nil
			}
		}
		return errors.New("заметка не найдена")
	})
	return n, err
}
func (s *Store) SaveTopic(t Topic) (Topic, error) {
	err := s.change(func(v *Snapshot) error {
		t.Name = strings.TrimSpace(t.Name)
		if t.Color == "" {
			t.Color = "#467769"
		}
		if t.ID == "" {
			t.ID = rand.Text()
			for _, p := range v.Topics {
				t.Position = max(t.Position, p.Position+1)
			}
			v.Topics = append(v.Topics, t)
			return nil
		}
		for i, p := range v.Topics {
			if p.ID == t.ID {
				t.Position = p.Position
				v.Topics[i] = t
				return nil
			}
		}
		return errors.New("тема не найдена")
	})
	return t, err
}
func (s *Store) SaveTask(t Task) (Task, error) {
	t.Reminders = slices.Clone(t.Reminders)
	t.NoteIDs = slices.Clone(t.NoteIDs)
	if t.Reminders == nil {
		t.Reminders = []Reminder{}
	}
	err := s.change(func(v *Snapshot) error {
		t.Title = strings.TrimSpace(t.Title)
		if t.Color == "" {
			t.Color = "#467769"
		}
		if t.NoteIDs == nil {
			t.NoteIDs = []string{}
		}
		if t.ID == "" {
			t.ID = rand.Text()
			v.Tasks = append(v.Tasks, t)
			return nil
		}
		for i, p := range v.Tasks {
			if p.ID == t.ID {
				v.Tasks[i] = t
				return nil
			}
		}
		return errors.New("задача не найдена")
	})
	t.Reminders = slices.Clone(t.Reminders)
	t.NoteIDs = slices.Clone(t.NoteIDs)
	return t, err
}
func (s *Store) Delete(kind, id string) error {
	return s.change(func(v *Snapshot) error {
		switch kind {
		case "topic":
			v.Topics = slices.DeleteFunc(v.Topics, func(t Topic) bool { return t.ID == id })
			for i := range v.Notes {
				if v.Notes[i].TopicID == id {
					v.Notes[i].TopicID = ""
				}
			}
		case "note":
			v.Notes = slices.DeleteFunc(v.Notes, func(n Note) bool { return n.ID == id })
			for i := range v.Tasks {
				v.Tasks[i].NoteIDs = slices.DeleteFunc(v.Tasks[i].NoteIDs, func(n string) bool { return n == id })
			}
		case "task":
			v.Tasks = slices.DeleteFunc(v.Tasks, func(t Task) bool { return t.ID == id })
		default:
			return errors.New("неизвестный тип объекта")
		}
		return nil
	})
}
func (s *Store) Move(kind, id string, delta int, scope ...string) error {
	return s.change(func(v *Snapshot) error {
		if delta != -1 && delta != 1 {
			return errors.New("некорректное направление")
		}
		if kind == "topic" {
			for i := range v.Topics {
				v.Topics[i].Position = i
			}
			for i, t := range v.Topics {
				if t.ID == id && i+delta >= 0 && i+delta < len(v.Topics) {
					j := i + delta
					v.Topics[i].Position, v.Topics[j].Position = v.Topics[j].Position, v.Topics[i].Position
					return nil
				}
			}
			return nil
		}
		if kind != "note" {
			return errors.New("неизвестный тип объекта")
		}
		var target *Note
		for i := range v.Notes {
			v.Notes[i].Position = i
			if v.Notes[i].ID == id {
				target = &v.Notes[i]
			}
		}
		if target == nil {
			return errors.New("заметка не найдена")
		}
		indices := []int{}
		for i, n := range v.Notes {
			if n.Pinned == target.Pinned && (len(scope) == 0 || scope[0] == "*" || n.TopicID == scope[0]) {
				indices = append(indices, i)
			}
		}
		for i, k := range indices {
			if v.Notes[k].ID == id && i+delta >= 0 && i+delta < len(indices) {
				j := indices[i+delta]
				v.Notes[k].Position, v.Notes[j].Position = v.Notes[j].Position, v.Notes[k].Position
				break
			}
		}
		return nil
	})
}
