package daemon

import (
	"testing"

	ama "github.com/realmroot/enbor/sdk/go/enbor"
)

func TestSDKErrorClassifiers(t *testing.T) {
	if !IsClaimRaceError(&ama.APIError{Status: 409}) {
		t.Fatal("expected conflict to be a claim race")
	}
	if !IsClaimRaceError(&ama.APIError{Status: 404}) {
		t.Fatal("expected not found to be a claim race")
	}
	if IsClaimRaceError(&ama.APIError{Status: 500}) {
		t.Fatal("expected server error not to be a claim race")
	}
	if !IsRunnerGoneError(&ama.APIError{Status: 404}) {
		t.Fatal("expected not found to mean runner gone")
	}
	if IsRunnerGoneError(&ama.APIError{Status: 409}) {
		t.Fatal("expected conflict not to mean runner gone")
	}
}

func TestWorkItemSessionID(t *testing.T) {
	sessionID := "session_1"
	if got := workItemSessionID(&ama.WorkItem{SessionId: &sessionID}); got != sessionID {
		t.Fatalf("expected session id %q, got %q", sessionID, got)
	}
	if got := workItemSessionID(&ama.WorkItem{}); got != "" {
		t.Fatalf("expected empty session id for missing field, got %q", got)
	}
	if got := workItemSessionID(nil); got != "" {
		t.Fatalf("expected empty session id for nil work item, got %q", got)
	}
}
