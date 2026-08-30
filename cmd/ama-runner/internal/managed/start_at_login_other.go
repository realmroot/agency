//go:build !darwin && !linux && !windows

package managed

func syncServiceStartAtLogin(string, bool) error {
	return nil
}

func startServiceNow(string, bool) error {
	return nil
}

func updateServiceStartAtLogin(string, bool) (func() error, error) {
	return func() error { return nil }, nil
}
