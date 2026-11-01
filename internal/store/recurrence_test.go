package store

import (
	"reflect"
	"testing"
	"time"
)

func instant(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t
}
func series() Task {
	return Task{ID: "series", Title: "Daily", Color: "#467769", Start: "2026-11-02T09:00:00+06:00", End: "2026-11-02T10:00:00+06:00", Recurrence: &Recurrence{Weekdays: []int{1, 2, 3, 4, 5, 6, 7}, TimeZone: "Asia/Omsk"}}
}
func TestRecurrenceWeekdaysAndInclusiveBoundaries(t *testing.T) {
	for _, tc := range []struct {
		name string
		days []int
		want []string
	}{
		{"daily", []int{1, 2, 3, 4, 5, 6, 7}, []string{"2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"}},
		{"weekdays", []int{1, 2, 3, 4, 5}, []string{"2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"}},
		{"weekend", []int{6, 7}, []string{"2026-11-07", "2026-11-08"}},
		{"custom", []int{2, 4}, []string{"2026-11-03", "2026-11-05"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			task := series()
			task.Recurrence.Weekdays = tc.days
			task.Recurrence.Until = "2026-11-08"
			got, err := expandTask(task, instant("2026-11-01T00:00:00Z"), instant("2026-11-10T00:00:00Z"))
			if err != nil {
				t.Fatal(err)
			}
			var dates []string
			for _, o := range got {
				dates = append(dates, o.Date)
				if o.Start[11:] != "03:00:00Z" {
					t.Fatal(o)
				}
			}
			if !reflect.DeepEqual(dates, tc.want) {
				t.Fatal(dates)
			}
		})
	}
}
func TestRecurrenceDSTGapAndFold(t *testing.T) {
	task := series()
	task.Recurrence.TimeZone = "America/New_York"
	task.Start = "2026-03-07T02:30:00-05:00"
	task.End = "2026-03-07T03:30:00-05:00"
	got, err := expandTask(task, instant("2026-03-07T00:00:00Z"), instant("2026-03-10T00:00:00Z"))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Start != "2026-03-07T07:30:00Z" || got[1].Start != "2026-03-09T06:30:00Z" {
		t.Fatal(got)
	}
	task.Start = "2026-10-31T01:30:00-04:00"
	task.End = "2026-10-31T02:30:00-04:00"
	o, ok := occurrenceOn(task, "2026-11-01")
	if !ok || o.Start != "2026-11-01T05:30:00Z" || o.End != "2026-11-01T06:30:00Z" {
		t.Fatal(o, ok)
	}
}
func TestOccurrenceExceptionsAndCrossingRange(t *testing.T) {
	task := series()
	task.Exceptions = []TaskException{
		{Date: "2026-11-02", Done: true}, {Date: "2026-11-03", Skipped: true},
		{Date: "2026-11-04", Start: "2026-12-01T23:00:00Z", End: "2026-12-03T01:00:00Z"},
	}
	got, err := expandTask(task, instant("2026-11-02T00:00:00Z"), instant("2026-11-05T00:00:00Z"))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || !got[0].Done {
		t.Fatal(got)
	}
	got, err = expandTask(task, instant("2026-12-02T12:00:00Z"), instant("2026-12-02T13:00:00Z"))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Date != "2026-11-04" || got[0].ID != "series/2026-11-04" {
		t.Fatal(got)
	}
}
func TestRecurrenceCalendarEdgesAndLongIntervals(t *testing.T) {
	task := series()
	task.Start = "2024-02-28T23:30:00Z"
	task.End = "2024-03-02T00:30:00Z"
	task.Recurrence.TimeZone = "UTC"
	got, err := expandTask(task, instant("2024-03-01T00:00:00Z"), instant("2024-03-01T00:15:00Z"))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Date != "2024-02-28" || got[1].Date != "2024-02-29" {
		t.Fatal(got)
	}
	task.Start = "2026-12-31T23:30:00Z"
	task.End = "2027-01-01T00:30:00Z"
	got, err = expandTask(task, instant("2027-01-01T00:00:00Z"), instant("2027-01-02T00:00:00Z"))
	if err != nil || len(got) != 2 || got[1].Date != "2027-01-01" {
		t.Fatal(got, err)
	}
}
func TestRecurrenceRejectsInvalidRulesAndExceptions(t *testing.T) {
	for _, mutate := range []func(*Task){
		func(t *Task) { t.Recurrence.Weekdays = nil }, func(t *Task) { t.Recurrence.Weekdays = []int{1, 1} }, func(t *Task) { t.Recurrence.Weekdays = []int{0} },
		func(t *Task) { t.Recurrence.TimeZone = "Local" }, func(t *Task) { t.Recurrence.TimeZone = "Wrong/Zone" }, func(t *Task) { t.Recurrence.Until = "2026-11-01" },
		func(t *Task) { t.Done = true }, func(t *Task) { t.Exceptions = []TaskException{{Date: "2026-11-01", Done: true}} },
		func(t *Task) { t.Exceptions = []TaskException{{Date: "2026-11-02", Start: "2026-11-02T09:00:00Z"}} },
		func(t *Task) { t.Exceptions = []TaskException{{Date: "2026-11-02", Done: true, Skipped: true}} },
		func(t *Task) {
			t.Exceptions = []TaskException{{Date: "2026-11-02", Done: true}, {Date: "2026-11-02", Done: true}}
		},
		func(t *Task) { t.Recurrence = nil; t.Exceptions = []TaskException{{Date: "2026-11-02", Done: true}} },
	} {
		task := series()
		mutate(&task)
		if err := validateRecurrence(task); err == nil {
			t.Fatalf("accepted invalid task: %+v", task)
		}
	}
}
