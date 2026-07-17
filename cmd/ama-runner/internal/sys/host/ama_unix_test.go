//go:build !windows

package host

import "testing"

func TestUnixSupportsAMARuntime(t *testing.T) {
	if !SupportsAMARuntime() {
		t.Fatal("Unix hosts must report AMA runtime support")
	}
}
