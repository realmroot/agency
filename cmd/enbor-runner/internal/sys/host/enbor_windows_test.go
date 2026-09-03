//go:build windows

package host

import "testing"

func TestWindowsDoesNotSupportEnborRuntime(t *testing.T) {
	if SupportsEnborRuntime() {
		t.Fatal("Windows must not report Enbor runtime support")
	}
}
