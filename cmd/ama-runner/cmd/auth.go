package cmd

import (
	"context"
	"io"

	runnercli "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/cli"
	"github.com/spf13/cobra"
)

func authCommand(ctx context.Context, stdout io.Writer) *cobra.Command {
	command := &cobra.Command{
		Use:           "auth",
		Short:         "Manage runner authentication",
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	command.AddCommand(
		authLoginCommand(ctx, stdout),
		authLogoutCommand(stdout),
		authRefreshCommand(ctx, stdout),
		authStatusCommand(stdout),
		authSwitchCommand(stdout),
	)
	return command
}

func authLoginCommand(ctx context.Context, stdout io.Writer) *cobra.Command {
	command := &cobra.Command{
		Use:           "login",
		Short:         "Authenticate enbor-runner with Enbor",
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(command *cobra.Command, _ []string) error {
			return runnercli.RunAuthLogin(ctx, command, stdout)
		},
	}
	runnercli.RegisterAuthLoginFlags(command)
	return command
}

func authLogoutCommand(stdout io.Writer) *cobra.Command {
	command := &cobra.Command{
		Use:           "logout [api-server]",
		Short:         "Remove saved runner authentication",
		Args:          cobra.MaximumNArgs(1),
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(command *cobra.Command, args []string) error {
			return runnercli.RunAuthLogout(command, args, stdout)
		},
	}
	return command
}

func authRefreshCommand(ctx context.Context, stdout io.Writer) *cobra.Command {
	command := &cobra.Command{
		Use:           "refresh",
		Short:         "Refresh the active runner authentication token",
		Args:          cobra.NoArgs,
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(command *cobra.Command, _ []string) error {
			return runnercli.RunAuthRefresh(ctx, stdout)
		},
	}
	return command
}

func authStatusCommand(stdout io.Writer) *cobra.Command {
	command := &cobra.Command{
		Use:           "status",
		Short:         "Show saved runner authentication status",
		Args:          cobra.NoArgs,
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(command *cobra.Command, _ []string) error {
			return runnercli.RunAuthStatus(stdout)
		},
	}
	return command
}

func authSwitchCommand(stdout io.Writer) *cobra.Command {
	command := &cobra.Command{
		Use:           "switch [account]",
		Short:         "Switch active runner authentication account",
		Args:          cobra.MaximumNArgs(1),
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(command *cobra.Command, args []string) error {
			return runnercli.RunAuthSwitch(command, args, stdout)
		},
	}
	runnercli.RegisterAuthSwitchFlags(command)
	return command
}
