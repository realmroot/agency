//go:build windows

package sandbox

import (
	"context"
	"strings"
	"testing"
)

func TestWindowsProcessAdapterRejectsAMARuntimeTools(t *testing.T) {
	_, err := (ProcessAdapter{}).Execute(context.Background(), ToolRequest{ToolName: "read", WorkDir: t.TempDir()})
	if err == nil || !strings.Contains(err.Error(), "not supported on windows") {
		t.Fatalf("expected Windows AMA runtime rejection, got %v", err)
	}
}
