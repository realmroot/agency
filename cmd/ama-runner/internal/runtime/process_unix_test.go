//go:build !windows

package runtime

import (
	"os/exec"
	"syscall"
)

func configureTestProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}
