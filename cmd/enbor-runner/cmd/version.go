package cmd

import (
	"io"

	runnercli "github.com/realmroot/enbor/cmd/enbor-runner/internal/cli"
	"github.com/realmroot/enbor/cmd/enbor-runner/pkg/version"
	"github.com/spf13/cobra"
)

func versionCommand(build version.Info, stdout io.Writer) *cobra.Command {
	var jsonOutput bool
	command := &cobra.Command{
		Use:           "version",
		Short:         "Print enbor-runner build metadata",
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(_ *cobra.Command, _ []string) error {
			return runnercli.RunVersion(build, stdout, jsonOutput)
		},
	}
	command.Flags().BoolVar(&jsonOutput, "json", false, "print JSON")
	return command
}
