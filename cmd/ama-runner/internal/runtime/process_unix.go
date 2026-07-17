//go:build !windows

package runtime

import (
	"os/exec"
	"syscall"
	"time"
)

type bridgeProcess struct {
	cmd *exec.Cmd
}

func startBridgeProcess(cmd *exec.Cmd) (*bridgeProcess, error) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return &bridgeProcess{cmd: cmd}, nil
}

func (p *bridgeProcess) Stop(grace time.Duration) {
	if p == nil || p.cmd.Process == nil {
		return
	}
	_ = syscall.Kill(-p.cmd.Process.Pid, syscall.SIGTERM)
	if grace > 0 {
		time.Sleep(grace)
	}
	_ = syscall.Kill(-p.cmd.Process.Pid, syscall.SIGKILL)
}

func (p *bridgeProcess) Close() {}
