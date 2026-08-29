package cli

import (
	"errors"
	"os"
	"strings"
	"time"

	"github.com/go-viper/mapstructure/v2"
	runnerauth "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/auth"
	runnerconfig "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/config"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

type runConfigOption struct {
	Key     string
	Flag    string
	Env     string
	Default any
	Usage   string
}

var runConfigOptions = []runConfigOption{
	{Key: "apiServer", Flag: "api-server", Env: "AMA_API_SERVER", Usage: "AMA API server URL"},
	{Key: "projectId", Flag: "project-id", Env: "AMA_PROJECT_ID", Usage: "AMA project id"},
	{Key: "environmentId", Flag: "environment-id", Env: "AMA_ENVIRONMENT_ID", Usage: "AMA environment id"},
	{Key: "allowUnsafeProcess", Flag: "allow-unsafe-process", Env: "AMA_RUNNER_ALLOW_UNSAFE_PROCESS", Default: false, Usage: "acknowledge unsafe process adapter"},
	{Key: "stateDir", Flag: "state-dir", Env: "AMA_RUNNER_STATE_DIR", Usage: "override runner state directory (default: isolated by API server)"},
	{Key: "workDir", Flag: "work-dir", Env: "AMA_RUNNER_WORKDIR", Usage: "override local work directory (default: state directory/work)"},
	{Key: "maxConcurrent", Flag: "max-concurrent", Env: "AMA_RUNNER_MAX_CONCURRENT", Default: 5, Usage: "max concurrent leases"},
	{Key: "heartbeatInterval", Env: "AMA_RUNNER_HEARTBEAT_INTERVAL", Default: 20 * time.Second},
	{Key: "leaseDurationSeconds", Env: "AMA_RUNNER_LEASE_SECONDS", Default: 60},
	{Key: "renewInterval", Env: "AMA_RUNNER_RENEW_INTERVAL", Default: 20 * time.Second},
	{Key: "commandTimeout", Env: "AMA_RUNNER_COMMAND_TIMEOUT", Default: 10 * time.Minute},
	{Key: "shutdownGraceInterval", Env: "AMA_RUNNER_SHUTDOWN_GRACE", Default: 5 * time.Second},
	{Key: "maxSessionDuration", Env: "AMA_RUNNER_MAX_SESSION_DURATION", Default: 2 * time.Hour},
}

func RegisterRunFlags(command *cobra.Command) {
	flags := command.Flags()
	for _, option := range runConfigOptions {
		if option.Flag == "" {
			continue
		}
		switch defaultValue := defaultRunValue(option).(type) {
		case bool:
			flags.Bool(option.Flag, defaultValue, option.Usage)
		case int:
			flags.Int(option.Flag, defaultValue, option.Usage)
		case string:
			flags.String(option.Flag, defaultValue, option.Usage)
		case time.Duration:
			flags.Duration(option.Flag, defaultValue, option.Usage)
		default:
			flags.String(option.Flag, defaultStringFlagValue(option), option.Usage)
		}
	}
}

func RegisterGlobalFlags(command *cobra.Command) {
	command.PersistentFlags().String("config", runnerconfig.DefaultConfigPath(), "runner config file")
}

func LoadRunConfig(command *cobra.Command) (runnerconfig.Config, error) {
	values, err := newRunConfigViper(command)
	if err != nil {
		return runnerconfig.Config{}, err
	}
	configPath, err := runConfigPath(command)
	if err != nil {
		return runnerconfig.Config{}, err
	}
	if err := readConfigFile(values, configPath, configFlagChanged(command) || strings.TrimSpace(os.Getenv("AMA_RUNNER_CONFIG")) != ""); err != nil {
		return runnerconfig.Config{}, err
	}
	var config runnerconfig.Config
	if err := values.Unmarshal(&config, viper.DecodeHook(mapstructure.StringToTimeDurationHookFunc())); err != nil {
		return runnerconfig.Config{}, err
	}
	config.ConfigPath = configPath
	config.CredentialPath = credentialPath()
	if err := applySavedLogin(&config); err != nil {
		return runnerconfig.Config{}, err
	}
	if err := applyDefaultStoragePaths(&config); err != nil {
		return runnerconfig.Config{}, err
	}
	if err := config.Validate(); err != nil {
		return runnerconfig.Config{}, err
	}
	return config, nil
}

func newRunConfigViper(command *cobra.Command) (*viper.Viper, error) {
	values := viper.New()
	for _, option := range runConfigOptions {
		values.SetDefault(option.Key, defaultRunValue(option))
		if err := values.BindEnv(option.Key, option.Env); err != nil {
			return nil, err
		}
		if option.Flag != "" {
			if err := values.BindPFlag(option.Key, command.Flags().Lookup(option.Flag)); err != nil {
				return nil, err
			}
		}
	}
	return values, nil
}

func defaultRunValue(option runConfigOption) any {
	switch option.Key {
	case "stateDir", "workDir":
		return ""
	default:
		return option.Default
	}
}

func applyDefaultStoragePaths(config *runnerconfig.Config) error {
	if strings.TrimSpace(config.StateDir) == "" {
		stateDir, err := runnerconfig.DefaultStateDirForAPIServer(config.APIServer)
		if err != nil {
			return err
		}
		config.StateDir = stateDir
	}
	if strings.TrimSpace(config.WorkDir) == "" {
		config.WorkDir = runnerconfig.DefaultWorkDirForStateDir(config.StateDir)
	}
	return nil
}

func defaultStringFlagValue(option runConfigOption) string {
	value, _ := defaultRunValue(option).(string)
	return value
}

func readConfigFile(values *viper.Viper, configPath string, required bool) error {
	configPath = strings.TrimSpace(configPath)
	if configPath == "" {
		return nil
	}
	values.SetConfigFile(configPath)
	err := values.ReadInConfig()
	if err == nil {
		return nil
	}
	var notFound viper.ConfigFileNotFoundError
	if !required && (errors.As(err, &notFound) || errors.Is(err, os.ErrNotExist)) {
		return nil
	}
	return err
}

func runConfigPath(command *cobra.Command) (string, error) {
	flag := command.Flag("config")
	if flag != nil && flag.Changed {
		return flag.Value.String(), nil
	}
	if value := strings.TrimSpace(os.Getenv("AMA_RUNNER_CONFIG")); value != "" {
		return value, nil
	}
	return runnerconfig.DefaultConfigPath(), nil
}

func credentialPath() string {
	if value := strings.TrimSpace(os.Getenv("AMA_RUNNER_CREDENTIALS")); value != "" {
		return value
	}
	return runnerconfig.DefaultCredentialPath()
}

func applySavedLogin(config *runnerconfig.Config) error {
	saved, err := runnerconfig.LoadCredentialProfile(config.CredentialPath, config.APIServer)
	if err != nil {
		return err
	}
	if saved == nil {
		return errors.New("AMA runner is not logged in; run ama-runner auth login")
	}
	if strings.TrimSpace(config.APIServer) == "" {
		config.APIServer = saved.APIServer
	}
	if !strings.EqualFold(strings.TrimSpace(saved.TokenType), "Bearer") {
		return errors.New("saved AMA runner login is not a Realmroot Bearer credential; run ama-runner auth login again")
	}
	return nil
}

func RegisterAuthLoginFlags(command *cobra.Command) {
	flags := command.Flags()
	flags.String("api-server", "", "AMA API server URL")
}

func RegisterAuthSwitchFlags(command *cobra.Command) {
	command.Flags().String("api-server", "", "AMA API server URL")
}

func LoadAuthLoginConfig(command *cobra.Command) (runnerauth.LoginCommand, error) {
	values := viper.New()
	if err := values.BindEnv("apiServer", "AMA_API_SERVER"); err != nil {
		return runnerauth.LoginCommand{}, err
	}
	if err := values.BindPFlag("apiServer", command.Flags().Lookup("api-server")); err != nil {
		return runnerauth.LoginCommand{}, err
	}
	configPath := authLoginConfigPath(command)
	if err := readConfigFile(values, configPath, configFlagChanged(command) || strings.TrimSpace(os.Getenv("AMA_RUNNER_CONFIG")) != ""); err != nil {
		return runnerauth.LoginCommand{}, err
	}
	return runnerauth.ValidateLoginCommand(runnerauth.LoginCommand{
		APIServer:      values.GetString("apiServer"),
		CredentialPath: credentialPath(),
	})
}

func authLoginConfigPath(command *cobra.Command) string {
	flag := command.Flag("config")
	if flag != nil && flag.Changed {
		return flag.Value.String()
	}
	if value := strings.TrimSpace(os.Getenv("AMA_RUNNER_CONFIG")); value != "" {
		return value
	}
	return runnerconfig.DefaultConfigPath()
}

func AuthCredentialPath() string {
	return credentialPath()
}

func AuthProfileAPIServer(command *cobra.Command) (string, error) {
	values := viper.New()
	if err := values.BindEnv("apiServer", "AMA_API_SERVER"); err != nil {
		return "", err
	}
	if err := values.BindPFlag("apiServer", command.Flags().Lookup("api-server")); err != nil {
		return "", err
	}
	configPath := authLoginConfigPath(command)
	if err := readConfigFile(values, configPath, configFlagChanged(command) || strings.TrimSpace(os.Getenv("AMA_RUNNER_CONFIG")) != ""); err != nil {
		return "", err
	}
	return values.GetString("apiServer"), nil
}

func configFlagChanged(command *cobra.Command) bool {
	flag := command.Flag("config")
	if flag == nil {
		return false
	}
	return flag.Changed
}
