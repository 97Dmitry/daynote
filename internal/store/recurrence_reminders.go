package store

import "time"

type dueOccurrence struct {
	occurrence Occurrence
	due        time.Time
}

// Search the inverse reminder window, not the entire series history. Moved
// exceptions are checked separately because their original date may be remote.
func reminderOccurrences(t Task, r Reminder, from, to time.Time) ([]dueOccurrence, error) {
	if t.Recurrence == nil {
		o, _ := occurrenceOn(t, "")
		start, _ := time.Parse(time.RFC3339, o.Start)
		due, err := r.Due(start)
		if err != nil {
			return nil, err
		}
		if !o.Done && !due.Before(from) && !due.After(to) {
			return []dueOccurrence{{o, due}}, nil
		}
		return nil, nil
	}
	c, err := recurrenceFor(t)
	if err != nil {
		return nil, err
	}
	var first, last, clock time.Time
	dayOffset := 0
	if r.Kind == "before" {
		offset := time.Duration(r.MinutesBefore) * time.Minute
		first, _ = calendarDate(from.Add(offset).In(c.loc).Format(time.DateOnly))
		last, _ = calendarDate(to.Add(offset).In(c.loc).Format(time.DateOnly))
	} else {
		at, _ := time.Parse(time.RFC3339, r.At)
		clock = at.In(c.loc)
		a, _ := calendarDate(c.anchor)
		b, _ := calendarDate(clock.Format(time.DateOnly))
		dayOffset = int((b.Unix() - a.Unix()) / 86400)
		first, _ = calendarDate(from.In(c.loc).Format(time.DateOnly))
		first = first.AddDate(0, 0, -dayOffset)
		last, _ = calendarDate(to.In(c.loc).Format(time.DateOnly))
		last = last.AddDate(0, 0, -dayOffset)
	}
	first = first.AddDate(0, 0, -1)
	last = last.AddDate(0, 0, 1)
	out := []dueOccurrence{}
	seen := map[string]bool{}
	add := func(date string) {
		if seen[date] {
			return
		}
		seen[date] = true
		o, ok := c.on(date)
		if !ok || o.Done {
			return
		}
		var due time.Time
		if r.Kind == "before" {
			start, _ := time.Parse(time.RFC3339, o.Start)
			due, _ = r.Due(start)
		} else {
			d, _ := calendarDate(date)
			due, ok = wallTime(d.AddDate(0, 0, dayOffset), clock, c.loc)
			if !ok {
				return
			}
		}
		if !due.Before(from) && !due.After(to) {
			out = append(out, dueOccurrence{o, due})
		}
	}
	for d := first; !d.After(last); d = d.AddDate(0, 0, 1) {
		add(d.Format(time.DateOnly))
	}
	if r.Kind == "before" {
		for _, ex := range t.Exceptions {
			if ex.Start != "" {
				add(ex.Date)
			}
		}
	}
	return out, nil
}
