package cli

import (
	"bytes"
	"strings"
	"testing"

	"github.com/realmroot/enbor/cmd/enbor-runner/pkg/version"
)

func TestRunVersionPrintsTextAndJSON(t *testing.T) {
	info := version.Info{Name: "enbor-runner", Version: "1.2.3", Commit: "abc", BuildDate: "today"}
	var output bytes.Buffer
	if err := RunVersion(info, &output, false); err != nil {
		t.Fatalf("expected text version, got %v", err)
	}
	if !strings.Contains(output.String(), "enbor-runner 1.2.3 (abc, built today)") {
		t.Fatalf("unexpected text version output: %s", output.String())
	}

	output.Reset()
	if err := RunVersion(info, &output, true); err != nil {
		t.Fatalf("expected json version, got %v", err)
	}
	if !strings.Contains(output.String(), `"version":"1.2.3"`) {
		t.Fatalf("unexpected json version output: %s", output.String())
	}
}
