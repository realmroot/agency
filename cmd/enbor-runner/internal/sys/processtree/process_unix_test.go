//go:build !windows

package processtree

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestStopTerminatesUnixProcessTree(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "child.pid")
	cmd := exec.Command("sh", "-lc", "sleep 300 & echo $! > \"$1\"; wait", "sh", marker)
	process, err := Start(cmd)
	if err != nil {
		t.Fatal(err)
	}
	defer process.Close()
	deadline := time.Now().Add(2 * time.Second)
	var childPID string
	for time.Now().Before(deadline) {
		data, err := os.ReadFile(marker)
		if err == nil && strings.TrimSpace(string(data)) != "" {
			childPID = strings.TrimSpace(string(data))
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if childPID == "" {
		t.Fatal("timed out waiting for child pid")
	}
	process.Stop(10 * time.Millisecond)
	_ = process.Wait()
	if err := exec.Command("kill", "-0", childPID).Run(); err == nil {
		t.Fatalf("expected child process %s to be killed with process group", childPID)
	}
}
