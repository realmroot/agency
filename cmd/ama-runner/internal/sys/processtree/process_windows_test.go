//go:build windows

package processtree

import (
	"os/exec"
	"testing"
	"time"
)

func TestStopTerminatesWindowsJob(t *testing.T) {
	cmd := exec.Command("cmd.exe", "/d", "/s", "/c", "ping -n 30 127.0.0.1 >nul")
	process, err := Start(cmd)
	if err != nil {
		t.Fatal(err)
	}
	defer process.Close()
	process.Stop(0)
	done := make(chan error, 1)
	go func() { done <- process.Wait() }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Windows Job Object did not stop its process tree")
	}
}
