package store

import (
	"errors"
	"slices"
	"strings"
	"time"
)

func cloneTask(t Task) Task {
	t.NoteIDs = slices.Clone(t.NoteIDs)
	if t.NoteIDs == nil {
		t.NoteIDs = []string{}
	}
	t.Reminders = slices.Clone(t.Reminders)
	if t.Reminders == nil {
		t.Reminders = []Reminder{}
	}
	t.Exceptions = slices.Clone(t.Exceptions)
	if t.Recurrence != nil {
		r := *t.Recurrence
		r.Weekdays = slices.Clone(r.Weekdays)
		t.Recurrence = &r
	}
	return t
}
func retainedExceptions(t Task) ([]TaskException, int, error) {
	if t.Recurrence == nil {
		return nil, len(t.Exceptions), nil
	}
	c, err := recurrenceFor(t)
	if err != nil {
		return nil, 0, err
	}
	kept := slices.DeleteFunc(slices.Clone(t.Exceptions), func(ex TaskException) bool { return !c.matches(ex.Date) })
	return kept, len(t.Exceptions) - len(kept), nil
}

// TaskChangeImpact previews the exceptions a series edit would remove. The
// save checks again atomically; a preview never authorizes a later mutation.
func (s *Store) TaskChangeImpact(t Task) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, p := range s.state.Tasks {
		if p.ID == t.ID {
			t.Exceptions = p.Exceptions
			_, n, err := retainedExceptions(t)
			return n, err
		}
	}
	return 0, errors.New("задача не найдена")
}
func (s *Store) Occurrences(from, to string) ([]Occurrence, error) {
	a, e1 := time.Parse(time.RFC3339, from)
	b, e2 := time.Parse(time.RFC3339, to)
	if e1 != nil || e2 != nil || !b.After(a) || b.Sub(a) > 366*24*time.Hour {
		return nil, errors.New("укажите интервал календаря не больше 366 дней")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []Occurrence{}
	for _, t := range s.state.Tasks {
		rows, err := expandTask(t, a, b)
		if err != nil {
			return nil, err
		}
		out = append(out, rows...)
	}
	slices.SortFunc(out, func(a, b Occurrence) int {
		x, _ := time.Parse(time.RFC3339, a.Start)
		y, _ := time.Parse(time.RFC3339, b.Start)
		if n := x.Compare(y); n != 0 {
			return n
		}
		return strings.Compare(a.ID, b.ID)
	})
	return out, nil
}
func (s *Store) Occurrence(taskID, date string) (Occurrence, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, t := range s.state.Tasks {
		if t.ID == taskID {
			if o, ok := occurrenceOn(t, date); ok {
				return o, nil
			}
			return Occurrence{}, errors.New("повторение уже удалено или исключено из расписания")
		}
	}
	return Occurrence{}, errors.New("задача не найдена")
}
func (s *Store) SaveException(taskID string, ex TaskException) error {
	return s.change(func(v *Snapshot) error {
		for i := range v.Tasks {
			t := &v.Tasks[i]
			if t.ID != taskID {
				continue
			}
			if t.Recurrence == nil {
				return errors.New("задача не повторяется")
			}
			c, err := recurrenceFor(*t)
			if err != nil {
				return err
			}
			if !c.matches(ex.Date) {
				return errors.New("дата не входит в расписание серии")
			}
			t.Exceptions = slices.DeleteFunc(t.Exceptions, func(p TaskException) bool { return p.Date == ex.Date })
			if ex.Done || ex.Skipped || ex.Start != "" || ex.End != "" {
				t.Exceptions = append(t.Exceptions, ex)
			}
			return nil
		}
		return errors.New("задача не найдена")
	})
}
func (s *Store) ResetException(taskID, date string) error {
	return s.change(func(v *Snapshot) error {
		for i := range v.Tasks {
			t := &v.Tasks[i]
			if t.ID == taskID {
				t.Exceptions = slices.DeleteFunc(t.Exceptions, func(p TaskException) bool { return p.Date == date })
				return nil
			}
		}
		return errors.New("задача не найдена")
	})
}
