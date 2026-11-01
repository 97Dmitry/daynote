package store

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
	"time"
)

// ClaimDue atomically stores the durable inbox before any OS notification is
// attempted. A shell error cannot erase a reminder; restarting never replays it.
func (s *Store) ClaimDue(now time.Time) ([]Notification, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now = now.UTC()
	cutoff := now.Add(-24 * time.Hour)
	out := []Notification{}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	for _, t := range s.state.Tasks {
		if t.Done {
			continue
		}
		start, err := time.Parse(time.RFC3339, t.Start)
		if err != nil {
			return nil, err
		}
		for _, r := range t.Reminders {
			due, err := r.Due(start)
			if err != nil {
				return nil, err
			}
			due = due.UTC()
			if due.After(now) || due.Before(cutoff) {
				continue
			}
			date := due.Format(time.RFC3339Nano)
			sum := sha256.Sum256([]byte(t.ID + "\x00" + r.ID + "\x00" + date))
			n := Notification{ID: hex.EncodeToString(sum[:]), TaskID: t.ID, TaskTitle: t.Title, TaskStart: t.Start, DueAt: date, CreatedAt: now.Format(time.RFC3339Nano), Sound: r.Sound}
			b, err := json.Marshal(n)
			if err != nil {
				return nil, err
			}
			result, err := tx.Exec("INSERT INTO notification_receipts(id,task_id,payload) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING", n.ID, n.TaskID, b)
			if err != nil {
				return nil, err
			}
			rows, err := result.RowsAffected()
			if err != nil {
				return nil, err
			}
			if rows == 1 {
				out = append(out, n)
			}
		}
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	sort.Slice(out, func(i, j int) bool {
		return notificationBefore(out[i], out[j])
	})
	return out, nil
}
func (s *Store) Notifications() ([]Notification, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rows, err := s.db.Query("SELECT payload,is_read FROM notification_receipts")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Notification{}
	for rows.Next() {
		var b []byte
		var read bool
		if err = rows.Scan(&b, &read); err != nil {
			return nil, err
		}
		var n Notification
		if err = json.Unmarshal(b, &n); err != nil {
			return nil, err
		}
		n.Read = read
		out = append(out, n)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	sort.Slice(out, func(i, j int) bool {
		return notificationBefore(out[j], out[i])
	})
	return out, nil
}
func (s *Store) Acknowledge(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var err error
	if id == "" {
		_, err = s.db.Exec("UPDATE notification_receipts SET is_read=1 WHERE is_read=0")
	} else {
		_, err = s.db.Exec("UPDATE notification_receipts SET is_read=1 WHERE id=?", id)
	}
	return err
}

func notificationBefore(a, b Notification) bool {
	first, _ := time.Parse(time.RFC3339Nano, a.DueAt)
	second, _ := time.Parse(time.RFC3339Nano, b.DueAt)
	if first.Equal(second) {
		return a.ID < b.ID
	}
	return first.Before(second)
}
