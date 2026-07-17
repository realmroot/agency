//go:build windows

package runtime

import (
	"os/exec"
	"testing"
	"time"
)

func TestWindowsBridgeProcessJobStopsTheProcess(t *testing.T) {
	cmd := exec.Command("cmd.exe", "/d", "/s", "/c", "ping -n 30 127.0.0.1 >nul")
	process, err := startBridgeProcess(cmd)
	if err != nil {
		t.Fatal(err)
	}
	defer process.Close()
	process.Stop(0)
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Windows bridge process did not stop with its Job Object")
	}
}
