//go:build !windows

package sandbox

import (
	"os/exec"
	"syscall"
	"time"
)

func configureProcessCommand(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func stopProcessCommand(cmd *exec.Cmd, grace time.Duration) {
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
	time.Sleep(grace)
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
}
