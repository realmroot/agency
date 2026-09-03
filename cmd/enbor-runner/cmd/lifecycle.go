package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"text/tabwriter"
	"time"

	runnercli "github.com/realmroot/enbor/cmd/enbor-runner/internal/cli"
	"github.com/realmroot/enbor/cmd/enbor-runner/internal/instance"
	"github.com/realmroot/enbor/cmd/enbor-runner/internal/managed"
	"github.com/realmroot/enbor/cmd/enbor-runner/pkg/version"
	"github.com/spf13/cobra"
)

func runCommand(ctx context.Context, build version.Info) *cobra.Command {
	command := &cobra.Command{
		Use:           "run",
		Short:         "Run one Enbor Runner in the foreground",
		Args:          cobra.NoArgs,
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(command *cobra.Command, _ []string) error {
			return runDaemon(ctx, command, build)
		},
	}
	runnercli.RegisterRunFlags(command)
	return command
}

func startCommand(build version.Info, stdout io.Writer) *cobra.Command {
	var startAtLogin bool
	command := &cobra.Command{
		Use:           "start [instance-id]",
		Short:         "Create or start a managed Enbor Runner instance",
		Args:          cobra.MaximumNArgs(1),
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(command *cobra.Command, args []string) error {
			registry := commandRegistry(command)
			var record instance.Record
			var err error
			if len(args) == 1 {
				if command.Flags().Changed("start-at-login") {
					return fmt.Errorf("use enbor-runner configure %s --start-at-login=<true|false> to change login startup", args[0])
				}
				record, err = registry.Get(args[0])
			} else {
				config, loadErr := runnercli.LoadManagedStartConfig(command)
				if loadErr != nil {
					return loadErr
				}
				record, err = instance.NewRecord(config)
				if err == nil {
					record.StartAtLogin = startAtLogin
					existing, getErr := registry.Get(record.ID)
					switch {
					case getErr == nil:
						if existing.Config != record.Config || existing.StartAtLogin != record.StartAtLogin || existing.CredentialPath != record.CredentialPath || existing.AccountID != record.AccountID {
							return fmt.Errorf("runner instance %s already exists with different configuration; use enbor-runner configure %s", record.ID, record.ID)
						}
						record = existing
					case errors.Is(getErr, instance.ErrNotFound):
						err = registry.Create(record)
					default:
						err = getErr
					}
				}
			}
			if err != nil {
				return err
			}
			controller, err := newManagedController(registry, build)
			if err != nil {
				return err
			}
			if err := controller.Start(record); err != nil {
				return err
			}
			fmt.Fprintf(stdout, "%s ready\n", record.ID)
			return nil
		},
	}
	runnercli.RegisterManagedStartFlags(command)
	command.Flags().BoolVar(&startAtLogin, "start-at-login", false, "start this Runner automatically when the user logs in")
	return command
}

func listCommand(ctx context.Context, build version.Info, stdout io.Writer) *cobra.Command {
	var output string
	command := &cobra.Command{
		Use:           "list",
		Short:         "List local Enbor Runner instances",
		Args:          cobra.NoArgs,
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(command *cobra.Command, _ []string) error {
			registry := commandRegistry(command)
			records, err := registry.List()
			if err != nil {
				return err
			}
			controller, err := newManagedController(registry, build)
			if err != nil {
				return err
			}
			statuses := make([]managed.Status, len(records))
			var wait sync.WaitGroup
			for index, record := range records {
				wait.Add(1)
				go func() {
					defer wait.Done()
					statusContext, cancel := context.WithTimeout(ctx, 2*time.Second)
					defer cancel()
					statuses[index] = controller.Status(statusContext, record)
				}()
			}
			wait.Wait()
			return printStatuses(stdout, output, statuses)
		},
	}
	command.Flags().StringVarP(&output, "output", "o", "table", "output format: table or json")
	return command
}

func statusCommand(ctx context.Context, build version.Info, stdout io.Writer) *cobra.Command {
	var output string
	command := &cobra.Command{
		Use:           "status <instance-id>",
		Short:         "Inspect one local Enbor Runner instance",
		Args:          cobra.ExactArgs(1),
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(command *cobra.Command, args []string) error {
			registry := commandRegistry(command)
			record, err := registry.Get(args[0])
			if err != nil {
				return err
			}
			controller, err := newManagedController(registry, build)
			if err != nil {
				return err
			}
			statusContext, cancel := context.WithTimeout(ctx, 2*time.Second)
			defer cancel()
			return printStatuses(stdout, output, []managed.Status{controller.Status(statusContext, record)})
		},
	}
	command.Flags().StringVarP(&output, "output", "o", "table", "output format: table or json")
	return command
}

func stopCommand(build version.Info, stdout io.Writer) *cobra.Command {
	var force bool
	command := &cobra.Command{
		Use:           "stop <instance-id>",
		Short:         "Stop and disable one managed Enbor Runner instance",
		Args:          cobra.ExactArgs(1),
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(command *cobra.Command, args []string) error {
			registry := commandRegistry(command)
			record, err := registry.Get(args[0])
			if err != nil {
				return err
			}
			controller, err := newManagedController(registry, build)
			if err != nil {
				return err
			}
			if err := controller.Stop(record, force); err != nil {
				return err
			}
			fmt.Fprintf(stdout, "%s stopped\n", record.ID)
			return nil
		},
	}
	command.Flags().BoolVar(&force, "force", false, "kill the Runner process if graceful shutdown times out")
	return command
}

func restartCommand(build version.Info, stdout io.Writer) *cobra.Command {
	return &cobra.Command{
		Use:           "restart <instance-id>",
		Short:         "Restart one managed Enbor Runner instance",
		Args:          cobra.ExactArgs(1),
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(command *cobra.Command, args []string) error {
			registry := commandRegistry(command)
			record, err := registry.Get(args[0])
			if err != nil {
				return err
			}
			controller, err := newManagedController(registry, build)
			if err != nil {
				return err
			}
			if err := controller.Restart(record); err != nil {
				return err
			}
			fmt.Fprintf(stdout, "%s ready\n", record.ID)
			return nil
		},
	}
}

func logsCommand(ctx context.Context, build version.Info, stdout io.Writer) *cobra.Command {
	var follow bool
	command := &cobra.Command{
		Use:           "logs <instance-id>",
		Short:         "Read logs for one managed Enbor Runner instance",
		Args:          cobra.ExactArgs(1),
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(command *cobra.Command, args []string) error {
			registry := commandRegistry(command)
			record, err := registry.Get(args[0])
			if err != nil {
				return err
			}
			controller, err := newManagedController(registry, build)
			if err != nil {
				return err
			}
			return managed.CopyLogs(ctx, controller.LogPath(record), follow, stdout)
		},
	}
	command.Flags().BoolVarP(&follow, "follow", "f", false, "follow appended log output")
	return command
}

func configureCommand(build version.Info, stdout io.Writer) *cobra.Command {
	var maxConcurrent int
	var projectID string
	var allowUnsafeProcess bool
	var startAtLogin bool
	command := &cobra.Command{
		Use:           "configure <instance-id>",
		Short:         "Update mutable configuration for one Runner instance",
		Args:          cobra.ExactArgs(1),
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(command *cobra.Command, args []string) error {
			runtimeChanged := command.Flags().Changed("max-concurrent") || command.Flags().Changed("project-id") || command.Flags().Changed("allow-unsafe-process")
			loginPolicySpecified := command.Flags().Changed("start-at-login")
			if !runtimeChanged && !loginPolicySpecified {
				return fmt.Errorf("at least one configuration flag is required")
			}
			registry := commandRegistry(command)
			record, err := registry.Get(args[0])
			if err != nil {
				return err
			}
			controller, err := newManagedController(registry, build)
			if err != nil {
				return err
			}
			if runtimeChanged {
				running, err := controller.IsRunning(record)
				if err != nil {
					return err
				}
				if running {
					return fmt.Errorf("runner instance %s must be stopped before its runtime configuration can be changed", record.ID)
				}
			}
			if command.Flags().Changed("max-concurrent") {
				record.Config.MaxConcurrent = maxConcurrent
			}
			if command.Flags().Changed("project-id") {
				record.Config.ProjectID = projectID
			}
			if command.Flags().Changed("allow-unsafe-process") {
				record.Config.AllowUnsafeProcess = allowUnsafeProcess
			}
			if loginPolicySpecified {
				record.StartAtLogin = startAtLogin
			}
			if err := record.Config.Validate(); err != nil {
				return err
			}
			var rollbackLoginPolicy func() error
			if loginPolicySpecified {
				rollbackLoginPolicy, err = controller.SetStartAtLogin(record, record.StartAtLogin)
				if err != nil {
					return err
				}
			}
			if err := registry.Put(record); err != nil {
				if rollbackLoginPolicy != nil {
					if rollbackErr := rollbackLoginPolicy(); rollbackErr != nil {
						return fmt.Errorf("save runner instance %s configuration: %w; rollback login startup failed: %v", record.ID, err, rollbackErr)
					}
				}
				return err
			}
			if runtimeChanged {
				fmt.Fprintf(stdout, "%s configured; restart it to apply the runtime change\n", record.ID)
			} else {
				fmt.Fprintf(stdout, "%s login startup configured; current process unchanged\n", record.ID)
			}
			return nil
		},
	}
	command.Flags().IntVar(&maxConcurrent, "max-concurrent", 0, "max concurrent leases")
	command.Flags().StringVar(&projectID, "project-id", "", "Enbor project id")
	command.Flags().BoolVar(&allowUnsafeProcess, "allow-unsafe-process", false, "acknowledge unsafe process adapter")
	command.Flags().BoolVar(&startAtLogin, "start-at-login", false, "start this Runner automatically when the user logs in")
	return command
}

func removeCommand(build version.Info, stdout io.Writer) *cobra.Command {
	var purge bool
	command := &cobra.Command{
		Use:           "remove <instance-id>",
		Short:         "Remove one managed Enbor Runner instance",
		Args:          cobra.ExactArgs(1),
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(command *cobra.Command, args []string) error {
			registry := commandRegistry(command)
			record, err := registry.Get(args[0])
			if err != nil {
				return err
			}
			controller, err := newManagedController(registry, build)
			if err != nil {
				return err
			}
			if err := controller.Stop(record, false); err != nil {
				return err
			}
			if err := registry.Remove(record.ID); err != nil {
				return err
			}
			if purge {
				expectedStateDir := filepath.Clean(record.Config.StateDir)
				if expectedStateDir == "." || expectedStateDir == string(filepath.Separator) {
					return fmt.Errorf("refusing to purge unsafe runner state directory %q", record.Config.StateDir)
				}
				if err := os.RemoveAll(expectedStateDir); err != nil {
					return err
				}
			}
			fmt.Fprintf(stdout, "%s removed\n", record.ID)
			return nil
		},
	}
	command.Flags().BoolVar(&purge, "purge", false, "permanently delete Runner identity, workspaces, events, and logs")
	return command
}

func serviceRunCommand(build version.Info) *cobra.Command {
	command := &cobra.Command{
		Use:           "service-run <instance-id>",
		Args:          cobra.ExactArgs(1),
		Hidden:        true,
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(command *cobra.Command, args []string) error {
			registry := commandRegistry(command)
			record, err := registry.Get(args[0])
			if err != nil {
				return err
			}
			controller, err := newManagedController(registry, build)
			if err != nil {
				return err
			}
			return controller.RunService(record)
		},
	}
	return command
}

func commandRegistry(command *cobra.Command) instance.Registry {
	dir, _ := command.Flags().GetString("registry-dir")
	if strings.TrimSpace(dir) == "" {
		dir = instance.DefaultRegistry().Dir
	}
	return instance.Registry{Dir: dir}
}

type managedController interface {
	Start(instance.Record) error
	Stop(instance.Record, bool) error
	Restart(instance.Record) error
	Status(context.Context, instance.Record) managed.Status
	RunService(instance.Record) error
	LogPath(instance.Record) string
	IsRunning(instance.Record) (bool, error)
	SetStartAtLogin(instance.Record, bool) (func() error, error)
}

var newManagedController = func(registry instance.Registry, build version.Info) (managedController, error) {
	return managed.NewController(registry, build)
}

func printStatuses(stdout io.Writer, output string, statuses []managed.Status) error {
	switch output {
	case "json":
		encoder := json.NewEncoder(stdout)
		encoder.SetIndent("", "  ")
		return encoder.Encode(statuses)
	case "table":
		writer := tabwriter.NewWriter(stdout, 0, 4, 2, ' ', 0)
		if _, err := fmt.Fprintln(writer, "INSTANCE\tAPI SERVER\tENVIRONMENT\tACCOUNT\tLOCAL\tCONTROL PLANE\tSTART AT LOGIN\tPID"); err != nil {
			return err
		}
		for _, status := range statuses {
			pid := "-"
			if status.PID > 0 {
				pid = fmt.Sprintf("%d", status.PID)
			}
			if _, err := fmt.Fprintf(writer, "%s\t%s\t%s\t%s\t%s\t%s\t%t\t%s\n", status.ID, status.APIServer, status.EnvironmentID, status.AccountID, status.LocalState, status.ControlState, status.StartAtLogin, pid); err != nil {
				return err
			}
		}
		return writer.Flush()
	default:
		return fmt.Errorf("unsupported output format %q", output)
	}
}
