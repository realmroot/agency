package daemon

import (
	"testing"

	enbor "github.com/realmroot/enbor/sdk/go/enbor"
)

func TestSDKErrorClassifiers(t *testing.T) {
	if !IsClaimRaceError(&enbor.APIError{Status: 409}) {
		t.Fatal("expected conflict to be a claim race")
	}
	if !IsClaimRaceError(&enbor.APIError{Status: 404}) {
		t.Fatal("expected not found to be a claim race")
	}
	if IsClaimRaceError(&enbor.APIError{Status: 500}) {
		t.Fatal("expected server error not to be a claim race")
	}
	if !IsRunnerGoneError(&enbor.APIError{Status: 404}) {
		t.Fatal("expected not found to mean runner gone")
	}
	if IsRunnerGoneError(&enbor.APIError{Status: 409}) {
		t.Fatal("expected conflict not to mean runner gone")
	}
}

func TestWorkItemSessionID(t *testing.T) {
	sessionID := "session_1"
	if got := workItemSessionID(&enbor.WorkItem{SessionId: &sessionID}); got != sessionID {
		t.Fatalf("expected session id %q, got %q", sessionID, got)
	}
	if got := workItemSessionID(&enbor.WorkItem{}); got != "" {
		t.Fatalf("expected empty session id for missing field, got %q", got)
	}
	if got := workItemSessionID(nil); got != "" {
		t.Fatalf("expected empty session id for nil work item, got %q", got)
	}
}
