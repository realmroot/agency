package cmd

import (
	"context"

	runnercli "github.com/realmroot/enbor/cmd/enbor-runner/internal/cli"
	"github.com/realmroot/enbor/cmd/enbor-runner/pkg/version"
	"github.com/spf13/cobra"
)

func runDaemon(ctx context.Context, command *cobra.Command, build version.Info) error {
	return runnercli.RunDaemon(ctx, command, build)
}
