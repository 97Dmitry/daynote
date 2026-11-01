package store

import (
	"encoding/json"
	"path/filepath"
	"testing"
)

func TestOccurrencePersistenceAndBackup(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	task := series()
	task.ID = ""
	saved, err := s.SaveTask(task)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.SaveException(saved.ID, TaskException{Date: "2026-11-02", Done: true}); err != nil {
		t.Fatal(err)
	}
	if err = s.SaveException(saved.ID, TaskException{Date: "2026-11-03", Skipped: true}); err != nil {
		t.Fatal(err)
	}
	if err = s.SaveException(saved.ID, TaskException{Date: "2026-11-04", Start: "2026-12-02T12:00:00Z", End: "2026-12-02T13:00:00Z"}); err != nil {
		t.Fatal(err)
	}
	// Input, output, and snapshot must not alias the live store.
	task.Recurrence.Weekdays[0] = 7
	saved.Recurrence.TimeZone = "Wrong/Zone"
	snap, _ := s.Snapshot()
	snap.Tasks[0].Recurrence.Weekdays[0] = 7
	snap.Tasks[0].Exceptions[0].Done = false
	_ = s.Close()
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	o, err := s.Occurrence(saved.ID, "2026-11-02")
	if err != nil || !o.Done {
		t.Fatal(o, err)
	}
	if _, err = s.Occurrence(saved.ID, "2026-11-03"); err == nil {
		t.Fatal("deleted instance returned")
	}
	got, err := s.Occurrences("2026-12-02T11:00:00Z", "2026-12-02T14:00:00Z")
	if err != nil || len(got) != 1 || got[0].Date != "2026-11-04" {
		t.Fatal(got, err)
	}
	if _, err = s.Occurrences("2026-01-01T00:00:00Z", "2028-01-01T00:00:00Z"); err == nil {
		t.Fatal("unbounded range")
	}
	snap, _ = s.Snapshot()
	data, _ := json.Marshal(snap)
	if err = s.Import(data); err != nil {
		t.Fatal(err)
	}
	o, err = s.Occurrence(saved.ID, "2026-11-02")
	if err != nil || !o.Done {
		t.Fatal(o, err)
	}
	if err = s.ResetException(saved.ID, "2026-11-03"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Occurrence(saved.ID, "2026-11-03"); err != nil {
		t.Fatal(err)
	}
	if err = s.SaveException(saved.ID, TaskException{Date: "2026-11-01", Done: true}); err == nil {
		t.Fatal("date outside series accepted")
	}
}
func TestOccurrenceSeriesChangesRequireConfirmation(t *testing.T) {
	s := openTest(t)
	task := series()
	task.ID = ""
	saved, err := s.SaveTask(task)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.SaveException(saved.ID, TaskException{Date: "2026-11-02", Done: true}); err != nil {
		t.Fatal(err)
	}
	// A stale editor must preserve exceptions written after it opened.
	saved.Title = "Updated"
	saved, err = s.SaveTask(saved)
	if err != nil || len(saved.Exceptions) != 1 {
		t.Fatal(saved, err)
	}
	saved.Recurrence.Weekdays = []int{6, 7}
	if _, err = s.SaveTask(saved); err == nil {
		t.Fatal("silently lost exception")
	}
	actual, _ := s.Occurrence(saved.ID, "2026-11-02")
	if !actual.Done {
		t.Fatal("failed change mutated data")
	}
	saved, err = s.SaveTaskWithConfirmation(saved, true)
	if err != nil || len(saved.Exceptions) != 0 {
		t.Fatal(saved, err)
	}
	saved.Recurrence = nil
	saved, err = s.SaveTaskWithConfirmation(saved, true)
	if err != nil {
		t.Fatal(err)
	}
	if o, err := s.Occurrence(saved.ID, ""); err != nil || o.Date != "" {
		t.Fatal(o, err)
	}
}
func TestRecurrenceRemindersUseEachDateAndMovedExceptions(t *testing.T) {
	s := openTest(t)
	task := series()
	task.ID = ""
	task.Reminders = []Reminder{{ID: "before", Kind: "before", MinutesBefore: 30}, {ID: "at", Kind: "at", At: "2026-11-01T18:00:00+06:00"}}
	task.Exceptions = []TaskException{{Date: "2026-11-02", Done: true}, {Date: "2026-11-03", Skipped: true}, {Date: "2026-11-04", Start: "2026-12-02T12:00:00Z", End: "2026-12-02T13:00:00Z"}}
	saved, err := s.SaveTask(task)
	if err != nil {
		t.Fatal(err)
	}
	due, err := s.ClaimDue(instant("2026-11-02T03:00:00Z"))
	if err != nil || len(due) != 0 {
		t.Fatal(due, err)
	}
	due, err = s.ClaimDue(instant("2026-11-05T03:00:00Z"))
	if err != nil || len(due) != 2 {
		t.Fatal(due, err)
	}
	for _, n := range due {
		if n.OccurrenceDate != "2026-11-05" {
			t.Fatal(n)
		}
	}
	due, err = s.ClaimDue(instant("2026-12-02T11:30:00Z"))
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, n := range due {
		if n.OccurrenceDate == "2026-11-04" && n.DueAt == "2026-12-02T11:30:00Z" && n.TaskID == saved.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("moved reminder missing", due)
	}
	again, err := s.ClaimDue(instant("2026-12-02T11:30:00Z"))
	if err != nil || len(again) != 0 {
		t.Fatal("duplicate", again, err)
	}
}
func TestRecurrenceReminderLargeOffsetsAndDST(t *testing.T) {
	s := openTest(t)
	task := series()
	task.ID = ""
	task.Reminders = []Reminder{{ID: "year", Kind: "before", MinutesBefore: 525600}}
	saved, err := s.SaveTask(task)
	if err != nil {
		t.Fatal(err)
	}
	due, err := s.ClaimDue(instant("2026-11-02T03:00:00Z"))
	if err != nil || len(due) != 2 || due[1].OccurrenceDate != "2027-11-02" {
		t.Fatal(due, err)
	}
	if err = s.Delete("task", saved.ID); err != nil {
		t.Fatal(err)
	}
	task = series()
	task.ID = ""
	task.Start = "2026-03-07T02:30:00-05:00"
	task.End = "2026-03-07T03:30:00-05:00"
	task.Recurrence.TimeZone = "America/New_York"
	task.Reminders = []Reminder{{ID: "start", Kind: "before"}, {ID: "at", Kind: "at", At: "2026-03-07T01:00:00-05:00"}}
	if _, err = s.SaveTask(task); err != nil {
		t.Fatal(err)
	}
	due, err = s.ClaimDue(instant("2026-03-09T07:00:00Z"))
	if err != nil || len(due) != 2 || due[0].OccurrenceDate != "2026-03-09" || due[0].DueAt != "2026-03-09T05:00:00Z" || due[1].DueAt != "2026-03-09T06:30:00Z" {
		t.Fatal(due, err)
	}
}
func TestRecurrenceV2MigrationPreservesReceipts(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.SaveTask(Task{Title: "One", Start: "2026-11-02T09:00:00Z", End: "2026-11-02T10:00:00Z", Reminders: []Reminder{{ID: "r", Kind: "before"}}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.ClaimDue(instant("2026-11-02T09:00:00Z")); err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec("PRAGMA user_version=2"); err != nil {
		t.Fatal(err)
	}
	_ = s.Close()
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	snap, _ := s.Snapshot()
	if snap.Version != 3 {
		t.Fatal(snap.Version)
	}
	due, err := s.ClaimDue(instant("2026-11-02T09:00:00Z"))
	if err != nil || len(due) != 0 {
		t.Fatal("receipt replayed", due, err)
	}
	inbox, _ := s.Notifications()
	if len(inbox) != 1 {
		t.Fatal(inbox)
	}
	for _, version := range []int{1, 2} {
		snap.Version = version
		data, _ := json.Marshal(snap)
		v, err := ParseBackup(data)
		if err != nil || v.Version != 3 || v.Tasks[0].Recurrence != nil {
			t.Fatal(v, err)
		}
	}
	if _, err = ParseBackup([]byte(`{"version":4}`)); err == nil {
		t.Fatal("future accepted")
	}
}
