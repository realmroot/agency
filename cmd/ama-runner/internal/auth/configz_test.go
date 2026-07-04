package auth

import (
	"strings"
	"testing"

	sdkama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

func testPublicConfig(issuer string, resource string, runnerClientID string, scopes []string) map[string]any {
	return map[string]any{
		"version": 1,
		"service": map[string]any{
			"name":   "Any Managed Agents",
			"origin": resource,
		},
		"auth": map[string]any{
			"oidc": map[string]any{
				"issuer":   issuer,
				"resource": resource,
				"browser": map[string]any{
					"clientId": "browser-client",
					"scopes":   []string{"openid", "email", "profile"},
				},
				"runner": map[string]any{
					"clientId": runnerClientID,
					"scopes":   scopes,
				},
			},
		},
	}
}

func TestEnsureCompatibleConfig(t *testing.T) {
	if err := EnsureCompatibleConfig(&sdkama.PublicConfig{
		Version: sdkama.N1,
		Service: sdkama.PublicServiceConfig{
			Name:   sdkama.AnyManagedAgents,
			Origin: "https://ama.example.test",
		},
	}); err != nil {
		t.Fatalf("expected compatible config response, got %v", err)
	}
	if err := EnsureCompatibleConfig(nil); err == nil || !strings.Contains(err.Error(), "empty") {
		t.Fatalf("expected empty config response error, got %v", err)
	}
	if err := EnsureCompatibleConfig(&sdkama.PublicConfig{
		Version: sdkama.N1,
		Service: sdkama.PublicServiceConfig{
			Name:   "Other",
			Origin: "https://ama.example.test",
		},
	}); err == nil || !strings.Contains(err.Error(), "incompatible") {
		t.Fatalf("expected incompatible config response error, got %v", err)
	}
}

func TestRunnerOidcSettingsFromConfig(t *testing.T) {
	config := &sdkama.PublicConfig{
		Version: sdkama.N1,
		Service: sdkama.PublicServiceConfig{
			Name:   sdkama.AnyManagedAgents,
			Origin: "https://ama.example.test",
		},
		Auth: sdkama.PublicAuthConfig{
			Oidc: &sdkama.PublicOidcConfig{
				Issuer:   "https://issuer.example.test",
				Resource: "https://ama.example.test/",
				Runner: &sdkama.PublicOidcClientConfig{
					ClientId: "runner-client",
					Scopes:   []string{"openid", "profile", "email", "offline_access"},
				},
			},
		},
	}
	settings, err := RunnerOidcSettingsFromConfig(config, "https://fallback.example.test")
	if err != nil {
		t.Fatalf("expected runner oidc settings, got %v", err)
	}
	if settings.Resource != "https://ama.example.test" ||
		settings.ClientID != "runner-client" ||
		settings.Scopes != "openid profile email offline_access" {
		t.Fatalf("unexpected runner settings: %#v", settings)
	}
}
