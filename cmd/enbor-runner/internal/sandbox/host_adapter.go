package sandbox

import (
	"time"

	"github.com/realmroot/enbor/cmd/enbor-runner/internal/sys/host"
)

const ProcessUnsafeAdapterName = "process-unsafe"

func NewHostAdapter(commandTimeout time.Duration, shutdownGraceInterval time.Duration) SandboxAdapter {
	if !host.SupportsEnborRuntime() {
		return nil
	}
	return ProcessAdapter{CommandTimeout: commandTimeout, ShutdownGraceInterval: shutdownGraceInterval}
}

func HostAdapterName() string {
	if !host.SupportsEnborRuntime() {
		return "none"
	}
	return ProcessUnsafeAdapterName
}
