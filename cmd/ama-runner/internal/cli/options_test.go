package cli

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runnerconfig "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/config"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/pkg/version"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

func TestLoadRunConfigAppliesSavedLoginAndFlags(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.json")
	credentialPath := filepath.Join(t.TempDir(), "credentials.json")
	t.Setenv("AMA_RUNNER_CONFIG", configPath)
	t.Setenv("AMA_RUNNER_CREDENTIALS", credentialPath)
	if err := runnerconfig.SaveLocalConfigValue(configPath, "apiServer", "https://ama.example.test"); err != nil {
		t.Fatal(err)
	}
	if err := runnerconfig.SaveLocalConfigValue(configPath, "environmentId", "env_1"); err != nil {
		t.Fatal(err)
	}
	if err := runnerconfig.SaveLocalConfigValue(configPath, "allowUnsafeProcess", "true"); err != nil {
		t.Fatal(err)
	}
	if err := runnerconfig.SaveCredentialProfile(credentialPath, runnerconfig.CredentialProfile{
		AccountID:   "acct_1",
		APIServer:   "https://ama.example.test",
		AccessToken: "saved-token",
		TokenType:   "Bearer",
		ExpiresAt:   time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatal(err)
	}
	command := runConfigTestCommand(t,
		"--work-dir", t.TempDir(),
		"--state-dir", t.TempDir(),
		"--max-concurrent", "2",
	)
	config, err := LoadRunConfig(command)
	if err != nil {
		t.Fatalf("expected run config, got %v", err)
	}
	if config.APIServer != "https://ama.example.test" || config.EnvironmentID != "env_1" {
		t.Fatalf("expected saved login and config file values, got %#v", config)
	}
	if config.CredentialPath != credentialPath || config.ConfigPath != configPath {
		t.Fatalf("unexpected path/token flags: %#v", config)
	}
}

func TestLoadRunConfigUsesDurationFlagAndConfigFlag(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.json")
	credentialPath := filepath.Join(t.TempDir(), "credentials.json")
	t.Setenv("AMA_RUNNER_CREDENTIALS", credentialPath)
	if err := runnerconfig.SaveCredentialProfile(credentialPath, runnerconfig.CredentialProfile{
		AccountID: "acct_1", APIServer: "https://ama.example.test", AccessToken: "saved-token",
		TokenType: "Bearer",
	}); err != nil {
		t.Fatal(err)
	}
	if err := runnerconfig.SaveLocalConfigValue(configPath, "apiServer", "https://ama.example.test"); err != nil {
		t.Fatal(err)
	}
	if err := runnerconfig.SaveLocalConfigValue(configPath, "environmentId", "env_1"); err != nil {
		t.Fatal(err)
	}
	if err := runnerconfig.SaveLocalConfigValue(configPath, "allowUnsafeProcess", "true"); err != nil {
		t.Fatal(err)
	}
	command := runConfigTestCommand(t,
		"--config", configPath,
		"--work-dir", t.TempDir(),
		"--state-dir", t.TempDir(),
		"--max-concurrent", "3",
	)
	command.Flags().Duration("test-duration", time.Second, "test duration")
	runConfigOptions = append(runConfigOptions, runConfigOption{Key: "testDuration", Flag: "test-duration", Env: "AMA_RUNNER_TEST_DURATION", Default: time.Second, Usage: "test duration"})
	t.Cleanup(func() { runConfigOptions = runConfigOptions[:len(runConfigOptions)-1] })
	config, err := LoadRunConfig(command)
	if err != nil {
		t.Fatalf("expected run config, got %v", err)
	}
	if config.ConfigPath != configPath || config.MaxConcurrent != 3 {
		t.Fatalf("unexpected config %#v", config)
	}
}

func TestRegisterRunFlagsSupportsDurationOptions(t *testing.T) {
	original := runConfigOptions
	runConfigOptions = append(runConfigOptions, runConfigOption{Key: "testDuration", Flag: "test-duration", Env: "AMA_RUNNER_TEST_DURATION", Default: time.Second, Usage: "test duration"})
	t.Cleanup(func() { runConfigOptions = original })
	command := &cobra.Command{}
	RegisterRunFlags(command)
	if command.Flags().Lookup("test-duration") == nil {
		t.Fatal("expected duration flag to be registered")
	}
}

func TestLoadRunConfigReturnsValidationError(t *testing.T) {
	command := runConfigTestCommand(t)
	if _, err := LoadRunConfig(command); err == nil {
		t.Fatal("expected invalid run config to fail")
	}
}

func TestOptionBindingErrorsWhenCommandsMissExpectedFlags(t *testing.T) {
	if _, err := newRunConfigViper(&cobra.Command{}); err == nil {
		t.Fatal("expected missing run flag binding error")
	}
	if _, err := LoadAuthLoginConfig(&cobra.Command{}); err == nil {
		t.Fatal("expected missing auth login flag binding error")
	}
	if _, err := AuthProfileAPIServer(&cobra.Command{}); err == nil {
		t.Fatal("expected missing auth switch flag binding error")
	}
}

func TestApplySavedLoginFillsServerFromBearerProfile(t *testing.T) {
	credentialPath := filepath.Join(t.TempDir(), "credentials.json")
	if err := runnerconfig.SaveCredentialProfile(credentialPath, runnerconfig.CredentialProfile{
		AccountID:   "acct_1",
		APIServer:   "https://ama.example.test",
		AccessToken: "saved-token",
		TokenType:   "Bearer",
		ExpiresAt:   time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatal(err)
	}
	config := runnerconfig.Config{CredentialPath: credentialPath}
	if err := applySavedLogin(&config); err != nil {
		t.Fatalf("apply saved login: %v", err)
	}
	if config.APIServer != "https://ama.example.test" {
		t.Fatalf("expected saved server, got %#v", config)
	}
}

func TestReadConfigFileRequiredAndOptional(t *testing.T) {
	values := viper.New()
	if err := readConfigFile(values, filepath.Join(t.TempDir(), "missing.json"), false); err != nil {
		t.Fatalf("optional missing config should be ignored: %v", err)
	}
	if err := readConfigFile(values, filepath.Join(t.TempDir(), "missing.json"), true); err == nil {
		t.Fatal("expected required missing config to fail")
	}
	if err := readConfigFile(values, "", true); err != nil {
		t.Fatalf("empty config path should be ignored: %v", err)
	}
}

func TestRunDaemonReturnsConfigError(t *testing.T) {
	command := runConfigTestCommand(t)
	if err := RunDaemon(t.Context(), command, version.Info{}); err == nil {
		t.Fatal("expected daemon command to return config error")
	}
}

func TestAuthConfigPathAndProfileAPIServer(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.json")
	if err := runnerconfig.SaveLocalConfigValue(configPath, "apiServer", "https://config.example.test"); err != nil {
		t.Fatal(err)
	}
	command := authSwitchTestCommand(t, "--config", configPath)
	got, err := AuthProfileAPIServer(command)
	if err != nil {
		t.Fatalf("expected api server from config, got %v", err)
	}
	if got != "https://config.example.test" {
		t.Fatalf("unexpected api server %q", got)
	}
	t.Setenv("AMA_RUNNER_CONFIG", configPath)
	if got := authLoginConfigPath(authLoginTestCommand(t)); got != configPath {
		t.Fatalf("expected auth login config env path, got %q", got)
	}
}

func TestAuthLoginAndSwitchConfigUseEnvironment(t *testing.T) {
	t.Setenv("AMA_API_SERVER", "https://env.example.test")
	t.Setenv("AMA_RUNNER_CREDENTIALS", filepath.Join(t.TempDir(), "credentials.json"))

	login, err := LoadAuthLoginConfig(authLoginTestCommand(t))
	if err != nil {
		t.Fatalf("expected auth login config from env, got %v", err)
	}
	if login.APIServer != "https://env.example.test" {
		t.Fatalf("unexpected login api server %q", login.APIServer)
	}

	got, err := AuthProfileAPIServer(authSwitchTestCommand(t))
	if err != nil {
		t.Fatalf("expected auth switch api server from env, got %v", err)
	}
	if got != "https://env.example.test" {
		t.Fatalf("unexpected switch api server %q", got)
	}
}

func TestApplySavedLoginRejectsUnknownExplicitServer(t *testing.T) {
	credentialPath := filepath.Join(t.TempDir(), "credentials.json")
	if err := runnerconfig.SaveCredentialProfile(credentialPath, runnerconfig.CredentialProfile{
		AccountID:   "acct_1",
		APIServer:   "https://saved.example.test",
		AccessToken: "saved-token",
		TokenType:   "Bearer",
		ExpiresAt:   time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatal(err)
	}
	config := runnerconfig.Config{
		CredentialPath: credentialPath,
		APIServer:      "https://other.example.test",
	}
	if err := applySavedLogin(&config); err == nil || !strings.Contains(err.Error(), "not logged in") {
		t.Fatalf("expected explicit unknown server to require login, got %v", err)
	}
}

func TestConfigFlagChangedHandlesMissingFlag(t *testing.T) {
	if configFlagChanged(&cobra.Command{}) {
		t.Fatal("expected command without config flag to report unchanged")
	}
}

func runConfigTestCommand(t *testing.T, args ...string) *cobra.Command {
	t.Helper()
	command := &cobra.Command{}
	RegisterGlobalFlags(command)
	RegisterRunFlags(command)
	if err := command.ParseFlags(args); err != nil {
		t.Fatal(err)
	}
	return command
}

func TestCredentialPathDefaultAndEnvironment(t *testing.T) {
	t.Setenv("AMA_RUNNER_CREDENTIALS", "")
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	if got := credentialPath(); !strings.HasSuffix(got, filepath.Join("ama-runner", "credentials.json")) {
		t.Fatalf("expected default credential path, got %q", got)
	}
	custom := filepath.Join(t.TempDir(), "creds.json")
	t.Setenv("AMA_RUNNER_CREDENTIALS", " "+custom+" ")
	if got := credentialPath(); got != custom {
		t.Fatalf("expected trimmed custom credential path, got %q", got)
	}
}

func TestRunConfigPathUsesDefaultWhenUnset(t *testing.T) {
	t.Setenv("AMA_RUNNER_CONFIG", "")
	configHome := filepath.Join(t.TempDir(), "config")
	t.Setenv("XDG_CONFIG_HOME", configHome)
	t.Setenv("APPDATA", configHome)
	command := runConfigTestCommand(t)
	got, err := runConfigPath(command)
	if err != nil {
		t.Fatalf("run config path: %v", err)
	}
	if _, err := os.Stat(filepath.Dir(got)); err == nil {
		t.Fatalf("default path lookup should not create directory, got %q", got)
	}
}
