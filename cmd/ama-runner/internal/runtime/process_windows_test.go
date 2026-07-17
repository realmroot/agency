//go:build windows

package runtime

import "os/exec"

func configureTestProcessGroup(_ *exec.Cmd) {}
