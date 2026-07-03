package auth

import (
	"strings"
	"testing"
)

func TestValidateLoginCommand(t *testing.T) {
	command, err := ValidateLoginCommand(LoginCommand{
		APIServer:      "https://ama.example.test",
		CredentialPath: "/tmp/credentials.json",
	})
	if err != nil {
		t.Fatalf("expected valid login command, got %v", err)
	}
	if command.APIServer != "https://ama.example.test" {
		t.Fatalf("unexpected login command %#v", command)
	}

	tests := []struct {
		name    string
		command LoginCommand
		want    string
	}{
		{name: "missing api server", command: LoginCommand{CredentialPath: "/tmp/credentials.json"}, want: "URL is required"},
		{name: "relative api server", command: LoginCommand{APIServer: "ama.example.test", CredentialPath: "/tmp/credentials.json"}, want: "absolute URL"},
		{name: "missing credential path", command: LoginCommand{APIServer: "https://ama.example.test"}, want: "credential path"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ValidateLoginCommand(tc.command)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected %q error, got %v", tc.want, err)
			}
		})
	}
}
