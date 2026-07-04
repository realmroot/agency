package runtime

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/pkg/runtimebridge"
)

type bridgeProtocol struct{}
type bridgeLineReader struct {
	reader *bufio.Reader
}

func (bridgeProtocol) lineReader(reader io.Reader) *bridgeLineReader {
	return &bridgeLineReader{reader: bufio.NewReader(reader)}
}

func (r *bridgeLineReader) readLine() ([]byte, error) {
	line, err := r.reader.ReadBytes('\n')
	if err != nil {
		if err == io.EOF && len(line) > 0 {
			return bytes.TrimSpace(line), nil
		}
		return nil, err
	}
	return bytes.TrimSpace(line), nil
}

func (bridgeProtocol) encodeLine(value any) ([]byte, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return append(data, '\n'), nil
}

func (bridgeProtocol) waitReady(reader *bridgeLineReader) error {
	line, err := reader.readLine()
	if err != nil {
		if err == io.EOF {
			return fmt.Errorf("runtime bridge exited before ready")
		}
		return err
	}
	if len(line) == 0 {
		return fmt.Errorf("runtime bridge exited before ready")
	}
	var envelope runtimebridge.RuntimeBridgeOutputMessage
	if err := json.Unmarshal(line, &envelope); err != nil {
		return fmt.Errorf("invalid runtime bridge ready message: %w", err)
	}
	if envelope.Type != runtimebridge.BridgeMessageTypeReady {
		return fmt.Errorf("runtime bridge did not send ready message")
	}
	return nil
}

func (bridgeProtocol) readResult(
	reader *bridgeLineReader,
	requestID string,
	write EventWriter,
	onResumeToken func(string) error,
	onProviderEvent func(string, JSON) error,
) (JSON, error) {
	for {
		line, err := reader.readLine()
		if err != nil {
			if err == io.EOF {
				return nil, fmt.Errorf("runtime bridge exited before result for request %q", requestID)
			}
			return nil, err
		}
		if len(line) == 0 {
			continue
		}
		var envelope runtimebridge.RuntimeBridgeOutputMessage
		if err := json.Unmarshal(line, &envelope); err != nil {
			return nil, fmt.Errorf("invalid runtime bridge message: %w", err)
		}
		if envelope.RequestID != "" && envelope.RequestID != requestID {
			continue
		}
		switch envelope.Type {
		case runtimebridge.BridgeMessageTypeResumeToken:
			if onResumeToken != nil && envelope.ResumeToken != "" {
				if err := onResumeToken(envelope.ResumeToken); err != nil {
					return nil, err
				}
			}
		case runtimebridge.BridgeMessageTypeRuntimeEvent:
			if envelope.Event == nil {
				return nil, fmt.Errorf("runtime bridge event missing body")
			}
			if _, ok := envelope.Event["type"].(string); !ok {
				return nil, fmt.Errorf("runtime bridge event missing type")
			}
			if err := write(envelope.Event); err != nil {
				return nil, err
			}
		case runtimebridge.BridgeMessageTypeProviderEvent:
			if envelope.Runtime == "" {
				return nil, fmt.Errorf("runtime bridge provider event missing runtime")
			}
			if envelope.Event == nil {
				return nil, fmt.Errorf("runtime bridge provider event missing body")
			}
			if _, ok := envelope.Event["type"].(string); !ok {
				return nil, fmt.Errorf("runtime bridge provider event missing type")
			}
			if onProviderEvent != nil {
				if err := onProviderEvent(string(envelope.Runtime), envelope.Event); err != nil {
					return nil, err
				}
			}
		case runtimebridge.BridgeMessageTypeResult:
			return envelope.Result, nil
		case runtimebridge.BridgeMessageTypeError:
			if envelope.Error.Message == "" {
				return nil, fmt.Errorf("runtime bridge failed")
			}
			return nil, fmt.Errorf("%s", envelope.Error.Message)
		default:
			return nil, fmt.Errorf("unsupported runtime bridge message type %q", envelope.Type)
		}
	}
}

func (bridgeProtocol) controlFrame(requestID string, command BridgeControlFrame) (JSON, error) {
	var frame JSON
	if err := json.Unmarshal(command, &frame); err != nil {
		return nil, fmt.Errorf("invalid bridge control message: %w", err)
	}
	if frame == nil {
		return nil, fmt.Errorf("invalid bridge control message")
	}
	frame["requestId"] = requestID
	return frame, nil
}

func (bridgeProtocol) inventorySnapshot(value JSON) (*InventorySnapshot, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var raw runtimebridge.RuntimeBridgeInventoryResult
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	snapshot := &InventorySnapshot{Runtimes: make([]InventoryRuntime, 0, len(raw.Runtimes))}
	for _, item := range raw.Runtimes {
		if item.Runtime == "" {
			return nil, fmt.Errorf("runtime bridge inventory entry missing runtime")
		}
		snapshot.Runtimes = append(snapshot.Runtimes, InventoryRuntime{
			Runtime:        string(item.Runtime),
			Binary:         item.Binary,
			Installed:      item.Installed,
			FallbackModels: append([]string(nil), item.FallbackModels...),
			Models:         append([]string(nil), item.Models...),
			Status:         item.Status,
			Version:        item.Version,
			Detail:         item.Detail,
			UsageWindows:   append([]UsageWindow(nil), item.UsageWindows...),
			LimitedDetail:  item.LimitedDetail,
		})
	}
	return snapshot, nil
}
