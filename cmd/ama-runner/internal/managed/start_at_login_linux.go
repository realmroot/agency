//go:build linux

package managed

import (
	"fmt"
	"os/exec"
	"strings"
)

func syncServiceStartAtLogin(serviceName string, enabled bool) error {
	action := "disable"
	if enabled {
		action = "enable"
	}
	output, err := exec.Command("systemctl", "--user", action, serviceName+".service").CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemctl --user %s %s.service: %w: %s", action, serviceName, err, strings.TrimSpace(string(output)))
	}
	return nil
}

func startServiceNow(string, bool) error {
	return nil
}

func updateServiceStartAtLogin(serviceName string, enabled bool) (func() error, error) {
	previous, err := systemdServiceStartAtLogin(serviceName)
	if err != nil {
		return nil, err
	}
	if err := syncServiceStartAtLogin(serviceName, enabled); err != nil {
		return nil, err
	}
	return func() error { return syncServiceStartAtLogin(serviceName, previous) }, nil
}

func systemdServiceStartAtLogin(serviceName string) (bool, error) {
	output, err := exec.Command("systemctl", "--user", "is-enabled", serviceName+".service").CombinedOutput()
	switch strings.TrimSpace(string(output)) {
	case "enabled":
		return true, nil
	case "disabled":
		return false, nil
	default:
		if err == nil {
			return false, fmt.Errorf("systemctl --user is-enabled %s.service returned unexpected state %q", serviceName, strings.TrimSpace(string(output)))
		}
		return false, fmt.Errorf("systemctl --user is-enabled %s.service: %w: %s", serviceName, err, strings.TrimSpace(string(output)))
	}
}
