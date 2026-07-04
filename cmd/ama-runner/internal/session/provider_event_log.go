package session

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

// ProviderEvent is the runner's durable copy of one raw provider SDK stream
// event. It is intentionally not a canonical SessionEvent and is never relayed
// to the cloud transcript directly; rebuild tools replay it through the same
// runtime mapper used during live execution.
type ProviderEvent struct {
	Sequence  int64    `json:"sequence"`
	CreatedAt string   `json:"createdAt"`
	Runtime   string   `json:"runtime"`
	Event     ama.JSON `json:"event"`
}

func ProviderEventLogPath(sessionDir string) string {
	return filepath.Join(sessionDir, "provider-events.jsonl")
}

func AppendProviderEvent(sessionDir string, runtimeName string, event ama.JSON) (ProviderEvent, error) {
	if runtimeName == "" {
		return ProviderEvent{}, fmt.Errorf("provider event runtime is required")
	}
	if _, ok := event["type"].(string); !ok {
		return ProviderEvent{}, fmt.Errorf("provider event is missing type")
	}
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		return ProviderEvent{}, err
	}
	path := ProviderEventLogPath(sessionDir)
	pathLock := eventLogPathLock(path)
	pathLock.Lock()
	defer pathLock.Unlock()

	events, err := readProviderEventLog(path)
	if err != nil {
		return ProviderEvent{}, err
	}
	seq := int64(0)
	for _, existing := range events {
		if existing.Sequence > seq {
			seq = existing.Sequence
		}
	}
	record := ProviderEvent{
		Sequence:  seq + 1,
		CreatedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Runtime:   runtimeName,
		Event:     event,
	}
	line, err := json.Marshal(record)
	if err != nil {
		return record, err
	}
	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return record, err
	}
	defer file.Close()
	if _, err := file.Write(append(line, '\n')); err != nil {
		return record, err
	}
	return record, nil
}

func ReadProviderEventLog(path string) ([]ProviderEvent, error) {
	pathLock := eventLogPathLock(path)
	pathLock.Lock()
	defer pathLock.Unlock()
	return readProviderEventLog(path)
}

func readProviderEventLog(path string) ([]ProviderEvent, error) {
	file, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	var events []ProviderEvent
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
		var event ProviderEvent
		if err := json.Unmarshal(raw, &event); err != nil {
			return nil, fmt.Errorf("read provider event log %s line %d: %w", path, line, err)
		}
		events = append(events, event)
		if err == io.EOF {
			return events, nil
		}
	}
}
