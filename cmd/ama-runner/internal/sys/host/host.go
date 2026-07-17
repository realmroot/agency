package host

import "runtime"

type Info struct {
	OS   string
	Arch string
}

func Current() Info {
	return Info{OS: runtime.GOOS, Arch: runtime.GOARCH}
}
