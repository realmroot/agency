package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/sys/host"
)

func TestConfigValidateRejectsInvalidBoundaries(t *testing.T) {
	valid := Config{
		APIServer:             "https://ama.example.test",
		EnvironmentID:         "env_1",
		AllowUnsafeProcess:    true,
		StateDir:              t.TempDir(),
		WorkDir:               t.TempDir(),
		MaxConcurrent:         1,
		HeartbeatInterval:     20 * time.Second,
		LeaseDurationSeconds:  60,
		RenewInterval:         20 * time.Second,
		CommandTimeout:        time.Second,
		ShutdownGraceInterval: time.Millisecond,
	}
	cases := []struct {
		name   string
		mutate func(*Config)
		want   string
	}{
		{"apiServerMissing", func(c *Config) { c.APIServer = "" }, "AMA API server URL is required"},
		{"apiServerMalformed", func(c *Config) { c.APIServer = "://bad" }, "absolute URL"},
		{"environment", func(c *Config) { c.EnvironmentID = "" }, "AMA environment id"},
		{"workDir", func(c *Config) { c.WorkDir = "" }, "work dir"},
		{"stateDir", func(c *Config) { c.StateDir = "" }, "runner state directory"},
		{"max", func(c *Config) { c.MaxConcurrent = 0 }, "max concurrent"},
		{"lease", func(c *Config) { c.LeaseDurationSeconds = 10 }, "lease duration"},
		{"heartbeat", func(c *Config) { c.HeartbeatInterval = time.Minute }, "heartbeat interval"},
		{"renew", func(c *Config) { c.RenewInterval = time.Minute }, "renew interval"},
		{"timeout", func(c *Config) { c.CommandTimeout = 0 }, "command timeout"},
		{"maxSession", func(c *Config) { c.MaxSessionDuration = -time.Second }, "max session duration"},
	}
	if host.SupportsAMARuntime() {
		cases = append(cases, struct {
			name   string
			mutate func(*Config)
			want   string
		}{"unsafe", func(c *Config) { c.AllowUnsafeProcess = false }, "process-unsafe adapter requires"})
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			config := valid
			tc.mutate(&config)
			err := config.Validate()
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected %q validation error, got %v", tc.want, err)
			}
		})
	}
}

func TestValidateAPIServerURLAllowsHTTPSAndLoopbackHTTPOnly(t *testing.T) {
	for _, value := range []string{
		"https://ama.example.test",
		"http://localhost:8787",
		"http://127.0.0.1:8787",
		"http://[::1]:8787",
	} {
		if err := ValidateAPIServerURL(value); err != nil {
			t.Fatalf("expected %q to be accepted, got %v", value, err)
		}
	}
	for _, tc := range []struct {
		value string
		want  string
	}{
		{value: "http://ama.example.test", want: "HTTPS"},
		{value: "ftp://ama.example.test", want: "HTTPS"},
		{value: "https://user:secret@ama.example.test", want: "userinfo"},
		{value: "https://ama.example.test?token=secret", want: "query"},
		{value: "https://ama.example.test#fragment", want: "fragment"},
	} {
		if err := ValidateAPIServerURL(tc.value); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("expected %q to fail with %q, got %v", tc.value, tc.want, err)
		}
	}
}

func TestDefaultPathsUseNativeUserDirectories(t *testing.T) {
	configRoot := filepath.Join(t.TempDir(), "config")
	stateRoot := filepath.Join(t.TempDir(), "state")
	t.Setenv("XDG_CONFIG_HOME", configRoot)
	t.Setenv("XDG_STATE_HOME", stateRoot)
	t.Setenv("APPDATA", configRoot)
	t.Setenv("LOCALAPPDATA", stateRoot)
	if got := DefaultConfigPath(); got != filepath.Join(configRoot, appDirectoryName, "config.json") {
		t.Fatalf("config path = %q", got)
	}
	if got := DefaultCredentialPath(); got != filepath.Join(configRoot, appDirectoryName, "credentials.json") {
		t.Fatalf("credential path = %q", got)
	}
	if got := DefaultStateDir(); got != filepath.Join(stateRoot, appDirectoryName) {
		t.Fatalf("state directory = %q", got)
	}
	if got := DefaultWorkDir(); got != filepath.Join(stateRoot, appDirectoryName, "work") {
		t.Fatalf("work directory = %q", got)
	}
}

func TestCredentialStoreSwitchesAccountsAndProfiles(t *testing.T) {
	credentialPath := filepath.Join(t.TempDir(), "credentials.json")
	profiles := []CredentialProfile{
		{AccountID: "acct_1", APIServer: "https://ama.example.test", Email: "one@example.test", AccessToken: "token-1", TokenType: "Bearer"},
		{AccountID: "acct_2", APIServer: "https://ama.example.test", Email: "two@example.test", AccessToken: "token-2", TokenType: "Bearer"},
		{AccountID: "acct_other", APIServer: "https://other.example.test", Email: "other@example.test", AccessToken: "token-other", TokenType: "Bearer"},
	}
	for _, profile := range profiles {
		if err := SaveCredentialProfile(credentialPath, profile); err != nil {
			t.Fatal(err)
		}
	}

	selected, err := SwitchCredentialProfile(credentialPath, "https://ama.example.test", "two@example.test")
	if err != nil {
		t.Fatalf("expected account switch, got %v", err)
	}
	if selected.AccountID != "acct_2" {
		t.Fatalf("expected second account, got %#v", selected)
	}
	active, err := LoadCredentialProfile(credentialPath, "https://ama.example.test")
	if err != nil {
		t.Fatal(err)
	}
	if active == nil || active.AccessToken != "token-2" {
		t.Fatalf("expected active account token, got %#v", active)
	}

	selected, err = SwitchCredentialProfile(credentialPath, "https://other.example.test", "")
	if err != nil {
		t.Fatalf("expected profile switch, got %v", err)
	}
	if selected.AccountID != "acct_other" {
		t.Fatalf("expected other profile, got %#v", selected)
	}

	if _, err := SwitchCredentialProfile(credentialPath, "https://ama.example.test", ""); err == nil || !strings.Contains(err.Error(), "multiple saved accounts") {
		t.Fatalf("expected ambiguous account error, got %v", err)
	}
	if _, err := SwitchCredentialProfile(credentialPath, "https://ama.example.test", "missing@example.test"); err == nil || !strings.Contains(err.Error(), "no saved auth account") {
		t.Fatalf("expected missing account error, got %v", err)
	}
	if _, err := SwitchCredentialProfile(credentialPath, "https://missing.example.test", ""); err == nil || !strings.Contains(err.Error(), "no saved auth profile") {
		t.Fatalf("expected missing profile error, got %v", err)
	}
}

func TestCredentialStoreLoadsAndLogsOutProfiles(t *testing.T) {
	credentialPath := filepath.Join(t.TempDir(), "credentials.json")
	if store, err := LoadCredentialStore(""); err != nil || len(store.Profiles) != 0 {
		t.Fatalf("expected empty store for empty path, store=%#v err=%v", store, err)
	}
	if store, err := LoadCredentialStore(filepath.Join(t.TempDir(), "missing.json")); err != nil || len(store.Profiles) != 0 {
		t.Fatalf("expected empty store for missing path, store=%#v err=%v", store, err)
	}
	if err := os.WriteFile(credentialPath, []byte(`{}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if store, err := LoadCredentialStore(credentialPath); err != nil || store.Active != "" || len(store.Profiles) != 0 {
		t.Fatalf("expected empty store for empty credential file, store=%#v err=%v", store, err)
	}
	if active, err := LoadActiveCredentialProfile(""); err != nil || active != nil {
		t.Fatalf("expected empty active profile for empty path, active=%#v err=%v", active, err)
	}
	profile := CredentialProfile{
		AccountID:   "acct_1",
		APIServer:   "https://ama.example.test/",
		Email:       "runner@example.test",
		AccessToken: "token",
		TokenType:   "Bearer",
		ExpiresAt:   time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	}
	if err := SaveCredentialProfile(credentialPath, profile); err != nil {
		t.Fatal(err)
	}
	active, err := LoadActiveCredentialProfile(credentialPath)
	if err != nil {
		t.Fatal(err)
	}
	if active == nil || active.APIServer != "https://ama.example.test" {
		t.Fatalf("expected normalized active profile, got %#v", active)
	}
	if err := LogoutCredentialProfile(credentialPath, ""); err != nil {
		t.Fatal(err)
	}
	store, err := LoadCredentialStore(credentialPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(store.Profiles) != 0 || store.Active != "" {
		t.Fatalf("expected logout to clear profile, got %#v", store)
	}
	if err := LogoutCredentialProfile(credentialPath, ""); err != nil {
		t.Fatalf("logout with no active profile should be no-op: %v", err)
	}
}

func TestCredentialStoreUpdatesAndReassignsActiveProfiles(t *testing.T) {
	credentialPath := filepath.Join(t.TempDir(), "credentials.json")
	first := CredentialProfile{AccountID: "acct_1", APIServer: "https://ama.example.test", AccessToken: "token-1", TokenType: "Bearer"}
	updated := CredentialProfile{AccountID: "acct_1", APIServer: "https://ama.example.test/", Email: "updated@example.test", AccessToken: "token-updated", TokenType: "Bearer"}
	otherServer := CredentialProfile{AccountID: "acct_2", APIServer: "https://other.example.test", AccessToken: "token-2", TokenType: "Bearer"}
	if err := SaveCredentialProfile(credentialPath, first); err != nil {
		t.Fatal(err)
	}
	if err := SaveCredentialProfile(credentialPath, updated); err != nil {
		t.Fatal(err)
	}
	if err := SaveCredentialProfile(credentialPath, otherServer); err != nil {
		t.Fatal(err)
	}
	store, err := LoadCredentialStore(credentialPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(store.Profiles) != 2 {
		t.Fatalf("expected upsert to replace profile, got %#v", store.Profiles)
	}
	active, err := LoadActiveCredentialProfile(credentialPath)
	if err != nil {
		t.Fatal(err)
	}
	if active == nil || active.AccountID != "acct_2" {
		t.Fatalf("expected last saved profile active, got %#v", active)
	}
	if err := LogoutCredentialProfile(credentialPath, "https://other.example.test"); err != nil {
		t.Fatal(err)
	}
	active, err = LoadActiveCredentialProfile(credentialPath)
	if err != nil {
		t.Fatal(err)
	}
	if active == nil || active.AccessToken != "token-updated" || active.APIServer != "https://ama.example.test" {
		t.Fatalf("expected remaining profile to become active, got %#v", active)
	}
}

func TestCredentialStoreLoadProfileSelection(t *testing.T) {
	credentialPath := filepath.Join(t.TempDir(), "credentials.json")
	for _, profile := range []CredentialProfile{
		{AccountID: "acct_1", APIServer: "https://ama.example.test", AccessToken: "token-1", TokenType: "Bearer"},
		{AccountID: "acct_2", APIServer: "https://ama.example.test", AccessToken: "token-2", TokenType: "Bearer"},
		{AccountID: "acct_3", APIServer: "https://other.example.test", AccessToken: "token-3", TokenType: "Bearer"},
	} {
		if err := SaveCredentialProfile(credentialPath, profile); err != nil {
			t.Fatal(err)
		}
	}
	if got, err := LoadCredentialProfile(credentialPath, "https://missing.example.test"); err != nil || got != nil {
		t.Fatalf("expected no profile for missing server, got %#v err=%v", got, err)
	}
	if _, err := LoadCredentialProfile(credentialPath, "https://ama.example.test"); err == nil || !strings.Contains(err.Error(), "multiple saved accounts") {
		t.Fatalf("expected ambiguous profile error, got %v", err)
	}
	if got, err := LoadCredentialProfile(credentialPath, "https://other.example.test"); err != nil || got == nil || got.AccountID != "acct_3" {
		t.Fatalf("expected single matching profile, got %#v err=%v", got, err)
	}
	if got, err := LoadCredentialProfile(credentialPath, ""); err != nil || got == nil || got.AccountID != "acct_3" {
		t.Fatalf("expected active profile when server omitted, got %#v err=%v", got, err)
	}
}

func TestCredentialStoreRejectsInvalidProfilesAndFiles(t *testing.T) {
	credentialPath := filepath.Join(t.TempDir(), "credentials.json")
	if err := SaveCredentialProfile("", CredentialProfile{AccountID: "acct_1", APIServer: "https://ama.example.test", AccessToken: "token", TokenType: "Bearer"}); err == nil {
		t.Fatal("expected empty credential path to fail")
	}
	for _, profile := range []CredentialProfile{
		{AccountID: "acct_1", APIServer: "https://ama.example.test", TokenType: "Bearer"},
		{APIServer: "https://ama.example.test", AccessToken: "token", TokenType: "Bearer"},
	} {
		if err := SaveCredentialProfile(credentialPath, profile); err == nil {
			t.Fatalf("expected invalid profile error for %#v", profile)
		}
	}
	if err := os.WriteFile(credentialPath, []byte(`{"active":"https://ama.example.test#acct_1","profiles":[{"accountId":"acct_1","apiServer":"https://ama.example.test","accessToken":"token","tokenType":"Bearer","expiresAt":"not-time"}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadActiveCredentialProfile(credentialPath); err == nil {
		t.Fatal("expected malformed expiry error")
	}
	if err := os.WriteFile(credentialPath, []byte(`{"active":"https://ama.example.test#acct_1","profiles":[{"accountId":"acct_1","apiServer":"https://ama.example.test","accessToken":"token","tokenType":"Bearer","expiresAt":"2000-01-01T00:00:00Z"}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadActiveCredentialProfile(credentialPath); err == nil || !strings.Contains(err.Error(), "expired") {
		t.Fatalf("expected expired token error, got %v", err)
	}
	if err := os.WriteFile(credentialPath, []byte(`not json`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadCredentialStore(credentialPath); err == nil {
		t.Fatal("expected invalid json error")
	}
	if _, err := loadRawCredentialFile(""); err == nil {
		t.Fatal("expected empty raw credential path to fail")
	}
	if err := saveRawCredentialFile("", CredentialStore{}); err == nil {
		t.Fatal("expected empty raw credential save path to fail")
	}
	blockedParent := filepath.Join(t.TempDir(), "not-a-dir")
	if err := os.WriteFile(blockedParent, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := saveRawCredentialFile(filepath.Join(blockedParent, "credentials.json"), CredentialStore{}); err == nil {
		t.Fatal("expected save under file parent to fail")
	}
}

func TestSaveLocalConfigValuePrunesUnknownKeys(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte(`{
		"apiServer": "https://ama.example.test",
		"accessToken": "old-token",
		"refreshToken": "old-refresh"
	}`), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := SaveLocalConfigValue(path, "environmentId", "env_1"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	config := string(data)
	if strings.Contains(config, "accessToken") || strings.Contains(config, "refreshToken") {
		t.Fatalf("expected credentials to be pruned from local config, got %s", config)
	}
	if !strings.Contains(config, `"apiServer"`) || !strings.Contains(config, `"environmentId"`) {
		t.Fatalf("expected allowed config keys to remain, got %s", config)
	}
}

func TestLocalConfigParsesAllowedValueTypes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	values := map[string]string{
		"apiServer":          "https://ama.example.test",
		"allowUnsafeProcess": "true",
		"maxConcurrent":      "3",
		"workDir":            "/tmp/work",
	}
	for key, value := range values {
		if err := SaveLocalConfigValue(path, key, value); err != nil {
			t.Fatalf("expected %s to save, got %v", key, err)
		}
	}
	config, err := LoadLocalConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if config["allowUnsafeProcess"] != true || config["maxConcurrent"] != float64(3) && config["maxConcurrent"] != 3 {
		t.Fatalf("unexpected parsed local config: %#v", config)
	}
	keys := LocalConfigKeys()
	if len(keys) == 0 || keys[0] > keys[len(keys)-1] {
		t.Fatalf("expected sorted config keys, got %#v", keys)
	}
}

func TestLocalConfigRejectsInvalidValues(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if _, err := LoadLocalConfig(""); err == nil {
		t.Fatal("expected empty config path to fail")
	}
	cases := []struct {
		key   string
		value string
	}{
		{key: "allowUnsafeProcess", value: "maybe"},
		{key: "maxConcurrent", value: "many"},
		{key: "unknown", value: "value"},
	}
	for _, tc := range cases {
		if err := SaveLocalConfigValue(path, tc.key, tc.value); err == nil {
			t.Fatalf("expected invalid value error for %s=%s", tc.key, tc.value)
		}
	}
	if _, err := LoadLocalConfig(filepath.Join(t.TempDir(), "missing.json")); err != nil {
		t.Fatalf("expected missing config to load empty, got %v", err)
	}
	if err := os.WriteFile(path, []byte(`not json`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadLocalConfig(path); err == nil {
		t.Fatal("expected invalid local config json error")
	}
	if _, err := loadWritableLocalConfig(path); err == nil {
		t.Fatal("expected invalid writable local config json error")
	}
	blockedParent := filepath.Join(t.TempDir(), "not-a-dir")
	if err := os.WriteFile(blockedParent, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := SaveLocalConfigValue(filepath.Join(blockedParent, "config.json"), "apiServer", "https://ama.example.test"); err == nil {
		t.Fatal("expected save under file parent to fail")
	}
	localConfigKeys["durationForTest"] = LocalDuration
	t.Cleanup(func() { delete(localConfigKeys, "durationForTest") })
	if got, err := parseLocalConfigValue("durationForTest", "5s"); err != nil || got != "5s" {
		t.Fatalf("expected duration parse success, got %#v err=%v", got, err)
	}
	if _, err := parseLocalConfigValue("durationForTest", "soon"); err == nil {
		t.Fatal("expected invalid duration error")
	}
}
