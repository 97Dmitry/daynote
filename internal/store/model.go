package store

import (
	"errors"
	"fmt"
	"regexp"
	"time"
)

type Topic struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Color    string `json:"color"`
	Position int    `json:"position"`
}
type Note struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Body      string `json:"body"`
	Date      string `json:"date"`
	TopicID   string `json:"topicId"`
	Pinned    bool   `json:"pinned"`
	Position  int    `json:"position"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}
type Task struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Start       string   `json:"start"`
	End         string   `json:"end"`
	Color       string   `json:"color"`
	Done        bool     `json:"done"`
	NoteIDs     []string `json:"noteIds"`
}
type Snapshot struct {
	Version int     `json:"version"`
	Topics  []Topic `json:"topics"`
	Notes   []Note  `json:"notes"`
	Tasks   []Task  `json:"tasks"`
}

var colorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func validate(s Snapshot) error {
	if s.Version != 1 {
		return errors.New("неподдерживаемая версия данных")
	}
	topics, notes, tasks := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for _, v := range s.Topics {
		if v.ID == "" || topics[v.ID] || len(v.Name) == 0 || len(v.Name) > 300 || !colorPattern.MatchString(v.Color) {
			return errors.New("некорректная тема")
		}
		topics[v.ID] = true
	}
	for _, v := range s.Notes {
		if v.ID == "" || notes[v.ID] || len(v.Title) > 1000 || len(v.Body) > 2<<20 || v.Position < 0 {
			return errors.New("некорректная заметка")
		}
		notes[v.ID] = true
		if _, err := time.Parse("2006-01-02", v.Date); err != nil {
			return errors.New("укажите существующую дату заметки")
		}
		if v.TopicID != "" && !topics[v.TopicID] {
			return errors.New("тема заметки не найдена")
		}
	}
	for _, v := range s.Tasks {
		if v.ID == "" || tasks[v.ID] || len(v.Title) == 0 || len(v.Title) > 1000 || len(v.Description) > 2<<20 || !colorPattern.MatchString(v.Color) {
			return errors.New("некорректная задача")
		}
		tasks[v.ID] = true
		start, e1 := time.Parse(time.RFC3339, v.Start)
		end, e2 := time.Parse(time.RFC3339, v.End)
		if e1 != nil || e2 != nil || !end.After(start) {
			return errors.New("конец задачи должен быть позже начала; укажите дату, время и часовой пояс")
		}
		seen := map[string]bool{}
		for _, id := range v.NoteIDs {
			if !notes[id] || seen[id] {
				return fmt.Errorf("некорректная связь заметки с задачей")
			}
			seen[id] = true
		}
	}
	return nil
}
