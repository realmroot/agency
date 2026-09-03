//go:build !windows

package host

import "testing"

func TestUnixSupportsEnborRuntime(t *testing.T) {
	if !SupportsEnborRuntime() {
		t.Fatal("Unix hosts must report Enbor runtime support")
	}
}
