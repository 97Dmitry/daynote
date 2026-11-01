package store

import (
	"errors"
	"slices"
	"time"
	_ "time/tzdata"
)

// Weekdays use ISO numbering, Monday=1 through Sunday=7.
type Recurrence struct {
	Weekdays []int  `json:"weekdays"`
	TimeZone string `json:"timeZone"`
	Until    string `json:"until"`
}

// Date is the original date in the series timezone, even after moving a day.
type TaskException struct {
	Date    string `json:"date"`
	Done    bool   `json:"done"`
	Skipped bool   `json:"skipped"`
	Start   string `json:"start"`
	End     string `json:"end"`
}
type Occurrence struct {
	ID     string `json:"id"`
	TaskID string `json:"taskId"`
	Date   string `json:"date"`
	Start  string `json:"start"`
	End    string `json:"end"`
	Done   bool   `json:"done"`
}
type recurrenceContext struct {
	task     Task
	start    time.Time
	duration time.Duration
	loc      *time.Location
	anchor   string
}

func recurrenceFor(t Task) (recurrenceContext, error) {
	start, e := time.Parse(time.RFC3339, t.Start)
	if e != nil {
		return recurrenceContext{}, e
	}
	end, e := time.Parse(time.RFC3339, t.End)
	if e != nil {
		return recurrenceContext{}, e
	}
	loc := time.UTC
	if t.Recurrence != nil {
		if t.Recurrence.TimeZone == "" || t.Recurrence.TimeZone == "Local" {
			return recurrenceContext{}, errors.New("укажите часовой пояс серии IANA")
		}
		loc, e = time.LoadLocation(t.Recurrence.TimeZone)
		if e != nil {
			return recurrenceContext{}, errors.New("неизвестный часовой пояс серии")
		}
	}
	if !end.After(start) || !start.Add(end.Sub(start)).Equal(end) {
		return recurrenceContext{}, errors.New("некорректная длительность серии")
	}
	return recurrenceContext{task: t, start: start.In(loc), duration: end.Sub(start), loc: loc, anchor: start.In(loc).Format(time.DateOnly)}, nil
}
func calendarDate(date string) (time.Time, bool) {
	d, err := time.Parse(time.DateOnly, date)
	return d, err == nil && len(date) == 10 && d.Format(time.DateOnly) == date
}
func (c recurrenceContext) matches(date string) bool {
	d, ok := calendarDate(date)
	if !ok || c.task.Recurrence == nil || date < c.anchor {
		return false
	}
	r := c.task.Recurrence
	if r.Until != "" && date > r.Until {
		return false
	}
	day := int(d.Weekday())
	if day == 0 {
		day = 7
	}
	return slices.Contains(r.Weekdays, day)
}

// Resolve a civil clock time explicitly: skip gaps and choose the earlier
// instant in folds. Sampling surrounding offsets also handles whole-day gaps.
func wallTime(date time.Time, clock time.Time, loc *time.Location) (time.Time, bool) {
	wall := time.Date(date.Year(), date.Month(), date.Day(), clock.Hour(), clock.Minute(), clock.Second(), clock.Nanosecond(), time.UTC)
	offsets := map[int]bool{}
	for h := -48; h <= 48; h += 6 {
		_, offset := wall.Add(time.Duration(h) * time.Hour).In(loc).Zone()
		offsets[offset] = true
	}
	var first time.Time
	for offset := range offsets {
		candidate := wall.Add(-time.Duration(offset) * time.Second)
		actual := candidate.In(loc)
		if actual.Year() == wall.Year() && actual.Month() == wall.Month() && actual.Day() == wall.Day() && actual.Hour() == wall.Hour() && actual.Minute() == wall.Minute() && actual.Second() == wall.Second() && actual.Nanosecond() == wall.Nanosecond() {
			if first.IsZero() || candidate.Before(first) {
				first = candidate
			}
		}
	}
	return first, !first.IsZero()
}
func (c recurrenceContext) on(date string) (Occurrence, bool) {
	if !c.matches(date) {
		return Occurrence{}, false
	}
	out := Occurrence{ID: c.task.ID + "/" + date, TaskID: c.task.ID, Date: date}
	for _, ex := range c.task.Exceptions {
		if ex.Date == date {
			if ex.Skipped {
				return Occurrence{}, false
			}
			out.Done = ex.Done
			if ex.Start != "" {
				out.Start = ex.Start
				out.End = ex.End
				return out, true
			}
			break
		}
	}
	d, _ := calendarDate(date)
	start, ok := wallTime(d, c.start, c.loc)
	if !ok {
		return Occurrence{}, false
	}
	out.Start = start.UTC().Format(time.RFC3339Nano)
	out.End = start.Add(c.duration).UTC().Format(time.RFC3339Nano)
	return out, true
}
func occurrenceOn(t Task, date string) (Occurrence, bool) {
	if t.Recurrence == nil {
		if date != "" {
			return Occurrence{}, false
		}
		return Occurrence{ID: t.ID, TaskID: t.ID, Start: t.Start, End: t.End, Done: t.Done}, true
	}
	c, err := recurrenceFor(t)
	if err != nil {
		return Occurrence{}, false
	}
	return c.on(date)
}
func overlaps(o Occurrence, from, to time.Time) bool {
	a, _ := time.Parse(time.RFC3339, o.Start)
	b, _ := time.Parse(time.RFC3339, o.End)
	return a.Before(to) && b.After(from)
}
func expandTask(t Task, from, to time.Time) ([]Occurrence, error) {
	out := []Occurrence{}
	if t.Recurrence == nil {
		o, _ := occurrenceOn(t, "")
		if overlaps(o, from, to) {
			out = append(out, o)
		}
		return out, nil
	}
	c, err := recurrenceFor(t)
	if err != nil {
		return nil, err
	}
	// Start near the requested period, including long overlapping tasks.
	first, _ := calendarDate(from.Add(-c.duration).In(c.loc).Format(time.DateOnly))
	first = first.AddDate(0, 0, -1)
	anchor, _ := calendarDate(c.anchor)
	if first.Before(anchor) {
		first = anchor
	}
	last, _ := calendarDate(to.In(c.loc).Format(time.DateOnly))
	last = last.AddDate(0, 0, 1)
	if t.Recurrence.Until != "" {
		until, _ := calendarDate(t.Recurrence.Until)
		if last.After(until) {
			last = until
		}
	}
	seen := map[string]bool{}
	add := func(date string) {
		if seen[date] {
			return
		}
		seen[date] = true
		if o, ok := c.on(date); ok && overlaps(o, from, to) {
			out = append(out, o)
		}
	}
	for d := first; !d.After(last); d = d.AddDate(0, 0, 1) {
		add(d.Format(time.DateOnly))
	}
	for _, ex := range t.Exceptions {
		if ex.Start != "" {
			add(ex.Date)
		}
	}
	slices.SortFunc(out, func(a, b Occurrence) int {
		x, _ := time.Parse(time.RFC3339, a.Start)
		y, _ := time.Parse(time.RFC3339, b.Start)
		return x.Compare(y)
	})
	return out, nil
}
func validateRecurrence(t Task) error {
	invalid := errors.New("некорректное правило повторения или исключение задачи")
	if t.Recurrence == nil {
		if len(t.Exceptions) != 0 {
			return invalid
		}
		return nil
	}
	if t.Done {
		return errors.New("выполнение повторяющейся задачи отмечается отдельно по дням")
	}
	c, err := recurrenceFor(t)
	if err != nil {
		return err
	}
	r := t.Recurrence
	if len(r.Weekdays) == 0 || len(r.Weekdays) > 7 {
		return invalid
	}
	days := map[int]bool{}
	for _, d := range r.Weekdays {
		if d < 1 || d > 7 || days[d] {
			return invalid
		}
		days[d] = true
	}
	if r.Until != "" {
		if _, ok := calendarDate(r.Until); !ok || r.Until < c.anchor {
			return invalid
		}
	}
	seen := map[string]bool{}
	for _, ex := range t.Exceptions {
		if !c.matches(ex.Date) || seen[ex.Date] || ex.Skipped && (ex.Done || ex.Start != "" || ex.End != "") {
			return invalid
		}
		seen[ex.Date] = true
		if ex.Start != "" || ex.End != "" {
			a, e1 := time.Parse(time.RFC3339, ex.Start)
			b, e2 := time.Parse(time.RFC3339, ex.End)
			if e1 != nil || e2 != nil || !b.After(a) {
				return invalid
			}
		}
	}
	return nil
}
