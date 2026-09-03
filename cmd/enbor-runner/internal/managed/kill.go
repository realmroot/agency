package managed

import (
	"fmt"
	"os"
)

func killProcess(pid int) error {
	if pid <= 0 {
		return fmt.Errorf("runner process id is invalid")
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return process.Kill()
}
