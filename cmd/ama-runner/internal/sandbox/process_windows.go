//go:build windows

package sandbox

import (
	"os/exec"
	"time"
)

func configureProcessCommand(_ *exec.Cmd) {}

func stopProcessCommand(cmd *exec.Cmd, _ time.Duration) {
	_ = cmd.Process.Kill()
}
