package session

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	enbor "github.com/realmroot/enbor/sdk/go/enbor"
)

// Event is one canonical event in the runner's local log. The id and sequence
// are assigned once at append so they stay stable across live relay and backfill
// reads; the browser dedups by them. The JSON shape intentionally matches the
// Enbor SessionEvent transport record.
type Event struct {
	ID        string   `json:"id"`
	SessionID string   `json:"sessionId"`
	Sequence  int64    `json:"sequence"`
	CreatedAt string   `json:"createdAt"`
	Type      string   `json:"type"`
	Payload   enbor.JSON `json:"payload"`
}

// EventLog is the runner's local, durable, per-session event log for
// CLI relay-only runtimes (claude-code/codex/copilot, loop on the runner). Their
// events live here — the cloud keeps no copy — surviving runner restarts and
// stale workspace cleanup. The RunnerPool relays backfill reads to this store.
// Append-only JSONL.
type EventLog struct {
	path      string
	sessionID string
	mu        sync.Mutex
	seq       int64
}

var eventLogPathLocks sync.Map

func eventLogPathLock(path string) *sync.Mutex {
	lock, _ := eventLogPathLocks.LoadOrStore(path, &sync.Mutex{})
	return lock.(*sync.Mutex)
}

// EventLogPath is the canonical on-disk log file for a session's event
// store. The relay serves a backfill for a completed session straight from
// this file, so the path is shared rather than re-derived.
func EventLogPath(sessionDir string) string {
	return filepath.Join(sessionDir, "events.jsonl")
}

func OpenEventLog(sessionDir string, sessionID string) (*EventLog, error) {
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		return nil, err
	}
	store := &EventLog{path: EventLogPath(sessionDir), sessionID: sessionID}
	pathLock := eventLogPathLock(store.path)
	pathLock.Lock()
	defer pathLock.Unlock()
	// Recover the latest sequence so a resumed session continues the run rather
	// than restarting the count (the on-disk log is the source of truth).
	events, err := store.readAll()
	if err != nil {
		return nil, err
	}
	if len(events) > 0 {
		store.seq = events[len(events)-1].Sequence
	}
	return store, nil
}

func newEventID() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate runner event id: %w", err)
	}
	return "event_" + hex.EncodeToString(buf), nil
}

// Append durably records one event and returns it (with its stable id/sequence)
// so the caller can both relay it live upstream and serve it on backfill.
func (s *EventLog) Append(body enbor.JSON) (Event, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	pathLock := eventLogPathLock(s.path)
	pathLock.Lock()
	defer pathLock.Unlock()
	events, err := s.readAll()
	if err != nil {
		return Event{}, err
	}
	for _, event := range events {
		if event.Sequence > s.seq {
			s.seq = event.Sequence
		}
	}
	s.seq++
	id, err := newEventID()
	if err != nil {
		return Event{}, err
	}
	eventType, ok := body["type"].(string)
	if !ok || eventType == "" {
		return Event{}, fmt.Errorf("session event is missing type")
	}
	payload, ok := body["payload"].(enbor.JSON)
	if !ok {
		payloadRecord, ok := body["payload"].(map[string]any)
		if !ok {
			payload = enbor.JSON{}
		} else {
			payload = enbor.JSON(payloadRecord)
		}
	}
	event := Event{
		ID:        id,
		SessionID: s.sessionID,
		Sequence:  s.seq,
		CreatedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Type:      eventType,
		Payload:   payload,
	}
	line, err := json.Marshal(event)
	if err != nil {
		return event, err
	}
	file, err := os.OpenFile(s.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return event, err
	}
	defer file.Close()
	if _, err := file.Write(append(line, '\n')); err != nil {
		return event, err
	}
	return event, nil
}

func (e Event) EnborEvent() enbor.JSON {
	return enbor.JSON{"type": e.Type, "payload": e.Payload}
}

// ReadAll returns the full ordered log. The server applies the cursor/type/
// visibility filters and pagination after canonicalising, so a backfill read
// hands back every event (the runner's contract is "the whole local log").
func (s *EventLog) ReadAll() ([]Event, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	pathLock := eventLogPathLock(s.path)
	pathLock.Lock()
	defer pathLock.Unlock()
	return s.readAll()
}

func (s *EventLog) readAll() ([]Event, error) {
	return readEventLog(s.path)
}

// ReadEventLog reads a session's full ordered log straight from disk. The
// relay uses it to answer a backfill for a session whose live store is gone
// (the lease completed) — the events survive on disk. A missing log is an empty
// history, not an error.
func ReadEventLog(path string) ([]Event, error) {
	pathLock := eventLogPathLock(path)
	pathLock.Lock()
	defer pathLock.Unlock()
	return readEventLog(path)
}

func readEventLog(path string) ([]Event, error) {
	file, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	var events []Event
	reader := bufio.NewReader(file)
	line := 0
	for {
		raw, err := reader.ReadBytes('\n')
		if err != nil {
			if err == io.EOF && len(raw) == 0 {
				return events, nil
			}
			if err != io.EOF {
				return nil, err
			}
		}
		raw = bytes.TrimSpace(raw)
		if len(raw) == 0 {
			if err == io.EOF {
				return events, nil
			}
			continue
		}
		line++
		var event Event
		if err := json.Unmarshal(raw, &event); err != nil {
			return nil, fmt.Errorf("read session event log %s line %d: %w", path, line, err)
		}
		events = append(events, event)
		if err == io.EOF {
			return events, nil
		}
	}
}
