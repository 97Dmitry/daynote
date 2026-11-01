// Package voice owns one microphone/transcription session. Raw audio is never saved.
package voice

import (
	"context"
	"errors"
	"github.com/97Dmitry/daynote/internal/audio"
	"github.com/97Dmitry/daynote/internal/stt"
	"strings"
	"sync"
	"time"
)

type Event struct {
	SessionID string `json:"sessionId"`
	State     string `json:"state"`
	Text      string `json:"text"`
	Error     string `json:"error"`
	Warning   string `json:"warning"`
}
type Controller struct {
	op                 sync.Mutex
	mu                 sync.Mutex
	provider           stt.Provider
	capture            audio.Capturer
	emit               func(Event)
	id, state, message string
	warning            string
	parts              map[string]string
	kinds              map[string]string
	order              []string
	session            stt.SessionAPI
	stop               func()
	cancel             context.CancelFunc
	done               chan struct{}
}

func New(p stt.Provider, c audio.Capturer, emit func(Event)) *Controller {
	return &Controller{provider: p, capture: c, emit: emit}
}
func (c *Controller) event() Event {
	c.mu.Lock()
	defer c.mu.Unlock()
	parts := []string{}
	for _, id := range c.order {
		if t := strings.TrimSpace(c.parts[id]); t != "" {
			parts = append(parts, t)
		}
	}
	return Event{SessionID: c.id, State: c.state, Text: strings.Join(parts, "\n"), Error: c.message, Warning: c.warning}
}
func (c *Controller) publish() { c.emit(c.event()) }
func (c *Controller) Start(id string) error {
	c.op.Lock()
	defer c.op.Unlock()
	c.mu.Lock()
	if c.cancel != nil {
		c.mu.Unlock()
		return errors.New("запись уже идёт")
	}
	ctx, cancel := context.WithCancel(context.Background())
	c.cancel = cancel
	c.id = id
	c.state = "connecting"
	c.message = ""
	c.warning = ""
	c.parts = map[string]string{}
	c.kinds = map[string]string{}
	c.order = nil
	c.mu.Unlock()
	c.publish()
	failed := func(err error) error {
		cancel()
		if c.session != nil {
			_ = c.session.Close()
			<-c.done
			c.session = nil
		}
		c.mu.Lock()
		c.cancel = nil
		c.state = "error"
		c.message = err.Error()
		c.mu.Unlock()
		c.publish()
		return err
	}
	s, err := c.provider.Start(ctx, nil)
	if err != nil {
		return failed(err)
	}
	c.session = s
	c.done = make(chan struct{})
	go c.consume(s, c.done)
	if err = s.Open(ctx, id, "mic", nil); err != nil {
		return failed(err)
	}
	_, stop, err := c.capture.Start(ctx, audio.Mic, func(f audio.Frame) {
		if e := s.Push(id, f.Rate, f.Channels, f.Samples); e != nil {
			c.mu.Lock()
			if c.message == "" {
				c.message = e.Error()
			}
			c.mu.Unlock()
			c.publish()
		}
	}, func(e error) {
		c.mu.Lock()
		c.message = e.Error()
		c.mu.Unlock()
		c.publish()
		go func() { _ = c.Stop() }()
	})
	if err != nil {
		return failed(err)
	}
	c.stop = stop
	c.mu.Lock()
	c.state = "recording"
	c.mu.Unlock()
	c.publish()
	return nil
}
func (c *Controller) consume(s stt.SessionAPI, done chan struct{}) {
	defer close(done)
	for ev := range s.Events() {
		c.mu.Lock()
		switch v := ev.(type) {
		case stt.Update:
			if _, ok := c.parts[v.UtteranceID]; !ok {
				c.order = append(c.order, v.UtteranceID)
			}
			c.parts[v.UtteranceID] = v.Text
			c.kinds[v.UtteranceID] = v.Kind
		case stt.StreamError:
			c.message = v.Message
			go func() { _ = c.Stop() }()
		case error:
			c.message = v.Error()
			go func() { _ = c.Stop() }()
		}
		c.mu.Unlock()
		c.publish()
	}
}
func (c *Controller) Stop() error { c.op.Lock(); defer c.op.Unlock(); return c.finish(true) }
func (c *Controller) Cancel() {
	c.mu.Lock()
	if c.cancel != nil {
		c.cancel()
	}
	c.mu.Unlock()
	c.op.Lock()
	defer c.op.Unlock()
	_ = c.finish(false)
}
func (c *Controller) finish(flush bool) error {
	c.mu.Lock()
	active := c.cancel != nil
	if active {
		c.state = "stopping"
	}
	c.mu.Unlock()
	if !active {
		return nil
	}
	c.publish()
	if c.stop != nil {
		c.stop()
		c.stop = nil
	}
	var err error
	if c.session != nil {
		if flush {
			ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
			err = c.session.Flush(ctx, c.id)
			cancel()
		}
		_ = c.session.Close()
		<-c.done
		c.session = nil
	}
	c.mu.Lock()
	if c.cancel != nil {
		c.cancel()
	}
	c.cancel = nil
	if errors.Is(err, stt.ErrUnconfirmed) {
		// Close and the consumer have finished. Judge the actual retained text,
		// including any final or interim events received during shutdown.
		hasFinal, pending := false, false
		for id, kind := range c.kinds {
			if kind != stt.KindFinal {
				pending = true
			} else if strings.TrimSpace(c.parts[id]) != "" {
				hasFinal = true
			}
		}
		if !hasFinal || pending {
			c.warning = err.Error()
		}
		err = nil
	}
	if err != nil {
		c.message = err.Error()
	}
	if flush {
		c.state = "ready"
	} else {
		c.state = "cancelled"
		c.message = ""
		c.warning = ""
		c.parts = map[string]string{}
		c.kinds = map[string]string{}
		c.order = nil
	}
	c.mu.Unlock()
	c.publish()
	return err
}
