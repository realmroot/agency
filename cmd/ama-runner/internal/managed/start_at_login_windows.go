//go:build windows

package managed

import (
	"fmt"

	"golang.org/x/sys/windows/svc/mgr"
)

func syncServiceStartAtLogin(string, bool) error {
	return nil
}

func startServiceNow(string, bool) error {
	return nil
}

func updateServiceStartAtLogin(serviceName string, enabled bool) (func() error, error) {
	manager, err := mgr.Connect()
	if err != nil {
		return nil, fmt.Errorf("connect to Windows Service Control Manager: %w", err)
	}
	defer manager.Disconnect()
	managedService, err := manager.OpenService(serviceName)
	if err != nil {
		return nil, fmt.Errorf("open Windows service %s: %w", serviceName, err)
	}
	defer managedService.Close()
	config, err := managedService.Config()
	if err != nil {
		return nil, fmt.Errorf("read Windows service %s configuration: %w", serviceName, err)
	}
	previousStartType := config.StartType
	config.StartType = mgr.StartManual
	if enabled {
		config.StartType = mgr.StartAutomatic
	}
	if err := managedService.UpdateConfig(config); err != nil {
		return nil, fmt.Errorf("update Windows service %s login startup: %w", serviceName, err)
	}
	return func() error { return setWindowsServiceStartType(serviceName, previousStartType) }, nil
}

func setWindowsServiceStartType(serviceName string, startType uint32) error {
	manager, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("connect to Windows Service Control Manager: %w", err)
	}
	defer manager.Disconnect()
	managedService, err := manager.OpenService(serviceName)
	if err != nil {
		return fmt.Errorf("open Windows service %s: %w", serviceName, err)
	}
	defer managedService.Close()
	config, err := managedService.Config()
	if err != nil {
		return fmt.Errorf("read Windows service %s configuration: %w", serviceName, err)
	}
	config.StartType = startType
	if err := managedService.UpdateConfig(config); err != nil {
		return fmt.Errorf("restore Windows service %s login startup: %w", serviceName, err)
	}
	return nil
}
