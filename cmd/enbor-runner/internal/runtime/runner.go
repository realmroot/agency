package runtime

import (
	"context"
	"errors"
	"time"
)

type Runner struct {
	Adapter            Adapter
	RuntimeBridge      Bridge
	MaxSessionDuration time.Duration
}

func (r Runner) Run(ctx context.Context, request Request, write EventWriter) Result {
	if write == nil {
		write = func(JSON) error { return nil }
	}
	adapter := r.Adapter
	if adapter == nil {
		adapter = r.bridge()
	}
	runCtx := ctx
	cancelDeadline := func() {}
	if r.MaxSessionDuration > 0 {
		runCtx, cancelDeadline = context.WithTimeout(ctx, r.MaxSessionDuration)
	}
	defer cancelDeadline()
	result, runErr := adapter.Run(runCtx, request, write)
	timedOut := errors.Is(runCtx.Err(), context.DeadlineExceeded)
	return Result{Output: result, Err: runErr, TimedOut: timedOut}
}

func (r Runner) bridge() Bridge {
	return r.RuntimeBridge
}
