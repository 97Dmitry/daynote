package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func openTest(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "notes.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}
func TestPersistAndRelationshipDeletion(t *testing.T) {
	s := openTest(t)
	topic, err := s.SaveTopic(Topic{Name: "Работа", Color: "#467769"})
	if err != nil {
		t.Fatal(err)
	}
	n, err := s.SaveNote(Note{Title: "Созвон", Date: "2026-11-02", TopicID: topic.ID, Pinned: true})
	if err != nil {
		t.Fatal(err)
	}
	task, err := s.SaveTask(Task{Title: "Утренний созвон", Start: "2026-11-02T09:00:00+06:00", End: "2026-11-02T10:00:00+06:00", NoteIDs: []string{n.ID}})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Delete("topic", topic.ID); err != nil {
		t.Fatal(err)
	}
	snap, err := s.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if snap.Notes[0].TopicID != "" || !snap.Notes[0].Pinned {
		t.Fatal(snap)
	}
	if err = s.Delete("task", task.ID); err != nil {
		t.Fatal(err)
	}
	snap, _ = s.Snapshot()
	if len(snap.Notes) != 1 {
		t.Fatal("task deletion lost note")
	}
	task, err = s.SaveTask(Task{Title: "Ночь", Start: "2026-11-02T23:00:00+06:00", End: "2026-11-03T01:00:00+06:00", NoteIDs: []string{n.ID}})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Delete("note", n.ID); err != nil {
		t.Fatal(err)
	}
	snap, _ = s.Snapshot()
	if len(snap.Tasks[0].NoteIDs) != 0 {
		t.Fatal("dangling note link", task)
	}
}
func TestReopenAndManualOrder(t *testing.T) {
	path := filepath.Join(t.TempDir(), "notes.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	a, _ := s.SaveNote(Note{Title: "A", Date: "2026-01-01"})
	b, _ := s.SaveNote(Note{Title: "B", Date: "2026-01-02"})
	if err = s.Move("note", b.ID, -1); err != nil {
		t.Fatal(err)
	}
	_ = s.Close()
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	snap, _ := s.Snapshot()
	if len(snap.Notes) != 2 || snap.Notes[0].ID != b.ID || snap.Notes[1].ID != a.ID {
		t.Fatal(snap.Notes)
	}
}
func TestValidationAndAtomicImport(t *testing.T) {
	s := openTest(t)
	n, _ := s.SaveNote(Note{Title: "Keep me", Date: "2026-02-01"})
	if _, err := s.SaveNote(Note{Date: "2026-02-30"}); err == nil {
		t.Fatal("invalid date accepted")
	}
	for _, task := range []Task{{Title: "bad", Start: "2026-11-02T10:00:00Z", End: "2026-11-02T09:00:00Z"}, {Title: "bad", Start: "2026-11-02T09:00:00", End: "2026-11-02T10:00:00"}, {Title: "bad", Start: "2026-11-02T09:00:00Z", End: "2026-11-02T10:00:00Z", NoteIDs: []string{"missing"}}} {
		if _, err := s.SaveTask(task); err == nil {
			t.Fatal("invalid task accepted")
		}
	}
	bad := Snapshot{Version: 1, Notes: []Note{{ID: "x", Title: "invalid", Date: "2026-01-01", TopicID: "absent"}}}
	data, _ := json.Marshal(bad)
	if err := s.Import(data); err == nil {
		t.Fatal("bad import accepted")
	}
	snap, _ := s.Snapshot()
	if len(snap.Notes) != 1 || snap.Notes[0].ID != n.ID {
		t.Fatal("failed import changed data")
	}
	snap.Version = 999
	data, _ = json.Marshal(snap)
	if err := s.Import(data); err == nil {
		t.Fatal("unknown schema accepted")
	}
}
func TestBackupRoundtripAndFailure(t *testing.T) {
	s := openTest(t)
	_, _ = s.SaveNote(Note{Title: "Голос", Body: "Привет", Date: "2026-11-02"})
	dir := t.TempDir()
	one, err := s.Export(dir)
	if err != nil {
		t.Fatal(err)
	}
	two, err := s.Export(dir)
	if err != nil {
		t.Fatal(err)
	}
	if one == two {
		t.Fatal("backup overwritten")
	}
	data, err := os.ReadFile(one)
	if err != nil {
		t.Fatal(err)
	}
	target := openTest(t)
	if err = target.Import(data); err != nil {
		t.Fatal(err)
	}
	snap, _ := target.Snapshot()
	if snap.Notes[0].Body != "Привет" {
		t.Fatal(snap)
	}
	blocked := filepath.Join(dir, "file")
	_ = os.WriteFile(blocked, []byte("x"), 0600)
	if _, err = s.Export(blocked); err == nil {
		t.Fatal("invalid directory accepted")
	}
	snap, _ = s.Snapshot()
	if len(snap.Notes) != 1 {
		t.Fatal("export failure lost data")
	}
}
