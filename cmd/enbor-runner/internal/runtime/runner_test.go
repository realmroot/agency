package runtime

import (
	"context"
	"errors"
	"testing"
	"time"
)

type runnerAdapter struct {
	output JSON
	err    error
	seen   Request
}

func (a *runnerAdapter) Run(ctx context.Context, request Request, write EventWriter) (JSON, error) {
	a.seen = request
	if a.err != nil {
		return a.output, a.err
	}
	if err := write(JSON{"type": "message.completed"}); err != nil {
		return nil, err
	}
	return a.output, nil
}

type blockingRunnerAdapter struct{}

func (blockingRunnerAdapter) Run(ctx context.Context, _ Request, _ EventWriter) (JSON, error) {
	<-ctx.Done()
	return nil, ctx.Err()
}

func TestRunnerUsesAdapterAndDefaultWriter(t *testing.T) {
	adapter := &runnerAdapter{output: JSON{"exitCode": 0}}
	result := Runner{Adapter: adapter}.Run(context.Background(), Request{SessionID: "session_1"}, nil)
	if result.Err != nil || result.TimedOut {
		t.Fatalf("expected successful result, got %#v", result)
	}
	if result.Output["exitCode"] != 0 {
		t.Fatalf("unexpected output %#v", result.Output)
	}
	if adapter.seen.SessionID != "session_1" {
		t.Fatalf("request was not passed to adapter: %#v", adapter.seen)
	}
}

func TestRunnerReturnsWriterErrors(t *testing.T) {
	writeErr := errors.New("write failed")
	result := Runner{Adapter: &runnerAdapter{output: JSON{"exitCode": 0}}}.Run(
		context.Background(),
		Request{},
		func(JSON) error { return writeErr },
	)
	if !errors.Is(result.Err, writeErr) || result.Output != nil {
		t.Fatalf("expected writer error result, got %#v", result)
	}
}

func TestRunnerMarksTimeout(t *testing.T) {
	result := Runner{Adapter: blockingRunnerAdapter{}, MaxSessionDuration: time.Millisecond}.Run(context.Background(), Request{}, nil)
	if !result.TimedOut || !errors.Is(result.Err, context.DeadlineExceeded) {
		t.Fatalf("expected timeout result, got %#v", result)
	}
}

func TestRunnerUsesBridgeWhenAdapterMissing(t *testing.T) {
	bridge := Bridge{}
	result := Runner{RuntimeBridge: bridge}.Run(context.Background(), Request{}, nil)
	if result.Err == nil {
		t.Fatal("expected zero bridge to fail when no adapter is configured")
	}
}
