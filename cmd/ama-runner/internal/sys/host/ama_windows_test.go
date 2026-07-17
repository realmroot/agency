//go:build windows

package host

import "testing"

func TestWindowsDoesNotSupportAMARuntime(t *testing.T) {
	if SupportsAMARuntime() {
		t.Fatal("Windows must not report AMA runtime support")
	}
}
