package store

import (
	"database/sql"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"
)

func TestMigrationPreservesLegacyTasks(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE topics(id TEXT PRIMARY KEY,data BLOB NOT NULL); CREATE TABLE notes(id TEXT PRIMARY KEY,topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,data BLOB NOT NULL); CREATE TABLE tasks(id TEXT PRIMARY KEY,data BLOB NOT NULL); CREATE TABLE task_notes(task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,note_id TEXT REFERENCES notes(id) ON DELETE CASCADE,PRIMARY KEY(task_id,note_id)); PRAGMA user_version=1;`)
	if err != nil {
		t.Fatal(err)
	}
	legacy := `{"id":"legacy","title":"Legacy event","start":"2026-11-02T09:00:00Z","end":"2026-11-02T10:00:00Z","color":"#467769","noteIds":[]}`
	_, err = db.Exec("INSERT INTO tasks(id,data) VALUES(?,?)", "legacy", legacy)
	if err != nil {
		t.Fatal(err)
	}
	_ = db.Close()
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	snap, _ := s.Snapshot()
	if snap.Version != 3 || len(snap.Tasks) != 1 || snap.Tasks[0].Title != "Legacy event" {
		t.Fatal(snap)
	}
	if _, err = s.Notifications(); err != nil {
		t.Fatal("missing migrated receipt table", err)
	}
}
func TestSaveTaskOwnsReminderSlices(t *testing.T) {
	s := openTest(t)
	input := Task{Title: "Owned", Start: "2026-11-02T09:00:00Z", End: "2026-11-02T10:00:00Z", Reminders: []Reminder{{ID: "r", Kind: "before", MinutesBefore: 30}}}
	saved, err := s.SaveTask(input)
	if err != nil {
		t.Fatal(err)
	}
	input.Reminders[0].MinutesBefore = 99
	saved.Reminders[0].MinutesBefore = 88
	snap, _ := s.Snapshot()
	if snap.Tasks[0].Reminders[0].MinutesBefore != 30 {
		t.Fatal("caller modified persisted state")
	}
}

func TestRemindersDueAndDurableDeduplication(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	task, err := s.SaveTask(Task{Title: "Созвон", Start: "2026-11-02T09:30:00Z", End: "2026-11-02T10:00:00Z", Reminders: []Reminder{{ID: "before", Kind: "before", MinutesBefore: 30, Sound: true}, {ID: "future", Kind: "before", MinutesBefore: 10}, {ID: "at", Kind: "at", At: "2026-11-02T08:00:00Z"}}})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 11, 2, 9, 0, 0, 0, time.UTC)
	due, err := s.ClaimDue(now)
	if err != nil {
		t.Fatal(err)
	}
	if len(due) != 2 {
		t.Fatal(due)
	}
	_ = s.Close()
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	again, err := s.ClaimDue(now)
	if err != nil || len(again) != 0 {
		t.Fatal("duplicate after restart", again, err)
	}
	inbox, _ := s.Notifications()
	if len(inbox) != 2 {
		t.Fatal(inbox)
	}
	if err = s.Acknowledge(inbox[0].ID); err != nil {
		t.Fatal(err)
	}
	inbox, _ = s.Notifications()
	if !inbox[0].Read {
		t.Fatal("ack not persisted")
	}
	task.Start = "2026-11-02T10:30:00Z"
	task.End = "2026-11-02T11:00:00Z"
	_, err = s.SaveTask(task)
	if err != nil {
		t.Fatal(err)
	}
	due, err = s.ClaimDue(now.Add(time.Hour))
	if err != nil || len(due) != 1 || due[0].DueAt != "2026-11-02T10:00:00Z" {
		t.Fatal("relative reminder did not move", due, err)
	}
	task.Done = true
	_, _ = s.SaveTask(task)
	due, _ = s.ClaimDue(now.Add(80 * time.Minute))
	if len(due) != 0 {
		t.Fatal("completed task notified")
	}
	if err = s.Delete("task", task.ID); err != nil {
		t.Fatal(err)
	}
	inbox, _ = s.Notifications()
	if len(inbox) != 0 {
		t.Fatal("deleted task retained notifications")
	}
}
func TestReminderCatchupAndBackupRestore(t *testing.T) {
	s := openTest(t)
	now := time.Date(2026, 11, 2, 9, 0, 0, 0, time.UTC)
	task, err := s.SaveTask(Task{Title: "Тренировка", Start: "2026-11-02T12:00:00Z", End: "2026-11-02T13:00:00Z", Reminders: []Reminder{{ID: "old", Kind: "at", At: "2026-11-01T08:59:59Z"}, {ID: "edge", Kind: "at", At: "2026-11-01T09:00:00Z"}, {ID: "now", Kind: "at", At: "2026-11-02T09:00:00Z"}}})
	if err != nil {
		t.Fatal(err)
	}
	due, err := s.ClaimDue(now)
	if err != nil || len(due) != 2 {
		t.Fatal(due, err)
	}
	snapshot, _ := s.Snapshot()
	if snapshot.Version != 3 {
		t.Fatal(snapshot.Version)
	}
	data, _ := json.Marshal(snapshot)
	if err = s.Import(data); err != nil {
		t.Fatal(err)
	}
	inbox, _ := s.Notifications()
	if len(inbox) != 0 {
		t.Fatal("import must reset local receipts")
	}
	due, _ = s.ClaimDue(now)
	if len(due) != 2 {
		t.Fatal("import did not reconcile catchup", due)
	}
	if err = s.Acknowledge(""); err != nil {
		t.Fatal(err)
	}
	inbox, _ = s.Notifications()
	for _, n := range inbox {
		if !n.Read {
			t.Fatal("mark all did not ack")
		}
	}
	// Snapshots are detached: callers cannot modify stored reminder definitions.
	snapshot, _ = s.Snapshot()
	snapshot.Tasks[0].Reminders[0].At = "broken"
	actual, _ := s.Snapshot()
	if actual.Tasks[0].Reminders[0].At == "broken" {
		t.Fatal("mutable reminders leaked")
	}
	task.Reminders = []Reminder{{ID: "x", Kind: "before", MinutesBefore: -1}}
	if _, err = s.SaveTask(task); err == nil {
		t.Fatal("negative offset accepted")
	}
	task.Reminders = []Reminder{{ID: "x", Kind: "at", At: "invalid"}}
	if _, err = s.SaveTask(task); err == nil {
		t.Fatal("invalid absolute time accepted")
	}
	task.Reminders = []Reminder{{ID: "x", Kind: "before", MinutesBefore: 30}, {ID: "y", Kind: "before", MinutesBefore: 30}}
	if _, err = s.SaveTask(task); err == nil {
		t.Fatal("duplicate reminders accepted")
	}
}
func TestLegacyBackupIsUpgradedAndFutureVersionRejected(t *testing.T) {
	legacy := []byte(`{"version":1,"topics":[],"notes":[],"tasks":[{"id":"t","title":"Legacy","start":"2026-11-02T09:00:00Z","end":"2026-11-02T10:00:00Z","color":"#467769","noteIds":[]}]}`)
	s, err := ParseBackup(legacy)
	if err != nil || s.Version != 3 || len(s.Tasks) != 1 {
		t.Fatal(s, err)
	}
	if len(s.Tasks[0].Reminders) != 0 {
		t.Fatal("legacy reminder invented")
	}
	if _, err = ParseBackup([]byte(`{"version":4}`)); err == nil {
		t.Fatal("future backup accepted")
	}
}

func TestNotificationOrderUsesInstantsWithFractionalSeconds(t *testing.T) {
	s := openTest(t)
	_, err := s.SaveTask(Task{Title: "Order", Start: "2026-11-02T12:00:00Z", End: "2026-11-02T13:00:00Z", Reminders: []Reminder{
		{ID: "whole", Kind: "at", At: "2026-11-02T09:00:00Z"},
		{ID: "fraction", Kind: "at", At: "2026-11-02T09:00:00.5Z"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	due, err := s.ClaimDue(time.Date(2026, 11, 2, 10, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if len(due) != 2 || due[0].DueAt != "2026-11-02T09:00:00Z" {
		t.Fatal("delivery must be chronological", due)
	}
	inbox, err := s.Notifications()
	if err != nil {
		t.Fatal(err)
	}
	if len(inbox) != 2 || inbox[0].DueAt != "2026-11-02T09:00:00.5Z" {
		t.Fatal("inbox must be newest first", inbox)
	}
}
