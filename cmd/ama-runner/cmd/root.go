package cmd

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"

	runnercli "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/cli"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/pkg/version"
	"github.com/spf13/cobra"
)

func Run(args []string, build ...version.Info) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	info := version.Info{}
	if len(build) > 0 {
		info = build[0]
	}
	return execute(ctx, args, info, os.Stdout, io.Discard)
}

func execute(ctx context.Context, args []string, build version.Info, stdout io.Writer, stderr io.Writer) error {
	command := rootCommand(ctx, build.Normalized(), writerOrDiscard(stdout), writerOrDiscard(stderr))
	command.SetArgs(args)
	return command.ExecuteContext(ctx)
}

func rootCommand(ctx context.Context, build version.Info, stdout io.Writer, stderr io.Writer) *cobra.Command {
	stdout = writerOrDiscard(stdout)
	stderr = writerOrDiscard(stderr)
	root := &cobra.Command{
		Use:           "enbor-runner",
		Short:         "Manage Enbor self-hosted Runner instances",
		Version:       build.Version,
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	root.SetOut(stdout)
	root.SetErr(stderr)
	root.SetVersionTemplate(fmt.Sprintf("%s %s (%s, built %s)\n", build.Name, build.Version, build.Commit, build.BuildDate))
	runnercli.RegisterGlobalFlags(root)
	root.PersistentFlags().String("registry-dir", "", "managed Runner instance registry directory")
	_ = root.PersistentFlags().MarkHidden("registry-dir")
	root.AddCommand(
		authCommand(ctx, stdout),
		runCommand(ctx, build),
		startCommand(build, stdout),
		listCommand(ctx, build, stdout),
		statusCommand(ctx, build, stdout),
		stopCommand(build, stdout),
		restartCommand(build, stdout),
		logsCommand(ctx, build, stdout),
		configureCommand(build, stdout),
		removeCommand(build, stdout),
		serviceRunCommand(build),
		versionCommand(build, stdout),
	)
	return root
}

func writerOrDiscard(writer io.Writer) io.Writer {
	if writer != nil {
		return writer
	}
	return io.Discard
}
