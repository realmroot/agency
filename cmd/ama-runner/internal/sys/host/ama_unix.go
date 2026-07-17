//go:build !windows

package host

func SupportsAMARuntime() bool {
	return true
}
