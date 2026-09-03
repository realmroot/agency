package cli

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"sort"
	"time"

	runnerauth "github.com/realmroot/enbor/cmd/enbor-runner/internal/auth"
	runnerconfig "github.com/realmroot/enbor/cmd/enbor-runner/internal/config"
	"github.com/spf13/cobra"
)

func RunAuthLogin(ctx context.Context, command *cobra.Command, stdout io.Writer) error {
	login, err := LoadAuthLoginConfig(command)
	if err != nil {
		return err
	}
	return runnerauth.Login(ctx, login, stdout)
}

func RunAuthLogout(command *cobra.Command, args []string, stdout io.Writer) error {
	apiServer := ""
	if len(args) > 0 {
		apiServer = args[0]
	}
	if err := runnerconfig.LogoutCredentialProfile(AuthCredentialPath(), apiServer); err != nil {
		return err
	}
	fmt.Fprintln(stdout, "Logged out")
	return nil
}

func RunAuthRefresh(ctx context.Context, stdout io.Writer) error {
	profile, source, err := activeTokenSource()
	if err != nil {
		return err
	}
	if _, err := source.ForceRefresh(ctx); err != nil {
		return err
	}
	fmt.Fprintf(stdout, "Refreshed token for %s\n", profile.APIServer)
	return nil
}

func RunAuthStatus(stdout io.Writer) error {
	store, err := runnerconfig.LoadCredentialStore(AuthCredentialPath())
	if err != nil {
		return err
	}
	if len(store.Profiles) == 0 || store.Active == "" {
		return fmt.Errorf("not logged in")
	}
	profiles := append([]runnerconfig.CredentialProfile(nil), store.Profiles...)
	sort.Slice(profiles, func(i, j int) bool {
		if profiles[i].APIServer == profiles[j].APIServer {
			return profiles[i].AccountID < profiles[j].AccountID
		}
		return profiles[i].APIServer < profiles[j].APIServer
	})
	for _, profile := range profiles {
		active := " "
		if credentialProfileKey(profile) == store.Active {
			active = "*"
		}
		fmt.Fprintf(stdout, "%s %s %s", active, profile.APIServer, profile.AccountID)
		if profile.Email != "" {
			fmt.Fprintf(stdout, " <%s>", profile.Email)
		}
		if profile.Name != "" {
			fmt.Fprintf(stdout, " name=%q", profile.Name)
		}
		if profile.ExpiresAt != "" {
			fmt.Fprintf(stdout, " expires=%s", profile.ExpiresAt)
		}
		fmt.Fprintln(stdout)
	}
	return nil
}

func RunAuthSwitch(command *cobra.Command, args []string, stdout io.Writer) error {
	apiServer, err := AuthProfileAPIServer(command)
	if err != nil {
		return err
	}
	account := ""
	if len(args) > 0 {
		account = args[0]
	}
	profile, err := runnerconfig.SwitchCredentialProfile(AuthCredentialPath(), apiServer, account)
	if err != nil {
		return err
	}
	fmt.Fprintf(stdout, "Switched to %s %s\n", profile.APIServer, profile.AccountID)
	return nil
}

func activeTokenSource() (*runnerconfig.CredentialProfile, *runnerauth.TokenSource, error) {
	credentialPath := AuthCredentialPath()
	profile, err := runnerconfig.LoadActiveCredentialProfile(credentialPath)
	if err != nil {
		return nil, nil, err
	}
	if profile == nil {
		return nil, nil, fmt.Errorf("not logged in")
	}
	source, err := runnerauth.NewTokenSource(runnerconfig.Config{
		CredentialPath: credentialPath,
		APIServer:      profile.APIServer,
	}, &http.Client{Timeout: 30 * time.Second})
	if err != nil {
		return nil, nil, err
	}
	return profile, source, nil
}

func credentialProfileKey(profile runnerconfig.CredentialProfile) string {
	return profile.APIServer + "#" + profile.AccountID
}
